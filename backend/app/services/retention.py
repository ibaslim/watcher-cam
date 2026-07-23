"""Background cleanup of old snapshot files.

Without this, `data/snapshots/` grows forever — every detection writes a JPEG
there. We keep snapshots for `snapshot_retention_days` days, then unlink.
Guard reference photos under `data/guard_photos/` are never auto-deleted
(those are user-uploaded and valuable until the guard is removed).
"""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path

from app.config import get_settings

log = logging.getLogger(__name__)

SWEEP_INTERVAL_SEC = 3600  # once an hour is plenty


async def run_retention_loop() -> None:
    s = get_settings()
    snapshot_dir = Path(s.snapshot_dir)
    try:
        while True:
            try:
                _sweep(snapshot_dir, s.snapshot_retention_days)
            except Exception as e:
                log.warning("retention sweep failed: %s", e)
            await asyncio.sleep(SWEEP_INTERVAL_SEC)
    except asyncio.CancelledError:
        log.info("retention loop stopped")
        raise


def _sweep(snapshot_dir: Path, keep_days: int) -> None:
    if not snapshot_dir.exists() or keep_days <= 0:
        return
    cutoff = time.time() - (keep_days * 86400)
    removed = 0
    freed_bytes = 0
    for p in snapshot_dir.iterdir():
        if not p.is_file():
            continue
        try:
            st = p.stat()
            if st.st_mtime < cutoff:
                freed_bytes += st.st_size
                p.unlink()
                removed += 1
        except OSError:
            pass
    if removed:
        log.info(
            "retention: removed %d snapshot(s), freed %.1f MB",
            removed,
            freed_bytes / 1024 / 1024,
        )
