"""Ingest endpoint used by the detector service.

Detector sends recognition heartbeats here.

Backend behavior:
- Correct assigned/backup guard updates last_seen every time.
- guard_present event is stored only first time or after guard_absent.
- Duplicate guard_present is ignored from event log.
- Wrong guard is stored when recognized guard is not assigned/backup and wrong-guard alert is enabled.
- Wrong-guard alerts require an assigned/backup guard and repeat after 10 minutes,
  unless a valid guard appears first and resets the cooldown.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.ws import broadcast
from app.db import session_scope
from app.models import CameraPost, Event
from app.services import alerts, presence_state

log = logging.getLogger(__name__)
router = APIRouter()

WRONG_GUARD_RENOTIFY_MIN = 10


class DetectionIn(BaseModel):
    camera_id: str
    event_type: Literal[
        "guard_present",
        "unknown_person",
        "detection",
    ] = "detection"
    source: Literal["face", "yolo"] = "face"
    label: str | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    snapshot_path: str | None = None
    guard_id: int | None = None
    face_score: float | None = Field(default=None, ge=0.0, le=1.0)


async def _save_and_broadcast(
    *,
    camera_id: str,
    source: str,
    event_type: str,
    label: str | None,
    confidence: float | None,
    snapshot_path: str | None,
    guard_id: int | None,
    face_score: float | None,
    notify: bool,
) -> dict:
    ts = datetime.utcnow()

    with session_scope() as db:
        ev = Event(
            camera_id=camera_id,
            created_at=ts,
            source=source,
            event_type=event_type,
            label=label,
            confidence=confidence,
            snapshot_path=snapshot_path,
            guard_id=guard_id,
            face_score=face_score,
        )
        db.add(ev)
        db.flush()
        event_id = ev.id

    payload = {
        "id": event_id,
        "camera_id": camera_id,
        "source": source,
        "event_type": event_type,
        "label": label,
        "confidence": confidence,
        "snapshot_path": snapshot_path,
        "guard_id": guard_id,
        "face_score": face_score,
        "created_at": ts.isoformat() + "Z",
    }

    await broadcast(payload)

    if notify:
        await alerts.maybe_send(payload)

    return {"ok": True, "event_id": event_id}


def _get_post_rules(camera_id: str) -> tuple[int | None, int | None, bool]:
    with session_scope() as db:
        post = db.get(CameraPost, camera_id)

        if not post:
            return None, None, False

        assigned_id = post.assigned_guard_id
        backup_id = post.backup_guard_id
        alert_wrong_guard = bool(post.alert_wrong_guard)

        return assigned_id, backup_id, alert_wrong_guard


def _recent_wrong_guard_exists(camera_id: str, guard_id: int) -> bool:
    if WRONG_GUARD_RENOTIFY_MIN <= 0:
        return False

    cutoff = datetime.utcnow() - timedelta(minutes=WRONG_GUARD_RENOTIFY_MIN)

    with session_scope() as db:
        latest_wrong_guard = db.scalar(
            select(Event)
            .where(
                Event.camera_id == camera_id,
                Event.event_type == "wrong_guard",
                Event.guard_id == guard_id,
                Event.created_at >= cutoff,
            )
            .order_by(Event.id.desc())
            .limit(1)
        )

        if latest_wrong_guard is None:
            return False

        valid_guard_seen_after = db.scalar(
            select(Event.id)
            .where(
                Event.camera_id == camera_id,
                Event.event_type == "guard_present",
                Event.created_at > latest_wrong_guard.created_at,
            )
            .order_by(Event.id.desc())
            .limit(1)
        )

        return valid_guard_seen_after is None


@router.post("")
async def ingest(payload: DetectionIn) -> dict:
    log.info(
        "DETECTION camera=%s type=%s guard=%s label=%s",
        payload.camera_id,
        payload.event_type,
        payload.guard_id,
        payload.label,
    )

    ts = datetime.utcnow()

    if payload.event_type == "guard_present" and payload.guard_id is not None:
        assigned_id, backup_id, alert_wrong_guard = _get_post_rules(payload.camera_id)

        valid_guard_ids = [
            gid for gid in [assigned_id, backup_id] if gid is not None
        ]

        # Correct assigned/backup guard
        if payload.guard_id in valid_guard_ids:
            presence_state.mark_seen(payload.camera_id, payload.guard_id, ts)

            previous_state = presence_state.get_state(payload.camera_id)

            if previous_state == "present":
                return {"ok": True, "ignored": "duplicate_guard_present"}

            presence_state.set_state(payload.camera_id, "present")

            notify = previous_state == "absent"

            return await _save_and_broadcast(
                camera_id=payload.camera_id,
                source=payload.source,
                event_type="guard_present",
                label=payload.label,
                confidence=payload.confidence,
                snapshot_path=payload.snapshot_path,
                guard_id=payload.guard_id,
                face_score=payload.face_score,
                notify=notify,
            )

        # A guard can only be "wrong" when this post has a configured guard.
        if alert_wrong_guard and (assigned_id is not None or backup_id is not None):
            if _recent_wrong_guard_exists(payload.camera_id, payload.guard_id):
                return {
                    "ok": True,
                    "ignored": "duplicate_wrong_guard",
                    "renotify_min": WRONG_GUARD_RENOTIFY_MIN,
                }

            presence_state.set_state(payload.camera_id, "wrong_guard")

            return await _save_and_broadcast(
                camera_id=payload.camera_id,
                source=payload.source,
                event_type="wrong_guard",
                label=payload.label,
                confidence=payload.confidence,
                snapshot_path=payload.snapshot_path,
                guard_id=payload.guard_id,
                face_score=payload.face_score,
                notify=True,
            )

        return {"ok": True, "ignored": "known_guard_not_assigned"}

    # Unknown person / generic detection
    return await _save_and_broadcast(
        camera_id=payload.camera_id,
        source=payload.source,
        event_type=payload.event_type,
        label=payload.label,
        confidence=payload.confidence,
        snapshot_path=payload.snapshot_path,
        guard_id=payload.guard_id,
        face_score=payload.face_score,
        notify=payload.event_type != "guard_present",
    )
