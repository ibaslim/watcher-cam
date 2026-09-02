from types import SimpleNamespace

from detector.worker import _best_matching_bbox, _ObjectTracker


def test_two_people_in_one_frame_receive_different_tracks() -> None:
    tracker = _ObjectTracker(forget_sec=20, match_iou=0.3, move_realert_px=120, move_realert_ratio=0.2)
    first_id, _, _ = tracker.update(kind="person", label="person", bbox=(0, 0, 100, 200), now=1.0, frame_index=1)
    second_id, _, _ = tracker.update(kind="person", label="person", bbox=(10, 0, 110, 200), now=1.0, frame_index=1)
    assert first_id != second_id


def test_tracks_are_reused_on_the_next_frame() -> None:
    tracker = _ObjectTracker(forget_sec=20, match_iou=0.3, move_realert_px=120, move_realert_ratio=0.2)
    first_id, _, _ = tracker.update(kind="person", label="person", bbox=(0, 0, 100, 200), now=1.0, frame_index=1)
    next_id, _, _ = tracker.update(kind="person", label="person", bbox=(2, 0, 102, 200), now=2.0, frame_index=2)
    assert first_id == next_id


def test_matching_one_person_keeps_all_frame_detections_available() -> None:
    detections = [
        SimpleNamespace(category="person", bbox=(0, 0, 100, 200), confidence=0.91),
        SimpleNamespace(category="person", bbox=(250, 0, 350, 200), confidence=0.88),
    ]

    matched = _best_matching_bbox(
        detections,
        category="person",
        source_bbox=(245, 0, 355, 200),
    )

    assert matched == (250, 0, 350, 200)
    assert len(detections) == 2
