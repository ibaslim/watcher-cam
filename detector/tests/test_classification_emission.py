from detector.worker import _should_emit_classification


def test_person_crop_without_fingerprint_is_still_emitted() -> None:
    assert _should_emit_classification(category="person", crop_path="cam_crop.jpg", fingerprint=None) is True


def test_non_person_crop_without_fingerprint_is_emitted() -> None:
    assert _should_emit_classification(category="animal", crop_path="cam_crop.jpg", fingerprint=None) is True
    assert _should_emit_classification(category="vehicle", crop_path="cam_crop.jpg", fingerprint=None) is True


def test_missing_crop_path_is_not_emitted() -> None:
    assert _should_emit_classification(category="person", crop_path=None, fingerprint=None) is False
