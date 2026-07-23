"""DB → CameraConfig projection.

Single place that reads `cameras` table rows and returns the runtime-friendly
Pydantic `CameraConfig` shape used by services (mediamtx, hikvision, presence,
PTZ). The demo-webcam virtual entry is injected here when `demo_mode` is on so
every consumer sees a consistent list.
"""

from __future__ import annotations

from sqlalchemy import select

from app.config import CameraConfig, get_settings
from app.db import session_scope
from app.models import Camera


_DEMO_WEBCAM = CameraConfig(
    id="demo-webcam",
    name="Demo (laptop webcam)",
    rtsp_url_override="rtsp://mediamtx:8554/demo-webcam",
)


def _to_config(row: Camera) -> CameraConfig:
    return CameraConfig(
        id=row.id,
        name=row.name,
        host=row.host,
        rtsp_port=row.rtsp_port,
        http_port=row.http_port,
        username=row.username,
        password=row.password,
        channel=row.channel,
        detect=row.detect,
        recording_enabled=row.recording_enabled,
        rtsp_url_override=row.rtsp_url_override,
        recorder_id=row.recorder_id or "",
        recorder_name=row.recorder_name or "",
    )


def list_cameras() -> list[CameraConfig]:
    with session_scope() as db:
        rows = db.scalars(select(Camera).order_by(Camera.created_at)).all()
        out = [_to_config(r) for r in rows]
    if get_settings().demo_mode:
        out.insert(0, _DEMO_WEBCAM)
    return out


def get_camera(camera_id: str) -> CameraConfig | None:
    if get_settings().demo_mode and camera_id == "demo-webcam":
        return _DEMO_WEBCAM
    with session_scope() as db:
        row = db.get(Camera, camera_id)
        return _to_config(row) if row else None


def valid_camera_ids() -> set[str]:
    return {c.id for c in list_cameras()}
