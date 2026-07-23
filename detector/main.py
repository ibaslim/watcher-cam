"""Detector service entrypoint.

Runs three things concurrently:

  1. An HTTP server (FastAPI) the backend calls for photo-upload embedding.
  2. A face-bank refresh loop that pulls the latest guard embeddings.
  3. A camera-worker supervisor that pulls the current camera list from the
     backend and starts/stops one RTSP face-recognition worker per camera with
     `detect=true`. Workers spin up automatically when an operator adds a
     camera in the admin UI — no service restart needed.
"""

from __future__ import annotations

import asyncio
import logging
import signal

import uvicorn
from fastapi import FastAPI

from detector.api import router as api_router
from detector.config import get_settings
from detector.face import get_app as load_face_app
from detector.face_bank import bank
from detector.object_detection import get_model as load_yolo_model
from detector.supervisor import run_camera_supervisor

log = logging.getLogger("detector")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def build_app() -> FastAPI:
    app = FastAPI(title="Camera Detector", version="0.2.0")
    app.include_router(api_router)
    return app


async def run_http_server() -> None:
    s = get_settings()
    config = uvicorn.Config(
        build_app(),
        host="0.0.0.0",
        port=s.api_port,
        log_level="info",
        access_log=False,
    )
    server = uvicorn.Server(config)
    await server.serve()


async def main() -> None:
    # Warm heavy AI models and initial bank before we start workers / accept requests.
    await asyncio.to_thread(load_face_app)
    await asyncio.to_thread(load_yolo_model)
    await bank.refresh()

    tasks: list[asyncio.Task] = [
        asyncio.create_task(run_http_server(), name="http"),
        asyncio.create_task(bank.run_periodic_refresh(), name="bank-refresh"),
        asyncio.create_task(run_camera_supervisor(), name="camera-supervisor"),
    ]

    log.info("detector running: http + bank refresh + camera supervisor")

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    await stop.wait()
    log.info("shutting down")
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


if __name__ == "__main__":
    asyncio.run(main())
