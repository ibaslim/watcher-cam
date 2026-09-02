from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    LargeBinary,
    Boolean,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


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
    detect: Mapped[bool] = mapped_column(Boolean, default=True)
    recording_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    rtsp_url_override: Mapped[str] = mapped_column(String(512), default="")
    recorder_id: Mapped[str] = mapped_column(String(64), default="")
    recorder_name: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
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
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    raw: Mapped[str | None] = mapped_column(Text, nullable=True)


class PersonIdentity(Base):
    """A persistent, global identity inferred from high-quality face samples."""

    __tablename__ = "person_identities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="provisional", index=True)
    representative_image_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    appearance_count: Mapped[int] = mapped_column(Integer, default=0)
    first_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PersonEmbedding(Base):
    """A normalized float32 ArcFace template belonging to one identity."""

    __tablename__ = "person_embeddings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    person_id: Mapped[int] = mapped_column(Integer, index=True)
    embedding: Mapped[bytes] = mapped_column(LargeBinary)
    dimensions: Mapped[int] = mapped_column(Integer, default=512)
    model_name: Mapped[str] = mapped_column(String(64), default="buffalo_l")
    quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    camera_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    face_image_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class PersonAppearance(Base):
    """One saved visit/snapshot in a person's album."""

    __tablename__ = "person_appearances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    person_id: Mapped[int] = mapped_column(Integer, index=True)
    event_id: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True, index=True)
    camera_id: Mapped[str] = mapped_column(String(64), index=True)
    track_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    snapshot_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    person_crop_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    face_crop_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    match_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    face_quality: Mapped[float | None] = mapped_column(Float, nullable=True)
    match_method: Mapped[str] = mapped_column(String(32), default="face")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class AmbiguousAppearance(Base):
    """A person detection without a face reliable enough for identification."""

    __tablename__ = "ambiguous_appearances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    event_id: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True, index=True)
    camera_id: Mapped[str] = mapped_column(String(64), index=True)
    track_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    snapshot_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    person_crop_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reason: Mapped[str] = mapped_column(String(64), default="no_usable_face")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

class CameraClassification(Base):
    """A cropped, per-camera gallery item for unique detections."""

    __tablename__ = "camera_classifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    camera_id: Mapped[str] = mapped_column(String(64), index=True)
    category: Mapped[str] = mapped_column(String(32), index=True)
    label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    crop_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    fingerprint: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    source_event_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    occurrence_count: Mapped[int] = mapped_column(Integer, default=1)
    first_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


Index("ix_events_camera_created", Event.camera_id, Event.created_at.desc())
Index("ix_events_type_created", Event.event_type, Event.created_at.desc())
