from __future__ import annotations

import logging
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api import auth
from app.config import CameraConfig, get_settings
from app.db import get_db
from app.models import Camera, User
from app.services import mediamtx
from app.services.cameras import list_cameras

router = APIRouter()
log = logging.getLogger(__name__)


async def _notify_detector_refresh(reason: str) -> None:
    """Ask the detector supervisor to reload camera settings immediately."""

    url = f"{get_settings().detector_url.rstrip('/')}/refresh-cameras"

    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.post(url)
            r.raise_for_status()
    except Exception as e:
        log.warning("detector refresh notify failed after %s: %s", reason, e)


def _camera_view(c: CameraConfig) -> dict:
    s = get_settings()

    return {
        "id": c.id,
        "name": c.name,
        "host": c.host,
        "rtsp_port": c.rtsp_port,
        "http_port": c.http_port,
        "username": c.username,
        "channel": c.channel,
        "detect": c.detect,
        "recording_enabled": c.recording_enabled,
        "rtsp_url_override": c.rtsp_url_override,
        "recorder_id": c.recorder_id,
        "recorder_name": c.recorder_name,
        "webrtc_url": f"http://localhost:{s.mediamtx_webrtc_port}/{c.id}",
        "hls_url": f"http://localhost:{s.mediamtx_hls_port}/{c.id}/index.m3u8",
    }


@router.get("")
def list_all() -> list[dict]:
    return [_camera_view(c) for c in list_cameras()]


internal_router = APIRouter()


@internal_router.get("")
def list_all_internal(db: Annotated[Session, Depends(get_db)]) -> list[dict]:
    rows = []

    for c in list_cameras():
        rows.append({
            **_camera_view(c),
            "password": c.password,
        })

    return rows


class CameraIn(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=128)
    host: str = ""
    rtsp_port: int = Field(554, ge=1, le=65535)
    http_port: int = Field(80, ge=1, le=65535)
    username: str = ""
    password: str = ""
    channel: int = Field(101, ge=1)
    detect: bool = True
    recording_enabled: bool = True
    rtsp_url_override: str = ""


class CameraUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    host: str = ""
    rtsp_port: int = Field(554, ge=1, le=65535)
    http_port: int = Field(80, ge=1, le=65535)
    username: str = ""
    password: str = ""
    channel: int = Field(101, ge=1)
    detect: bool = True
    recording_enabled: bool = True
    rtsp_url_override: str = ""


@router.post("", status_code=201)
async def create_camera(
    _admin: Annotated[User, Depends(auth.require_admin)],
    payload: CameraIn,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    if get_settings().demo_mode and payload.id == "demo-webcam":
        raise HTTPException(400, "demo-webcam is a reserved id")

    if db.get(Camera, payload.id) is not None:
        raise HTTPException(409, f"camera id '{payload.id}' already exists")

    row = Camera(**payload.model_dump())
    db.add(row)
    db.commit()

    cam = CameraConfig(**payload.model_dump())
    warning = await mediamtx.sync_one(cam)
    await _notify_detector_refresh("camera create")

    view = _camera_view(cam)
    view["stream_warning"] = warning
    return view


async def delete_recorder(
    _admin: Annotated[User, Depends(auth.require_admin)],
    recorder_id: str,
    db: Annotated[Session, Depends(get_db)],
):
    rows = db.query(Camera).filter(Camera.recorder_id == recorder_id).all()

    if not rows:
        raise HTTPException(404, "NVR/DVR not found")

    camera_ids = [row.id for row in rows]

    for row in rows:
        db.delete(row)

    db.commit()

    for camera_id in camera_ids:
        try:
            await mediamtx.remove_path(camera_id)
        except Exception:
            pass

    await _notify_detector_refresh("recorder delete")


@router.get("/{camera_id}")
def get_one(camera_id: str) -> dict:
    for c in list_cameras():
        if c.id == camera_id:
            return _camera_view(c)

    raise HTTPException(404, "camera not found")


@router.put("/{camera_id}")
async def update_camera(
    _admin: Annotated[User, Depends(auth.require_admin)],
    camera_id: str,
    payload: CameraUpdate,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    if get_settings().demo_mode and camera_id == "demo-webcam":
        raise HTTPException(400, "demo-webcam is virtual and not editable")

    row = db.get(Camera, camera_id)

    if row is None:
        raise HTTPException(404, "camera not found")

    row.name = payload.name
    row.host = payload.host
    row.rtsp_port = payload.rtsp_port
    row.http_port = payload.http_port
    row.username = payload.username

    if payload.password:
        row.password = payload.password

    row.channel = payload.channel
    row.detect = payload.detect
    row.recording_enabled = payload.recording_enabled
    row.rtsp_url_override = payload.rtsp_url_override

    db.commit()
    db.refresh(row)

    cam = CameraConfig(
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

    warning = await mediamtx.sync_one(cam)
    await _notify_detector_refresh("camera update")

    view = _camera_view(cam)
    view["stream_warning"] = warning
    return view


@router.delete("/{camera_id}", status_code=204)
async def delete_camera(
    _admin: Annotated[User, Depends(auth.require_admin)],
    camera_id: str,
    db: Annotated[Session, Depends(get_db)],
):
    if get_settings().demo_mode and camera_id == "demo-webcam":
        raise HTTPException(400, "demo-webcam is virtual and not deletable")

    row = db.get(Camera, camera_id)

    if row is None:
        raise HTTPException(404, "camera not found")

    db.delete(row)

    db.commit()

    try:
        await mediamtx.remove_path(camera_id)
    except Exception:
        pass

    await _notify_detector_refresh("camera delete")
