from __future__ import annotations

import asyncio
import logging

from app.config import CameraConfig
from app.services.cameras import list_cameras

log = logging.getLogger(__name__)


def _signature(cam: CameraConfig) -> tuple:
    return (
        cam.rtsp_url,
        cam.recorder_id,
    )


async def _stop_process(camera_id: str, proc: asyncio.subprocess.Process) -> None:
    if proc.returncode is not None:
        return

    log.info("remux: stopping %s", camera_id)
    proc.terminate()
    try:
        await asyncio.wait_for(proc.wait(), timeout=8)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()


async def _start_process(cam: CameraConfig) -> asyncio.subprocess.Process:
    publish_url = f"rtsp://mediamtx:8554/{cam.id}"
    log.info("remux: starting %s -> %s", cam.id, publish_url)

    return await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-nostdin",
        "-rtsp_transport",
        "tcp",
        "-fflags",
        "nobuffer",
        "-flags",
        "low_delay",
        "-i",
        cam.rtsp_url,
        "-an",
        "-c:v",
        "copy",
        "-f",
        "rtsp",
        "-rtsp_transport",
        "tcp",
        publish_url,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )


async def run_remux_loop() -> None:
    """Keep one FFmpeg remux process per imported NVR/DVR camera.

    Some recorders advertise H264 RTP packetization incorrectly. MediaMTX can
    mark the path live while browsers still receive black video. FFmpeg is more
    tolerant of those recorder quirks, so for imported recorder cameras we pull
    the original RTSP and publish a normalized RTSP stream into MediaMTX.
    """

    workers: dict[str, tuple[asyncio.subprocess.Process, tuple]] = {}

    try:
        while True:
            try:
                wanted = {
                    cam.id: cam
                    for cam in list_cameras()
                    if cam.recorder_id and cam.host and not cam.rtsp_url_override
                }

                for camera_id in list(workers.keys()):
                    proc, sig = workers[camera_id]
                    cam = wanted.get(camera_id)
                    if proc.returncode is not None:
                        log.warning("remux: %s exited with code %s", camera_id, proc.returncode)
                        workers.pop(camera_id, None)
                        continue
                    if cam is None or _signature(cam) != sig:
                        await _stop_process(camera_id, proc)
                        workers.pop(camera_id, None)

                start_index = 0
                for camera_id, cam in sorted(wanted.items()):
                    if camera_id in workers:
                        continue
                    if start_index > 0:
                        await asyncio.sleep(0.75)
                    proc = await _start_process(cam)
                    workers[camera_id] = (proc, _signature(cam))
                    start_index += 1
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("remux loop failed: %s", e)

            await asyncio.sleep(10)
    except asyncio.CancelledError:
        await asyncio.gather(
            *(_stop_process(camera_id, proc) for camera_id, (proc, _sig) in workers.items()),
            return_exceptions=True,
        )
        raise
