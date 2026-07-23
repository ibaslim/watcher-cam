"""Absence detector.

Runs in the backend as a background task. It scans guarded posts and checks
whether the assigned guard or backup guard was recently seen.

Rules:
- No assigned guard = no absence alert
- Backup guard counts as valid presence
- Alerts only fire during duty hours
- alert_guard_absent must be enabled
- is_guarded must be enabled
- Absence threshold comes from GUI
- Repeated absent alert comes every ABSENCE_RENOTIFY_MIN minutes
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.api.ws import broadcast
from app.config import get_settings
from app.db import session_scope
from app.models import CameraPost, Event
from app.services import alerts, hikvision, presence_state
from app.services.cameras import get_camera

log = logging.getLogger(__name__)

CHECK_INTERVAL_SEC = 15
ABSENCE_RENOTIFY_MIN = 10


def _app_timezone() -> ZoneInfo:
    settings = get_settings()
    tz_name = getattr(settings, "app_timezone", "Asia/Karachi") or "Asia/Karachi"

    try:
        return ZoneInfo(tz_name)
    except Exception:
        log.warning("invalid APP_TIMEZONE=%s, falling back to Asia/Karachi", tz_name)
        return ZoneInfo("Asia/Karachi")


def _is_on_duty(start_hour: int, end_hour: int, now_local: datetime) -> bool:
    hour = now_local.hour

    if start_hour == 0 and end_hour == 24:
        return True

    return start_hour <= hour < end_hour


async def _snapshot_for_camera(camera_id: str) -> str | None:
    cam = get_camera(camera_id)
    if not cam:
        return None

    try:
        jpg = await hikvision.snapshot(cam)
    except Exception as e:
        log.warning("absence snapshot for %s failed: %s", camera_id, e)
        jpg = None

    if not jpg:
        return None

    filename = f"{camera_id}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S_%f')}_absent.jpg"
    path = Path(get_settings().snapshot_dir) / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(jpg)

    return filename


async def _emit_absent(camera_id: str, post_name: str, last_seen: datetime | None) -> None:
    ts = datetime.utcnow()
    snapshot_path = await _snapshot_for_camera(camera_id)

    with session_scope() as db:
        ev = Event(
            camera_id=camera_id,
            created_at=ts,
            source="presence",
            event_type="guard_absent",
            label=post_name or None,
            snapshot_path=snapshot_path,
        )
        db.add(ev)
        db.flush()
        event_id = ev.id

    payload = {
        "id": event_id,
        "camera_id": camera_id,
        "source": "presence",
        "event_type": "guard_absent",
        "label": post_name or None,
        "snapshot_path": snapshot_path,
        "last_seen": last_seen.isoformat() + "Z" if last_seen else None,
        "created_at": ts.isoformat() + "Z",
    }

    await broadcast(payload)
    await alerts.maybe_send(payload, subject_prefix="[Absent]")

    presence_state.set_state(camera_id, "absent")


async def _scan_once(last_alerts: dict[str, datetime]) -> None:
    now_utc = datetime.utcnow()
    now_local = datetime.now(_app_timezone())

    with session_scope() as db:
        posts = db.scalars(
            select(CameraPost).where(
                CameraPost.is_guarded.is_(True),
                CameraPost.alert_guard_absent.is_(True),
                CameraPost.assigned_guard_id.is_not(None),
            )
        ).all()

        post_data = [
            {
                "camera_id": p.camera_id,
                "post_name": p.post_name,
                "assigned_guard_id": p.assigned_guard_id,
                "backup_guard_id": p.backup_guard_id,
                "duty_start_hour": p.duty_start_hour,
                "duty_end_hour": p.duty_end_hour,
                "absence_threshold_min": p.absence_threshold_min,
            }
            for p in posts
        ]

    for post in post_data:
        camera_id = post["camera_id"]
        post_name = post["post_name"]
        assigned_guard_id = post["assigned_guard_id"]
        backup_guard_id = post["backup_guard_id"]
        start_h = post["duty_start_hour"]
        end_h = post["duty_end_hour"]
        threshold_min = post["absence_threshold_min"]

        if assigned_guard_id is None:
            continue

        if not _is_on_duty(start_h, end_h, now_local):
            continue

        allowed_guard_ids = [assigned_guard_id]

        if backup_guard_id is not None:
            allowed_guard_ids.append(backup_guard_id)

        cutoff = now_utc - timedelta(minutes=threshold_min)

        last_seen_at = presence_state.get_last_seen(
            camera_id,
            allowed_guard_ids,
        )

        if last_seen_at is not None and last_seen_at >= cutoff:
            presence_state.set_state(camera_id, "present")
            continue

        current_state = presence_state.get_state(camera_id)
        last_alert = last_alerts.get(camera_id)

# If guard is already absent, repeat alert only every ABSENCE_RENOTIFY_MIN.
# But if guard was present and now missing again, alert immediately after threshold.
        if (
            current_state == "absent"
            and last_alert
            and (now_utc - last_alert) < timedelta(minutes=ABSENCE_RENOTIFY_MIN)
         ):
             continue

        log.info(
            "absence detected: camera=%s assigned=%s backup=%s threshold=%dm local_hour=%s last_seen=%s",
            camera_id,
            assigned_guard_id,
            backup_guard_id,
            threshold_min,
            now_local.hour,
            last_seen_at,
        )

        await _emit_absent(camera_id, post_name, last_seen_at)
        last_alerts[camera_id] = now_utc


async def run_presence_loop() -> None:
    last_alerts: dict[str, datetime] = {}

    try:
        while True:
            try:
                await _scan_once(last_alerts)
            except Exception as e:
                log.warning("presence scan failed: %s", e)

            await asyncio.sleep(CHECK_INTERVAL_SEC)

    except asyncio.CancelledError:
        log.info("presence loop stopped")
        raise