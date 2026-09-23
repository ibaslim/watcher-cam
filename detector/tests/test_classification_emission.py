from detector.worker import _VehicleAlertSuppressor, _should_emit_classification


def test_person_crop_without_fingerprint_is_still_emitted() -> None:
    assert _should_emit_classification(category="person", crop_path="cam_crop.jpg", fingerprint=None) is True


def test_non_person_crop_without_fingerprint_is_emitted() -> None:
    assert _should_emit_classification(category="animal", crop_path="cam_crop.jpg", fingerprint=None) is True
    assert _should_emit_classification(category="vehicle", crop_path="cam_crop.jpg", fingerprint=None) is True


def test_missing_crop_path_is_not_emitted() -> None:
    assert _should_emit_classification(category="person", crop_path=None, fingerprint=None) is False


def test_vehicle_alert_suppressor_blocks_parked_vehicle_repeat() -> None:
    suppressor = _VehicleAlertSuppressor(
        suppress_sec=3600,
        match_iou=0.12,
        match_px=45,
    )

    suppressor.remember(kind="vehicle", bbox=(100, 100, 220, 220), now=10)

    assert suppressor.should_suppress(kind="vehicle", bbox=(106, 98, 226, 218), now=120) is True


def test_vehicle_alert_suppressor_allows_vehicle_that_moved_far() -> None:
    suppressor = _VehicleAlertSuppressor(
        suppress_sec=3600,
        match_iou=0.12,
        match_px=80,
    )

    suppressor.remember(kind="vehicle", bbox=(100, 100, 220, 220), now=10)

    assert suppressor.should_suppress(kind="vehicle", bbox=(500, 100, 620, 220), now=120) is False


def test_vehicle_alert_suppressor_allows_nearby_separate_parked_vehicle() -> None:
    suppressor = _VehicleAlertSuppressor(
        suppress_sec=3600,
        match_iou=0.12,
        match_px=45,
    )

    suppressor.remember(kind="vehicle", bbox=(100, 100, 220, 220), now=10)

    assert suppressor.should_suppress(kind="vehicle", bbox=(250, 100, 370, 220), now=120) is False


def test_vehicle_alert_suppressor_does_not_affect_people() -> None:
    suppressor = _VehicleAlertSuppressor(
        suppress_sec=3600,
        match_iou=0.12,
        match_px=45,
    )

    suppressor.remember(kind="person", bbox=(100, 100, 180, 240), now=10)

    assert suppressor.should_suppress(kind="person", bbox=(102, 100, 182, 240), now=120) is False
