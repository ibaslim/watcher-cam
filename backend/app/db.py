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

    post_columns = {column["name"] for column in inspect(engine).get_columns("camera_posts")}
    post_additions = {
    }

    with engine.begin() as connection:
        for name, definition in post_additions.items():
            if name not in post_columns:
                connection.execute(
                    text(f"ALTER TABLE camera_posts ADD COLUMN {name} {definition}")
                )

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
