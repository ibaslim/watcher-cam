from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from detector.object_detection import detect_objects


@dataclass
class PersonBox:
    bbox: tuple[int, int, int, int]
    confidence: float


def detect_people(image_bgr: np.ndarray) -> list[PersonBox]:
    return [
        PersonBox(detection.bbox, detection.confidence)
        for detection in detect_objects(image_bgr)
        if detection.category == "person"
    ]
