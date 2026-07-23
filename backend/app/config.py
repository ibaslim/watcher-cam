from __future__ import annotations

from functools import lru_cache
from urllib.parse import quote

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict


class CameraConfig(BaseModel):
    """Runtime camera config used by services (mediamtx, hikvision ISAPI, presence).

    Source of truth lives in the DB (`models.Camera`); this is a plain Pydantic
    shape that DB rows are projected into so the existing service code can
    consume it without holding a SQLAlchemy session.
    """

    id: str
    name: str
    host: str = ""
    rtsp_port: int = 554
    http_port: int = 80
    username: str = ""
    password: str = ""
    channel: int = 101
    detect: bool = False
    recording_enabled: bool = True
    rtsp_url_override: str = ""
    recorder_id: str = ""
    recorder_name: str = ""

    @property
    def rtsp_url(self) -> str:
        if self.rtsp_url_override:
            return self.rtsp_url_override
        username = quote(self.username, safe="")
        password = quote(self.password, safe="")
        return (
            f"rtsp://{username}:{password}"
            f"@{self.host}:{self.rtsp_port}/Streaming/Channels/{self.channel}"
        )

    @property
    def is_hikvision(self) -> bool:
        return not self.rtsp_url_override and bool(self.host)

    @property
    def isapi_base(self) -> str:
        return f"http://{self.host}:{self.http_port}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_nested_delimiter="__",
        extra="ignore",
    )

    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    database_url: str = "sqlite:///./data/app.db"
    snapshot_dir: str = "./data/snapshots"
    secret_key: str = "change-me"

    app_timezone: str = "Asia/Karachi"

    mediamtx_api_host: str = "host.docker.internal"
    mediamtx_api_port: int = 9997
    mediamtx_webrtc_port: int = 8889
    mediamtx_hls_port: int = 8888

    yolo_model: str = "yolov8n.pt"
    yolo_fps: float = 3.0
    yolo_confidence: float = 0.45
    yolo_classes: str = "person"

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "alerts@example.com"
    smtp_to: str = ""
    smtp_use_tls: bool = True

    alert_cooldown: int = 60

    # Snapshot files older than this are auto-deleted. 0 disables retention.
    snapshot_retention_days: int = 30
    recording_dir: str = "./data/recordings"
    recording_retention_days: int = 30
    recording_segment_seconds: int = 300
    recording_enabled: bool = True

    # Shared-password gate for the whole API + dashboard. Leave blank to
    # disable (MVP default — trust the LAN). Set to a long random string
    # when exposing the dashboard outside a trusted network.
    dashboard_password: str = ""
    # The dashboard deliberately auto-targets the same hostname it was opened
    # from, so deployments may use localhost, a LAN address, or a public
    # hostname. Authentication uses a Bearer token rather than cookies, making
    # wildcard CORS appropriate as the portable default.
    cors_origins: str = "*"
    internal_service_token: str = ""

    # URL the backend uses to call the detector service for embedding / matching.
    # Inside docker compose this resolves to the `detector` service.
    detector_url: str = "http://detector:8001"

    # When true, a virtual "demo-webcam" camera is exposed in /api/cameras
    # so a developer can test the dashboard without real Hikvision hardware.
    # Pair with scripts/webcam.sh which publishes the laptop webcam to MediaMTX.
    demo_mode: bool = False

    @property
    def mediamtx_api_url(self) -> str:
        return f"http://{self.mediamtx_api_host}:{self.mediamtx_api_port}"

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [o.strip() for o in self.cors_origins.split(",") if o.strip()]
        return origins or ["*"]

    @property
    def yolo_class_list(self) -> list[str]:
        return [c.strip() for c in self.yolo_classes.split(",") if c.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
