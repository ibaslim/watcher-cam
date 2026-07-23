"""Email alerting with per-(camera, event_type) cooldown.

We intentionally keep this dead simple: one SMTP connection per send, cooldown
kept in-process (lost on restart — fine for an MVP).
"""

from __future__ import annotations

import asyncio
import logging
import time
from email.message import EmailMessage
from pathlib import Path

import aiosmtplib

from app.config import get_settings

log = logging.getLogger(__name__)

_last_sent: dict[tuple[str, str], float] = {}
_lock = asyncio.Lock()


async def maybe_send(event: dict, subject_prefix: str = "[Camera]") -> None:
    s = get_settings()
    if not s.smtp_host or not s.smtp_to:
        return

    key = (event.get("camera_id", "?"), event.get("event_type", "?"))
    now = time.monotonic()
    async with _lock:
        last = _last_sent.get(key, 0)
        if now - last < s.alert_cooldown:
            return
        _last_sent[key] = now

    subject = f"{subject_prefix} {event.get('event_type')} on {event.get('camera_id')}"
    body = (
        f"Camera: {event.get('camera_id')}\n"
        f"Event:  {event.get('event_type')}\n"
        f"Source: {event.get('source')}\n"
        f"Time:   {event.get('created_at')}\n"
        f"Label:  {event.get('label') or '-'}\n"
        f"Score:  {event.get('confidence') or '-'}\n"
    )

    msg = EmailMessage()
    msg["From"] = s.smtp_from
    msg["To"] = s.smtp_to
    msg["Subject"] = subject
    msg.set_content(body)

    snapshot = event.get("snapshot_path")
    if snapshot:
        path = Path(s.snapshot_dir) / snapshot
        if path.exists():
            msg.add_attachment(path.read_bytes(), maintype="image", subtype="jpeg", filename=path.name)

    try:
        await aiosmtplib.send(
            msg,
            hostname=s.smtp_host,
            port=s.smtp_port,
            username=s.smtp_user or None,
            password=s.smtp_password or None,
            start_tls=s.smtp_use_tls,
            timeout=10,
        )
        log.info("alert email sent: %s", subject)
    except Exception as e:
        log.warning("alert email failed: %s", e)
