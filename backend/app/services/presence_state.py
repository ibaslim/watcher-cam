from __future__ import annotations

from datetime import datetime

_last_seen: dict[tuple[str, int], datetime] = {}
_last_state: dict[str, str] = {}


def mark_seen(camera_id: str, guard_id: int, ts: datetime) -> None:
    _last_seen[(camera_id, guard_id)] = ts


def get_last_seen(camera_id: str, guard_ids: list[int]) -> datetime | None:
    hits = [_last_seen.get((camera_id, gid)) for gid in guard_ids]
    hits = [h for h in hits if h is not None]
    return max(hits) if hits else None


def get_state(camera_id: str) -> str:
    return _last_state.get(camera_id, "unknown")


def set_state(camera_id: str, state: str) -> None:
    _last_state[camera_id] = state