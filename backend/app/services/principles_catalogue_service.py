"""Browse the bundled EA Principles reference catalogue and import
selected principles as `EAPrinciple` rows.

Two responsibilities:

1. Serve the catalogue payload to the frontend, annotated with which entries
   already exist as principles (matched by `catalogue_id`).
2. Bulk-create `EAPrinciple` rows for a chosen set of catalogue entries,
   tagging them with `catalogue_id` so re-imports are idempotent and survive
   display-title edits.

The catalogue itself is a static JSON file bundled in this repo. Unlike the
Capability Catalogue (which is a separately-published PyPI package with an
online update path), the principles set is small and curated, so the simpler
in-tree JSON is sufficient.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ea_principle import EAPrinciple
from app.services.principle_service import ensure_principle_references

logger = logging.getLogger(__name__)

_CATALOGUE_PATH: Path = Path(__file__).parent / "data" / "ea_principles_catalogue.json"


@lru_cache(maxsize=1)
def _load_catalogue() -> dict[str, Any]:
    """Load and cache the bundled JSON catalogue."""
    with _CATALOGUE_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict) or "principles" not in data:
        raise RuntimeError("ea_principles_catalogue.json is malformed")
    return data


def get_catalogue_principle(catalogue_id: str) -> dict[str, Any] | None:
    """Return a single catalogue entry by id, or None if unknown."""
    for p in _load_catalogue().get("principles", []):
        if p.get("id") == catalogue_id:
            return dict(p)
    return None


async def _existing_principle_index(db: AsyncSession) -> dict[str, str]:
    """Return {catalogue_id: principle_id} for principles already imported."""
    res = await db.execute(
        select(EAPrinciple.id, EAPrinciple.catalogue_id).where(
            EAPrinciple.catalogue_id.is_not(None)
        )
    )
    out: dict[str, str] = {}
    for principle_id, cat_id in res.all():
        if cat_id and cat_id not in out:
            out[cat_id] = str(principle_id)
    return out


async def get_catalogue_payload(db: AsyncSession) -> dict[str, Any]:
    """Build the response for `GET /principles-catalogue`.

    Each entry is annotated with `existing_principle_id` so the frontend can
    render a green tick (and disable selection) for already-imported
    principles. Matching is by `catalogue_id`, which survives title edits.
    """
    catalogue = _load_catalogue()
    index = await _existing_principle_index(db)
    annotated = [
        {**p, "existing_principle_id": index.get(p["id"])} for p in catalogue.get("principles", [])
    ]
    return {
        "catalogue_version": catalogue.get("catalogue_version"),
        "generated_at": catalogue.get("generated_at"),
        "principles": annotated,
    }


async def import_principles(
    db: AsyncSession,
    catalogue_ids: list[str],
) -> dict[str, Any]:
    """Bulk-create EAPrinciple rows from the selected catalogue ids.

    Idempotent: ids that already correspond to an existing principle (matched
    by `catalogue_id`) are skipped. New principles are appended after the
    current max `sort_order` so they don't collide with manually-created ones.
    """
    catalogue = _load_catalogue()
    by_id: dict[str, dict[str, Any]] = {p["id"]: p for p in catalogue.get("principles", [])}
    index = await _existing_principle_index(db)

    max_sort_res = await db.execute(select(func.coalesce(func.max(EAPrinciple.sort_order), 0)))
    next_sort = (max_sort_res.scalar_one() or 0) + 10

    created: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    seen: set[str] = set()
    for cat_id in catalogue_ids:
        if cat_id in seen:
            continue
        seen.add(cat_id)
        if cat_id in index:
            skipped.append(
                {
                    "catalogue_id": cat_id,
                    "principle_id": index[cat_id],
                    "reason": "already_imported",
                }
            )
            continue
        entry = by_id.get(cat_id)
        if entry is None:
            skipped.append({"catalogue_id": cat_id, "principle_id": "", "reason": "unknown_id"})
            continue
        principle = EAPrinciple(
            title=entry["title"],
            description=entry.get("description"),
            rationale=entry.get("rationale"),
            implications=entry.get("implications"),
            is_active=True,
            sort_order=next_sort,
            catalogue_id=cat_id,
        )
        db.add(principle)
        await db.flush()
        created.append({"catalogue_id": cat_id, "principle_id": str(principle.id)})
        next_sort += 10

    await ensure_principle_references(db)
    await db.commit()

    return {
        "created": created,
        "skipped": skipped,
        "catalogue_version": catalogue.get("catalogue_version"),
    }
