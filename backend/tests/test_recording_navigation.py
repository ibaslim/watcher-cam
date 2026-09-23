import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from app.config import CameraConfig, Settings
from app.api import recordings
from app.models import DetectionTrack, Event
from app.services.recording import Recorder


class RecordingNavigationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.settings = SimpleNamespace(recording_dir=str(self.root), app_timezone="Asia/Karachi")
        self.patches = [patch.object(recordings, "get_settings", return_value=self.settings),
                        patch("app.services.recording.get_settings", return_value=self.settings),
                        patch.object(recordings, "valid_camera_ids", return_value={"gate"})]
        for item in self.patches:
            item.start()
        self.addCleanup(self.temp.cleanup)
        for item in self.patches:
            self.addCleanup(item.stop)

    def clip(self, day="2026-09-18", name="12-00-00.mp4"):
        path = self.root / "gate" / day / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"test")
        return path

    def lookup(self, at, db=None, event_id=None):
        if db is None:
            db = SimpleNamespace(get=lambda *args, **kwargs: None)
        return recordings.recording_at(None, db, "gate", datetime.fromisoformat(at), event_id)

    def test_utc_event_seeks_inside_local_clip(self):
        self.clip()
        with patch.object(recordings, "_clip_duration", return_value=60):
            result = self.lookup("2026-09-18T07:00:17.250+00:00")
            self.assertEqual(result["offset_seconds"], 17.25)
            self.assertEqual(result["timeline_second"], 12 * 3600 + 17.25)
            self.assertEqual(result["clip"]["start_second"], 12 * 3600)
            self.assertEqual(result["clip"]["filename"], "12-00-00.mp4")
            self.assertEqual(self.lookup("2026-09-18T12:00:17.250+05:00")["offset_seconds"], 17.25)

    def test_midnight_uses_previous_day(self):
        self.clip("2026-09-17", "23-59-30.mp4")
        with patch.object(recordings, "_clip_duration", return_value=60):
            result = self.lookup("2026-09-17T19:00:05+00:00")
            self.assertEqual(result["clip"]["day"], "2026-09-17")
            self.assertEqual(result["offset_seconds"], 35)

    def test_gap_and_clip_end_do_not_play_unrelated_footage(self):
        self.clip()
        with patch.object(recordings, "_clip_duration", return_value=30):
            for instant in ["2026-09-18T07:01:00+00:00", "2026-09-18T06:59:00+00:00"]:
                with self.assertRaises(HTTPException) as error:
                    self.lookup(instant)
                self.assertEqual(error.exception.status_code, 404)

    def test_subsecond_boundary_gap_resolves_gracefully(self):
        self.clip()
        with patch.object(recordings, "_clip_duration", return_value=59.2):
            # Event occurred at 59.5 seconds into the minute (0.3s after clip ended)
            result = self.lookup("2026-09-18T07:00:59.500+00:00")
            self.assertEqual(result["clip"]["filename"], "12-00-00.mp4")
            self.assertAlmostEqual(result["offset_seconds"], 59.1, places=1)

    def test_fallback_when_latest_probe_fails(self):
        self.clip()
        self.clip(name="12-01-00.mp4")
        def mock_probe(path, *args):
            if "12-01-00" in path:
                raise ValueError("moov missing in active clip")
            return 60.0

        with patch.object(recordings, "_clip_duration", side_effect=mock_probe):
            result = self.lookup("2026-09-18T07:00:45+00:00")
            self.assertEqual(result["clip"]["filename"], "12-00-00.mp4")
            self.assertEqual(result["offset_seconds"], 45)

    def test_boundary_selects_new_clip(self):
        self.clip()
        self.clip(name="12-01-00.mp4")
        with patch.object(recordings, "_clip_duration", return_value=60):
            result = self.lookup("2026-09-18T07:01:00+00:00")
            self.assertEqual(result["clip"]["filename"], "12-01-00.mp4")
            self.assertEqual(result["offset_seconds"], 0)

    def test_event_jump_uses_track_first_seen(self):
        self.clip(name="12-00-00.mp4")
        db = SimpleNamespace(
            get=lambda model, event_id: Event(
                id=event_id,
                camera_id="gate",
                created_at=datetime(2026, 9, 18, 7, 0, 15),
                source="yolo",
                event_type="person_detected",
                track_id="track-1",
            ),
            scalar=lambda stmt: DetectionTrack(
                id=2,
                camera_id="gate",
                track_id="track-1",
                category="person",
                first_seen=datetime(2026, 9, 18, 7, 0, 10),
                last_seen=datetime(2026, 9, 18, 7, 0, 25),
            ),
        )

        with patch.object(recordings, "_clip_duration", return_value=600):
            result = self.lookup("2026-09-18T07:00:15+00:00", db=db, event_id=1)

        self.assertEqual(result["offset_seconds"], 10)
        self.assertEqual(result["timeline_second"], 12 * 3600 + 10)

    def test_unfinished_clip_and_probe_timeout_fail_gracefully(self):
        self.clip()
        for failure in [ValueError("moov atom missing"), subprocess.TimeoutExpired("ffprobe", 5)]:
            with patch.object(recordings, "_clip_duration", side_effect=failure):
                with self.assertRaises(HTTPException) as error:
                    self.lookup("2026-09-18T07:00:10+00:00")
                self.assertEqual(error.exception.status_code, 404)

    def test_missing_camera_and_no_files(self):
        with self.assertRaises(HTTPException):
            recordings.recording_at(None, "missing", datetime.now(timezone.utc))
        with self.assertRaises(HTTPException):
            self.lookup("2026-09-18T07:00:10+00:00")

    def test_real_ffprobe_duration(self):
        path = self.clip()
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=size=64x64:rate=10", "-t", "2", "-c:v", "libx264", str(path)], check=True, timeout=15)
        result = self.lookup("2026-09-18T07:00:01+00:00")
        self.assertAlmostEqual(result["duration_seconds"], 2, places=1)
        self.assertEqual(result["offset_seconds"], 1)

    def test_day_manifest_includes_clips_events_and_ranges(self):
        self.clip(name="12-00-00.mp4")
        db = SimpleNamespace(
            scalars=lambda stmt: SimpleNamespace(
                all=lambda: [
                    Event(
                        id=1,
                        camera_id="gate",
                        created_at=datetime(2026, 9, 18, 7, 0, 15),
                        source="yolo",
                        event_type="person_detected",
                        label="person",
                        confidence=0.9,
                        snapshot_path="person.jpg",
                        track_id="track-1",
                    )
                ]
                if str(stmt).find("events") >= 0
                else [
                    DetectionTrack(
                        id=2,
                        camera_id="gate",
                        track_id="track-1",
                        category="person",
                        label="person",
                        confidence=0.9,
                        first_seen=datetime(2026, 9, 18, 7, 0, 10),
                        last_seen=datetime(2026, 9, 18, 7, 0, 25),
                    )
                ]
            )
        )

        with patch.object(recordings, "_clip_duration", return_value=600):
            result = recordings.recording_day(None, db, "gate", datetime(2026, 9, 18).date())

        self.assertEqual(result["clips"][0]["start_second"], 12 * 3600)
        self.assertEqual(result["detections"][0]["timeline_second"], 12 * 3600 + 10)
        self.assertEqual(result["detection_ranges"][0]["start_second"], 12 * 3600 + 10)
        self.assertEqual(result["detection_ranges"][0]["end_second"], 12 * 3600 + 25)


class RecorderSourceTests(unittest.TestCase):
    def test_recorder_uses_mediamtx_path_and_ten_minute_segments(self):
        settings = Settings(
            mediamtx_rtsp_host="streams",
            mediamtx_rtsp_port=8554,
            recording_segment_seconds=600,
        )
        self.assertEqual(settings.recording_segment_seconds, 600)

        with patch("app.services.recording.get_settings", return_value=settings):
            recorder = Recorder(CameraConfig(id="front gate", name="Front Gate", host="192.0.2.10"))
            self.assertEqual(recorder._source_url(), "rtsp://streams:8554/front%20gate")


if __name__ == "__main__":
    unittest.main()
