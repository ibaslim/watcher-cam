from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

log = logging.getLogger(__name__)
router = APIRouter()

_clients: set[WebSocket] = set()
_lock = asyncio.Lock()


@router.websocket("")
async def ws_events(websocket: WebSocket) -> None:
    await websocket.accept()
    async with _lock:
        _clients.add(websocket)
    try:
        while True:
            # We only push — ignore anything the client sends (used as keepalive).
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        async with _lock:
            _clients.discard(websocket)


async def broadcast(payload: dict) -> None:
    if not _clients:
        return
    message = json.dumps(payload)
    async with _lock:
        targets = list(_clients)
    for ws in targets:
        try:
            await ws.send_text(message)
        except Exception as e:
            log.debug("ws send failed, dropping client: %s", e)
            async with _lock:
                _clients.discard(ws)
