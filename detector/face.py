"""InsightFace wrapper — face detection + embedding in one shot.

`buffalo_l` is the standard model pack: SCRFD (detection) + ArcFace (embedding).
Embeddings come back already L2-normalized so cosine similarity == dot product.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

import numpy as np

from detector.config import get_settings

log = logging.getLogger(__name__)

_app = None
_lock = threading.Lock()


@dataclass
class DetectedFace:
    bbox: tuple[int, int, int, int]  # x1, y1, x2, y2 in pixels
    det_score: float                  # detection confidence from SCRFD
    embedding: np.ndarray             # shape (512,), float32, unit-normalized


def get_app():
    """Lazily construct the FaceAnalysis pipeline (thread-safe)."""
    global _app
    if _app is None:
        with _lock:
            if _app is None:
                from insightface.app import FaceAnalysis

                s = get_settings()
                a = FaceAnalysis(name=s.face_model, providers=["CPUExecutionProvider"])
                a.prepare(ctx_id=0, det_size=(s.face_det_size, s.face_det_size))
                _app = a
                log.info("FaceAnalysis ready (model=%s det_size=%d)", s.face_model, s.face_det_size)
    return _app


def analyze(image_bgr: np.ndarray) -> list[DetectedFace]:
    """Detect + embed every face in a BGR image. Returns [] if no faces."""
    app = get_app()
    faces = app.get(image_bgr)
    out: list[DetectedFace] = []
    min_size = get_settings().face_min_size
    for f in faces:
        x1, y1, x2, y2 = (int(v) for v in f.bbox)
        if (x2 - x1) < min_size or (y2 - y1) < min_size:
            continue
        emb = np.asarray(f.embedding, dtype=np.float32)
        # Safety: re-normalize in case upstream changes; cheap when already unit-length.
        norm = float(np.linalg.norm(emb))
        if norm > 0:
            emb = emb / norm
        out.append(
            DetectedFace(
                bbox=(x1, y1, x2, y2),
                det_score=float(getattr(f, "det_score", 0.0)),
                embedding=emb,
            )
        )
    return out
