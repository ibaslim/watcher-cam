from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.api.detections as detections_module
from app.api.detections import ClassificationIn, ingest_classification
from app.models import AmbiguousAppearance, Base, Event, PersonIdentity


def test_person_without_usable_face_goes_to_ambiguous_gallery(monkeypatch) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)

    with Session() as session:
        event = Event(camera_id="CAM01", source="yolo", event_type="person_detected", label="person", snapshot_path="dark.jpg")
        session.add(event)
        session.commit()
        event_id = event.id

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
    result = ingest_classification(ClassificationIn(
        camera_id="CAM01", category="person", event_id=event_id,
        crop_path=None, embedding=None, track_id=3,
    ))

    with Session() as session:
        event = session.get(Event, event_id)
        ambiguous = session.query(AmbiguousAppearance).one()
        assert session.query(PersonIdentity).count() == 0
        assert event is not None and event.entity_id == ambiguous.public_id
        assert ambiguous.reason == "no_usable_face"

    assert result["ambiguous"] is True
