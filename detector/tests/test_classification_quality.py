from types import SimpleNamespace

import cv2
import numpy as np

from detector.worker import _select_face_crop_bbox


def test_select_face_crop_bbox_rejects_blurry_or_tiny_faces() -> None:
    frame = np.zeros((160, 160, 3), dtype=np.uint8)
    person_bbox = (0, 0, 160, 160)

    blurry_faces = [SimpleNamespace(bbox=(30, 30, 45, 70), det_score=0.95)]
    assert _select_face_crop_bbox(frame, person_bbox, blurry_faces) is None

    detailed_frame = np.zeros((160, 160, 3), dtype=np.uint8)
    for x in range(0, 160, 10):
        cv2.rectangle(detailed_frame, (x, 0), (x + 5, 160), (255, 255, 255), -1)

    embedding = np.zeros(512, dtype=np.float32)
    embedding[0] = 1.0
    clear_face = [SimpleNamespace(bbox=(30, 30, 95, 130), det_score=0.95, embedding=embedding)]
    selected = _select_face_crop_bbox(detailed_frame, person_bbox, clear_face)
    assert selected is not None
