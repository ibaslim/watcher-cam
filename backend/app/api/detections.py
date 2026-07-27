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
import hashlib
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.ws import broadcast
from app.db import session_scope
from app.models import CameraClassification, CameraPost, Event
from app.services import alerts, presence_state

log = logging.getLogger(__name__)
router = APIRouter()

WRONG_GUARD_RENOTIFY_MIN = 10


class DetectionIn(BaseModel):
    camera_id: str
    event_type: Literal[
        "guard_present",
        "unknown_person",
        "person_detected",
        "vehicle_detected",
        "animal_detected",
        "detection",
    ] = "detection"
    source: Literal["face", "yolo"] = "face"
    label: str | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    snapshot_path: str | None = None
    guard_id: int | None = None
    face_score: float | None = Field(default=None, ge=0.0, le=1.0)


class ClassificationIn(BaseModel):
    camera_id: str
    category: Literal["person", "animal", "vehicle"]
    label: str | None = None
    crop_path: str | None = None
    fingerprint: str | None = None
    event_id: int | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    source_event_type: str | None = None


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


def _fingerprint_distance(a: str | None, b: str | None) -> int:
    if not a or not b:
        return 999

    if len(a) != len(b):
        return 999

    return sum(1 for x, y in zip(a, b) if x != y)


def _next_entity_id(session, *, camera_id: str, category: str) -> str:
    prefix = f"{camera_id}-{category}-"
    existing_ids = session.scalars(
        select(CameraClassification.entity_id).where(CameraClassification.entity_id.like(f"{prefix}%"), CameraClassification.entity_id.isnot(None))
    ).all()
    existing_ids.extend(
        session.scalars(
            select(Event.entity_id).where(Event.entity_id.like(f"{prefix}%"), Event.entity_id.isnot(None))
        ).all()
    )

    max_index = 0
    for entity_id in existing_ids:
        if not entity_id or not entity_id.startswith(prefix):
            continue
        suffix = entity_id[len(prefix):]
        try:
            max_index = max(max_index, int(suffix))
        except ValueError:
            continue

    return f"{prefix}{max_index + 1:04d}"


def _upsert_classification_from_event(
    session,
    *,
    camera_id: str,
    category: str,
    label: str | None,
    crop_path: str | None,
    fingerprint: str | None = None,
    event_id: int | None = None,
    confidence: float | None = None,
    source_event_type: str | None = None,
) -> tuple[int | None, bool, str | None]:
    ts = datetime.utcnow()
    event_row = session.get(Event, event_id) if event_id is not None else None
    event_entity_id = event_row.entity_id if event_row else None
    artifact_path = crop_path or (event_row.snapshot_path if event_row else None)

    if not artifact_path:
        return None, False, None

    if not fingerprint:
        fingerprint = hashlib.blake2b(artifact_path.encode("utf-8"), digest_size=16).hexdigest()

    existing = None
    if fingerprint:
        existing = session.scalar(
            select(CameraClassification).where(
                CameraClassification.camera_id == camera_id,
                CameraClassification.category == category,
                CameraClassification.fingerprint == fingerprint,
            )
        )

        if existing is None:
            recent_cutoff = ts - timedelta(minutes=30)
            recent_rows = session.scalars(
                select(CameraClassification).where(
                    CameraClassification.camera_id == camera_id,
                    CameraClassification.category == category,
                    CameraClassification.last_seen >= recent_cutoff,
                    CameraClassification.fingerprint.isnot(None),
                )
                .order_by(CameraClassification.last_seen.desc())
            ).all()

            for candidate in recent_rows:
                if _fingerprint_distance(candidate.fingerprint, fingerprint) <= 4:
                    existing = candidate
                    break
    else:
        existing = session.scalar(
            select(CameraClassification).where(
                CameraClassification.camera_id == camera_id,
                CameraClassification.category == category,
                CameraClassification.crop_path == crop_path,
            )
        )

    entity_id = existing.entity_id if existing and existing.entity_id else event_entity_id
    if entity_id is None:
        entity_id = _next_entity_id(session, camera_id=camera_id, category=category)

    if existing is None:
        item = CameraClassification(
            camera_id=camera_id,
            category=category,
            label=label,
            crop_path=artifact_path,
            entity_id=entity_id,
            fingerprint=fingerprint,
            source_event_type=source_event_type,
            confidence=confidence,
            occurrence_count=1,
            first_seen=ts,
            last_seen=ts,
        )
        session.add(item)
        session.flush()
        existing = item
        created = True
    else:
        created = False

    existing.entity_id = entity_id
    existing.label = label or existing.label
    existing.crop_path = artifact_path if artifact_path else existing.crop_path
    existing.source_event_type = source_event_type or existing.source_event_type
    existing.confidence = confidence if confidence is not None else existing.confidence
    existing.occurrence_count = existing.occurrence_count + (0 if created else 1)
    if created:
        existing.occurrence_count = 1
    existing.last_seen = ts

    if event_row is not None:
        event_row.entity_id = entity_id

    return existing.id, created, entity_id


@router.post("/classifications")
def ingest_classification(payload: ClassificationIn) -> dict:
    with session_scope() as db:
        item_id, created, entity_id = _upsert_classification_from_event(
            db,
            camera_id=payload.camera_id,
            category=payload.category,
            label=payload.label,
            crop_path=payload.crop_path,
            fingerprint=payload.fingerprint,
            event_id=payload.event_id,
            confidence=payload.confidence,
            source_event_type=payload.source_event_type,
        )

    return {"ok": True, "created": created, "classification_id": item_id, "entity_id": entity_id}


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
