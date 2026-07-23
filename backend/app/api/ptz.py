from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.services import hikvision
from app.services.cameras import get_camera

router = APIRouter()

# Normalized directions → (pan_speed, tilt_speed) in Hikvision's -100..100 range.
DIRECTIONS = {
    "up": (0, 60),
    "down": (0, -60),
    "left": (-60, 0),
    "right": (60, 0),
    "up-left": (-60, 60),
    "up-right": (60, 60),
    "down-left": (-60, -60),
    "down-right": (60, -60),
    "stop": (0, 0),
}


@router.post("/{camera_id}/move/{direction}")
async def move(camera_id: str, direction: str) -> dict:
    cam = get_camera(camera_id)
    if not cam:
        raise HTTPException(404, "camera not found")
    if direction not in DIRECTIONS:
        raise HTTPException(400, f"direction must be one of {list(DIRECTIONS)}")
    pan, tilt = DIRECTIONS[direction]
    await hikvision.ptz_continuous(cam, pan=pan, tilt=tilt)
    return {"ok": True, "direction": direction}


@router.post("/{camera_id}/zoom/{direction}")
async def zoom(camera_id: str, direction: str) -> dict:
    cam = get_camera(camera_id)
    if not cam:
        raise HTTPException(404, "camera not found")
    if direction not in ("in", "out", "stop"):
        raise HTTPException(400, "direction must be in/out/stop")
    zoom_speed = 60 if direction == "in" else (-60 if direction == "out" else 0)
    await hikvision.ptz_continuous(cam, zoom=zoom_speed)
    return {"ok": True, "direction": direction}


@router.post("/{camera_id}/preset/{preset_id}")
async def go_preset(camera_id: str, preset_id: int) -> dict:
    cam = get_camera(camera_id)
    if not cam:
        raise HTTPException(404, "camera not found")
    await hikvision.ptz_preset(cam, preset_id)
    return {"ok": True, "preset": preset_id}
