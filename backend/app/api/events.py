from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    import cv2
except ModuleNotFoundError:  # pragma: no cover - runtime fallback
    cv2 = None

import numpy as np

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import require_admin
from app.config import get_settings
from app.db import get_db
from app.models import CameraClassification, Event, Guard, User

router = APIRouter()

ENTITY_MATCH_WINDOW = timedelta(minutes=20)
ENTITY_HASH_DISTANCE_THRESHOLD = 10
ENTITY_COLOR_CORRELATION_THRESHOLD = 0.75


class BulkDeleteIn(BaseModel):
    event_ids: list[int] = Field(..., min_length=1, max_length=500)


def _local_boundary_to_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None

    if value.tzinfo is None:
        try:
            local_tz = ZoneInfo(get_settings().app_timezone)
        except ZoneInfoNotFoundError:
            local_tz = timezone.utc
        value = value.replace(tzinfo=local_tz)

    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _delete_snapshot_file(snapshot_path: str | None) -> bool:
    if not snapshot_path:
        return False

    settings = get_settings()
    snapshot_dir = Path(settings.snapshot_dir).resolve()

    try:
        file_path = (snapshot_dir / snapshot_path).resolve()

        # Safety check: never delete outside snapshot_dir
        if snapshot_dir not in file_path.parents and file_path != snapshot_dir:
            return False

        if file_path.exists() and file_path.is_file():
            file_path.unlink()
            return True

    except Exception:
        return False

    return False


@router.get("")
def list_events(
    db: Annotated[Session, Depends(get_db)],
    camera_id: str | None = None,
    entity_id: str | None = None,
    event_type: str | None = None,
    source: str | None = Query(None, description='"hikvision" | "face" | "presence" | "yolo"'),
    since: datetime | None = None,
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    limit: int | None = Query(None, ge=1),
    offset: int = 0,
) -> list[dict]:
    date_from = _local_boundary_to_utc(date_from) or since
    date_to = _local_boundary_to_utc(date_to)

    stmt = select(Event).order_by(Event.created_at.desc())
    if camera_id:
        stmt = stmt.where(Event.camera_id == camera_id)
    if entity_id:
        stmt = stmt.where(Event.entity_id == entity_id)
    if event_type:
        stmt = stmt.where(Event.event_type == event_type)
    if source:
        stmt = stmt.where(Event.source == source)
    if date_from:
        stmt = stmt.where(Event.created_at >= date_from)
    if date_to:
        stmt = stmt.where(Event.created_at <= date_to)
    if limit is not None:
        stmt = stmt.limit(limit)
    stmt = stmt.offset(offset)

    rows = db.scalars(stmt).all()

    guard_ids = {e.guard_id for e in rows if e.guard_id is not None}
    guard_names: dict[int, str] = {}
    if guard_ids:
        guards = db.scalars(select(Guard).where(Guard.id.in_(guard_ids))).all()
        guard_names = {g.id: g.name for g in guards}

    return [
        {
            "id": e.id,
            "camera_id": e.camera_id,
            "created_at": e.created_at.isoformat() + "Z",
            "source": e.source,
            "event_type": e.event_type,
            "label": e.label,
            "confidence": e.confidence,
            "snapshot_url": f"/snapshots/{e.snapshot_path}" if e.snapshot_path else None,
            "entity_id": e.entity_id,
            "guard_id": e.guard_id,
            "guard_name": guard_names.get(e.guard_id) if e.guard_id else None,
            "face_score": e.face_score,
        }
        for e in rows
    ]


def _fingerprint_image(path: Path) -> str | None:
    if not path.exists() or not path.is_file():
        return None

    digest = hashlib.blake2b(digest_size=16)
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 64), b""):
                digest.update(chunk)
    except Exception:
        return None

    return digest.hexdigest()


def _load_entity_image(path: Path):
    if cv2 is None or not path.exists() or not path.is_file():
        return None

    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        return None

    green_mask = (
        (image[:, :, 1] >= 140)
        & (image[:, :, 1] >= image[:, :, 0] + 70)
        & (image[:, :, 1] >= image[:, :, 2] + 70)
    ).astype(np.uint8) * 255

    contours, _ = cv2.findContours(green_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        contour = max(contours, key=cv2.contourArea)
        x, y, width, height = cv2.boundingRect(contour)
        if width >= 24 and height >= 24:
            inset = max(2, min(width, height) // 48)
            x1 = max(0, x + inset)
            y1 = max(0, y + inset)
            x2 = min(image.shape[1], x + width - inset)
            y2 = min(image.shape[0], y + height - inset)
            if x2 > x1 and y2 > y1:
                image = image[y1:y2, x1:x2]

    return image


def _load_entity_region(path: Path):
    image = _load_entity_image(path)
    if image is None:
        return None
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def _visual_hash_image(path: Path) -> str | None:
    image = _load_entity_region(path)
    if image is None:
        return None

    try:
        resized = cv2.resize(image, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float32)
    except Exception:
        return None

    dct = cv2.dct(resized)
    low_freq = dct[:8, :8]
    threshold = float(np.median(low_freq[1:, :]))
    bits = (low_freq > threshold).astype(np.uint8).reshape(-1)
    packed = np.packbits(bits)
    return packed.tobytes().hex()


def _color_signature_image(path: Path):
    if cv2 is None:
        return None

    image = _load_entity_image(path)
    if image is None:
        return None

    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [12, 8], [0, 180, 0, 256])
    return cv2.normalize(hist, hist).flatten().astype(np.float32)


def _color_correlation(left, right) -> float | None:
    if cv2 is None or left is None or right is None:
        return None
    return float(cv2.compareHist(left, right, cv2.HISTCMP_CORREL))


def _image_laplacian_score(frame) -> float:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _hamming_distance(left: str | None, right: str | None) -> int | None:
    if not left or not right:
        return None

    try:
        return (int(left, 16) ^ int(right, 16)).bit_count()
    except ValueError:
        return None


def _normalize_classification_category(value: str | None) -> str | None:
    raw = (value or "").strip().lower()
    if not raw:
        return None
    if raw.startswith("person"):
        return "person"
    if raw.startswith("animal") or raw in {"cat", "dog", "bird", "horse", "cow", "sheep"}:
        return "animal"
    if raw.startswith("vehicle") or raw in {"car", "truck", "bus", "van", "motorbike", "bicycle"}:
        return "vehicle"
    return None


def _serialize_classification(row, *, snapshot_dir: str | None = None) -> dict:
    base_dir = Path(snapshot_dir or get_settings().snapshot_dir).resolve()
    snapshot_name = getattr(row, "snapshot_path", None)
    image_url = None

    if snapshot_name:
        candidate = base_dir / snapshot_name if not Path(snapshot_name).is_absolute() else Path(snapshot_name)
        if candidate.exists() and candidate.is_file():
            image = cv2.imread(str(candidate), cv2.IMREAD_COLOR) if cv2 is not None else None
            if image is None or _image_laplacian_score(image) >= 140.0:
                image_url = f"/snapshots/{candidate.name}"

    return {
        "id": getattr(row, "id", None),
        "camera_id": getattr(row, "camera_id", None),
        "category": getattr(row, "category", None),
        "label": getattr(row, "label", None),
        "crop_url": image_url,
        "image_url": image_url,
        "occurrence_count": getattr(row, "occurrence_count", 1),
        "first_seen": getattr(row, "first_seen", None).isoformat() + "Z" if getattr(row, "first_seen", None) else None,
        "last_seen": getattr(row, "last_seen", None).isoformat() + "Z" if getattr(row, "last_seen", None) else None,
        "confidence": getattr(row, "confidence", None),
        "source_event_type": getattr(row, "source_event_type", None),
        "classification_key": getattr(row, "entity_id", None) or f"{getattr(row, 'category', None)}:{getattr(row, 'id', None)}",
        "entity_id": getattr(row, "entity_id", None),
    }


def _event_created_at(event) -> datetime:
    return getattr(event, "created_at", None) or datetime.now(timezone.utc)


def _build_snapshot_entity_index(events, *, snapshot_dir: str | None = None) -> tuple[dict[int, str], list[dict]]:
    base_dir = Path(snapshot_dir or get_settings().snapshot_dir).resolve()
    image_cache: dict[str, tuple[Path, str | None, str | None, np.ndarray | None]] = {}
    clusters_by_scope: dict[tuple[str, str], list[dict]] = {}
    counters: dict[tuple[str, str], int] = {}
    entity_by_event_id: dict[int, str] = {}

    for event in sorted(events, key=_event_created_at):
        category = _normalize_classification_category(getattr(event, "label", None) or getattr(event, "event_type", None))
        if category is None:
            continue

        snapshot_path = getattr(event, "snapshot_path", None)
        snapshot_path = snapshot_path.strip() if snapshot_path else ""
        if not snapshot_path:
            continue

        cached = image_cache.get(snapshot_path)
        if cached is None:
            candidate = base_dir / snapshot_path if not Path(snapshot_path).is_absolute() else Path(snapshot_path)
            if not candidate.exists() or not candidate.is_file():
                image_cache[snapshot_path] = (candidate, None, None, None)
            else:
                image_cache[snapshot_path] = (
                    candidate,
                    _fingerprint_image(candidate),
                    _visual_hash_image(candidate),
                    _color_signature_image(candidate),
                )
            cached = image_cache[snapshot_path]

        source_file, fingerprint, visual_hash, color_signature = cached
        if not fingerprint:
            continue

        scope = (event.camera_id, category)
        clusters = clusters_by_scope.setdefault(scope, [])
        created_at = _event_created_at(event)
        matched_cluster = None

        for cluster in reversed(clusters):
            if created_at - cluster["last_seen_dt"] > ENTITY_MATCH_WINDOW:
                continue
            if fingerprint in cluster["fingerprints"]:
                matched_cluster = cluster
                break

            distances = [
                distance
                for distance in (_hamming_distance(visual_hash, existing_hash) for existing_hash in cluster["visual_hashes"])
                if distance is not None
            ]
            if distances and min(distances) <= ENTITY_HASH_DISTANCE_THRESHOLD:
                matched_cluster = cluster
                break

            correlations = [
                correlation
                for correlation in (_color_correlation(color_signature, existing_signature) for existing_signature in cluster["color_signatures"])
                if correlation is not None
            ]
            if correlations and max(correlations) >= ENTITY_COLOR_CORRELATION_THRESHOLD:
                matched_cluster = cluster
                break

        if matched_cluster is None:
            next_index = counters.get(scope, 0) + 1
            counters[scope] = next_index
            matched_cluster = {
                "entity_id": f"{event.camera_id}-{category}-{next_index:04d}",
                "camera_id": event.camera_id,
                "category": category,
                "event_ids": [],
                "fingerprints": set(),
                "visual_hashes": [],
                "color_signatures": [],
                "first_seen_dt": created_at,
                "last_seen_dt": created_at,
                "representative_event": event,
                "representative_file": source_file,
            }
            clusters.append(matched_cluster)

        matched_cluster["event_ids"].append(event.id)
        matched_cluster["fingerprints"].add(fingerprint)
        if visual_hash:
            matched_cluster["visual_hashes"].append(visual_hash)
        if color_signature is not None:
            matched_cluster["color_signatures"].append(color_signature)

        if created_at < matched_cluster["first_seen_dt"]:
            matched_cluster["first_seen_dt"] = created_at
        if created_at >= matched_cluster["last_seen_dt"]:
            matched_cluster["last_seen_dt"] = created_at
            matched_cluster["representative_event"] = event
            matched_cluster["representative_file"] = source_file

        entity_by_event_id[event.id] = matched_cluster["entity_id"]

    clusters = sorted(
        (cluster for scoped_clusters in clusters_by_scope.values() for cluster in scoped_clusters),
        key=lambda item: item["last_seen_dt"],
        reverse=True,
    )
    return entity_by_event_id, clusters


def _build_snapshot_classifications(events, *, snapshot_dir: str | None = None) -> list[dict]:
    rows: list[dict] = []
    by_entity_id: dict[str, dict] = {}

    for event in sorted(events, key=_event_created_at, reverse=True):
        entity_id = getattr(event, "entity_id", None)
        if not entity_id:
            continue

        category = _normalize_classification_category(getattr(event, "label", None) or getattr(event, "event_type", None))
        if category is None:
            continue

        group = by_entity_id.get(entity_id)
        if group is None:
            snapshot_path = getattr(event, "snapshot_path", None)
            image_url = f"/snapshots/{Path(snapshot_path).name}" if snapshot_path else None
            group = {
                "id": event.id,
                "entity_id": entity_id,
                "camera_id": event.camera_id,
                "category": category,
                "label": getattr(event, "label", None) or category,
                "crop_url": image_url,
                "image_url": image_url,
                "occurrence_count": 0,
                "first_seen": event.created_at.isoformat() + "Z",
                "last_seen": event.created_at.isoformat() + "Z",
                "confidence": getattr(event, "confidence", None),
                "source_event_type": getattr(event, "event_type", None),
                "classification_key": entity_id,
            }
            by_entity_id[entity_id] = group
            rows.append(group)

        group["occurrence_count"] += 1
        if event.created_at.isoformat() + "Z" > group["last_seen"]:
            group["last_seen"] = event.created_at.isoformat() + "Z"
            group["image_url"] = f"/snapshots/{Path(event.snapshot_path).name}" if event.snapshot_path else group["image_url"]
            group["crop_url"] = group["image_url"]
            group["confidence"] = getattr(event, "confidence", None)
            group["source_event_type"] = getattr(event, "event_type", None)

    return rows


@router.get("/classifications")
def list_classifications(
    db: Annotated[Session, Depends(get_db)],
    camera_id: str | None = None,
    category: str | None = None,
    entity_id: str | None = None,
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    limit: int | None = Query(None, ge=1),
) -> list[dict]:
    stmt = select(Event).where(Event.entity_id.isnot(None)).order_by(Event.created_at.desc())
    if camera_id:
        stmt = stmt.where(Event.camera_id == camera_id)
    if category:
        stmt = stmt.where(Event.event_type.like(f"%{category}%"))
    if entity_id:
        stmt = stmt.where(Event.entity_id == entity_id)
    if date_from:
        stmt = stmt.where(Event.created_at >= _local_boundary_to_utc(date_from))
    if date_to:
        stmt = stmt.where(Event.created_at <= _local_boundary_to_utc(date_to))
    if limit is not None:
        stmt = stmt.limit(max(limit * 20, limit))

    rows = db.scalars(stmt).all()
    classifications = _build_snapshot_classifications(rows, snapshot_dir=get_settings().snapshot_dir)

    return classifications[:limit] if limit is not None else classifications


@router.delete("/bulk")
def delete_events_bulk(
    payload: BulkDeleteIn,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin)],
) -> dict:
    rows = db.scalars(select(Event).where(Event.id.in_(payload.event_ids))).all()

    if not rows:
        raise HTTPException(404, "no matching events found")

    deleted_files = 0

    for event in rows:
        if _delete_snapshot_file(event.snapshot_path):
            deleted_files += 1

        db.delete(event)

    db.commit()

    return {
        "ok": True,
        "deleted_events": len(rows),
        "deleted_snapshots": deleted_files,
    }
