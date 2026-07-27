from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.api.detections as detections_module
from app.api.detections import ClassificationIn, ingest_classification
from app.db import Base
from app.models import CameraClassification


def test_ingest_classification_uses_crop_path_when_fingerprint_missing(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)

    @contextmanager
    def fake_session_scope():
        session = Session()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    monkeypatch.setattr(detections_module, "session_scope", fake_session_scope)

    result = ingest_classification(
        ClassificationIn(
            camera_id="CAM01",
            category="person",
            label="person",
            crop_path="cam01_person_crop.jpg",
            fingerprint=None,
            confidence=0.91,
            source_event_type="person_detected",
        )
    )

    assert result["created"] is True

    with Session() as session:
        rows = session.query(CameraClassification).all()

    assert len(rows) == 1
    assert rows[0].fingerprint is not None
    assert rows[0].crop_path == "cam01_person_crop.jpg"
