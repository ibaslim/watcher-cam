from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Event, Guard
from app.services.cameras import list_cameras

router = APIRouter()


def _report_boundary_to_utc(value: datetime | None) -> datetime | None:
    """Convert report filter datetimes to the UTC-naive format stored in DB.

    Browser ``datetime-local`` inputs intentionally submit no timezone offset,
    so FastAPI parses them as naive datetimes. Treat those values as the app's
    configured local timezone, then convert to UTC before filtering. This keeps
    short windows like "last 5 minutes" or "last 1 hour" aligned with what the
    user selected in the portal.
    """

    if value is None:
        return None

    if value.tzinfo is None:
        tz_name = get_settings().app_timezone
        try:
            local_tz = ZoneInfo(tz_name)
        except ZoneInfoNotFoundError:
            local_tz = timezone.utc
        value = value.replace(tzinfo=local_tz)

    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _event_filters(stmt, camera_id, event_type, source, date_from, date_to):
    date_from = _report_boundary_to_utc(date_from)
    date_to = _report_boundary_to_utc(date_to)

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
    return stmt


def _guard_names(db: Session, rows: list[Event]) -> dict[int, str]:
    guard_ids = {e.guard_id for e in rows if e.guard_id is not None}
    if not guard_ids:
        return {}
    guards = db.scalars(select(Guard).where(Guard.id.in_(guard_ids))).all()
    return {g.id: g.name for g in guards}


def _event_to_dict(e: Event, guard_names: dict[int, str]) -> dict:
    return {
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


@router.get("/events")
def report_events(
    db: Annotated[Session, Depends(get_db)],
    camera_id: str | None = None,
    event_type: str | None = None,
    source: str | None = None,
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    limit: int = Query(500, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[dict]:
    stmt = select(Event).order_by(Event.created_at.desc())
    stmt = _event_filters(stmt, camera_id, event_type, source, date_from, date_to)
    stmt = stmt.limit(limit).offset(offset)

    rows = db.scalars(stmt).all()
    guard_names = _guard_names(db, rows)

    return [_event_to_dict(e, guard_names) for e in rows]


@router.get("/summary")
def report_summary(
    db: Annotated[Session, Depends(get_db)],
    camera_id: str | None = None,
    event_type: str | None = None,
    source: str | None = None,
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
) -> dict:
    base = select(Event)
    base = _event_filters(base, camera_id, event_type, source, date_from, date_to)
    rows = db.scalars(base).all()

    total_events = len(rows)
    unknown_person = sum(1 for e in rows if e.event_type == "unknown_person")
    guard_present = sum(1 for e in rows if e.event_type == "guard_present")
    guard_absent = sum(1 for e in rows if e.event_type == "guard_absent")
    intrusion = sum(1 for e in rows if e.event_type == "intrusion")
    line_crossing = sum(1 for e in rows if e.event_type == "line_crossing")

    camera_names = {c.id: c.name for c in list_cameras()}
    camera_breakdown: dict[str, dict] = {}

    for e in rows:
        if e.camera_id not in camera_breakdown:
            camera_breakdown[e.camera_id] = {
                "camera_id": e.camera_id,
                "camera_name": camera_names.get(e.camera_id, e.camera_id),
                "total": 0,
                "unknown_person": 0,
                "guard_present": 0,
                "guard_absent": 0,
                "intrusion": 0,
                "line_crossing": 0,
            }

        camera_breakdown[e.camera_id]["total"] += 1

        if e.event_type in camera_breakdown[e.camera_id]:
            camera_breakdown[e.camera_id][e.event_type] += 1

    return {
        "total_events": total_events,
        "unknown_person": unknown_person,
        "guard_present": guard_present,
        "guard_absent": guard_absent,
        "intrusion": intrusion,
        "line_crossing": line_crossing,
        "camera_breakdown": list(camera_breakdown.values()),
    }


@router.get("/events.csv")
def report_events_csv(
    db: Annotated[Session, Depends(get_db)],
    camera_id: str | None = None,
    event_type: str | None = None,
    source: str | None = None,
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
):
    stmt = select(Event).order_by(Event.created_at.desc())
    stmt = _event_filters(stmt, camera_id, event_type, source, date_from, date_to)
    rows = db.scalars(stmt).all()
    guard_names = _guard_names(db, rows)

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow([
        "ID",
        "Date Time",
        "Camera ID",
        "Source",
        "Event Type",
        "Label",
        "Guard Name",
        "Confidence",
        "Face Score",
        "Snapshot",
    ])

    for e in rows:
        writer.writerow([
            e.id,
            e.created_at.isoformat(),
            e.camera_id,
            e.source,
            e.event_type,
            e.label or "",
            guard_names.get(e.guard_id, "") if e.guard_id else "",
            e.confidence if e.confidence is not None else "",
            e.face_score if e.face_score is not None else "",
            e.snapshot_path or "",
        ])

    output.seek(0)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=ai-camera-events-report.csv"},
    )
