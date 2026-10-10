"""Browse the bundled Value Stream reference catalogue and import selected
streams as BusinessContext cards (subtype `valueStream`).

A value stream is a 2-level structure: a `Stream` (VS-N) is the parent and
each stream contains a list of `Stages` (VS-N.M) with sparse 10/20/30
numbering. Both levels are imported as BusinessContext cards with subtype
`valueStream`; stages are linked to their stream through `cards.parent_id`.
The wheel's `value-streams.json` is a nested list (stream → stages); this
service flattens it for the browser tree UI so the same `<CatalogueBrowser>`
component as the other two catalogues can render it.

Cross-references on stages:
- `capability_ids[]` → auto-create `relBizCtxToBC` (stage → BC) relations.
- `process_ids[]` → auto-create `relProcessToBizCtx` (process → stage)
  relations. Note the direction: the metamodel relation is defined with
  BusinessProcess as the source.

Both auto-relations skip silently when the target card doesn't exist; the
source IDs are stored on the stage card's attributes (`capabilityIds`,
`processIds`) so a follow-up import of the missing artefacts can wire them
later.
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

VALUE_STREAM_TYPE: str = "BusinessContext"
VALUE_STREAM_SUBTYPE: str = "valueStream"
VALUE_STREAM_SUBTYPES: tuple[str, ...] = (VALUE_STREAM_SUBTYPE,)
BUSINESS_CAPABILITY_TYPE: str = "BusinessCapability"
BUSINESS_PROCESS_TYPE: str = "BusinessProcess"
STAGE_TO_BC_RELATION_TYPE: str = "relBizCtxToBC"
PROCESS_TO_STAGE_RELATION_TYPE: str = "relProcessToBizCtx"
SETTINGS_KEY: str = common.VALUE_STREAM_CACHE_KEY

CROSS_INDUSTRY_LABEL: str = "Cross-Industry"

# Two synthetic levels surface the stream/stage hierarchy to the existing
# browser UI (which expects a `level: int` per node).
LEVEL_STREAM: int = 1
LEVEL_STAGE: int = 2


# ---------------------------------------------------------------------------
# Loading: bundled vs cached-remote
# ---------------------------------------------------------------------------


def _industries_summary(industries: list[str]) -> str:
    """Collapse a list of industries into a single string for the browser's
    industry filter.

    "Cross-Industry" wins when present (matches the upstream catalogue's
    rule that Cross-Industry must stand alone); otherwise the list is
    joined with `; ` to align with how the existing capability filter
    handles multi-industry entries.
    """
    if not industries:
        return ""
    if CROSS_INDUSTRY_LABEL in industries:
        return CROSS_INDUSTRY_LABEL
    return "; ".join(industries)


def _stream_to_node(stream: dict[str, Any]) -> dict[str, Any]:
    """One value stream → flat node dict (level=1, no parent)."""
    industries = list(stream.get("industries") or [])
    return {
        "id": stream["id"],
        "name": stream["name"],
        "level": LEVEL_STREAM,
        "parent_id": None,
        "description": stream.get("description"),
        "industries": industries,
        "industry": _industries_summary(industries),
        "stage_count": len(stream.get("stages") or []),
        "deprecated": stream.get("deprecated"),
        "deprecation_reason": stream.get("deprecation_reason"),
        "successor_id": stream.get("successor_id"),
        "metadata": dict(stream.get("metadata") or {}),
        # not present on a stream — included so the browser can rely on a
        # stable shape across stream + stage nodes
        "stage_order": None,
        "stage_name": None,
        "industry_variant": None,
        "notes": None,
        "capability_ids": [],
        "process_ids": [],
        "aliases": [],
    }


def _stage_to_node(
    stream_id: str, stream_industries: list[str], stage: dict[str, Any]
) -> dict[str, Any]:
    """One stage → flat node dict (level=2, parent=stream_id)."""
    stage_industries = list(stage.get("industries") or stream_industries)
    stage_name = stage.get("stage_name")
    industry_variant = stage.get("industry_variant")
    # The source catalogue intentionally repeats stages once per industry
    # variant (Agriculture, Automotive, Oil & Gas, …) so each variant can
    # carry its own ``capability_ids`` / ``process_ids``. Without
    # surfacing the variant in the display name the tree shows the same
    # bare ``stage_name`` 8+ times in a row, which looks like a bug.
    # Suffix the variant in parentheses so the cross-industry baseline
    # and each specialisation are visually distinct in the list, in the
    # search hay, and on the imported cards.
    display_name = (
        f"{stage_name} ({industry_variant})" if stage_name and industry_variant else stage_name
    )
    return {
        "id": stage["id"],
        # The `name` slot drives the tree UI; stages have no `name` field —
        # they have `stage_name`. Surface it as both so name-anchored
        # search + the catalogueId index keep working.
        "name": display_name,
        "stage_name": stage_name,
        "level": LEVEL_STAGE,
        "parent_id": stream_id,
        "description": stage.get("description"),
        "stage_order": stage.get("stage_order"),
        "industries": stage_industries,
        "industry": _industries_summary(stage_industries),
        "industry_variant": industry_variant,
        "notes": stage.get("notes"),
        "capability_ids": list(stage.get("capability_ids") or []),
        "process_ids": list(stage.get("process_ids") or []),
        "aliases": [],
        # stream-only fields filled in for shape stability
        "stage_count": None,
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    }


def _flatten_streams(streams: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Lower a `[stream{stages: [...]}]` list to a flat tree node list.

    The streams are always dicts: the bundled JSON and the cached remote
    both store them as read from the wheel.
    """
    out: list[dict[str, Any]] = []
    for stream in streams:
        out.append(_stream_to_node(stream))
        stream_industries = list(stream.get("industries") or [])
        for stage in stream.get("stages") or []:
            out.append(_stage_to_node(stream["id"], stream_industries, stage))
    return out


def _bundled_available_locales() -> tuple[str, ...]:
    return tuple(catalogue_pkg.available_locales())


def _bundled_payload(*, locale: str = "en") -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Bundled flattened list, optionally localized.

    Reads ``data/value-streams.json`` directly via
    ``common.load_bundled_value_streams_raw`` and applies the wheel's
    i18n tables itself, sidestepping the upstream Pydantic loader for
    the same reason ``capability_catalogue_service`` and
    ``process_catalogue_service`` do (see ``catalogue_common`` for the
    rationale). The flattened payload uses dicts throughout, so the
    localization overlay can be applied to stream + stage rows the
    same way as the other two catalogues.
    """
    streams = common.load_bundled_value_streams_raw()
    return common.bundled_payload(
        catalogue_pkg,
        locale=locale,
        raw=streams,
        count_key="value_stream_count",
        count=len(streams),
        flatten=_flatten_streams,
    )


async def _resolve_active_catalogue(
    db: AsyncSession,
    *,
    locale: str = "en",
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    # The cache holds the raw nested list: flatten it, then localize by
    # VS-N / VS-N.M id like the other two catalogues.
    active = await common.resolve_active_catalogue(
        db,
        cache_key=SETTINGS_KEY,
        locale=locale,
        bundled=_bundled_payload(locale=locale),
        bundled_locales=_bundled_available_locales(),
        count_key="value_stream_count",
        flatten=_flatten_streams,
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
    flat, meta = await _resolve_active_catalogue(db, locale=locale)
    existing = await _existing_cards(db, flat, meta)
    annotated = [{**node, "existing_card_id": existing.get(node["id"])} for node in flat]
    return {"version": meta, "value_streams": annotated}


async def _existing_cards(
    db: AsyncSession, flat: list[dict[str, Any]], meta: dict[str, Any]
) -> dict[str, str]:
    # Stage names repeat across streams ("Application Intake" is a stage of
    # two of them); the shared matcher only matches a name no other entry
    # carries, so one stream's stage no longer reads as the other's card.
    return await common.match_existing_cards(
        db,
        flat=flat,
        english=await common.english_index(_resolve_active_catalogue, db, flat, meta),
        card_type=VALUE_STREAM_TYPE,
        subtypes=VALUE_STREAM_SUBTYPES,
    )


# ---------------------------------------------------------------------------
# Import: bulk-create cards + auto-create cross-artefact relations
# ---------------------------------------------------------------------------


async def _wire_stage_relations(
    db: AsyncSession,
    *,
    stage_card_id: uuid.UUID,
    capability_ids: list[str],
    process_ids: list[str],
    bc_card_lookup: dict[str, str],
    bp_card_lookup: dict[str, str],
) -> int:
    """Auto-create the two stage-relation kinds. Returns count created."""
    created = 0
    for bc_id in capability_ids:
        target = bc_card_lookup.get(bc_id)
        if target and await common.add_relation_once(
            db,
            relation_type=STAGE_TO_BC_RELATION_TYPE,
            source_id=stage_card_id,
            target_id=uuid.UUID(target),
        ):
            created += 1

    # The metamodel defines `relProcessToBizCtx` with BusinessProcess as the
    # source, so the relation row's source is the process card and the
    # target is the stage card. That is the inverse direction the YAML
    # source uses (`process_ids` listed on the stage), but the row in the
    # database must respect the metamodel's declared direction.
    for bp_id in process_ids:
        source = bp_card_lookup.get(bp_id)
        if source and await common.add_relation_once(
            db,
            relation_type=PROCESS_TO_STAGE_RELATION_TYPE,
            source_id=uuid.UUID(source),
            target_id=stage_card_id,
        ):
            created += 1

    return created


# Catalogue fields an imported card keeps as attributes, when present. The
# stage order and a stream's stage count are added on their own: 0 is a
# value there, not an absence.
_STREAM_ATTRIBUTES: tuple[tuple[str, str], ...] = (
    ("industries", "industries"),
    ("deprecated", "deprecated"),
    ("deprecation_reason", "deprecationReason"),
    ("successor_id", "successorId"),
)
_STAGE_ATTRIBUTES: tuple[tuple[str, str], ...] = (
    ("stage_name", "stageName"),
    ("industries", "industries"),
    ("industry_variant", "industryVariant"),
    ("notes", "notes"),
    ("capability_ids", "capabilityIds"),
    ("process_ids", "processIds"),
)


def _stream_attributes(node: dict[str, Any], meta: dict[str, Any], now: str) -> dict[str, Any]:
    attrs = common.catalogue_attributes(
        node, meta, now, ("valueStreamLevel", "Stream"), _STREAM_ATTRIBUTES
    )
    if node.get("stage_count") is not None:
        attrs["stageCount"] = node["stage_count"]
    return attrs


def _stage_attributes(node: dict[str, Any], meta: dict[str, Any], now: str) -> dict[str, Any]:
    attrs = common.catalogue_attributes(
        node, meta, now, ("valueStreamLevel", "Stage"), _STAGE_ATTRIBUTES
    )
    if node.get("stage_order") is not None:
        attrs["stageOrder"] = node["stage_order"]
    return attrs


async def import_value_streams(
    db: AsyncSession,
    *,
    user: User,
    catalogue_ids: list[str],
    locale: str = "en",
) -> dict[str, Any]:
    """Bulk-create BusinessContext / valueStream cards for the given ids.

    Selection semantics: when only a stage is selected, we still need its
    parent stream to land first (so `parent_id` works). The catalogue
    payload is already flattened into the standard `parent_id`-bearing
    shape, so the existing `bfs_order_by_parent` helper handles this when
    we enrich the requested set with the parent ids of any selected stages.

    Every card goes through the shared write path
    (``common.create_catalogue_card``); a refused row and the stages below
    it land in ``failed``. Stages only: the route commits.
    """
    flat, meta = await _resolve_active_catalogue(db, locale=locale)
    by_id = {n["id"]: n for n in flat}
    catalogue_id_to_card_id = await _existing_cards(db, flat, meta)
    pre_existing_ids: set[str] = set(catalogue_id_to_card_id)
    bc_card_lookup = await common.card_lookup(db, BUSINESS_CAPABILITY_TYPE)
    bp_card_lookup = await common.card_lookup(db, BUSINESS_PROCESS_TYPE)

    # Auto-include the parent stream when only a stage is selected — without
    # it, the child stage card has no `parent_id` to wire to, and the user
    # would have to manually re-select the stream every time.
    requested_with_parents: set[str] = set()
    for cid in catalogue_ids:
        if cid not in by_id:
            continue
        requested_with_parents.add(cid)
        parent = by_id[cid].get("parent_id")
        if parent and parent in by_id:
            requested_with_parents.add(parent)

    ordered = common.bfs_order_by_parent(requested_with_parents, by_id)

    created: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    failed: list[dict[str, str]] = []
    failed_ids: set[str] = set()
    auto_relations_total = 0
    created_in_batch: set[str] = set()
    now = common.now_iso()
    user_id = user.id
    allocator = common.ReferenceAllocator()

    for node in ordered:
        if node["id"] in pre_existing_ids:
            skipped.append(
                {
                    "catalogue_id": node["id"],
                    "card_id": catalogue_id_to_card_id[node["id"]],
                    "reason": "exists",
                }
            )
            continue

        cat_parent = node.get("parent_id")
        if cat_parent in failed_ids:
            failed.append({"catalogue_id": node["id"], "reason": common.PARENT_NOT_IMPORTED})
            failed_ids.add(node["id"])
            continue
        is_stream = node["level"] == LEVEL_STREAM
        attrs = (
            _stream_attributes(node, meta, now) if is_stream else _stage_attributes(node, meta, now)
        )

        card, reason = await common.create_catalogue_card(
            db,
            user,
            type_key=VALUE_STREAM_TYPE,
            name=node.get("name") or node.get("stage_name") or node["id"],
            subtype=VALUE_STREAM_SUBTYPE,
            description=node.get("description"),
            parent_id=catalogue_id_to_card_id.get(cat_parent) if cat_parent else None,
            attributes=attrs,
            allocator=allocator,
        )
        if card is None:
            failed.append({"catalogue_id": node["id"], "reason": reason})
            failed_ids.add(node["id"])
            continue
        catalogue_id_to_card_id[node["id"]] = str(card.id)

        if not is_stream:
            auto_relations_total += await _wire_stage_relations(
                db,
                stage_card_id=card.id,
                capability_ids=list(node.get("capability_ids") or []),
                process_ids=list(node.get("process_ids") or []),
                bc_card_lookup=bc_card_lookup,
                bp_card_lookup=bp_card_lookup,
            )

        created.append({"catalogue_id": node["id"], "card_id": str(card.id)})
        created_in_batch.add(node["id"])

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
