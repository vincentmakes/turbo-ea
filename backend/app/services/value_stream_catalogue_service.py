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
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.relation import Relation
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


def _stream_to_node(stream: Any) -> dict[str, Any]:
    """One value stream → flat node dict (level=1, no parent)."""
    is_dict = isinstance(stream, dict)
    industries = list((stream.get("industries") if is_dict else stream.industries) or [])
    stages = list((stream.get("stages") if is_dict else stream.stages) or [])
    return {
        "id": stream["id"] if is_dict else stream.id,
        "name": stream["name"] if is_dict else stream.name,
        "level": LEVEL_STREAM,
        "parent_id": None,
        "description": stream.get("description") if is_dict else stream.description,
        "industries": industries,
        "industry": _industries_summary(industries),
        "stage_count": len(stages),
        "deprecated": stream.get("deprecated") if is_dict else stream.deprecated,
        "deprecation_reason": (
            stream.get("deprecation_reason") if is_dict else stream.deprecation_reason
        ),
        "successor_id": stream.get("successor_id") if is_dict else stream.successor_id,
        "metadata": dict((stream.get("metadata") if is_dict else stream.metadata) or {}),
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


def _stage_to_node(stream_id: str, stream_industries: list[str], stage: Any) -> dict[str, Any]:
    """One stage → flat node dict (level=2, parent=stream_id)."""
    is_dict = isinstance(stage, dict)
    stage_industries = list(
        (stage.get("industries") if is_dict else stage.industries) or stream_industries
    )
    stage_name = stage.get("stage_name") if is_dict else stage.stage_name
    industry_variant = stage.get("industry_variant") if is_dict else stage.industry_variant
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
        "id": stage["id"] if is_dict else stage.id,
        # The `name` slot drives the tree UI; stages have no `name` field —
        # they have `stage_name`. Surface it as both so name-anchored
        # search + the catalogueId index keep working.
        "name": display_name,
        "stage_name": stage_name,
        "level": LEVEL_STAGE,
        "parent_id": stream_id,
        "description": stage.get("description") if is_dict else stage.description,
        "stage_order": stage.get("stage_order") if is_dict else stage.stage_order,
        "industries": stage_industries,
        "industry": _industries_summary(stage_industries),
        "industry_variant": industry_variant,
        "notes": stage.get("notes") if is_dict else stage.notes,
        "capability_ids": list(
            (stage.get("capability_ids") if is_dict else stage.capability_ids) or []
        ),
        "process_ids": list((stage.get("process_ids") if is_dict else stage.process_ids) or []),
        "aliases": [],
        # stream-only fields filled in for shape stability
        "stage_count": None,
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    }


def _flatten_streams(streams: list[Any]) -> list[dict[str, Any]]:
    """Lower a `[stream{stages: [...]}]` list to a flat tree node list."""
    out: list[dict[str, Any]] = []
    for stream in streams:
        out.append(_stream_to_node(stream))
        is_dict = isinstance(stream, dict)
        stream_id = stream["id"] if is_dict else stream.id
        stream_industries = list((stream.get("industries") if is_dict else stream.industries) or [])
        stages = list((stream.get("stages") if is_dict else stream.stages) or [])
        for stage in stages:
            out.append(_stage_to_node(stream_id, stream_industries, stage))
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
    available = _bundled_available_locales()
    effective = common.resolve_effective_locale(locale, available)
    streams = common.load_bundled_value_streams_raw()
    flat = _flatten_streams(streams)
    if effective != "en":
        table = common.bundled_i18n_table(effective)
        if table:
            flat = common.localize_flat_with_table(flat, table)
    meta = {
        "catalogue_version": catalogue_pkg.VERSION,
        "schema_version": str(catalogue_pkg.SCHEMA_VERSION),
        "generated_at": catalogue_pkg.GENERATED_AT,
        "value_stream_count": len(streams),
        "available_locales": list(available),
        "active_locale": effective,
    }
    return flat, meta


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
    name_index = await common.existing_card_index_by_name(
        db, card_type=VALUE_STREAM_TYPE, subtypes=VALUE_STREAM_SUBTYPES
    )
    cat_id_index = await common.existing_card_index_by_catalogue_id(
        db, card_type=VALUE_STREAM_TYPE, subtypes=VALUE_STREAM_SUBTYPES
    )
    english_names: dict[str, str] | None = None
    if meta.get("active_locale", "en") != "en":
        english_flat, _ = await _resolve_active_catalogue(db, locale="en")
        english_names = {n["id"]: n["name"] for n in english_flat}
    annotated: list[dict[str, Any]] = []
    for node in flat:
        match_name = (english_names or {}).get(node["id"], node["name"])
        existing = cat_id_index.get(node["id"]) or name_index.get(
            common.normalize_name(match_name or "")
        )
        annotated.append({**node, "existing_card_id": existing})
    return {"version": meta, "value_streams": annotated}


# ---------------------------------------------------------------------------
# Import: bulk-create cards + auto-create cross-artefact relations
# ---------------------------------------------------------------------------


async def _capability_card_index(db: AsyncSession) -> dict[str, str]:
    cat_id_index = await common.existing_card_index_by_catalogue_id(
        db, card_type=BUSINESS_CAPABILITY_TYPE
    )
    name_index = await common.existing_card_index_by_name(db, card_type=BUSINESS_CAPABILITY_TYPE)
    # Same rationale as the process service: BC-* IDs and normalised English
    # names live in disjoint key spaces, so a single dict is fine.
    return {**name_index, **cat_id_index}


async def _process_card_index(db: AsyncSession) -> dict[str, str]:
    cat_id_index = await common.existing_card_index_by_catalogue_id(
        db, card_type=BUSINESS_PROCESS_TYPE
    )
    name_index = await common.existing_card_index_by_name(db, card_type=BUSINESS_PROCESS_TYPE)
    return {**name_index, **cat_id_index}


async def _relation_exists(
    db: AsyncSession,
    *,
    relation_type: str,
    source_id: uuid.UUID,
    target_id: uuid.UUID,
) -> bool:
    res = await db.execute(
        select(Relation.id).where(
            Relation.type == relation_type,
            Relation.source_id == source_id,
            Relation.target_id == target_id,
        )
    )
    return res.scalar_one_or_none() is not None


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
        target_id_str = bc_card_lookup.get(bc_id)
        if not target_id_str:
            continue
        target_uuid = uuid.UUID(target_id_str)
        if await _relation_exists(
            db,
            relation_type=STAGE_TO_BC_RELATION_TYPE,
            source_id=stage_card_id,
            target_id=target_uuid,
        ):
            continue
        db.add(
            Relation(
                type=STAGE_TO_BC_RELATION_TYPE,
                source_id=stage_card_id,
                target_id=target_uuid,
                attributes={},
            )
        )
        created += 1

    # The metamodel defines `relProcessToBizCtx` with BusinessProcess as the
    # source, so the relation row's source is the process card and the
    # target is the stage card. That is the inverse direction the YAML
    # source uses (`process_ids` listed on the stage), but the row in the
    # database must respect the metamodel's declared direction.
    for bp_id in process_ids:
        source_id_str = bp_card_lookup.get(bp_id)
        if not source_id_str:
            continue
        source_uuid = uuid.UUID(source_id_str)
        if await _relation_exists(
            db,
            relation_type=PROCESS_TO_STAGE_RELATION_TYPE,
            source_id=source_uuid,
            target_id=stage_card_id,
        ):
            continue
        db.add(
            Relation(
                type=PROCESS_TO_STAGE_RELATION_TYPE,
                source_id=source_uuid,
                target_id=stage_card_id,
                attributes={},
            )
        )
        created += 1

    return created


def _stream_attributes(node: dict[str, Any], meta: dict[str, Any], now: str) -> dict[str, Any]:
    attrs: dict[str, Any] = {
        "catalogueId": node["id"],
        "catalogueVersion": meta.get("catalogue_version"),
        "catalogueImportedAt": now,
        "valueStreamLevel": "Stream",
    }
    if meta.get("active_locale", "en") != "en":
        attrs["catalogueLocale"] = meta["active_locale"]
    if node.get("industries"):
        attrs["industries"] = list(node["industries"])
    if node.get("deprecated"):
        attrs["deprecated"] = True
    if node.get("deprecation_reason"):
        attrs["deprecationReason"] = node["deprecation_reason"]
    if node.get("successor_id"):
        attrs["successorId"] = node["successor_id"]
    if node.get("stage_count") is not None:
        attrs["stageCount"] = node["stage_count"]
    return attrs


def _stage_attributes(node: dict[str, Any], meta: dict[str, Any], now: str) -> dict[str, Any]:
    attrs: dict[str, Any] = {
        "catalogueId": node["id"],
        "catalogueVersion": meta.get("catalogue_version"),
        "catalogueImportedAt": now,
        "valueStreamLevel": "Stage",
    }
    if meta.get("active_locale", "en") != "en":
        attrs["catalogueLocale"] = meta["active_locale"]
    if node.get("stage_order") is not None:
        attrs["stageOrder"] = node["stage_order"]
    if node.get("stage_name"):
        attrs["stageName"] = node["stage_name"]
    if node.get("industries"):
        attrs["industries"] = list(node["industries"])
    if node.get("industry_variant"):
        attrs["industryVariant"] = node["industry_variant"]
    if node.get("notes"):
        attrs["notes"] = node["notes"]
    if node.get("capability_ids"):
        attrs["capabilityIds"] = list(node["capability_ids"])
    if node.get("process_ids"):
        attrs["processIds"] = list(node["process_ids"])
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
    """
    flat, meta = await _resolve_active_catalogue(db, locale=locale)
    by_id = {n["id"]: n for n in flat}
    if meta.get("active_locale", "en") != "en":
        english_flat, _ = await _resolve_active_catalogue(db, locale="en")
        english_by_id = {n["id"]: n for n in english_flat}
    else:
        english_by_id = by_id

    name_index = await common.existing_card_index_by_name(
        db, card_type=VALUE_STREAM_TYPE, subtypes=VALUE_STREAM_SUBTYPES
    )
    cat_id_index = await common.existing_card_index_by_catalogue_id(
        db, card_type=VALUE_STREAM_TYPE, subtypes=VALUE_STREAM_SUBTYPES
    )
    bc_card_lookup = await _capability_card_index(db)
    bp_card_lookup = await _process_card_index(db)

    catalogue_id_to_card_id: dict[str, str] = {}
    for node in flat:
        english_name = english_by_id.get(node["id"], node).get("name") or ""
        existing_card_id = cat_id_index.get(node["id"]) or name_index.get(
            common.normalize_name(english_name)
        )
        if existing_card_id:
            catalogue_id_to_card_id[node["id"]] = existing_card_id
    pre_existing_ids: set[str] = set(catalogue_id_to_card_id.keys())

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
    relinked: list[dict[str, str]] = []
    auto_relations_total = 0
    created_in_batch: set[str] = set()
    now = common.now_iso()
    user_id = user.id

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

        parent_card_id: Any = None
        cat_parent = node.get("parent_id")
        if cat_parent and cat_parent in catalogue_id_to_card_id:
            parent_card_id = catalogue_id_to_card_id[cat_parent]

        is_stream = node["level"] == LEVEL_STREAM
        attrs = (
            _stream_attributes(node, meta, now) if is_stream else _stage_attributes(node, meta, now)
        )

        card = Card(
            type=VALUE_STREAM_TYPE,
            subtype=VALUE_STREAM_SUBTYPE,
            name=node.get("name") or node.get("stage_name") or node["id"],
            description=node.get("description"),
            parent_id=parent_card_id,
            attributes=attrs,
            created_by=user_id,
            updated_by=user_id,
        )
        db.add(card)
        await db.flush()
        catalogue_id_to_card_id[node["id"]] = str(card.id)
        if card.name:
            name_index[common.normalize_name(card.name)] = str(card.id)
        english_name = english_by_id.get(node["id"], node).get("name") or ""
        if english_name and english_name != card.name:
            name_index[common.normalize_name(english_name)] = str(card.id)

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

    for cat_id in pre_existing_ids:
        relink_node = by_id.get(cat_id)
        if relink_node is None:
            continue
        cat_parent = relink_node.get("parent_id")
        if not cat_parent or cat_parent not in created_in_batch:
            continue
        existing_card_id = catalogue_id_to_card_id[cat_id]
        new_parent_card_id = catalogue_id_to_card_id[cat_parent]
        existing_uuid = uuid.UUID(existing_card_id)
        new_parent_uuid = uuid.UUID(new_parent_card_id)
        await db.execute(
            update(Card)
            .where(Card.id == existing_uuid)
            .values(parent_id=new_parent_uuid, updated_by=user_id)
        )
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
