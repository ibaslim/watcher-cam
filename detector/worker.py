"""Per-camera AI detection worker.

Pipeline:
  1. Pull latest RTSP frame
  2. Detect people with YOLO
  3. Run face recognition for detected people
  4. Match faces against enrolled guards
  5. Emit:
     - guard_present when a known guard is recognized
     - unknown_person when a person is visible but no known guard face is matched
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import cv2
import httpx

from detector.config import CameraConfig, get_settings
from detector.face import DetectedFace, analyze
from detector.face_bank import bank
from detector.object_detection import detect_objects
from detector.person import PersonBox

log = logging.getLogger(__name__)


def _internal_headers() -> dict[str, str]:
    token = get_settings().internal_service_token
    return {"X-Internal-Token": token} if token else {}


class _LatestFrameReader:
    def __init__(self, url: str) -> None:
        self._url = url
        self._lock = threading.Lock()
        self._frame = None
        self._seq = 0
        self._running = True
        self._failed = False
        self.opened = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def _loop(self) -> None:
        cap = cv2.VideoCapture(self._url, cv2.CAP_FFMPEG)

        if not cap.isOpened():
            self._failed = True
            self.opened.set()
            return

        self.opened.set()

        try:
            while self._running:
                ok, frame = cap.read()

                if not ok or frame is None:
                    time.sleep(0.1)
                    continue

                with self._lock:
                    self._frame = frame
                    self._seq += 1
        finally:
            cap.release()

    def read_latest(self):
        with self._lock:
            return self._seq, self._frame

    @property
    def failed(self) -> bool:
        return self._failed

    def stop(self) -> None:
        self._running = False
        self._thread.join(timeout=2)


def _center_inside(inner: tuple[int, int, int, int], outer: tuple[int, int, int, int]) -> bool:
    x1, y1, x2, y2 = inner
    ox1, oy1, ox2, oy2 = outer

    cx = (x1 + x2) // 2
    cy = (y1 + y2) // 2

    return ox1 <= cx <= ox2 and oy1 <= cy <= oy2


def _center(bbox: tuple[int, int, int, int]) -> tuple[float, float]:
    x1, y1, x2, y2 = bbox
    return ((x1 + x2) / 2, (y1 + y2) / 2)


def _diag(bbox: tuple[int, int, int, int]) -> float:
    x1, y1, x2, y2 = bbox
    return max(1.0, ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5)


def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


def _iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b

    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)

    if inter <= 0:
        return 0.0

    area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
    area_b = max(0, bx2 - bx1) * max(0, by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _scale_bbox(
    bbox: tuple[int, int, int, int],
    *,
    src_shape,
    dst_shape,
) -> tuple[int, int, int, int]:
    src_h, src_w = src_shape[:2]
    dst_h, dst_w = dst_shape[:2]

    if src_w <= 0 or src_h <= 0:
        return bbox

    sx = dst_w / src_w
    sy = dst_h / src_h
    x1, y1, x2, y2 = bbox

    return (
        max(0, min(dst_w - 1, int(round(x1 * sx)))),
        max(0, min(dst_h - 1, int(round(y1 * sy)))),
        max(0, min(dst_w - 1, int(round(x2 * sx)))),
        max(0, min(dst_h - 1, int(round(y2 * sy)))),
    )


def _capture_high_quality_snapshot(cam: CameraConfig):
    """Grab one frame directly from the camera/NVR main stream.

    Live view and detector workers can stay on substream for stability, while
    the saved event image can use the higher-resolution main stream. Returns
    None on any failure so event delivery falls back to the already-available
    detector frame.
    """

    url = cam.rtsp_snapshot_url

    if not url:
        return None

    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)

    if not cap.isOpened():
        cap.release()
        return None

    try:
        frame = None

        for _ in range(max(1, get_settings().snapshot_grab_frames)):
            ok, candidate = cap.read()

            if ok and candidate is not None:
                frame = candidate

        return frame
    finally:
        cap.release()


def _event_detection_category(event_type: str) -> str | None:
    if event_type in {"unknown_person", "guard_present", "wrong_guard"}:
        return "person"
    return None


def _best_snapshot_detection_bbox(
    snapshot_frame,
    *,
    event_type: str,
    label: str,
    source_bbox: tuple[int, int, int, int],
    source_shape,
) -> tuple[int, int, int, int] | None:
    """Find a matching detection in the high-quality snapshot frame.

    The HQ frame is grabbed from the main stream after the detector event was
    observed on the live/sub stream. If the main stream is delayed or not
    frame-synchronized, blindly scaling the old bbox can draw boxes over empty
    areas. This function confirms that the same kind of object/person is still
    visible near the expected position before using the HQ frame.
    """

    category = _event_detection_category(event_type)

    if category is None:
        return None

    scaled_source_bbox = _scale_bbox(
        source_bbox,
        src_shape=source_shape,
        dst_shape=snapshot_frame.shape,
    )
    scaled_center = _center(scaled_source_bbox)
    scaled_diag = _diag(scaled_source_bbox)

    detections = [
        item
        for item in detect_objects(snapshot_frame)
        if item.category == category
    ]

    if not detections:
        return None

    ranked: list[tuple[float, tuple[int, int, int, int]]] = []

    for detection in detections:
        overlap = _iou(scaled_source_bbox, detection.bbox)
        distance = _distance(scaled_center, _center(detection.bbox))
        near_enough = distance <= max(180.0, scaled_diag * 1.75)

        if overlap < 0.03 and not near_enough:
            continue

        score = overlap * 10.0 + detection.confidence - (distance / max(1.0, scaled_diag * 10.0))
        ranked.append((score, detection.bbox))

    if not ranked:
        return None

    ranked.sort(key=lambda item: item[0], reverse=True)
    return ranked[0][1]


@dataclass
class _Track:
    id: int
    kind: str
    label: str
    bbox: tuple[int, int, int, int]
    first_seen: float
    last_seen: float
    last_alert_center: tuple[float, float] | None = None
    observation_frames: list[int] | None = None


class _ObjectTracker:
    """Small per-camera tracker that alerts on new or meaningfully moved objects."""

    def __init__(
        self,
        *,
        forget_sec: float,
        match_iou: float,
        move_realert_px: float,
        move_realert_ratio: float,
    ) -> None:
        self.forget_sec = forget_sec
        self.match_iou = match_iou
        self.move_realert_px = move_realert_px
        self.move_realert_ratio = move_realert_ratio
        self._next_id = 1
        self._tracks: list[_Track] = []

    def update(
        self,
        *,
        kind: str,
        label: str,
        bbox: tuple[int, int, int, int],
        now: float,
        frame_index: int,
        confirmation_hits: int = 1,
        confirmation_window: int = 1,
    ) -> tuple[int, bool, str]:
        self.prune(now)

        track = self._match(kind, label, bbox)
        if track is None:
            track = _Track(
                id=self._next_id,
                kind=kind,
                label=label,
                bbox=bbox,
                first_seen=now,
                last_seen=now,
                observation_frames=[frame_index],
            )
            self._next_id += 1
            self._tracks.append(track)
            if confirmation_hits <= 1:
                track.last_alert_center = _center(bbox)
                return track.id, True, "new"
            return track.id, False, "confirming"

        track.bbox = bbox
        track.last_seen = now
        observations = track.observation_frames or []
        if not observations or observations[-1] != frame_index:
            observations.append(frame_index)
        minimum_frame = frame_index - max(1, confirmation_window) + 1
        track.observation_frames = [
            observed for observed in observations if observed >= minimum_frame
        ]

        current_center = _center(bbox)
        if track.last_alert_center is None:
            if len(track.observation_frames) < max(1, confirmation_hits):
                return track.id, False, "confirming"
            track.last_alert_center = current_center
            return track.id, True, "confirmed"

        threshold = max(self.move_realert_px, _diag(bbox) * self.move_realert_ratio)
        moved = _distance(current_center, track.last_alert_center)

        if moved >= threshold:
            track.last_alert_center = current_center
            return track.id, True, "moved"

        return track.id, False, "stationary"

    def prune(self, now: float) -> None:
        self._tracks = [
            track
            for track in self._tracks
            if now - track.last_seen <= self.forget_sec
        ]

    def _match(
        self,
        kind: str,
        label: str,
        bbox: tuple[int, int, int, int],
    ) -> _Track | None:
        best: tuple[float, _Track] | None = None

        for track in self._tracks:
            if track.kind != kind or track.label != label:
                continue

            score = _iou(track.bbox, bbox)
            if score < self.match_iou:
                continue

            if best is None or score > best[0]:
                best = (score, track)

        return best[1] if best else None


def _person_has_matched_face(
    person: PersonBox,
    matches: list[tuple[DetectedFace, int, str, float]],
) -> tuple[DetectedFace, int, str, float] | None:
    for face, guard_id, guard_name, score in matches:
        if _center_inside(face.bbox, person.bbox):
            return face, guard_id, guard_name, score
    return None


async def run_camera_loop(cam: CameraConfig) -> None:
    log.info(
        "worker starting for %s detect=%s guarded=%s assigned=%s backup=%s unknown=%s wrong=%s",
        cam.id,
        cam.detect,
        cam.is_guarded,
        cam.assigned_guard_id,
        cam.backup_guard_id,
        cam.alert_unknown_person,
        cam.alert_wrong_guard,
    )

    try:
        while True:
            try:
                await _run_once(cam)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("worker %s crashed, retrying in 5s: %s", cam.id, e)
                await asyncio.sleep(5)
    except asyncio.CancelledError:
        log.info("worker stopped for %s", cam.id)


async def _run_once(cam: CameraConfig) -> None:
    s = get_settings()
    reader = _LatestFrameReader(cam.rtsp_sub_url)
    reader.start()

    opened = await asyncio.to_thread(reader.opened.wait, s.camera_open_timeout_sec)

    if not opened or reader.failed:
        reader.stop()
        raise RuntimeError(f"cannot open RTSP for {cam.id}")

    interval = 1.0 / max(s.face_sample_fps, 0.1)
    stall_timeout = 10.0

    last_seq = -1
    last_frame_mono = time.monotonic()
    last_face_analysis = 0.0
    last_face_diag_log = 0.0
    detection_frame_index = 0

    last_guard_heartbeat: dict[int, float] = {}
    tracker = _ObjectTracker(
        forget_sec=s.object_track_forget_sec,
        match_iou=s.object_track_match_iou,
        move_realert_px=s.object_move_realert_px,
        move_realert_ratio=s.object_move_realert_ratio,
    )

    try:
        async with httpx.AsyncClient(base_url=s.backend_url, timeout=5) as client:
            while True:
                await asyncio.sleep(interval)

                now = time.monotonic()
                seq, frame = reader.read_latest()

                if frame is None or seq == last_seq:
                    if now - last_frame_mono > stall_timeout:
                        raise RuntimeError(f"stream stalled for {cam.id}")
                    continue

                last_seq = seq
                last_frame_mono = now
                detection_frame_index += 1

                objects = await asyncio.to_thread(detect_objects, frame)
                people = [
                    PersonBox(item.bbox, item.confidence)
                    for item in objects
                    if item.category == "person"
                ]
                emitted_unknown_face_boxes: list[tuple[int, int, int, int]] = []

                should_run_face = (
                    (
                        cam.is_guarded
                        or cam.alert_wrong_guard
                        or cam.alert_unknown_person
                    )
                    and now - last_face_analysis >= s.face_recognition_interval_sec
                )
                faces = []

                if should_run_face:
                    last_face_analysis = now
                    faces = await asyncio.to_thread(analyze, frame)

                matched_faces: list[tuple[DetectedFace, int, str, float]] = []

                face_results = []

                for f in faces:
                    result = await bank.match_with_score(f.embedding)
                    face_results.append(result)
                    m = result.match

                    if m is not None:
                        matched_faces.append((f, m.guard_id, m.guard_name, m.score))

                if should_run_face and now - last_face_diag_log >= 10.0:
                    last_face_diag_log = now
                    if face_results:
                        best = max(
                            face_results,
                            key=lambda item: item.best_score if item.best_score is not None else -1.0,
                        )
                        log.info(
                            "face diagnostic camera=%s people=%d faces=%d matches=%d best_guard=%s best_score=%s threshold=%.2f",
                            cam.id,
                            len(people),
                            len(faces),
                            len(matched_faces),
                            best.best_guard_name,
                            f"{best.best_score:.3f}" if best.best_score is not None else "none",
                            s.face_match_threshold,
                        )
                    else:
                        log.info(
                            "face diagnostic camera=%s people=%d faces=0 matches=0 threshold=%.2f",
                            cam.id,
                            len(people),
                            s.face_match_threshold,
                        )

                emitted_guard_ids: set[int] = set()

                for person in people:
                    matched = _person_has_matched_face(person, matched_faces)

                    if matched is not None:
                        face, guard_id, guard_name, score = matched

                        if guard_id in emitted_guard_ids:
                            continue

                        last_seen = last_guard_heartbeat.get(guard_id, 0.0)

                        if now - last_seen >= s.present_heartbeat_sec:
                            last_guard_heartbeat[guard_id] = now
                            emitted_guard_ids.add(guard_id)
                            log.info(
                                "guard present matched camera=%s guard=%s guard_id=%s score=%.3f",
                                cam.id,
                                guard_name,
                                guard_id,
                                score,
                            )

                            await _emit(
                                client,
                                cam,
                                frame,
                                person.bbox,
                                event_type="guard_present",
                                label=guard_name,
                                guard_id=guard_id,
                                face_score=score,
                                face_bbox=face.bbox,
                            )

                if cam.alert_unknown_person and should_run_face:
                    for person in people:
                        if _person_has_matched_face(person, matched_faces):
                            continue

                        _track_id, should_alert, _reason = tracker.update(
                            kind="unknown_person",
                            label="unknown person",
                            bbox=person.bbox,
                            now=now,
                            frame_index=detection_frame_index,
                            confirmation_hits=s.unknown_confirmation_hits,
                            confirmation_window=s.unknown_confirmation_window,
                        )

                        if should_alert:
                            emitted_unknown_face_boxes.append(person.bbox)
                            await _emit(
                                client,
                                cam,
                                frame,
                                person.bbox,
                                event_type="unknown_person",
                                label="unknown person",
                                guard_id=None,
                                face_score=None,
                                face_bbox=None,
                            )

                    for face in faces:
                        if _person_has_matched_face(PersonBox(face.bbox, 1.0), matched_faces):
                            continue

                        if any(_center_inside(face.bbox, person.bbox) for person in people):
                            continue

                        if any(_iou(face.bbox, sent_bbox) > 0.05 for sent_bbox in emitted_unknown_face_boxes):
                            continue

                        _track_id, should_alert, _reason = tracker.update(
                            kind="unknown_face",
                            label="unknown person",
                            bbox=face.bbox,
                            now=now,
                            frame_index=detection_frame_index,
                            confirmation_hits=s.unknown_confirmation_hits,
                            confirmation_window=s.unknown_confirmation_window,
                        )

                        if should_alert:
                            emitted_unknown_face_boxes.append(face.bbox)
                            await _emit(
                                client,
                                cam,
                                frame,
                                face.bbox,
                                event_type="unknown_person",
                                label="unknown person",
                                guard_id=None,
                                face_score=None,
                                face_bbox=face.bbox,
                            )

                # Fallback: if YOLO missed body but face recognition found a guard.
                if not people:
                    for face, guard_id, guard_name, score in matched_faces:
                        last_seen = last_guard_heartbeat.get(guard_id, 0.0)

                        if now - last_seen < s.present_heartbeat_sec:
                            continue

                        last_guard_heartbeat[guard_id] = now
                        log.info(
                            "guard present matched camera=%s guard=%s guard_id=%s score=%.3f fallback=face_only",
                            cam.id,
                            guard_name,
                            guard_id,
                            score,
                        )

                        await _emit(
                            client,
                            cam,
                            frame,
                            face.bbox,
                            event_type="guard_present",
                            label=guard_name,
                            guard_id=guard_id,
                            face_score=score,
                            face_bbox=face.bbox,
                        )

    finally:
        await asyncio.to_thread(reader.stop)


async def _emit(
    client: httpx.AsyncClient,
    cam: CameraConfig,
    frame,
    bbox: tuple[int, int, int, int],
    *,
    event_type: str,
    label: str,
    guard_id: int | None,
    face_score: float | None,
    face_bbox: tuple[int, int, int, int] | None = None,
    confidence: float | None = None,
    source: str = "face",
) -> None:
    s = get_settings()
    ts = datetime.utcnow()
    filename = f"{cam.id}_{ts.strftime('%Y%m%d_%H%M%S_%f')}_{event_type}.jpg"
    full_path = Path(s.snapshot_dir) / filename

    def _write() -> None:
        snapshot_frame = (
            _capture_high_quality_snapshot(cam)
            if s.high_quality_event_snapshots
            and event_type in s.high_quality_snapshot_event_type_set
            else None
        )
        source_shape = frame.shape

        if snapshot_frame is not None:
            confirmed_bbox = _best_snapshot_detection_bbox(
                snapshot_frame,
                event_type=event_type,
                label=label,
                source_bbox=bbox,
                source_shape=source_shape,
            )

            if confirmed_bbox is not None:
                annotated = snapshot_frame.copy()
                draw_bbox = confirmed_bbox
                draw_face_bbox = None
            else:
                annotated = frame.copy()
                draw_bbox = bbox
                draw_face_bbox = face_bbox
        else:
            annotated = frame.copy()
            draw_bbox = bbox
            draw_face_bbox = face_bbox

        if event_type == "guard_present":
            color = (0, 200, 0)
        else:
            color = (0, 0, 220)

        x1, y1, x2, y2 = draw_bbox
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)

        if draw_face_bbox:
            fx1, fy1, fx2, fy2 = draw_face_bbox
            cv2.rectangle(annotated, (fx1, fy1), (fx2, fy2), (255, 200, 0), 2)

        score = face_score if face_score is not None else confidence
        caption = label if score is None else f"{label} {score:.2f}"

        cv2.putText(
            annotated,
            caption,
            (x1, max(y1 - 8, 15)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            color,
            2,
        )

        full_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(full_path), annotated)

    await asyncio.to_thread(_write)

    try:
        r = await client.post(
            "/api/detections",
            headers=_internal_headers(),
            json={
                "camera_id": cam.id,
                "event_type": event_type,
                "source": source,
                "label": label,
                "confidence": confidence if confidence is not None else face_score,
                "snapshot_path": filename,
                "guard_id": guard_id,
                "face_score": face_score,
            },
        )

        if r.status_code >= 400:
            log.warning("ingest failed: %s %s", r.status_code, r.text[:200])

    except Exception as e:
        log.warning("ingest post failed: %s", e)
