from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

import numpy as np

from detector.config import get_settings

log = logging.getLogger(__name__)

_model = None
_lock = threading.Lock()

@dataclass(frozen=True)
class ObjectDetection:
    bbox: tuple[int, int, int, int]
    confidence: float
    label: str
    category: str


def get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from ultralytics import YOLO

                settings = get_settings()
                _model = YOLO(settings.yolo_model)
                log.info(
                    "YOLO object detector ready: model=%s classes=%s",
                    settings.yolo_model,
                    ",".join(settings.yolo_class_list),
                )
    return _model


def _category(label: str) -> str | None:
    lowered = label.lower()
    if lowered == "person":
        return "person"
    if lowered in {"car", "truck", "bus", "van", "motorbike", "bicycle", "vehicle"}:
        return "vehicle"
    if lowered in {"cat", "dog", "bird", "horse", "cow", "sheep", "animal"}:
        return "animal"
    return None


def detect_objects(image_bgr: np.ndarray) -> list[ObjectDetection]:
    settings = get_settings()
    model = get_model()
    allowed_categories = set(settings.yolo_class_list)
    names = model.names
    class_ids = [
        class_id
        for class_id, name in names.items()
        if _category(name) in allowed_categories
    ]

    if not class_ids:
        log.warning("none of YOLO_CLASSES matched model labels: %s", sorted(allowed_categories))
        return []

    # Ultralytics models are not safe to run concurrently from multiple camera
    # worker threads. Protect prediction so first-time model fusion/inference
    # cannot race and crash with partially-mutated layer state.
    with _lock:
        results = model.predict(
            image_bgr,
            conf=settings.yolo_confidence,
            classes=class_ids,
            verbose=False,
        )

    detections: list[ObjectDetection] = []

    for result in results:
        if result.boxes is None:
            continue

        for box in result.boxes:
            class_id = int(box.cls[0])
            label = str(names[class_id])
            category = _category(label)

            if category is None:
                continue

            x1, y1, x2, y2 = [int(value) for value in box.xyxy[0].tolist()]
            area = max(0, x2 - x1) * max(0, y2 - y1)
            confidence = float(box.conf[0])
            min_area = settings.object_min_area
            if area < min_area or confidence < settings.yolo_confidence:
                continue

            detections.append(
                ObjectDetection(
                    bbox=(x1, y1, x2, y2),
                    confidence=confidence,
                    label=label,
                    category=category,
                )
            )

    return detections
