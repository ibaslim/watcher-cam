"""HTTP endpoints the backend calls — embedding a single uploaded photo.

The camera workers don't use this; they call `face.analyze` directly in-process.
"""

from __future__ import annotations

import base64
import logging

import cv2
import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile

from detector.face import analyze
from detector.face_bank import bank
from detector.supervisor import request_camera_refresh

log = logging.getLogger(__name__)
router = APIRouter()


@router.post("/embed")
async def embed(file: UploadFile = File(...)) -> dict:
    """Detect faces in an uploaded image and return their embeddings.

    Response: {"faces": [{"embedding": "<base64 float32>", "bbox": [x1,y1,x2,y2], "det_score": 0.99}]}
    """
    body = await file.read()
    if not body:
        raise HTTPException(400, "empty upload")
    arr = np.frombuffer(body, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "could not decode image")

    faces = analyze(img)
    return {
        "faces": [
            {
                "bbox": list(f.bbox),
                "det_score": f.det_score,
                "embedding": base64.b64encode(f.embedding.tobytes()).decode("ascii"),
            }
            for f in faces
        ]
    }


@router.post("/match")
async def match(file: UploadFile = File(...)) -> dict:
    """Detect faces AND match each against the enrolled guards. For ad-hoc use.

    Response: {"faces": [{..., "match": {"guard_id": 1, "guard_name": "Ali", "score": 0.72} | null}]}
    """
    body = await file.read()
    if not body:
        raise HTTPException(400, "empty upload")
    arr = np.frombuffer(body, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "could not decode image")

    out = []
    for f in analyze(img):
        m = await bank.match(f.embedding)
        out.append(
            {
                "bbox": list(f.bbox),
                "det_score": f.det_score,
                "match": None if m is None else {
                    "guard_id": m.guard_id,
                    "guard_name": m.guard_name,
                    "score": m.score,
                },
            }
        )
    return {"faces": out}


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.post("/refresh-cameras")
def refresh_cameras() -> dict:
    """Wake the camera supervisor after backend camera/post settings change."""

    request_camera_refresh()
    return {"ok": True}
