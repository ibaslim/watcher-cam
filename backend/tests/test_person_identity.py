from pathlib import Path

import numpy as np
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, Event, PersonAppearance, PersonIdentity
from app.services.person_identity import identify_and_record


def _event(session, snapshot: str) -> Event:
    row = Event(camera_id="CAM01", source="yolo", event_type="person_detected", label="person", snapshot_path=snapshot)
    session.add(row)
    session.flush()
    return row


def test_same_face_reuses_global_identity_and_builds_album(tmp_path: Path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'identity.db'}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    vector = np.zeros(512, dtype=np.float32)
    vector[0] = 1.0

    with Session() as session:
        first = identify_and_record(session, embedding=vector.tolist(), camera_id="CAM01", event=_event(session, "one.jpg"), track_id=1, snapshot_path="one.jpg", person_crop_path="one-person.jpg", face_crop_path="one-face.jpg", face_quality=2.0, model_name="buffalo_l")
        session.commit()
        second = identify_and_record(session, embedding=vector.tolist(), camera_id="CAM02", event=_event(session, "two.jpg"), track_id=9, snapshot_path="two.jpg", person_crop_path="two-person.jpg", face_crop_path="two-face.jpg", face_quality=2.1, model_name="buffalo_l")
        session.commit()

        assert first is not None and second is not None
        assert first.public_id == second.public_id
        assert session.query(PersonIdentity).count() == 1
        assert session.query(PersonAppearance).count() == 2


def test_different_faces_create_different_identities(tmp_path: Path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'identity.db'}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    first_vector = np.eye(1, 512, 0, dtype=np.float32)[0]
    second_vector = np.eye(1, 512, 1, dtype=np.float32)[0]

    with Session() as session:
        first = identify_and_record(session, embedding=first_vector.tolist(), camera_id="CAM01", event=_event(session, "one.jpg"), track_id=1, snapshot_path="one.jpg", person_crop_path=None, face_crop_path=None, face_quality=1.0, model_name="buffalo_l")
        second = identify_and_record(session, embedding=second_vector.tolist(), camera_id="CAM01", event=_event(session, "two.jpg"), track_id=2, snapshot_path="two.jpg", person_crop_path=None, face_crop_path=None, face_quality=1.0, model_name="buffalo_l")
        assert first is not None and second is not None
        assert first.public_id != second.public_id
