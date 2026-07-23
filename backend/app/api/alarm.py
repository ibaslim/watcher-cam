"""Endpoint Hikvision cameras POST to when a smart event fires.

Configure on each camera: Configuration → Network → Advanced → HTTP Listening.
URL: http://<backend-host>:8000/api/alarm
"""

from __future__ import annotations

import json
import logging
from datetime import datetime

import xmltodict
from fastapi import APIRouter, Request

from app.api.ws import broadcast
from app.db import session_scope
from app.models import Event
from app.services import alerts
from app.services.cameras import list_cameras

log = logging.getLogger(__name__)
router = APIRouter()


def _find_camera_id(payload: dict, client_host: str) -> str | None:
    """Map an incoming alarm payload to one of our configured cameras.

    Hikvision payloads include ipAddress under EventNotificationAlert; fall back to
    the client's source IP.
    """
    ip = payload.get("ipAddress") or client_host
    match = next((c for c in list_cameras() if c.host == ip), None)
    return match.id if match else None


@router.post("")
async def receive_alarm(request: Request) -> dict:
    body = await request.body()
    content_type = request.headers.get("content-type", "")

    parsed: dict
    if "xml" in content_type or body.lstrip().startswith(b"<"):
        try:
            parsed = xmltodict.parse(body).get("EventNotificationAlert", {}) or {}
        except Exception as e:
            log.warning("malformed alarm XML: %s", e)
            parsed = {}
    else:
        try:
            parsed = json.loads(body or b"{}")
        except Exception:
            parsed = {}

    client_host = request.client.host if request.client else ""
    camera_id = _find_camera_id(parsed, client_host) or "unknown"
    event_type = parsed.get("eventType") or parsed.get("EventType") or "alarm"

    with session_scope() as db:
        ev = Event(
            camera_id=camera_id,
            created_at=datetime.utcnow(),
            source="hikvision",
            event_type=str(event_type),
            label=parsed.get("channelName"),
            raw=json.dumps(parsed)[:8000],
        )
        db.add(ev)
        db.flush()
        event_id = ev.id

    payload = {
        "id": event_id,
        "camera_id": camera_id,
        "event_type": event_type,
        "source": "hikvision",
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
    await broadcast(payload)
    await alerts.maybe_send(payload, subject_prefix="[Camera]")
    return {"ok": True, "event_id": event_id}
