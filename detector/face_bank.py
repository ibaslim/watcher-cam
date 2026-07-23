"""In-memory cache of enrolled guard embeddings.

Holds a (N, 512) numpy matrix plus parallel arrays of guard_id / guard_name so
matching a candidate embedding against all enrolled guards is a single vector
multiply. Refreshed periodically from the backend so newly-enrolled guards
become recognizable without restarting the detector.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from dataclasses import dataclass

import httpx
import numpy as np

from detector.config import get_settings

log = logging.getLogger(__name__)


def _internal_headers() -> dict[str, str]:
    token = get_settings().internal_service_token
    return {"X-Internal-Token": token} if token else {}


@dataclass
class Match:
    guard_id: int
    guard_name: str
    score: float


@dataclass
class MatchResult:
    match: Match | None
    best_guard_id: int | None
    best_guard_name: str | None
    best_score: float | None


class FaceBank:
    def __init__(self) -> None:
        self._matrix: np.ndarray = np.zeros((0, 512), dtype=np.float32)
        self._guard_ids: list[int] = []
        self._guard_names: list[str] = []
        self._lock = asyncio.Lock()

    async def refresh(self) -> None:
        s = get_settings()
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    f"{s.backend_url}/api/guards/embeddings",
                    headers=_internal_headers(),
                )
                r.raise_for_status()
                rows = r.json()
        except Exception as e:
            log.warning("face bank refresh failed: %s", e)
            return

        if not rows:
            async with self._lock:
                self._matrix = np.zeros((0, 512), dtype=np.float32)
                self._guard_ids = []
                self._guard_names = []
            log.info("face bank refreshed: 0 embeddings")
            return

        vectors = np.stack(
            [np.frombuffer(base64.b64decode(r["vector_b64"]), dtype=np.float32) for r in rows]
        )
        async with self._lock:
            self._matrix = vectors
            self._guard_ids = [r["guard_id"] for r in rows]
            self._guard_names = [r["guard_name"] for r in rows]
        log.info(
            "face bank refreshed: %d embedding(s) across %d guard(s)",
            len(rows),
            len(set(self._guard_ids)),
        )

    async def match(self, embedding: np.ndarray) -> Match | None:
        """Return the best-matching guard if similarity exceeds the threshold."""
        result = await self.match_with_score(embedding)
        return result.match

    async def match_with_score(self, embedding: np.ndarray) -> MatchResult:
        """Return the thresholded match plus the best raw score for diagnostics."""
        async with self._lock:
            if self._matrix.shape[0] == 0:
                return MatchResult(None, None, None, None)

            scores = self._matrix @ embedding
            best_idx = int(np.argmax(scores))
            best_score = float(scores[best_idx])
            best_guard_id = self._guard_ids[best_idx]
            best_guard_name = self._guard_names[best_idx]

            if best_score < get_settings().face_match_threshold:
                return MatchResult(None, best_guard_id, best_guard_name, best_score)

            match = Match(
                guard_id=best_guard_id,
                guard_name=best_guard_name,
                score=best_score,
            )
            return MatchResult(match, best_guard_id, best_guard_name, best_score)

    async def run_periodic_refresh(self) -> None:
        interval = get_settings().face_bank_refresh_sec
        while True:
            await self.refresh()
            await asyncio.sleep(interval)


bank = FaceBank()
