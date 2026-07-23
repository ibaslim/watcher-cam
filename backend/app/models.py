from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    full_name: Mapped[str] = mapped_column(String(128), default="")
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), default="operator")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Guard(Base):
    """An enrolled guard whose face the system can recognize."""

    __tablename__ = "guards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    embeddings: Mapped[list["GuardEmbedding"]] = relationship(
        back_populates="guard", cascade="all, delete-orphan"
    )


class GuardEmbedding(Base):
    """One face embedding per uploaded reference photo."""

    __tablename__ = "guard_embeddings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    guard_id: Mapped[int] = mapped_column(
        ForeignKey("guards.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # 512-dim float32 ArcFace embedding, stored as raw bytes.
    vector: Mapped[bytes] = mapped_column(LargeBinary)

    # Optional reference photo filename under data/guard_photos/.
    photo_path: Mapped[str | None] = mapped_column(String(255), nullable=True)

    guard: Mapped[Guard] = relationship(back_populates="embeddings")


class Camera(Base):
    """A configured camera."""

    __tablename__ = "cameras"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    host: Mapped[str] = mapped_column(String(128), default="")
    rtsp_port: Mapped[int] = mapped_column(Integer, default=554)
    http_port: Mapped[int] = mapped_column(Integer, default=80)
    username: Mapped[str] = mapped_column(String(64), default="")
    password: Mapped[str] = mapped_column(String(128), default="")
    channel: Mapped[int] = mapped_column(Integer, default=101)
    detect: Mapped[bool] = mapped_column(Boolean, default=False)
    recording_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    rtsp_url_override: Mapped[str] = mapped_column(String(512), default="")
    recorder_id: Mapped[str] = mapped_column(String(64), default="")
    recorder_name: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class CameraPost(Base):
    """Per-camera guard-monitoring config."""

    __tablename__ = "camera_posts"

    camera_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    post_name: Mapped[str] = mapped_column(String(128), default="")

    assigned_guard_id: Mapped[int | None] = mapped_column(
        ForeignKey("guards.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    backup_guard_id: Mapped[int | None] = mapped_column(
        ForeignKey("guards.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    alert_guard_absent: Mapped[bool] = mapped_column(Boolean, default=True)
    alert_wrong_guard: Mapped[bool] = mapped_column(Boolean, default=True)
    alert_unknown_person: Mapped[bool] = mapped_column(Boolean, default=False)

    is_guarded: Mapped[bool] = mapped_column(Boolean, default=True)
    duty_start_hour: Mapped[int] = mapped_column(Integer, default=0)
    duty_end_hour: Mapped[int] = mapped_column(Integer, default=24)
    absence_threshold_min: Mapped[int] = mapped_column(Integer, default=15)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class Event(Base):
    """A single detection, alarm, or presence event."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    camera_id: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    source: Mapped[str] = mapped_column(String(16))
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    snapshot_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    raw: Mapped[str | None] = mapped_column(Text, nullable=True)

    guard_id: Mapped[int | None] = mapped_column(
        ForeignKey("guards.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    face_score: Mapped[float | None] = mapped_column(Float, nullable=True)


Index("ix_events_camera_created", Event.camera_id, Event.created_at.desc())
Index("ix_events_type_created", Event.event_type, Event.created_at.desc())
