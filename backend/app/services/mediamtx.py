"""Tell MediaMTX which RTSP sources to pull.

MediaMTX exposes a control API (/v3/config/paths/...) that lets us add paths at
runtime instead of templating a YAML file. On startup we call this for every
camera in the .env config.

Docs: https://github.com/bluenviron/mediamtx#control-api
"""

from __future__ import annotations

import logging

import httpx

from app.config import CameraConfig, get_settings

log = logging.getLogger(__name__)


def _path_config(cam: CameraConfig) -> dict:
    if cam.recorder_id:
        # NVR/DVR streams often have recorder-specific RTP/H264 quirks. The
        # backend remux supervisor pulls the original recorder RTSP with FFmpeg
        # and publishes a normalized RTSP stream to this MediaMTX path.
        return {
            "source": "publisher",
            "sourceOnDemand": False,
        }

    url = cam.rtsp_url_override if cam.rtsp_url_override else cam.rtsp_url
    return {
        "source": url,
        # `rtspTransport` is the current MediaMTX v3 field name (the old
        # `sourceProtocol` is deprecated). Force TCP — UDP RTSP is unreliable
        # over most networks and behind NAT.
        "rtspTransport": "tcp",
        "sourceOnDemand": True,
        # Keep remote NVR/DVR sources warm for a short period after a viewer
        # disconnects. Without this, every dashboard refresh/fullscreen/retry
        # can make MediaMTX tear down and re-open the RTSP session, which is
        # especially unstable over port-forwarded internet links.
        "sourceOnDemandStartTimeout": "30s",
        "sourceOnDemandCloseAfter": "120s",
    }


async def sync_one(cam: CameraConfig) -> str | None:
    """Register/update a single camera's MediaMTX path.

    Returns None on success, or a human-readable error string describing why the
    stream couldn't be registered (so callers can surface it in the UI instead
    of the operator discovering a dead tile later)."""
    # Cameras with a direct RTSP override (e.g. the demo webcam) are managed
    # manually in mediamtx.yml — don't clobber the static config.
    if cam.rtsp_url_override:
      log.info("mediamtx path %s has override url — registering with override", cam.id)

    api = get_settings().mediamtx_api_url
    try:
        async with httpx.AsyncClient(base_url=api, timeout=10) as client:
            existing = await _list_path_configs(client)
            config = _path_config(cam)
            if cam.id in existing:
                if _path_matches(existing[cam.id], config):
                    log.debug("mediamtx path unchanged: %s", cam.id)
                    return None
                r = await client.patch(f"/v3/config/paths/patch/{cam.id}", json=config)
            else:
                r = await client.post(f"/v3/config/paths/add/{cam.id}", json=config)
    except Exception as e:
        log.warning("mediamtx path %s: could not reach MediaMTX: %s", cam.id, e)
        return f"Could not reach the streaming server to register this camera: {e}"

    if r.status_code >= 400:
        log.warning("mediamtx path %s failed: %s %s", cam.id, r.status_code, r.text)
        return f"Streaming server rejected the camera config (HTTP {r.status_code}): {r.text[:200]}"

    log.info("mediamtx path registered: %s", cam.id)
    return None


async def sync_paths(cameras: list[CameraConfig]) -> None:
    """Bulk sync (used at startup). Per-camera failures are logged, not raised."""
    for cam in cameras:
        await sync_one(cam)


async def remove_path(camera_id: str) -> None:
    """Best-effort tear down a dynamic path. Externally-managed paths (set via
    mediamtx.yml) won't be in `existing` and we just no-op."""
    api = get_settings().mediamtx_api_url
    async with httpx.AsyncClient(base_url=api, timeout=10) as client:
        existing = await _list_path_configs(client)
        if camera_id not in existing:
            return
        r = await client.post(f"/v3/config/paths/delete/{camera_id}")
        if r.status_code >= 400:
            log.warning("mediamtx path delete %s failed: %s %s", camera_id, r.status_code, r.text)


async def _list_path_configs(client: httpx.AsyncClient) -> dict[str, dict]:
    try:
        r = await client.get("/v3/config/paths/list")
        r.raise_for_status()
        return {item["name"]: item for item in r.json().get("items", [])}
    except Exception:
        return {}


def _duration_matches(actual: object, desired: str) -> bool:
    """MediaMTX normalizes durations (for example 120s -> 2m0s)."""
    if actual == desired:
        return True
    aliases = {
        "120s": {"120s", "2m0s", "2m"},
        "30s": {"30s"},
    }
    return str(actual) in aliases.get(desired, {desired})


def _path_matches(actual: dict, desired: dict) -> bool:
    if desired["source"] == "publisher":
        return (
            actual.get("source") == "publisher"
            and actual.get("sourceOnDemand") == desired["sourceOnDemand"]
        )

    return (
        actual.get("source") == desired["source"]
        and actual.get("rtspTransport") == desired["rtspTransport"]
        and actual.get("sourceOnDemand") == desired["sourceOnDemand"]
        and _duration_matches(actual.get("sourceOnDemandStartTimeout"), desired["sourceOnDemandStartTimeout"])
        and _duration_matches(actual.get("sourceOnDemandCloseAfter"), desired["sourceOnDemandCloseAfter"])
    )
