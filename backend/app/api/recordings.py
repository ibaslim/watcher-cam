from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import get_settings
from app.models import User
from app.api import auth
from app.services.cameras import valid_camera_ids

router = APIRouter()


def _display_name(filename: str) -> str:
    stem = Path(filename).stem

    if len(stem) == 8 and stem[2] == "-" and stem[5] == "-":
        return stem.replace("-", ":")

    return stem


def _safe_clip_path(camera_id: str, day: str, filename: str) -> Path:
    root = Path(get_settings().recording_dir).resolve()
    path = (root / camera_id / day / filename).resolve()

    if root not in path.parents and path != root:
        raise HTTPException(400, "invalid path")

    return path


@router.get("")
def list_recordings(
    _user: Annotated[User, Depends(auth.get_current_user)],
    camera_id: str,
    day: date = Query(...),
) -> list[dict]:
    if camera_id not in valid_camera_ids():
        raise HTTPException(404, "camera not found")

    root = Path(get_settings().recording_dir)
    folder = root / camera_id / day.isoformat()

    if not folder.exists():
        return []

    clips = []

    for f in sorted(folder.glob("*.mp4")):
        clips.append({
            "camera_id": camera_id,
            "day": day.isoformat(),
            "filename": f.name,
            "display_name": _display_name(f.name),
            "size_bytes": f.stat().st_size,
            "url": f"/recordings/{camera_id}/{day.isoformat()}/{f.name}",
        })

    return clips
