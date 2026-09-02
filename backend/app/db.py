from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.models import Base

_settings = get_settings()

engine = create_engine(
    _settings.database_url,
    connect_args={"check_same_thread": False} if _settings.database_url.startswith("sqlite") else {},
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def init_db() -> None:
    Base.metadata.create_all(engine)
    _apply_sqlite_additive_migrations()


def _apply_sqlite_additive_migrations() -> None:
    if not _settings.database_url.startswith("sqlite"):
        return

    with engine.begin() as connection:
        camera_columns = {column["name"] for column in inspect(engine).get_columns("cameras")}
        camera_additions = {
            "recorder_id": "VARCHAR(64) NOT NULL DEFAULT ''",
            "recorder_name": "VARCHAR(128) NOT NULL DEFAULT ''",
        }

        for name, definition in camera_additions.items():
            if name not in camera_columns:
                connection.execute(
                    text(f"ALTER TABLE cameras ADD COLUMN {name} {definition}")
                )

        event_columns = {column["name"] for column in inspect(engine).get_columns("events")}
        event_additions = {
            "entity_id": "VARCHAR(64)",
        }

        for name, definition in event_additions.items():
            if name not in event_columns:
                connection.execute(
                    text(f"ALTER TABLE events ADD COLUMN {name} {definition}")
                )

        classification_columns = {column["name"] for column in inspect(engine).get_columns("camera_classifications")}
        classification_additions = {
            "entity_id": "VARCHAR(64)",
        }

        for name, definition in classification_additions.items():
            if name not in classification_columns:
                connection.execute(
                    text(f"ALTER TABLE camera_classifications ADD COLUMN {name} {definition}")
                )

        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_events_entity_id ON events (entity_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_camera_classifications_entity_id ON camera_classifications (entity_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_person_embeddings_person_id ON person_embeddings (person_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_person_appearances_person_id ON person_appearances (person_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_ambiguous_appearances_camera_id ON ambiguous_appearances (camera_id)"))

        connection.execute(
            text(
                """
                UPDATE cameras
                SET
                    recorder_id = substr(id, 1, instr(id, '-ch') - 1),
                    recorder_name = substr(id, 1, instr(id, '-ch') - 1)
                WHERE
                    recorder_id = ''
                    AND instr(id, '-ch') > 1
                """
            )
        )

def _backfill_event_entity_ids() -> None:
    from sqlalchemy import select

    from app.api.events import _build_snapshot_entity_index
    from app.models import Event

    with SessionLocal() as session:
        rows = session.scalars(
            select(Event).where(Event.entity_id.is_(None)).order_by(Event.created_at.asc())
        ).all()

        if not rows:
            return

        entity_by_event_id, _ = _build_snapshot_entity_index(rows, snapshot_dir=_settings.snapshot_dir)

        changed = False
        for event in rows:
            entity_id = entity_by_event_id.get(event.id)
            if entity_id and event.entity_id != entity_id:
                event.entity_id = entity_id
                changed = True

        if changed:
            session.commit()


@contextmanager
def session_scope() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
