from detector.object_detection import _category


def test_vehicle_and_animal_labels_map_to_supported_categories() -> None:
    assert _category("person") == "person"
    assert _category("car") == "vehicle"
    assert _category("cat") == "animal"
