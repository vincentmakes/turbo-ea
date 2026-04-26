"""Browse the bundled Business Capability reference catalogue and import
selected capabilities as BusinessCapability cards.

Three responsibilities:

1. Serve the catalogue payload to the frontend, annotated with which entries
   already exist as cards (matched by display name, case-insensitive).
2. Bulk-create cards for a chosen set of catalogue entries while preserving
   the catalogue hierarchy via the self-referential `cards.parent_id` FK.
3. Let admins check for and fetch a newer catalogue from the public site,
   stored in `app_settings.general_settings.capability_catalogue` as an
   override over the bundled package.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
import turbo_ea_capabilities as catalogue_pkg
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_settings import AppSettings
from app.models.card import Card
from app.models.user import User

CATALOGUE_REMOTE_URL: str = os.environ.get(
    "CAPABILITY_CATALOGUE_URL", "https://capabilities.turbo-ea.org"
).rstrip("/")
CATALOGUE_FETCH_TIMEOUT_SECONDS: float = 15.0
BUSINESS_CAPABILITY_TYPE: str = "BusinessCapability"
SETTINGS_KEY: str = "capability_catalogue"


# ---------------------------------------------------------------------------
# Loading: bundled vs cached-remote
# ---------------------------------------------------------------------------


def _capability_to_dict(c: catalogue_pkg.Capability) -> dict[str, Any]:
    """Pydantic Capability → plain JSON-serialisable dict (children stripped)."""
    return {
        "id": c.id,
        "name": c.name,
        "level": c.level,
        "parent_id": c.parent_id,
        "description": c.description,
        "aliases": list(c.aliases),
        "owner": c.owner,
        "tags": list(c.tags),
        "industry": c.industry,
        "references": list(c.references),
        "in_scope": list(c.in_scope),
        "out_of_scope": list(c.out_of_scope),
        "deprecated": c.deprecated,
        "deprecation_reason": c.deprecation_reason,
        "successor_id": c.successor_id,
        "metadata": dict(c.metadata),
    }


def _bundled_payload() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    flat = [_capability_to_dict(c) for c in catalogue_pkg.load_all()]
    meta = {
        "catalogue_version": catalogue_pkg.VERSION,
        "schema_version": str(catalogue_pkg.SCHEMA_VERSION),
        "generated_at": catalogue_pkg.GENERATED_AT,
        "node_count": catalogue_pkg.NODE_COUNT,
    }
    return flat, meta


async def _get_app_settings(db: AsyncSession) -> AppSettings:
    res = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    settings = res.scalar_one_or_none()
    if settings is None:
        settings = AppSettings(id="default", general_settings={})
        db.add(settings)
        await db.flush()
    return settings


async def _get_cached_remote(db: AsyncSession) -> dict[str, Any] | None:
    settings = await _get_app_settings(db)
    general = settings.general_settings or {}
    cached = general.get(SETTINGS_KEY)
    if not cached or not cached.get("data"):
        return None
    return cached


def _version_tuple(v: str) -> tuple[int, ...]:
    """Best-effort semver-ish parse so '1.10.0' > '1.9.0'."""
    parts: list[int] = []
    for chunk in v.split("."):
        digits = ""
        for ch in chunk:
            if ch.isdigit():
                digits += ch
            else:
                break
        parts.append(int(digits) if digits else 0)
    return tuple(parts)


async def _resolve_active_catalogue(
    db: AsyncSession,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Return (capabilities_flat, version_meta) honouring remote override.

    Cached remote wins only if its version is strictly greater than bundled.
    """
    bundled_flat, bundled_meta = _bundled_payload()
    cached = await _get_cached_remote(db)
    if cached and _version_tuple(cached.get("catalogue_version", "0")) > _version_tuple(
        bundled_meta["catalogue_version"]
    ):
        return list(cached["data"]), {
            "catalogue_version": cached["catalogue_version"],
            "schema_version": str(cached.get("schema_version", "")),
            "generated_at": cached.get("generated_at"),
            "node_count": cached.get("node_count", len(cached["data"])),
            "source": "remote",
            "fetched_at": cached.get("fetched_at"),
            "bundled_version": bundled_meta["catalogue_version"],
        }
    return bundled_flat, {
        **bundled_meta,
        "source": "bundled",
        "bundled_version": bundled_meta["catalogue_version"],
    }


# ---------------------------------------------------------------------------
# Public payload (what the frontend renders)
# ---------------------------------------------------------------------------


def _normalize_name(s: str) -> str:
    return " ".join(s.split()).strip().casefold()


async def _existing_bc_name_index(db: AsyncSession) -> dict[str, str]:
    """Return {normalized_name: card_id} for active BusinessCapability cards."""
    res = await db.execute(
        select(Card.id, Card.name).where(
            Card.type == BUSINESS_CAPABILITY_TYPE,
            Card.status != "ARCHIVED",
        )
    )
    out: dict[str, str] = {}
    for card_id, name in res.all():
        if not name:
            continue
        out.setdefault(_normalize_name(name), str(card_id))
    return out


async def get_catalogue_payload(db: AsyncSession) -> dict[str, Any]:
    """Build the response for `GET /capability-catalogue`.

    Each capability is annotated with `existing_card_id` (str | null) — the
    id of an already-created BusinessCapability card whose display name
    matches (case-insensitive, whitespace-collapsed). The frontend uses this
    to render a green tick instead of a checkbox.
    """
    flat, meta = await _resolve_active_catalogue(db)
    name_index = await _existing_bc_name_index(db)
    annotated: list[dict[str, Any]] = []
    for cap in flat:
        existing = name_index.get(_normalize_name(cap["name"]))
        annotated.append({**cap, "existing_card_id": existing})
    return {"version": meta, "capabilities": annotated}


# ---------------------------------------------------------------------------
# Import: bulk-create cards from selected catalogue ids
# ---------------------------------------------------------------------------


def _bfs_order(selected_ids: set[str], by_id: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Return selected capabilities in parent-before-child order.

    Within the same depth, preserve catalogue id ordering for stable output.
    """
    depths: dict[str, int] = {}

    def depth_of(cap_id: str) -> int:
        if cap_id in depths:
            return depths[cap_id]
        cap = by_id.get(cap_id)
        if cap is None or not cap.get("parent_id"):
            depths[cap_id] = 0
        else:
            depths[cap_id] = depth_of(cap["parent_id"]) + 1
        return depths[cap_id]

    selected = [by_id[i] for i in selected_ids if i in by_id]
    selected.sort(key=lambda c: (depth_of(c["id"]), c["id"]))
    return selected


async def import_capabilities(
    db: AsyncSession,
    *,
    user: User,
    catalogue_ids: list[str],
) -> dict[str, Any]:
    """Bulk-create BusinessCapability cards for the given catalogue ids.

    - Skips any catalogue id whose display name already matches an existing
      active BusinessCapability card (idempotent).
    - Wires `parent_id` to existing matches OR to siblings created in this
      same call so the catalogue hierarchy is reproduced.
    - Stores `catalogueId`, `catalogueVersion`, `catalogueImportedAt`, and
      `capabilityLevel` on each new card's `attributes`.

    Permission: callers must already have been gated on `inventory.create`
    by the route layer.
    """
    flat, meta = await _resolve_active_catalogue(db)
    by_id = {c["id"]: c for c in flat}
    name_index = await _existing_bc_name_index(db)

    # Pre-seed the FULL catalogue → existing card mapping so that a selected
    # child grafts onto an existing parent matched by name even when the
    # parent itself isn't in the selection.
    catalogue_id_to_card_id: dict[str, str] = {}
    for cap in flat:
        existing_card_id = name_index.get(_normalize_name(cap["name"]))
        if existing_card_id:
            catalogue_id_to_card_id[cap["id"]] = existing_card_id
    pre_existing_ids: set[str] = set(catalogue_id_to_card_id.keys())

    requested = {cid for cid in catalogue_ids if cid in by_id}
    ordered = _bfs_order(requested, by_id)

    created: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    relinked: list[dict[str, str]] = []
    created_in_batch: set[str] = set()
    now = datetime.now(timezone.utc).isoformat()
    user_id = user.id

    for cap in ordered:
        # Already a card with this name? Skip — the mapping is already in
        # catalogue_id_to_card_id (pre-built above) so descendants can find it.
        if cap["id"] in pre_existing_ids:
            skipped.append(
                {
                    "catalogue_id": cap["id"],
                    "card_id": catalogue_id_to_card_id[cap["id"]],
                    "reason": "exists",
                }
            )
            continue

        parent_card_id: Any = None
        cat_parent = cap.get("parent_id")
        if cat_parent and cat_parent in catalogue_id_to_card_id:
            parent_card_id = catalogue_id_to_card_id[cat_parent]

        attrs: dict[str, Any] = {
            "catalogueId": cap["id"],
            "catalogueVersion": meta.get("catalogue_version"),
            "catalogueImportedAt": now,
            "capabilityLevel": f"L{cap['level']}",
        }
        if cap.get("aliases"):
            attrs["aliases"] = list(cap["aliases"])
        if cap.get("industry"):
            attrs["industry"] = cap["industry"]
        if cap.get("tags"):
            attrs["tags"] = list(cap["tags"])
        if cap.get("deprecated"):
            attrs["deprecated"] = True

        card = Card(
            type=BUSINESS_CAPABILITY_TYPE,
            name=cap["name"],
            description=cap.get("description"),
            parent_id=parent_card_id,
            attributes=attrs,
            created_by=user_id,
            updated_by=user_id,
        )
        db.add(card)
        await db.flush()  # need card.id to wire any children we create later
        catalogue_id_to_card_id[cap["id"]] = str(card.id)
        # Keep name_index in sync so a duplicate name within the same batch
        # doesn't get created twice.
        name_index[_normalize_name(cap["name"])] = str(card.id)
        created.append({"catalogue_id": cap["id"], "card_id": str(card.id)})
        created_in_batch.add(cap["id"])

    # Re-parent existing top-level cards whose catalogue parent was just
    # created in this batch. Only `parent_id IS NULL` cards are touched —
    # manual nestings (existing parent_id pointing somewhere else) are
    # preserved deliberately, so users keep authority over their hierarchy.
    for cat_id in pre_existing_ids:
        cap = by_id.get(cat_id)
        if cap is None:
            continue
        cat_parent = cap.get("parent_id")
        if not cat_parent or cat_parent not in created_in_batch:
            continue
        existing_card_id = catalogue_id_to_card_id[cat_id]
        new_parent_card_id = catalogue_id_to_card_id[cat_parent]
        existing_card = await db.get(Card, uuid.UUID(existing_card_id))
        if existing_card is None or existing_card.parent_id is not None:
            continue
        existing_card.parent_id = uuid.UUID(new_parent_card_id)
        existing_card.updated_by = user_id
        relinked.append(
            {
                "catalogue_id": cat_id,
                "card_id": existing_card_id,
                "new_parent_card_id": new_parent_card_id,
            }
        )

    await db.commit()
    return {
        "created": created,
        "skipped": skipped,
        "relinked": relinked,
        "catalogue_version": meta.get("catalogue_version"),
    }


# ---------------------------------------------------------------------------
# Remote update: check + fetch (admin)
# ---------------------------------------------------------------------------


async def check_remote_version(db: AsyncSession) -> dict[str, Any]:
    """Fetch /api/version.json from the remote catalogue site.

    Returns local + remote version metadata so the UI can decide whether to
    surface "update available". Does NOT modify any state.
    """
    bundled_flat, bundled_meta = _bundled_payload()
    cached = await _get_cached_remote(db)
    active_version = (
        cached["catalogue_version"]
        if cached
        and _version_tuple(cached.get("catalogue_version", "0"))
        > _version_tuple(bundled_meta["catalogue_version"])
        else bundled_meta["catalogue_version"]
    )

    remote_meta: dict[str, Any] | None = None
    error: str | None = None
    try:
        async with httpx.AsyncClient(timeout=CATALOGUE_FETCH_TIMEOUT_SECONDS) as client:
            resp = await client.get(f"{CATALOGUE_REMOTE_URL}/api/version.json")
            resp.raise_for_status()
            remote_meta = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        error = f"Could not reach catalogue: {exc}"

    update_available = False
    if remote_meta and "catalogue_version" in remote_meta:
        update_available = _version_tuple(remote_meta["catalogue_version"]) > _version_tuple(
            active_version
        )

    return {
        "active_version": active_version,
        "active_source": "remote" if cached else "bundled",
        "bundled_version": bundled_meta["catalogue_version"],
        "cached_remote_version": cached["catalogue_version"] if cached else None,
        "remote": remote_meta,
        "update_available": update_available,
        "error": error,
    }


async def fetch_remote_catalogue(db: AsyncSession) -> dict[str, Any]:
    """Download the latest catalogue from the public site and cache it.

    Stores into `app_settings.general_settings.capability_catalogue`. The next
    `_resolve_active_catalogue` call will prefer it over the bundled data
    (when newer).
    """
    async with httpx.AsyncClient(timeout=CATALOGUE_FETCH_TIMEOUT_SECONDS) as client:
        ver_resp = await client.get(f"{CATALOGUE_REMOTE_URL}/api/version.json")
        ver_resp.raise_for_status()
        ver = ver_resp.json()

        caps_resp = await client.get(f"{CATALOGUE_REMOTE_URL}/api/capabilities.json")
        caps_resp.raise_for_status()
        caps = caps_resp.json()

    if not isinstance(caps, list):
        raise ValueError("Remote /api/capabilities.json did not return a list")

    settings = await _get_app_settings(db)
    general = dict(settings.general_settings or {})
    general[SETTINGS_KEY] = {
        "data": caps,
        "catalogue_version": ver.get("catalogue_version"),
        "schema_version": str(ver.get("schema_version", "")),
        "generated_at": ver.get("generated_at"),
        "node_count": ver.get("node_count", len(caps)),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    settings.general_settings = general
    await db.commit()

    return {
        "catalogue_version": ver.get("catalogue_version"),
        "node_count": ver.get("node_count", len(caps)),
        "fetched_at": general[SETTINGS_KEY]["fetched_at"],
    }
