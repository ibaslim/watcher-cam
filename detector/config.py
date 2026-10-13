from __future__ import annotations

from functools import lru_cache
from urllib.parse import quote

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict


class CameraConfig(BaseModel):
    """Mirror of the backend's CameraConfig — populated from /api/cameras."""

    id: str
    name: str
    host: str = ""
    rtsp_port: int = 554
    http_port: int = 80
    username: str = ""
    password: str = ""
    channel: int = 101
    detect: bool = False
    rtsp_url_override: str = ""

    @property
    def rtsp_sub_url(self) -> str:
        return f"rtsp://mediamtx:8554/{self.id}"

    @property
    def snapshot_channel(self) -> int:
        """Return the Hikvision main-stream channel for high-quality snapshots.

        Hikvision channel convention is input 1 main=101 / sub=102,
        input 2 main=201 / sub=202, etc. If the camera is already configured
        on main stream, this returns the same channel.
        """

        if self.channel > 100 and self.channel % 100 == 2:
            return self.channel - 1
        return self.channel

    @property
    def rtsp_snapshot_url(self) -> str | None:
        if self.rtsp_url_override or not self.host:
            return None

        username = quote(self.username, safe="")
        password = quote(self.password, safe="")

        return (
            f"rtsp://{username}:{password}"
            f"@{self.host}:{self.rtsp_port}/Streaming/Channels/{self.snapshot_channel}"
        )


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_nested_delimiter="__",
        extra="ignore",
    )

    backend_url: str = "http://backend:8000"
    internal_service_token: str = ""
    snapshot_dir: str = "/app/data/snapshots"
    high_quality_event_snapshots: bool = True
    snapshot_grab_frames: int = 8
    high_quality_snapshot_event_types: str = ""

    face_model: str = "buffalo_l"
    face_det_size: int = 320
    face_sample_fps: float = 1.0
    face_min_size: int = 40

    yolo_model: str = "yolov8m.pt"
    yolo_confidence: float = 0.30
    yolo_classes: str = "person,vehicle,animal"
    object_min_area: int = 2500
    unknown_confirmation_hits: int = 1
    unknown_confirmation_window: int = 1
    object_alert_cooldown_sec: int = 0
    object_track_forget_sec: float = 20.0
    object_track_match_iou: float = 0.30
    object_move_realert_px: float = 120.0
    object_move_realert_ratio: float = 0.20
    vehicle_repeat_alert_suppress_sec: float = 43200.0
    vehicle_repeat_alert_match_iou: float = 0.12
    vehicle_repeat_alert_match_px: float = 45.0
    camera_open_timeout_sec: float = 45.0

    camera_refresh_sec: int = 30
    camera_worker_start_stagger_sec: float = 1.0
    camera_worker_start_stagger_max_sec: float = 30.0

    present_heartbeat_sec: int = 0
    unknown_alert_cooldown_sec: int = 0

    api_port: int = 8001

    @property
    def yolo_class_list(self) -> list[str]:
        return [name.strip().lower() for name in self.yolo_classes.split(",") if name.strip()]

    @staticmethod
    def _float_map(value: str) -> dict[str, float]:
        result: dict[str, float] = {}
        for item in value.split(","):
            name, separator, raw = item.strip().partition(":")
            if separator:
                result[name.strip().lower()] = float(raw)
        return result

    @staticmethod
    def _int_map(value: str) -> dict[str, int]:
        result: dict[str, int] = {}
        for item in value.split(","):
            name, separator, raw = item.strip().partition(":")
            if separator:
                result[name.strip().lower()] = int(raw)
        return result

    @property
    def high_quality_snapshot_event_type_set(self) -> set[str]:
        return {
            name.strip()
            for name in self.high_quality_snapshot_event_types.split(",")
            if name.strip()
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
