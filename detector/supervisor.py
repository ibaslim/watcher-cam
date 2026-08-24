"""Camera worker supervisor.

Polls the backend's `/api/_internal/cameras` (server-to-server, optionally
protected by `INTERNAL_SERVICE_TOKEN`, includes RTSP passwords) and keeps one
`run_camera_loop` task per camera with
`detect=true`. When a camera is added, removed, or its connection details
change, the supervisor starts/stops/restarts the matching worker so the
operator's edits in the admin UI take effect without a service restart.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from detector.config import CameraConfig, get_settings
from detector.worker import run_camera_loop

log = logging.getLogger(__name__)
_refresh_event: asyncio.Event | None = None


def request_camera_refresh() -> None:
    """Wake the supervisor so backend camera edits apply immediately."""

    if _refresh_event is not None:
        _refresh_event.set()


def _internal_headers() -> dict[str, str]:
    token = get_settings().internal_service_token
    return {"X-Internal-Token": token} if token else {}


def _camera_signature(c: CameraConfig) -> tuple:
    """Tuple of fields that, if any change, justify restarting a worker.
    `name` is excluded — it's display-only and doesn't affect RTSP/detection."""
    return (
        c.host,
        c.rtsp_port,
        c.username,
        c.password,
        c.channel,
        c.rtsp_url_override,
    )


async def _run_camera_loop_after_delay(cam: CameraConfig, delay_sec: float) -> None:
    """Start a camera worker after a small delay.

    Large camera deployments can enable many cameras together. Opening every RTSP
    session at the same instant can overload the recorder, MediaMTX, or the VM
    network stack. A short stagger keeps startup smooth while preserving the
    normal one-worker-per-camera model.
    """

    if delay_sec > 0:
        await asyncio.sleep(delay_sec)
    await run_camera_loop(cam)


async def _fetch_cameras() -> list[CameraConfig] | None:
    s = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # Internal endpoint — includes camera passwords. See
            # backend/app/api/cameras.py:internal_router.
            r = await client.get(
                f"{s.backend_url}/api/_internal/cameras",
                headers=_internal_headers(),
            )
            r.raise_for_status()
            rows = r.json()
    except Exception as e:
        log.warning("camera list refresh failed: %s", e)
        return None

    out: list[CameraConfig] = []
    for row in rows:
        out.append(
            CameraConfig(
                id=row["id"],
                name=row["name"],
                host=row.get("host", ""),
                rtsp_port=row.get("rtsp_port", 554),
                http_port=row.get("http_port", 80),
                username=row.get("username", ""),
                password=row.get("password", ""),
                channel=row.get("channel", 101),
                detect=bool(row.get("detect", False)),
                rtsp_url_override=row.get("rtsp_url_override", ""),
            )
        )
    return out


async def run_camera_supervisor() -> None:
    global _refresh_event

    s = get_settings()
    workers: dict[str, tuple[asyncio.Task, tuple]] = {}
    _refresh_event = asyncio.Event()

    try:
        while True:
            cams = await _fetch_cameras()
            if cams is not None:
                wanted = {
                    c.id: c
                    for c in cams
                    if c.detect
                }

                # Stop workers whose cameras vanished or whose connection
                # changed.
                for cam_id in list(workers.keys()):
                    task, sig = workers[cam_id]
                    new_cam = wanted.get(cam_id)
                    if new_cam is None or _camera_signature(new_cam) != sig:
                        log.info("supervisor: stopping worker %s", cam_id)
                        task.cancel()
                        try:
                            await task
                        except (asyncio.CancelledError, Exception):
                            pass
                        workers.pop(cam_id, None)

                # Start workers for new (or restarted) cameras.
                new_worker_index = 0
                for cam_id, cam in sorted(wanted.items()):
                    if cam_id in workers:
                        continue
                    delay_sec = min(
                        new_worker_index * s.camera_worker_start_stagger_sec,
                        s.camera_worker_start_stagger_max_sec,
                    )
                    log.info(
                        "supervisor: starting worker %s in %.1fs",
                        cam_id,
                        delay_sec,
                    )
                    task = asyncio.create_task(
                        _run_camera_loop_after_delay(cam, delay_sec),
                        name=f"worker-{cam_id}",
                    )
                    workers[cam_id] = (task, _camera_signature(cam))
                    new_worker_index += 1

            try:
                await asyncio.wait_for(_refresh_event.wait(), timeout=s.camera_refresh_sec)
            except asyncio.TimeoutError:
                pass
            finally:
                _refresh_event.clear()
    except asyncio.CancelledError:
        for cam_id, (task, _sig) in workers.items():
            task.cancel()
        await asyncio.gather(*(t for t, _ in workers.values()), return_exceptions=True)
        raise
