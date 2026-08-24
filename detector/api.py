"""Detector health and camera-refresh endpoints."""

from __future__ import annotations

from fastapi import APIRouter
from detector.supervisor import request_camera_refresh

router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.post("/refresh-cameras")
def refresh_cameras() -> dict:
    """Wake the camera supervisor after backend camera settings change."""

    request_camera_refresh()
    return {"ok": True}
