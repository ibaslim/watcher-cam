"""Persistent face identity matching and per-person appearance albums."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import uuid4

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Event, PersonAppearance, PersonEmbedding, PersonIdentity


@dataclass(frozen=True)
class IdentityResult:
    public_id: str
    created: bool
    match_score: float | None
    ambiguous: bool


def _normalize(values: list[float]) -> np.ndarray | None:
    vector = np.asarray(values, dtype=np.float32)
    if vector.ndim != 1 or vector.size < 32 or not np.all(np.isfinite(vector)):
        return None
    norm = float(np.linalg.norm(vector))
    return vector / norm if norm > 0.0 else None


def _decode(row: PersonEmbedding) -> np.ndarray | None:
    vector = np.frombuffer(row.embedding, dtype=np.float32)
    if vector.size != row.dimensions:
        return None
    norm = float(np.linalg.norm(vector))
    return vector / norm if norm > 0.0 else None


def _rank_identities(session: Session, vector: np.ndarray) -> list[tuple[float, int]]:
    best_by_person: dict[int, float] = {}
    for row in session.scalars(select(PersonEmbedding)).all():
        candidate = _decode(row)
        if candidate is None or candidate.size != vector.size:
            continue
        score = float(np.dot(vector, candidate))
        best_by_person[row.person_id] = max(score, best_by_person.get(row.person_id, -1.0))
    return sorted(((score, person_id) for person_id, score in best_by_person.items()), reverse=True)


def _new_identity(session: Session, *, snapshot_path: str | None, now: datetime) -> PersonIdentity:
    identity = PersonIdentity(
        public_id=f"person-{uuid4().hex[:12]}",
        status="provisional",
        representative_image_path=snapshot_path,
        appearance_count=0,
        first_seen=now,
        last_seen=now,
    )
    session.add(identity)
    session.flush()
    return identity


def identify_and_record(
    session: Session,
    *,
    embedding: list[float],
    camera_id: str,
    event: Event,
    track_id: int | None,
    snapshot_path: str | None,
    person_crop_path: str | None,
    face_crop_path: str | None,
    face_quality: float | None,
    model_name: str,
) -> IdentityResult | None:
    """Match a face globally, create an identity when needed, and save an appearance."""
    vector = _normalize(embedding)
    if vector is None:
        return None

    settings = get_settings()
    ranked = _rank_identities(session, vector)
    best_score = ranked[0][0] if ranked else None
    second_score = ranked[1][0] if len(ranked) > 1 else None
    confident = bool(
        best_score is not None
        and best_score >= settings.person_match_threshold
        and (second_score is None or best_score - second_score >= settings.person_match_margin)
    )
    ambiguous = bool(best_score is not None and best_score >= settings.person_match_threshold and not confident)
    now = datetime.utcnow()

    if confident:
        identity = session.get(PersonIdentity, ranked[0][1])
        if identity is None:
            confident = False

    if not confident:
        identity = _new_identity(session, snapshot_path=snapshot_path, now=now)

    event.entity_id = identity.public_id
    identity.last_seen = now
    identity.appearance_count += 1
    if not identity.representative_image_path:
        identity.representative_image_path = snapshot_path

    appearance = PersonAppearance(
        person_id=identity.id,
        event_id=event.id,
        camera_id=camera_id,
        track_id=track_id,
        snapshot_path=snapshot_path,
        person_crop_path=person_crop_path,
        face_crop_path=face_crop_path,
        match_score=best_score if confident else None,
        face_quality=face_quality,
        match_method="face" if confident else ("ambiguous-new" if ambiguous else "new-face"),
        created_at=now,
    )
    session.add(appearance)

    existing_templates = session.scalars(
        select(PersonEmbedding).where(PersonEmbedding.person_id == identity.id).order_by(PersonEmbedding.created_at.desc())
    ).all()
    similarities = [float(np.dot(vector, candidate)) for row in existing_templates if (candidate := _decode(row)) is not None]
    should_add_template = (
        not existing_templates
        or (
            len(existing_templates) < settings.person_max_embeddings
            and (not similarities or max(similarities) < settings.person_template_novelty)
        )
    )
    if should_add_template:
        session.add(PersonEmbedding(
            person_id=identity.id,
            embedding=vector.astype(np.float32).tobytes(),
            dimensions=int(vector.size),
            model_name=model_name,
            quality_score=face_quality,
            camera_id=camera_id,
            face_image_path=face_crop_path,
            created_at=now,
        ))

    session.flush()
    return IdentityResult(identity.public_id, not confident, best_score if confident else None, ambiguous)
