"""Thin wrapper around Hikvision ISAPI endpoints we actually use.

ISAPI is Hikvision's public HTTP API. Auth is digest by default on modern firmware.
Endpoints used here:

- PTZ continuous move:  PUT /ISAPI/PTZCtrl/channels/1/continuous       (XML body)
- PTZ goto preset:      PUT /ISAPI/PTZCtrl/channels/1/presets/<id>/goto

Reference: Hikvision ISAPI Developer Guide (public PDF).
"""

from __future__ import annotations

import logging

import httpx

from app.config import CameraConfig

log = logging.getLogger(__name__)


def _auth(cam: CameraConfig) -> httpx.DigestAuth:
    return httpx.DigestAuth(cam.username, cam.password)


async def ptz_continuous(
    cam: CameraConfig, pan: int = 0, tilt: int = 0, zoom: int = 0
) -> None:
    """Start/continue a continuous PTZ move. Pass zeros to stop."""
    body = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f"<PTZData><pan>{pan}</pan><tilt>{tilt}</tilt><zoom>{zoom}</zoom></PTZData>"
    )
    url = f"{cam.isapi_base}/ISAPI/PTZCtrl/channels/1/continuous"
    async with httpx.AsyncClient(timeout=5, auth=_auth(cam)) as client:
        r = await client.put(url, content=body, headers={"Content-Type": "application/xml"})
    if r.status_code >= 400:
        log.warning("PTZ continuous %s -> %s %s", cam.id, r.status_code, r.text[:200])


async def ptz_preset(cam: CameraConfig, preset_id: int) -> None:
    url = f"{cam.isapi_base}/ISAPI/PTZCtrl/channels/1/presets/{preset_id}/goto"
    async with httpx.AsyncClient(timeout=5, auth=_auth(cam)) as client:
        r = await client.put(url)
    if r.status_code >= 400:
        log.warning("PTZ preset %s -> %s %s", cam.id, r.status_code, r.text[:200])


async def snapshot(cam: CameraConfig) -> bytes | None:
    """Grab a JPEG still from the camera via ISAPI (lighter than decoding an RTSP frame)."""
    url = f"{cam.isapi_base}/ISAPI/Streaming/channels/1/picture"
    async with httpx.AsyncClient(timeout=5, auth=_auth(cam)) as client:
        r = await client.get(url)
    if r.status_code != 200:
        log.warning("snapshot %s -> %s", cam.id, r.status_code)
        return None
    return r.content
