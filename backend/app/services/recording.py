from __future__ import annotations

import asyncio
import logging
import os
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.config import CameraConfig, get_settings
from app.services.cameras import list_cameras

log = logging.getLogger(__name__)


def _app_timezone() -> ZoneInfo:
    tz_name = get_settings().app_timezone

    try:
        return ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        log.warning("invalid app timezone %s; falling back to UTC", tz_name)
        return ZoneInfo("UTC")


_RETRY_BASE_SEC = 5
_RETRY_MAX_SEC = 300


class Recorder:
    def __init__(self, camera: CameraConfig):
        self.camera = camera
        self.process: asyncio.subprocess.Process | None = None
        self.task: asyncio.Task | None = None
        self.running = True
        self.failures = 0

    def _output_pattern(self) -> str:
        s = get_settings()
        now = datetime.now(_app_timezone())
        folder = Path(s.recording_dir) / self.camera.id / now.strftime("%Y-%m-%d")
        folder.mkdir(parents=True, exist_ok=True)

        return str(folder / f"{now.strftime('%H-%M-%S')}.mp4")

    def _source_url(self) -> str:
        """Record the normalized MediaMTX path used by live view and detection."""
        return get_settings().mediamtx_rtsp_url(self.camera.id)

    async def start(self) -> None:
        while self.running:
            try:
                await self._run_ffmpeg()
                self.failures = 0
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.failures += 1
                # Back off on repeated failures: Hikvision locks a source IP for
                # 30 minutes after 5 failed logins, so fast retries keep it locked.
                delay = min(_RETRY_BASE_SEC * 2 ** (self.failures - 1), _RETRY_MAX_SEC)
                log.warning(
                    "recorder error for %s: %s (attempt %d, retrying in %ds)",
                    self.camera.id,
                    e,
                    self.failures,
                    delay,
                )
                await asyncio.sleep(delay)

    async def _run_ffmpeg(self) -> None:
        s = get_settings()
        output = self._output_pattern()

        cmd = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-rtsp_transport",
            "tcp",
            "-i",
            self._source_url(),
            "-an",
            "-c:v",
            "copy",
            "-movflags",
            "+frag_keyframe+empty_moov+default_base_moof",
            "-t",
            str(s.recording_segment_seconds),
            output,
        ]

        log.info("starting recorder for %s", self.camera.id)

        self.process = await asyncio.create_subprocess_exec(
            *cmd,
            env={**os.environ, "TZ": s.app_timezone},
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )

        assert self.process.stderr is not None

        async def log_stderr() -> None:
            while True:
                line = await self.process.stderr.readline()
                if not line:
                    break
                msg = line.decode(errors="ignore").strip()
                if msg:
                    log.warning("ffmpeg %s: %s", self.camera.id, msg)

        stderr_task = asyncio.create_task(log_stderr())

        try:
            await self.process.wait()
        finally:
            stderr_task.cancel()

        if self.running and self.process.returncode not in (0, None):
            raise RuntimeError(f"ffmpeg exited with code {self.process.returncode}")

        log.warning("recorder stopped for %s", self.camera.id)

    async def stop(self) -> None:
        self.running = False

        if self.process and self.process.returncode is None:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=8)
            except asyncio.TimeoutError:
                self.process.kill()


async def retention_loop() -> None:
    s = get_settings()

    if s.recording_retention_days <= 0:
        return

    while True:
        try:
            cutoff = datetime.now(_app_timezone()).replace(tzinfo=None) - timedelta(days=s.recording_retention_days)
            root = Path(s.recording_dir)

            if root.exists():
                for camera_dir in root.iterdir():
                    if not camera_dir.is_dir():
                        continue

                    for day_dir in camera_dir.iterdir():
                        if not day_dir.is_dir():
                            continue

                        try:
                            day = datetime.strptime(day_dir.name, "%Y-%m-%d")
                        except ValueError:
                            continue

                        if day < cutoff:
                            shutil.rmtree(day_dir, ignore_errors=True)
                            log.info("deleted old recording folder: %s", day_dir)
        except Exception as e:
            log.warning("recording retention failed: %s", e)

        await asyncio.sleep(3600)


async def run_recording_loop() -> None:
    s = get_settings()

    if not s.recording_enabled:
        log.info("recording disabled")
        return

    Path(s.recording_dir).mkdir(parents=True, exist_ok=True)

    recorders: dict[str, Recorder] = {}
    retention_task = asyncio.create_task(retention_loop(), name="recording-retention")

    try:
        while True:
            cameras = [c for c in list_cameras() if c.recording_enabled]
            active_ids = {c.id for c in cameras}

            for c in cameras:
                if c.id not in recorders:
                    rec = Recorder(c)
                    rec.task = asyncio.create_task(rec.start(), name=f"recorder-{c.id}")
                    recorders[c.id] = rec

            for camera_id in list(recorders.keys()):
                if camera_id not in active_ids:
                    rec = recorders.pop(camera_id)
                    await rec.stop()
                    if rec.task:
                        rec.task.cancel()

            await asyncio.sleep(30)

    except asyncio.CancelledError:
        log.info("recording loop stopping")
        raise

    finally:
        retention_task.cancel()

        for rec in recorders.values():
            await rec.stop()
            if rec.task:
                rec.task.cancel()
