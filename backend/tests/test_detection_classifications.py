from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.detections import _upsert_classification_from_event
from app.api.events import _serialize_classification
from app.models import Base, CameraClassification, Event


def test_upsert_classification_from_event_creates_row(tmp_path: Path) -> None:
    snapshot_path = tmp_path / "sample.jpg"
    snapshot_path.write_bytes(b"sample-image-data")

    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with Session() as session:
        classification_id, created, entity_id = _upsert_classification_from_event(
            session,
            camera_id="CAM01",
            category="person",
            label="person",
            crop_path=snapshot_path.name,
            fingerprint="abc123",
            confidence=0.95,
            source_event_type="person_detected",
        )

        row = session.query(CameraClassification).one()

    assert created is True
    assert classification_id == row.id
    assert row.camera_id == "CAM01"
    assert row.category == "person"
    assert row.crop_path == snapshot_path.name
    assert row.fingerprint == "abc123"
    assert row.occurrence_count == 1
    assert row.confidence == 0.95
    assert entity_id == row.entity_id


def test_upsert_classification_without_fingerprint_still_creates_row(tmp_path: Path) -> None:
    snapshot_path = tmp_path / "sample.jpg"
    snapshot_path.write_bytes(b"sample-image-data")

    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with Session() as session:
        classification_id, created, entity_id = _upsert_classification_from_event(
            session,
            camera_id="CAM01",
            category="person",
            label="person",
            crop_path=snapshot_path.name,
            confidence=0.93,
            source_event_type="person_detected",
        )

        row = session.query(CameraClassification).one()

    assert created is True
    assert classification_id == row.id
    assert row.camera_id == "CAM01"
    assert row.category == "person"
    assert row.crop_path == snapshot_path.name
    assert row.fingerprint is not None
    assert row.occurrence_count == 1
    assert row.confidence == 0.93
    assert entity_id == row.entity_id


def test_upsert_classification_falls_back_to_event_snapshot(tmp_path: Path) -> None:
    snapshot_path = tmp_path / "event-snapshot.jpg"
    snapshot_path.write_bytes(b"sample-image-data")

    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with Session() as session:
        event = Event(
            camera_id="CAM01",
            source="face",
            event_type="person_detected",
            label="person",
            snapshot_path=snapshot_path.name,
        )
        session.add(event)
        session.flush()

        classification_id, created, entity_id = _upsert_classification_from_event(
            session,
            camera_id="CAM01",
            category="person",
            label="person",
            crop_path=None,
            event_id=event.id,
            confidence=0.91,
            source_event_type="person_detected",
        )

        row = session.query(CameraClassification).one()

    assert created is True
    assert classification_id == row.id
    assert row.crop_path == snapshot_path.name
    assert entity_id == row.entity_id


def test_serialize_classification_includes_stable_key_and_omits_missing_crop(tmp_path: Path) -> None:
    row = SimpleNamespace(
        id=7,
        camera_id="CAM01",
        category="person",
        label="person",
        crop_path="missing.jpg",
        occurrence_count=3,
        first_seen=datetime(2024, 1, 1, tzinfo=timezone.utc),
        last_seen=datetime(2024, 1, 2, tzinfo=timezone.utc),
        confidence=0.98,
        source_event_type="person_detected",
    )

    payload = _serialize_classification(row, snapshot_dir=str(tmp_path))

    assert payload["classification_key"] == "person:7"
    assert payload["crop_url"] is None


def test_serialize_classification_uses_snapshot_image(tmp_path: Path) -> None:
    snapshot = tmp_path / "snapshot.jpg"
    snapshot.write_bytes(b"crop-image-data")

    row = SimpleNamespace(
        id=8,
        camera_id="CAM02",
        category="person",
        label="person",
        snapshot_path=snapshot.name,
        occurrence_count=1,
        first_seen=datetime(2024, 1, 1, tzinfo=timezone.utc),
        last_seen=datetime(2024, 1, 2, tzinfo=timezone.utc),
        confidence=0.89,
        source_event_type="person_detected",
    )

    payload = _serialize_classification(row, snapshot_dir=str(tmp_path))

    assert payload["crop_url"] == "/snapshots/snapshot.jpg"


def test_upsert_classification_matches_similar_fingerprint(tmp_path: Path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with Session() as session:
        first_id, created, first_entity_id = _upsert_classification_from_event(
            session,
            camera_id="CAM01",
            category="person",
            label="person",
            crop_path="first.jpg",
            fingerprint="0000000000000000",
            confidence=0.95,
            source_event_type="person_detected",
        )
        assert created is True

        second_id, created, second_entity_id = _upsert_classification_from_event(
            session,
            camera_id="CAM01",
            category="person",
            label="person",
            crop_path="second.jpg",
            fingerprint="0000000000000001",
            confidence=0.96,
            source_event_type="person_detected",
        )

    assert first_id == second_id
    assert created is False
    assert first_entity_id == second_entity_id


def test_serialize_classification_skips_blurry_crop(tmp_path: Path) -> None:
    blurry = np.zeros((80, 80, 3), dtype=np.uint8)
    cv2.imwrite(str(tmp_path / "blurry.jpg"), blurry)

    row = SimpleNamespace(
        id=9,
        camera_id="CAM01",
        category="person",
        label="person",
        crop_path="blurry.jpg",
        occurrence_count=1,
        first_seen=datetime(2024, 1, 1, tzinfo=timezone.utc),
        last_seen=datetime(2024, 1, 2, tzinfo=timezone.utc),
        confidence=0.89,
        source_event_type="person_detected",
    )

    payload = _serialize_classification(row, snapshot_dir=str(tmp_path))

    assert payload["crop_url"] is None
