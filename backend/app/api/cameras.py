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
from app.models import Camera, CameraPost, User
from app.services import mediamtx
from app.services.cameras import list_cameras, valid_camera_ids

router = APIRouter()
log = logging.getLogger(__name__)


async def _notify_detector_refresh(reason: str) -> None:
    """Ask detector supervisor to reload camera/post settings immediately."""

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
        post = db.get(CameraPost, c.id)

        rows.append({
            **_camera_view(c),
            "password": c.password,

            "assigned_guard_id": post.assigned_guard_id if post else None,
            "backup_guard_id": post.backup_guard_id if post else None,

            "alert_guard_absent": post.alert_guard_absent if post else True,
            "alert_wrong_guard": post.alert_wrong_guard if post else True,
            "alert_unknown_person": post.alert_unknown_person if post else False,

            "is_guarded": post.is_guarded if post else False,
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
    detect: bool = False
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
    detect: bool = False
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

    for camera_id in camera_ids:
        post = db.get(CameraPost, camera_id)
        if post is not None:
            db.delete(post)

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

    post = db.get(CameraPost, camera_id)
    if post is not None:
        db.delete(post)

    db.commit()

    try:
        await mediamtx.remove_path(camera_id)
    except Exception:
        pass

    await _notify_detector_refresh("camera delete")


class PostConfig(BaseModel):
    post_name: str = ""
    assigned_guard_id: int | None = None
    backup_guard_id: int | None = None
    is_guarded: bool = True
    duty_start_hour: int = Field(0, ge=0, le=23)
    duty_end_hour: int = Field(24, ge=0, le=24)
    absence_threshold_min: int = Field(15, ge=1, le=240)
    alert_guard_absent: bool = True
    alert_wrong_guard: bool = True
    alert_unknown_person: bool = False


def _to_view(p: CameraPost) -> dict:
    return {
        "camera_id": p.camera_id,
        "post_name": p.post_name,
        "assigned_guard_id": p.assigned_guard_id,
        "backup_guard_id": p.backup_guard_id,
        "is_guarded": p.is_guarded,
        "duty_start_hour": p.duty_start_hour,
        "duty_end_hour": p.duty_end_hour,
        "absence_threshold_min": p.absence_threshold_min,
        "alert_guard_absent": p.alert_guard_absent,
        "alert_wrong_guard": p.alert_wrong_guard,
        "alert_unknown_person": p.alert_unknown_person,
    }


@router.get("/{camera_id}/post")
def get_post(camera_id: str, db: Annotated[Session, Depends(get_db)]) -> dict:
    if camera_id not in valid_camera_ids():
        raise HTTPException(404, "camera not found")

    p = db.get(CameraPost, camera_id)

    if not p:
        return {
            "camera_id": camera_id,
            "post_name": "",
            "assigned_guard_id": None,
            "backup_guard_id": None,
            "is_guarded": False,
            "duty_start_hour": 0,
            "duty_end_hour": 24,
            "absence_threshold_min": 15,
            "alert_guard_absent": True,
            "alert_wrong_guard": True,
            "alert_unknown_person": False,
        }

    return _to_view(p)


@router.put("/{camera_id}/post")
async def put_post(
    _admin: Annotated[User, Depends(auth.require_admin)],
    camera_id: str,
    payload: PostConfig,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    if camera_id not in valid_camera_ids():
        raise HTTPException(404, "camera not found")

    if payload.duty_end_hour <= payload.duty_start_hour:
        raise HTTPException(400, "duty_end_hour must be greater than duty_start_hour")

    p = db.get(CameraPost, camera_id)

    if not p:
        p = CameraPost(camera_id=camera_id)
        db.add(p)

    p.post_name = payload.post_name
    p.assigned_guard_id = payload.assigned_guard_id
    p.backup_guard_id = payload.backup_guard_id
    p.is_guarded = payload.is_guarded
    p.duty_start_hour = payload.duty_start_hour
    p.duty_end_hour = payload.duty_end_hour
    p.absence_threshold_min = payload.absence_threshold_min
    p.alert_guard_absent = payload.alert_guard_absent
    p.alert_wrong_guard = payload.alert_wrong_guard
    p.alert_unknown_person = payload.alert_unknown_person

    db.commit()
    db.refresh(p)

    await _notify_detector_refresh("post update")

    return _to_view(p)
