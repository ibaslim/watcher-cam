from __future__ import annotations

import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np

from app.api.events import _build_snapshot_classifications, _build_snapshot_entity_index


class SnapshotClassificationsTests(unittest.TestCase):
    def _write_entity_image(self, path: Path, accent: int) -> None:
        image = np.zeros((80, 80, 3), dtype=np.uint8)
        image[12:68, 20:60] = 40 + accent
        image[24:56, 30:50] = 180 + accent
        cv2.imwrite(str(path), image)

    def test_builds_unique_classifications_from_persisted_entity_ids(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            snapshot_dir = Path(tmpdir)
            first_path = snapshot_dir / "cam1_first.jpg"
            second_path = snapshot_dir / "cam1_second.jpg"

            self._write_entity_image(first_path, 0)
            self._write_entity_image(second_path, 2)

            events = [
                SimpleNamespace(
                    camera_id="CAM01",
                    id=1,
                    created_at=datetime(2026, 7, 27, 12, 0, 0),
                    event_type="person_detected",
                    label="person",
                    snapshot_path=first_path.name,
                    entity_id="CAM01-person-0001",
                ),
                SimpleNamespace(
                    camera_id="CAM01",
                    id=2,
                    created_at=datetime(2026, 7, 27, 12, 1, 0),
                    event_type="person_detected",
                    label="person",
                    snapshot_path=second_path.name,
                    entity_id="CAM01-person-0001",
                ),
            ]

            rows = _build_snapshot_classifications(events, snapshot_dir=snapshot_dir)

            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["camera_id"], "CAM01")
            self.assertEqual(rows[0]["category"], "person")
            self.assertTrue(rows[0]["image_url"].startswith("/snapshots/"))
            self.assertEqual(rows[0]["source_event_type"], "person_detected")
            self.assertEqual(rows[0]["occurrence_count"], 2)
            self.assertEqual(rows[0]["entity_id"], "CAM01-person-0001")

    def test_ignores_events_without_entity_ids(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            snapshot_dir = Path(tmpdir)
            first_path = snapshot_dir / "cam1_dup_a.jpg"
            second_path = snapshot_dir / "cam1_dup_b.jpg"

            cv2.imwrite(str(first_path), np.zeros((80, 80, 3), dtype=np.uint8))
            cv2.imwrite(str(second_path), np.zeros((80, 80, 3), dtype=np.uint8))

            events = [
                SimpleNamespace(
                    camera_id="CAM01",
                    id=1,
                    created_at=datetime(2026, 7, 27, 12, 0, 0),
                    event_type="person_detected",
                    label="person",
                    snapshot_path=first_path.name,
                ),
                SimpleNamespace(
                    camera_id="CAM01",
                    id=2,
                    created_at=datetime(2026, 7, 27, 12, 1, 0),
                    event_type="person_detected",
                    label="person",
                    snapshot_path=second_path.name,
                ),
            ]

            rows = _build_snapshot_classifications(events, snapshot_dir=snapshot_dir)

            self.assertEqual(len(rows), 0)

    def test_assigns_entity_ids_that_can_group_related_snapshots(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            snapshot_dir = Path(tmpdir)
            first_path = snapshot_dir / "cam1_person_a.jpg"
            second_path = snapshot_dir / "cam1_person_b.jpg"
            third_path = snapshot_dir / "cam1_vehicle.jpg"

            self._write_entity_image(first_path, 0)
            self._write_entity_image(second_path, 1)

            vehicle_image = np.zeros((80, 80, 3), dtype=np.uint8)
            vehicle_image[30:50, 10:70] = 220
            cv2.imwrite(str(third_path), vehicle_image)

            events = [
                SimpleNamespace(
                    camera_id="CAM01",
                    id=1,
                    created_at=datetime(2026, 7, 27, 12, 0, 0),
                    event_type="person_detected",
                    label="person",
                    snapshot_path=first_path.name,
                ),
                SimpleNamespace(
                    camera_id="CAM01",
                    id=2,
                    created_at=datetime(2026, 7, 27, 12, 2, 0),
                    event_type="person_detected",
                    label="person",
                    snapshot_path=second_path.name,
                ),
                SimpleNamespace(
                    camera_id="CAM01",
                    id=3,
                    created_at=datetime(2026, 7, 27, 12, 3, 0),
                    event_type="vehicle_detected",
                    label="vehicle",
                    snapshot_path=third_path.name,
                ),
            ]

            entity_by_event_id, clusters = _build_snapshot_entity_index(events, snapshot_dir=snapshot_dir)

            self.assertEqual(entity_by_event_id[1], entity_by_event_id[2])
            self.assertNotEqual(entity_by_event_id[1], entity_by_event_id[3])
            self.assertEqual(clusters[0]["entity_id"], "CAM01-vehicle-0001")
            self.assertEqual(clusters[1]["entity_id"], "CAM01-person-0001")


if __name__ == "__main__":
    unittest.main()
