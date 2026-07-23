from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import (
    alarm,
    auth,
    cameras,
    detections,
    events,
    guards,
    ptz,
    recordings,
    reports,
    users,
    ws,
)
from app.api.auth import ensure_default_admin
from app.config import get_settings
from app.db import init_db
from app.services import mediamtx, presence, recording, remux, retention
from app.services.cameras import list_cameras

log = logging.getLogger("app")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


async def _run_mediamtx_sync_loop() -> None:
    """Restore dynamic camera paths after a MediaMTX restart."""
    while True:
        try:
            await mediamtx.sync_paths(list_cameras())
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("MediaMTX periodic path sync failed: %s", e)

        await asyncio.sleep(30)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    Path(settings.snapshot_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.recording_dir).mkdir(parents=True, exist_ok=True)

    init_db()
    ensure_default_admin()

    try:
        await mediamtx.sync_paths(list_cameras())
    except Exception as e:
        log.warning("MediaMTX path sync failed (will retry on demand): %s", e)

    background = [
        asyncio.create_task(_run_mediamtx_sync_loop(), name="mediamtx-sync"),
        asyncio.create_task(presence.run_presence_loop(), name="presence"),
        asyncio.create_task(retention.run_retention_loop(), name="retention"),
        asyncio.create_task(recording.run_recording_loop(), name="recording"),
        asyncio.create_task(remux.run_remux_loop(), name="remux"),
    ]

    log.info("background tasks started: mediamtx-sync + presence + retention + recording + remux")

    try:
        yield
    finally:
        for t in background:
            t.cancel()

        for t in background:
            try:
                await t
            except (Exception, asyncio.CancelledError):
                pass


app = FastAPI(
    title="Camera Streaming & AI Monitoring",
    version="0.1.0",
    lifespan=lifespan,
)

_settings = get_settings()
_cors_origins = _settings.cors_origin_list
_cors_allows_any_origin = "*" in _cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    # Authentication is sent in the Authorization header, not in cookies.
    # Disabling credentialed CORS allows the portable "*" default to work
    # correctly for localhost, LAN IPs, and public hostnames.
    allow_credentials=not _cors_allows_any_origin,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])

protected = [Depends(auth.require_auth)]

app.include_router(cameras.router, prefix="/api/cameras", tags=["cameras"], dependencies=protected)
app.include_router(events.router, prefix="/api/events", tags=["events"], dependencies=protected)
app.include_router(ptz.router, prefix="/api/ptz", tags=["ptz"], dependencies=protected)

# Guards router applies route-level protection because the detector uses
# GET /api/guards/embeddings with the internal service token.
app.include_router(guards.router, prefix="/api/guards", tags=["guards"])

app.include_router(reports.router, prefix="/api/reports", tags=["reports"], dependencies=protected)
app.include_router(recordings.router, prefix="/api/recordings", tags=["recordings"], dependencies=protected)
app.include_router(users.router, prefix="/api/users", tags=["users"], dependencies=protected)

# Internal / server-to-server routes
internal = [Depends(auth.require_internal_service)]

app.include_router(alarm.router, prefix="/api/alarm", tags=["alarm"], dependencies=internal)
app.include_router(detections.router, prefix="/api/detections", tags=["detections"], dependencies=internal)
app.include_router(cameras.internal_router, prefix="/api/_internal/cameras", tags=["cameras"], dependencies=internal)
app.include_router(ws.router, prefix="/ws", tags=["ws"])

Path(_settings.snapshot_dir).mkdir(parents=True, exist_ok=True)
app.mount("/snapshots", StaticFiles(directory=_settings.snapshot_dir), name="snapshots")

_photos_dir = Path(_settings.snapshot_dir).parent / "guard_photos"
_photos_dir.mkdir(parents=True, exist_ok=True)
app.mount("/guard_photos", StaticFiles(directory=str(_photos_dir)), name="guard_photos")

_recordings_dir = Path(_settings.recording_dir)
_recordings_dir.mkdir(parents=True, exist_ok=True)
app.mount("/recordings", StaticFiles(directory=str(_recordings_dir)), name="recordings")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
