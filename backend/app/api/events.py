from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import require_admin
from app.config import get_settings
from app.db import get_db
from app.models import Event, Guard, User

router = APIRouter()


class BulkDeleteIn(BaseModel):
    event_ids: list[int] = Field(..., min_length=1, max_length=500)


def _local_boundary_to_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None

    if value.tzinfo is None:
        try:
            local_tz = ZoneInfo(get_settings().app_timezone)
        except ZoneInfoNotFoundError:
            local_tz = timezone.utc
        value = value.replace(tzinfo=local_tz)

    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _delete_snapshot_file(snapshot_path: str | None) -> bool:
    if not snapshot_path:
        return False

    settings = get_settings()
    snapshot_dir = Path(settings.snapshot_dir).resolve()

    try:
        file_path = (snapshot_dir / snapshot_path).resolve()

        # Safety check: never delete outside snapshot_dir
        if snapshot_dir not in file_path.parents and file_path != snapshot_dir:
            return False

        if file_path.exists() and file_path.is_file():
            file_path.unlink()
            return True

    except Exception:
        return False

    return False


@router.get("")
def list_events(
    db: Annotated[Session, Depends(get_db)],
    camera_id: str | None = None,
    event_type: str | None = None,
    source: str | None = Query(None, description='"hikvision" | "face" | "presence" | "yolo"'),
    since: datetime | None = None,
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    limit: int | None = Query(None, ge=1),
    offset: int = 0,
) -> list[dict]:
    date_from = _local_boundary_to_utc(date_from) or since
    date_to = _local_boundary_to_utc(date_to)

    stmt = select(Event).order_by(Event.created_at.desc())
    if camera_id:
        stmt = stmt.where(Event.camera_id == camera_id)
    if event_type:
        stmt = stmt.where(Event.event_type == event_type)
    if source:
        stmt = stmt.where(Event.source == source)
    if date_from:
        stmt = stmt.where(Event.created_at >= date_from)
    if date_to:
        stmt = stmt.where(Event.created_at <= date_to)
    if limit is not None:
        stmt = stmt.limit(limit)
    stmt = stmt.offset(offset)

    rows = db.scalars(stmt).all()

    guard_ids = {e.guard_id for e in rows if e.guard_id is not None}
    guard_names: dict[int, str] = {}
    if guard_ids:
        guards = db.scalars(select(Guard).where(Guard.id.in_(guard_ids))).all()
        guard_names = {g.id: g.name for g in guards}

    return [
        {
            "id": e.id,
            "camera_id": e.camera_id,
            "created_at": e.created_at.isoformat() + "Z",
            "source": e.source,
            "event_type": e.event_type,
            "label": e.label,
            "confidence": e.confidence,
            "snapshot_url": f"/snapshots/{e.snapshot_path}" if e.snapshot_path else None,
            "guard_id": e.guard_id,
            "guard_name": guard_names.get(e.guard_id) if e.guard_id else None,
            "face_score": e.face_score,
        }
        for e in rows
    ]


@router.delete("/bulk")
def delete_events_bulk(
    payload: BulkDeleteIn,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin)],
) -> dict:
    rows = db.scalars(select(Event).where(Event.id.in_(payload.event_ids))).all()

    if not rows:
        raise HTTPException(404, "no matching events found")

    deleted_files = 0

    for event in rows:
        if _delete_snapshot_file(event.snapshot_path):
            deleted_files += 1

        db.delete(event)

    db.commit()

    return {
        "ok": True,
        "deleted_events": len(rows),
        "deleted_snapshots": deleted_files,
    }
