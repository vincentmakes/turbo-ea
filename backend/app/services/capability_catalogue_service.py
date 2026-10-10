"""Browse the bundled Business Capability reference catalogue and import
selected capabilities as BusinessCapability cards.

Three responsibilities:

1. Serve the catalogue payload to the frontend, annotated with which entries
   already exist as cards (matched by display name or by `attributes.catalogueId`).
2. Bulk-create cards for a chosen set of catalogue entries while preserving
   the catalogue hierarchy via the self-referential `cards.parent_id` FK.
3. Let admins check for and fetch a newer catalogue from PyPI. The same
   wheel download also hydrates the process and value-stream caches —
   the unified fetch logic lives in `catalogue_common`.

Cross-catalogue concerns (locale resolution, settings cache, BFS ordering,
existing-card lookup, wheel extraction) live in `catalogue_common`.
"""

from __future__ import annotations

import logging
from typing import Any

import turbo_ea_capabilities as catalogue_pkg
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.user import User
from app.services import catalogue_common as common

logger = logging.getLogger(__name__)

BUSINESS_CAPABILITY_TYPE: str = "BusinessCapability"
SETTINGS_KEY: str = common.CAPABILITY_CACHE_KEY

# Macro capabilities sit above L1 in the rendered tree but stay flat in the
# wheel — they reference L1s by id via ``capability_ids``. We surface them
# in the same flat payload as synthetic ``level=0`` entries so the existing
# tree-render and BFS-import code handles the new tier with no structural
# change.
MACRO_LEVEL: int = 0
MACRO_CAPABILITY_LEVEL_KEY: str = "Macro"
MACRO_ID_PREFIX: str = "MC-"

# Catalogue fields an imported card keeps as attributes, when present.
_COPIED_ATTRIBUTES: tuple[tuple[str, str], ...] = (
    ("aliases", "aliases"),
    ("industry", "industry"),
    ("tags", "tags"),
    ("deprecated", "deprecated"),
)


# ---------------------------------------------------------------------------
# Loading: bundled vs cached-remote
# ---------------------------------------------------------------------------


def _bundled_available_locales() -> tuple[str, ...]:
    return tuple(catalogue_pkg.available_locales())


def _bundled_payload(*, locale: str = "en") -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Bundled flat list, optionally localized.

    Reads ``data/capabilities.json`` directly via
    ``common.load_bundled_capabilities_raw`` instead of going through the
    package's Pydantic ``load_all()``. The model layer has fallen behind
    the data at least once (see comment in catalogue_common); decoupling
    here means a future stricter validator on any artefact type cannot
    break Turbo EA's catalogue endpoints.
    """
    return common.bundled_payload(
        catalogue_pkg,
        locale=locale,
        raw=common.load_bundled_capabilities_raw(),
        count_key="node_count",
        count=getattr(catalogue_pkg, "NODE_COUNT", None),
    )


def _macro_to_capability_entry(macro: dict[str, Any]) -> dict[str, Any]:
    """Project a macro definition into the same shape as a flat capability
    entry so it can sit alongside L1s in the payload.

    Macro-only fields (``in_scope``, ``out_of_scope``, ``framework_refs``,
    ``references``, ``capability_ids``) are passed through verbatim — the
    frontend can render them in the detail panel, and ``localize_flat_with_table``
    already knows how to overlay ``in_scope`` / ``out_of_scope``.
    """
    entry: dict[str, Any] = {
        "id": macro["id"],
        "name": macro["name"],
        "level": MACRO_LEVEL,
        "parent_id": None,
        "description": macro.get("description"),
        "industry": macro.get("industry"),
        "deprecated": bool(macro.get("deprecated", False)),
    }
    if macro.get("in_scope"):
        entry["in_scope"] = list(macro["in_scope"])
    if macro.get("out_of_scope"):
        entry["out_of_scope"] = list(macro["out_of_scope"])
    if macro.get("framework_refs"):
        entry["framework_refs"] = list(macro["framework_refs"])
    if macro.get("references"):
        entry["references"] = list(macro["references"])
    if macro.get("successor_id"):
        entry["successor_id"] = macro["successor_id"]
    return entry


def _inject_macros(
    flat: list[dict[str, Any]],
    macros: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Return a flat payload with macros prepended and L1.parent_id rewritten.

    For every macro, each id in ``capability_ids`` has its corresponding
    capability's ``parent_id`` rewritten to the macro's id. MECE invariant:
    a capability should be claimed by at most one macro. If two macros
    claim the same capability the *first* macro wins (matches the order
    macros appear in the wheel artefact) and a warning string is returned
    — the catalogue endpoints surface warnings rather than failing because
    upstream CI checks MECE separately and we should not 5xx on a
    misconfigured wheel.
    """
    if not macros:
        return flat, []

    macro_entries = [_macro_to_capability_entry(m) for m in macros]
    macro_ids: set[str] = {m["id"] for m in macro_entries}

    claimed_by: dict[str, str] = {}
    warnings: list[str] = []
    for macro in macros:
        macro_id = macro["id"]
        for cap_id in macro.get("capability_ids") or []:
            if cap_id in claimed_by:
                warnings.append(
                    f"capability {cap_id} claimed by macros {claimed_by[cap_id]} "
                    f"and {macro_id}; ignoring {macro_id}"
                )
                continue
            claimed_by[cap_id] = macro_id

    rewritten: list[dict[str, Any]] = []
    for cap in flat:
        cap_id = cap.get("id")
        # Skip any stray macro entries already present in `flat` to keep the
        # prepended-then-flat-list shape unambiguous.
        if cap_id in macro_ids:
            continue
        if cap_id in claimed_by:
            rewritten.append({**cap, "parent_id": claimed_by[cap_id]})
        else:
            rewritten.append(cap)

    return macro_entries + rewritten, warnings


def _bundled_macros() -> list[dict[str, Any]]:
    """Bundled macros — graceful empty list on older wheels."""
    return common.load_bundled_macros_raw()


def _resolve_active_macros(remote: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Macros from the cached remote when it is the source served, else the bundled wheel.

    ``remote`` is ``ActiveCatalogue.remote``: None whenever the bundled wheel
    won, so a stale cache's macros never regroup a newer bundled list.
    """
    if remote is not None:
        cached_macros = remote.get("macros")
        if isinstance(cached_macros, list):
            return cached_macros
    return _bundled_macros()


async def _resolve_active_catalogue(
    db: AsyncSession,
    *,
    locale: str = "en",
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Return (capabilities_flat, version_meta) honouring the remote override.

    Remote or bundled is decided in ``catalogue_common.resolve_active_catalogue``,
    shared with the process and value-stream catalogues.

    Macros are injected here — once at the single source of truth — so the
    GET payload and `import_capabilities` see the same flat list with the
    same parent_id rewriting. Doing it anywhere else (e.g. only in
    `get_catalogue_payload`) would silently no-op the auto-relink path of
    pre-existing L1 cards on macro import. They are localized with the same
    table as the capabilities: entries are keyed by id, so macro ids
    (``MC-*``) and capability ids (``BC-*``) coexist cleanly.
    """
    active = await common.resolve_active_catalogue(
        db,
        cache_key=SETTINGS_KEY,
        locale=locale,
        bundled=_bundled_payload(locale=locale),
        bundled_locales=_bundled_available_locales(),
        count_key="node_count",
    )
    macros = active.localize(_resolve_active_macros(active.remote))
    merged, warnings = _inject_macros(active.flat, macros)
    return merged, {**active.meta, "macro_count": len(macros), "macro_warnings": warnings}


# ---------------------------------------------------------------------------
# Public payload (what the frontend renders)
# ---------------------------------------------------------------------------


async def get_catalogue_payload(
    db: AsyncSession,
    *,
    locale: str = "en",
) -> dict[str, Any]:
    """Build the response for `GET /capability-catalogue`.

    Each capability is annotated with `existing_card_id` (str | null) — the
    id of an already-created BusinessCapability card. Matching prefers
    `attributes.catalogueId` (so the green-tick survives display-name
    edits) and falls back to a case-insensitive match against the canonical
    English name.
    """
    flat, meta = await _resolve_active_catalogue(db, locale=locale)
    existing = await _existing_cards(db, flat, meta)
    annotated = [{**cap, "existing_card_id": existing.get(cap["id"])} for cap in flat]
    return {"version": meta, "capabilities": annotated}


def _is_macro(node: dict[str, Any]) -> bool:
    return str(node["id"]).startswith(MACRO_ID_PREFIX)


async def _existing_cards(
    db: AsyncSession, flat: list[dict[str, Any]], meta: dict[str, Any]
) -> dict[str, str]:
    # Macros match by catalogueId only. A customer might already have a card
    # named e.g. "Enterprise Governance & Risk" that has nothing to do with
    # macro MC-10; a name match would silently re-link unrelated L1s under it
    # on the next macro import.
    return await common.match_existing_cards(
        db,
        flat=flat,
        english=await common.english_index(_resolve_active_catalogue, db, flat, meta),
        card_type=BUSINESS_CAPABILITY_TYPE,
        by_id_only=_is_macro,
    )


# ---------------------------------------------------------------------------
# Import: bulk-create cards from selected catalogue ids
# ---------------------------------------------------------------------------


async def import_capabilities(
    db: AsyncSession,
    *,
    user: User,
    catalogue_ids: list[str],
    locale: str = "en",
) -> dict[str, Any]:
    """Bulk-create BusinessCapability cards for the given catalogue ids.

    - Skips any catalogue id an active BusinessCapability card already stands
      for (idempotent): matched by catalogueId, or by an English name no
      other catalogue entry shares (``common.match_existing_cards``).
    - Wires `parent_id` to existing matches OR to siblings created in this
      same call so the catalogue hierarchy is reproduced.
    - Re-parents existing children whose new catalogue parent was just
      created in this batch.
    """
    flat, meta = await _resolve_active_catalogue(db, locale=locale)
    by_id = {c["id"]: c for c in flat}
    catalogue_id_to_card_id = await _existing_cards(db, flat, meta)
    pre_existing_ids: set[str] = set(catalogue_id_to_card_id)

    requested = {cid for cid in catalogue_ids if cid in by_id}
    ordered = common.bfs_order_by_parent(requested, by_id)

    created: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    created_in_batch: set[str] = set()
    now = common.now_iso()
    user_id = user.id

    for cap in ordered:
        if cap["id"] in pre_existing_ids:
            skipped.append(
                {
                    "catalogue_id": cap["id"],
                    "card_id": catalogue_id_to_card_id[cap["id"]],
                    "reason": "exists",
                }
            )
            continue

        cat_parent = cap.get("parent_id")
        level_key = (
            MACRO_CAPABILITY_LEVEL_KEY if cap["level"] == MACRO_LEVEL else f"L{cap['level']}"
        )
        card = Card(
            type=BUSINESS_CAPABILITY_TYPE,
            name=cap["name"],
            description=cap.get("description"),
            parent_id=catalogue_id_to_card_id.get(cat_parent) if cat_parent else None,
            attributes=common.catalogue_attributes(
                cap, meta, now, ("capabilityLevel", level_key), _COPIED_ATTRIBUTES
            ),
            created_by=user_id,
            updated_by=user_id,
        )
        db.add(card)
        await db.flush()
        catalogue_id_to_card_id[cap["id"]] = str(card.id)
        created.append({"catalogue_id": cap["id"], "card_id": str(card.id)})
        created_in_batch.add(cap["id"])

    relinked = await common.relink_pre_existing(
        db,
        pre_existing=pre_existing_ids,
        by_id=by_id,
        created_in_batch=created_in_batch,
        card_ids=catalogue_id_to_card_id,
        user_id=user_id,
    )

    await db.commit()
    macro_warnings = list(meta.get("macro_warnings") or [])
    return {
        "created": created,
        "skipped": skipped,
        "relinked": relinked,
        "catalogue_version": meta.get("catalogue_version"),
        "warnings": macro_warnings,
    }


# ---------------------------------------------------------------------------
# Remote update: check + fetch (admin)
# ---------------------------------------------------------------------------


async def check_remote_version(db: AsyncSession) -> dict[str, Any]:
    """Query PyPI for the latest published `turbo-ea-capabilities` version.

    Returns local + remote version metadata so the UI can decide whether to
    surface "update available". Does NOT modify any state.
    """
    return await common.check_remote_version_for(
        db, cache_key=SETTINGS_KEY, bundled_version=catalogue_pkg.VERSION
    )


async def fetch_remote_catalogue(db: AsyncSession) -> dict[str, Any]:
    """Download the latest wheel from PyPI and cache all three catalogue
    payloads. Returns the capability-centric summary; the same wheel also
    populates the process and value-stream caches in the same transaction.
    """
    return await common.fetch_and_cache_all(db)
