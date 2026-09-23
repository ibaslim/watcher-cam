from __future__ import annotations

import math
import subprocess
from functools import lru_cache
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import DetectionTrack, Event, User
from app.api import auth
from app.services.cameras import valid_camera_ids
from app.services.recording import _app_timezone

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


def _clip_view(camera_id: str, path: Path) -> dict:
    return {
        "camera_id": camera_id, "day": path.parent.name, "filename": path.name,
        "display_name": _display_name(path.name), "size_bytes": path.stat().st_size,
        "url": f"/recordings/{camera_id}/{path.parent.name}/{path.name}",
    }


def _timeline_clip_view(camera_id: str, path: Path, day_start: datetime, start: datetime, duration: float) -> dict:
    start_second = _timeline_second(day_start, start)
    return {
        **_clip_view(camera_id, path),
        "start_time": start.isoformat(),
        "end_time": (start + timedelta(seconds=duration)).isoformat(),
        "start_second": round(start_second, 3),
        "end_second": round(start_second + duration, 3),
        "duration_seconds": round(duration, 3),
    }


def _local_day_bounds(day: date) -> tuple[datetime, datetime]:
    tz = _app_timezone()
    start = datetime.combine(day, time.min).replace(tzinfo=tz)
    return start, start + timedelta(days=1)


def _utc_naive(value: datetime) -> datetime:
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _event_time(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _clip_candidates(camera_id: str, day: date) -> list[tuple[datetime, Path]]:
    candidates = []
    for folder_day in (day - timedelta(days=1), day, day + timedelta(days=1)):
        folder = _safe_clip_path(camera_id, folder_day.isoformat(), "placeholder.mp4").parent
        if not folder.exists():
            continue
        for path in folder.glob("*.mp4"):
            try:
                start = datetime.strptime(
                    f"{folder_day.isoformat()} {path.stem}",
                    "%Y-%m-%d %H-%M-%S",
                ).replace(tzinfo=_app_timezone())
            except ValueError:
                continue
            candidates.append((start, path))
    return sorted(candidates, key=lambda item: item[0])


def _timeline_second(day_start: datetime, instant: datetime) -> float:
    return (instant.astimezone(timezone.utc) - day_start.astimezone(timezone.utc)).total_seconds()


def _recording_jump_time(db: Session, camera_id: str, at: datetime, event_id: int | None) -> datetime:
    instant = at.replace(tzinfo=timezone.utc) if at.tzinfo is None else at
    if event_id is None:
        return instant

    event = db.get(Event, event_id)
    if event is None or event.camera_id != camera_id or not event.track_id:
        return instant

    track = db.scalar(
        select(DetectionTrack).where(
            DetectionTrack.camera_id == camera_id,
            DetectionTrack.track_id == event.track_id,
        )
    )
    if track is None:
        return instant

    return _event_time(track.first_seen)


@router.get("/day")
def recording_day(
    _user: Annotated[User, Depends(auth.get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    camera_id: str,
    day: date = Query(...),
) -> dict:
    if camera_id not in valid_camera_ids():
        raise HTTPException(404, "camera not found")

    day_start, day_end = _local_day_bounds(day)
    clips = []

    for start, path in _clip_candidates(camera_id, day):
        try:
            stat = path.stat()
            if stat.st_size == 0:
                continue
            duration = _clip_duration(str(path), stat.st_size, stat.st_mtime_ns)
        except (OSError, ValueError, subprocess.SubprocessError):
            continue

        end = start + timedelta(seconds=duration)
        if end <= day_start or start >= day_end:
            continue

        clips.append(_timeline_clip_view(camera_id, path, day_start, start, duration))

    gaps = []
    cursor = 0.0
    for clip in clips:
        visible_start = max(0.0, clip["start_second"])
        visible_end = min(86400.0, clip["end_second"])
        if visible_start > cursor:
            gaps.append({"start_second": round(cursor, 3), "end_second": round(visible_start, 3)})
        cursor = max(cursor, visible_end)
    if cursor < 86400.0:
        gaps.append({"start_second": round(cursor, 3), "end_second": 86400.0})

    event_start = _utc_naive(day_start)
    event_end = _utc_naive(day_end)
    events = db.scalars(
        select(Event)
        .where(
            Event.camera_id == camera_id,
            Event.created_at >= event_start,
            Event.created_at < event_end,
            Event.event_type.in_(["person_detected", "vehicle_detected", "animal_detected"]),
        )
        .order_by(Event.created_at.asc())
    ).all()

    tracks = db.scalars(
        select(DetectionTrack)
        .where(
            DetectionTrack.camera_id == camera_id,
            DetectionTrack.last_seen >= event_start,
            DetectionTrack.first_seen < event_end,
        )
        .order_by(DetectionTrack.first_seen.asc())
    ).all()
    tracks_by_id = {track.track_id: track for track in tracks}

    detections = []
    for event in events:
        event_instant = _event_time(event.created_at)
        jump_instant = _event_time(tracks_by_id[event.track_id].first_seen) if event.track_id in tracks_by_id else event_instant
        detections.append({
            "event_id": event.id,
            "track_id": event.track_id,
            "type": event.event_type,
            "label": event.label,
            "confidence": event.confidence,
            "time": event_instant.isoformat().replace("+00:00", "Z"),
            "timeline_second": round(_timeline_second(day_start, jump_instant), 3),
            "snapshot_url": f"/snapshots/{event.snapshot_path}" if event.snapshot_path else None,
        })

    ranges = []
    for track in tracks:
        first_seen = _event_time(track.first_seen)
        last_seen = _event_time(track.last_seen)
        ranges.append({
            "id": track.id,
            "track_id": track.track_id,
            "category": track.category,
            "label": track.label,
            "confidence": track.confidence,
            "start_time": first_seen.isoformat().replace("+00:00", "Z"),
            "end_time": last_seen.isoformat().replace("+00:00", "Z"),
            "start_second": round(max(0.0, _timeline_second(day_start, first_seen)), 3),
            "end_second": round(min(86400.0, _timeline_second(day_start, last_seen)), 3),
            "snapshot_url": f"/snapshots/{track.snapshot_path}" if track.snapshot_path else None,
        })

    return {
        "camera_id": camera_id,
        "day": day.isoformat(),
        "timezone": str(_app_timezone()),
        "start": day_start.isoformat(),
        "end": day_end.isoformat(),
        "duration_seconds": 86400,
        "clips": clips,
        "gaps": gaps,
        "detections": detections,
        "detection_ranges": ranges,
    }


@router.get("/at")
def recording_at(
    _user: Annotated[User, Depends(auth.get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    camera_id: str,
    at: datetime = Query(...),
    event_id: int | None = Query(None),
) -> dict:
    """Resolve a UTC event instant to a finalized clip and its playback offset."""
    if camera_id not in valid_camera_ids():
        raise HTTPException(404, "camera not found")
    instant = _recording_jump_time(db, camera_id, at, event_id)
    local = instant.astimezone(_app_timezone())
    candidates = []
    # A clip can start before midnight and continue into the following day.
    for day in (local.date() - timedelta(days=1), local.date(), local.date() + timedelta(days=1)):
        folder = _safe_clip_path(camera_id, day.isoformat(), "placeholder.mp4").parent
        if not folder.exists():
            continue
        for path in folder.glob("*.mp4"):
            try:
                start = datetime.strptime(f"{day.isoformat()} {path.stem}", "%Y-%m-%d %H-%M-%S").replace(tzinfo=_app_timezone())
            except ValueError:
                continue
            candidates.append((start, path))

    if not candidates:
        raise HTTPException(404, "No playable recording is available at this time. Recent footage may still be saving; try again shortly.")

    # Sort candidates by start time
    candidates.sort(key=lambda item: item[0])

    # First pass: look for exact match where start <= local < start + duration
    prior_candidates = [c for c in candidates if c[0] <= local]
    for start, path in reversed(prior_candidates):
        try:
            stat = path.stat()
            if stat.st_size == 0:
                continue
            duration = _clip_duration(str(path), stat.st_size, stat.st_mtime_ns)
            offset = (instant.astimezone(timezone.utc) - start.astimezone(timezone.utc)).total_seconds()
            if 0 <= offset < duration:
                day_start, _day_end = _local_day_bounds(start.date())
                return {
                    "clip": _timeline_clip_view(camera_id, path, day_start, start, duration),
                    "offset_seconds": round(offset, 3),
                    "timeline_second": round(_timeline_second(day_start, instant), 3),
                    "recorded_at": start.isoformat(),
                    "duration_seconds": duration,
                }
        except (OSError, ValueError, subprocess.SubprocessError):
            continue

    # Second pass: Boundary / tolerance match for segment gaps or small clock offsets
    best_match = None
    best_dist = float("inf")
    for start, path in candidates:
        try:
            stat = path.stat()
            if stat.st_size == 0:
                continue
            duration = _clip_duration(str(path), stat.st_size, stat.st_mtime_ns)
            offset = (instant.astimezone(timezone.utc) - start.astimezone(timezone.utc)).total_seconds()

            if offset < 0:
                dist = abs(offset)
                clamped_offset = 0.0
            elif offset >= duration:
                dist = offset - duration
                clamped_offset = max(0.0, duration - 0.1)
            else:
                dist = 0.0
                clamped_offset = offset

            # Allow tolerance up to 5 seconds for segment gaps
            if dist <= 5.0 and dist < best_dist:
                day_start, _day_end = _local_day_bounds(start.date())
                best_dist = dist
                best_match = {
                    "clip": _timeline_clip_view(camera_id, path, day_start, start, duration),
                    "offset_seconds": round(clamped_offset, 3),
                    "timeline_second": round(_timeline_second(day_start, instant), 3),
                    "recorded_at": start.isoformat(),
                    "duration_seconds": duration,
                }
        except (OSError, ValueError, subprocess.SubprocessError):
            continue

    if best_match is not None:
        return best_match

    raise HTTPException(404, "No playable recording is available at this time. Recent footage may still be saving; try again shortly.")


@lru_cache(maxsize=512)
def _clip_duration(path: str, size: int, modified_ns: int) -> float:
    # Cache only successfully probed metadata; changing files use a new cache key.
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True, timeout=5, check=True,
    )
    duration = float(result.stdout.strip())
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Clip has no playable duration")
    return duration
