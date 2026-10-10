"""Browse the bundled Business Process reference catalogue and import
selected processes as BusinessProcess cards.

APQC-PCF-anchored process tree: Category (L1) → Process Group (L2) →
Process (L3) → Activity (L4). The Turbo EA `BusinessProcess` card type's
subtype list aligns with the first three levels (`category`, `group`,
`process`); L4 activities map to the `process` subtype as the closest fit.

Cross-references: each catalogue process carries `realizes_capability_ids`.
On import, a `relProcessToBC` relation is auto-created for every entry whose
target BusinessCapability card already exists locally (matched by
`attributes.catalogueId` first, then by case-insensitive English name).
The original list is also persisted on `attributes.realizesCapabilityIds`
so a subsequent import of new capability cards can be re-linked retroactively
(out of scope for the first version — the data is there for it).
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

import turbo_ea_capabilities as catalogue_pkg
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services import catalogue_common as common

logger = logging.getLogger(__name__)

BUSINESS_PROCESS_TYPE: str = "BusinessProcess"
BUSINESS_CAPABILITY_TYPE: str = "BusinessCapability"
PROCESS_TO_BC_RELATION_TYPE: str = "relProcessToBC"
SETTINGS_KEY: str = common.PROCESS_CACHE_KEY


# Level → Turbo EA BusinessProcess subtype. APQC PCF L4 ("Activity") falls back
# to `process` because the metamodel has no `activity` subtype.
LEVEL_TO_SUBTYPE: dict[int, str] = {
    1: "category",
    2: "group",
    3: "process",
    4: "process",
}

# Catalogue fields an imported card keeps as attributes, when present.
_COPIED_ATTRIBUTES: tuple[tuple[str, str], ...] = (
    ("aliases", "aliases"),
    ("industry", "industry"),
    ("references", "references"),
    ("framework_refs", "frameworkRefs"),
    ("realizes_capability_ids", "realizesCapabilityIds"),
    ("in_scope", "inScope"),
    ("out_of_scope", "outOfScope"),
    ("deprecated", "deprecated"),
)


# ---------------------------------------------------------------------------
# Loading: bundled vs cached-remote
# ---------------------------------------------------------------------------


def _bundled_available_locales() -> tuple[str, ...]:
    return tuple(catalogue_pkg.available_locales())


def _bundled_payload(*, locale: str = "en") -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Bundled flat list, optionally localized.

    Reads ``data/business-processes.json`` directly via
    ``common.load_bundled_processes_raw`` (sidesteps the upstream
    Pydantic loader — see catalogue_common's rationale). Translations
    come from ``data/i18n/<locale>.json`` applied via the same overlay
    helper the cached-remote path uses.
    """
    return common.bundled_payload(
        catalogue_pkg,
        locale=locale,
        raw=common.load_bundled_processes_raw(),
        count_key="process_count",
        count=getattr(catalogue_pkg, "PROCESS_COUNT", None),
    )


async def _resolve_active_catalogue(
    db: AsyncSession,
    *,
    locale: str = "en",
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    active = await common.resolve_active_catalogue(
        db,
        cache_key=SETTINGS_KEY,
        locale=locale,
        bundled=_bundled_payload(locale=locale),
        bundled_locales=_bundled_available_locales(),
        count_key="process_count",
    )
    return active.flat, active.meta


# ---------------------------------------------------------------------------
# Public payload
# ---------------------------------------------------------------------------


async def get_catalogue_payload(
    db: AsyncSession,
    *,
    locale: str = "en",
) -> dict[str, Any]:
    """Build the response for `GET /process-catalogue`."""
    flat, meta = await _resolve_active_catalogue(db, locale=locale)
    existing = await _existing_cards(db, flat, meta)
    annotated = [{**proc, "existing_card_id": existing.get(proc["id"])} for proc in flat]
    return {"version": meta, "processes": annotated}


async def _existing_cards(
    db: AsyncSession, flat: list[dict[str, Any]], meta: dict[str, Any]
) -> dict[str, str]:
    return await common.match_existing_cards(
        db,
        flat=flat,
        english=await common.english_index(_resolve_active_catalogue, db, flat, meta),
        card_type=BUSINESS_PROCESS_TYPE,
    )


# ---------------------------------------------------------------------------
# Import: bulk-create cards + auto-create relProcessToBC relations
# ---------------------------------------------------------------------------


async def _create_realizes_relations(
    db: AsyncSession,
    *,
    process_card_id: uuid.UUID,
    realizes_capability_ids: list[str],
    bc_card_lookup: dict[str, str],
) -> int:
    """Auto-create `relProcessToBC` relations for every realized BC that
    already has a card. Returns the number of relations created.

    Skips silently when:
        - the target BC has no card yet (will be linkable manually later)
        - a relation with the same source/target already exists (idempotent
          re-import)
    """
    created = 0
    for bc_id in realizes_capability_ids:
        target = bc_card_lookup.get(bc_id)
        if target and await common.add_relation_once(
            db,
            relation_type=PROCESS_TO_BC_RELATION_TYPE,
            source_id=process_card_id,
            target_id=uuid.UUID(target),
        ):
            created += 1
    return created


async def import_processes(
    db: AsyncSession,
    *,
    user: User,
    catalogue_ids: list[str],
    locale: str = "en",
) -> dict[str, Any]:
    """Bulk-create BusinessProcess cards for the given catalogue ids.

    Behaviour mirrors capability import (idempotent, parent-before-child,
    relink-existing-on-newly-created-parent). Additionally:

    - subtype is derived from `level` via `LEVEL_TO_SUBTYPE`
    - for each newly-created card, auto-create `relProcessToBC` relations
      for the entries in `realizes_capability_ids` whose target BC card
      exists (matched by `attributes.catalogueId` or English name)
    - every card goes through the shared write path
      (``common.create_catalogue_card``); a refused row and the entries
      below it land in ``failed``. Stages only: the route commits.
    """
    flat, meta = await _resolve_active_catalogue(db, locale=locale)
    by_id = {p["id"]: p for p in flat}
    catalogue_id_to_card_id = await _existing_cards(db, flat, meta)
    pre_existing_ids: set[str] = set(catalogue_id_to_card_id)
    bc_card_lookup = await common.card_lookup(db, BUSINESS_CAPABILITY_TYPE)

    requested = {cid for cid in catalogue_ids if cid in by_id}
    ordered = common.bfs_order_by_parent(requested, by_id)

    created: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    failed: list[dict[str, str]] = []
    failed_ids: set[str] = set()
    auto_relations_total = 0
    created_in_batch: set[str] = set()
    now = common.now_iso()
    user_id = user.id
    allocator = common.ReferenceAllocator()

    for proc in ordered:
        if proc["id"] in pre_existing_ids:
            skipped.append(
                {
                    "catalogue_id": proc["id"],
                    "card_id": catalogue_id_to_card_id[proc["id"]],
                    "reason": "exists",
                }
            )
            continue

        cat_parent = proc.get("parent_id")
        if cat_parent in failed_ids:
            failed.append({"catalogue_id": proc["id"], "reason": common.PARENT_NOT_IMPORTED})
            failed_ids.add(proc["id"])
            continue
        card, reason = await common.create_catalogue_card(
            db,
            user,
            type_key=BUSINESS_PROCESS_TYPE,
            name=proc["name"],
            subtype=LEVEL_TO_SUBTYPE.get(int(proc["level"]), "process"),
            description=proc.get("description"),
            parent_id=catalogue_id_to_card_id.get(cat_parent) if cat_parent else None,
            attributes=common.catalogue_attributes(
                proc, meta, now, ("processLevel", f"L{proc['level']}"), _COPIED_ATTRIBUTES
            ),
            allocator=allocator,
        )
        if card is None:
            failed.append({"catalogue_id": proc["id"], "reason": reason})
            failed_ids.add(proc["id"])
            continue
        catalogue_id_to_card_id[proc["id"]] = str(card.id)

        auto_relations_total += await _create_realizes_relations(
            db,
            process_card_id=card.id,
            realizes_capability_ids=list(proc.get("realizes_capability_ids") or []),
            bc_card_lookup=bc_card_lookup,
        )

        created.append({"catalogue_id": proc["id"], "card_id": str(card.id)})
        created_in_batch.add(proc["id"])

    relinked = await common.relink_pre_existing(
        db,
        pre_existing=pre_existing_ids,
        by_id=by_id,
        created_in_batch=created_in_batch,
        card_ids=catalogue_id_to_card_id,
        user_id=user_id,
    )

    return {
        "created": created,
        "skipped": skipped,
        "failed": failed,
        "relinked": relinked,
        "auto_relations_created": auto_relations_total,
        "catalogue_version": meta.get("catalogue_version"),
    }


# ---------------------------------------------------------------------------
# Remote update: thin wrappers around shared helpers
# ---------------------------------------------------------------------------


async def check_remote_version(db: AsyncSession) -> dict[str, Any]:
    return await common.check_remote_version_for(
        db, cache_key=SETTINGS_KEY, bundled_version=catalogue_pkg.VERSION
    )


async def fetch_remote_catalogue(db: AsyncSession) -> dict[str, Any]:
    return await common.fetch_and_cache_all(db)
