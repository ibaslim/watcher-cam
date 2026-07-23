"""Guard enrollment endpoints.

Flow:
  1. POST /api/guards                     — create a guard (just the name)
  2. POST /api/guards/{id}/photos         — upload a JPG; backend asks the detector
                                           service to compute an embedding and stores it
  3. GET  /api/guards                     — list guards (with photo counts)
  4. GET  /api/guards/embeddings          — detector calls this on startup / refresh
  5. DELETE /api/guards/{id}              — remove a guard + all their embeddings
  6. DELETE /api/guards/{id}/photos/{pid} — remove a single reference photo
"""

from __future__ import annotations

import base64
import logging
import os
import uuid
from pathlib import Path
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api import auth
from app.models import User
from app.config import get_settings
from app.db import get_db
from app.models import Guard, GuardEmbedding

log = logging.getLogger(__name__)
router = APIRouter()


# Embeddings are 512-dim float32 from ArcFace — 2048 bytes each.
EMBED_DIM_BYTES = 2048


class GuardIn(BaseModel):
    name: str


class GuardOut(BaseModel):
    id: int
    name: str
    active: bool
    photo_count: int
    created_at: str


def _photo_dir() -> Path:
    d = Path(get_settings().snapshot_dir).parent / "guard_photos"
    d.mkdir(parents=True, exist_ok=True)
    return d


@router.post("", response_model=GuardOut)
def create_guard(
    _admin: Annotated[User, Depends(auth.require_admin)],
    payload: GuardIn,
    db: Annotated[Session, Depends(get_db)],
) -> GuardOut:
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "name is required")
    g = Guard(name=name)
    db.add(g)
    db.commit()
    db.refresh(g)
    return GuardOut(
        id=g.id, name=g.name, active=g.active, photo_count=0, created_at=g.created_at.isoformat() + "Z"
    )


@router.get("", response_model=list[GuardOut])
def list_guards(
    _user: Annotated[User, Depends(auth.get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[GuardOut]:
    rows = db.execute(
        select(Guard, func.count(GuardEmbedding.id))
        .outerjoin(GuardEmbedding, GuardEmbedding.guard_id == Guard.id)
        .group_by(Guard.id)
        .order_by(Guard.created_at.desc())
    ).all()
    return [
        GuardOut(
            id=g.id,
            name=g.name,
            active=g.active,
            photo_count=count,
            created_at=g.created_at.isoformat() + "Z",
        )
        for g, count in rows
    ]


@router.delete("/{guard_id}")
def delete_guard(
    _admin: Annotated[User, Depends(auth.require_admin)],
    guard_id: int,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    g = db.get(Guard, guard_id)
    if not g:
        raise HTTPException(404, "guard not found")

    # Delete photo files for any embeddings that reference them.
    for emb in g.embeddings:
        if emb.photo_path:
            try:
                (_photo_dir() / emb.photo_path).unlink(missing_ok=True)
            except OSError as e:
                log.warning("failed deleting photo %s: %s", emb.photo_path, e)

    db.delete(g)  # cascade deletes embeddings
    db.commit()
    return {"ok": True}


@router.post("/{guard_id}/photos")
async def upload_photo(
    _admin: Annotated[User, Depends(auth.require_admin)],
    guard_id: int,
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
) -> dict:
    g = db.get(Guard, guard_id)
    if not g:
        raise HTTPException(404, "guard not found")
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "file must be an image")

    body = await file.read()
    if not body:
        raise HTTPException(400, "empty upload")

    # Ask the detector to run face detection + embedding on this image.
    s = get_settings()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{s.detector_url}/embed",
                files={"file": (file.filename or "photo.jpg", body, file.content_type)},
            )
    except httpx.HTTPError as e:
        raise HTTPException(502, f"detector unreachable: {e}") from e

    if r.status_code != 200:
        raise HTTPException(502, f"detector error: {r.status_code} {r.text[:200]}")

    result = r.json()
    faces: list[dict] = result.get("faces", [])
    if not faces:
        raise HTTPException(422, "no face detected in the uploaded photo")
    if len(faces) > 1:
        raise HTTPException(422, "multiple faces detected — upload a photo with only this guard")

    face = faces[0]
    vector_b64: str = face["embedding"]
    vector = base64.b64decode(vector_b64)
    if len(vector) != EMBED_DIM_BYTES:
        raise HTTPException(502, f"unexpected embedding size {len(vector)}")

    # Persist the reference photo for UI preview.
    ext = os.path.splitext(file.filename or "photo.jpg")[1] or ".jpg"
    saved_name = f"g{guard_id}_{uuid.uuid4().hex}{ext}"
    (_photo_dir() / saved_name).write_bytes(body)

    emb = GuardEmbedding(guard_id=guard_id, vector=vector, photo_path=saved_name)
    db.add(emb)
    db.commit()
    db.refresh(emb)
    return {
        "ok": True,
        "embedding_id": emb.id,
        "photo_url": f"/guard_photos/{saved_name}",
        "det_score": face.get("det_score"),
    }


@router.delete("/{guard_id}/photos/{embedding_id}")
def delete_photo(
    _admin: Annotated[User, Depends(auth.require_admin)],
    guard_id: int,
    embedding_id: int,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    emb = db.get(GuardEmbedding, embedding_id)
    if not emb or emb.guard_id != guard_id:
        raise HTTPException(404, "embedding not found")
    if emb.photo_path:
        try:
            (_photo_dir() / emb.photo_path).unlink(missing_ok=True)
        except OSError:
            pass
    db.delete(emb)
    db.commit()
    return {"ok": True}


@router.get("/embeddings")
def list_embeddings(
    _internal: Annotated[None, Depends(auth.require_internal_service)],
    db: Annotated[Session, Depends(get_db)],
) -> list[dict]:
    """All enrolled embeddings, used by the detector to populate its in-memory face bank."""
    rows = db.execute(
        select(GuardEmbedding, Guard.name)
        .join(Guard, Guard.id == GuardEmbedding.guard_id)
        .where(Guard.active.is_(True))
    ).all()
    return [
        {
            "embedding_id": emb.id,
            "guard_id": emb.guard_id,
            "guard_name": name,
            "vector_b64": base64.b64encode(emb.vector).decode("ascii"),
        }
        for emb, name in rows
    ]
