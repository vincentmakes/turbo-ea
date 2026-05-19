"""LeanIX migration staging service.

Turns a parsed :class:`LeanixSnapshot` into a set of
:class:`LeanixStagedRecord` rows that the admin can review before
applying. Phase 3 covers **cards + relations + tags + users +
subscriptions + documents + comments**; the metamodel-extension
pipeline (new card types / custom fields / new relation types) is the
last remaining piece.

The staging layer is responsible for:

1. **Identity resolution**. For every fact sheet, look up the
   ``leanix_identity_map`` first. If miss, fall back to
   ``cards.external_id``. If still miss, fall back to ``(name, type)``.
   The first hit gives us the ``target_id`` and an ``action='update'``;
   no hit gives ``action='create'``.

2. **Type mapping**. Translate the LeanIX FS type into the matching
   Turbo EA card-type key (see :data:`LX_TO_TEA_TYPE`). Unknown types
   are surfaced as `metamodel_type` staged rows (Phase 3 wires this
   into the apply pipeline).

3. **Diff computation**. For ``update`` rows, walk the LeanIX payload
   and compute a ``{field: {old, new}}`` map so the UI can render a
   three-column diff.

The service is idempotent: running it twice for the same migration
clears and rewrites staged rows so admins can iterate.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.leanix import LeanixIdentityMap, LeanixMigration, LeanixStagedRecord
from app.models.relation import Relation
from app.models.tag import Tag, TagGroup
from app.models.user import User
from app.services.leanix_snapshot_parser import FactSheet, LeanixSnapshot

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# LeanIX → Turbo EA type mapping
# ---------------------------------------------------------------------------

# 1:1 mapping from default LeanIX fact-sheet type names to Turbo EA
# card-type keys. Custom (tenant-defined) FS types are surfaced as
# ``metamodel_type`` staged rows in a later pass.
LX_TO_TEA_TYPE: dict[str, str] = {
    "Application": "Application",
    "ITComponent": "ITComponent",
    "BusinessCapability": "BusinessCapability",
    "BusinessContext": "BusinessContext",
    "Process": "BusinessProcess",  # legacy v3 → BusinessProcess
    "BusinessProcess": "BusinessProcess",
    "DataObject": "DataObject",
    "Interface": "Interface",
    "Project": "Initiative",
    "Initiative": "Initiative",
    "Provider": "Provider",
    "TechCategory": "TechCategory",
    "Platform": "Platform",
    "Objective": "Objective",
    # User Group has no native equivalent — gets mapped to Organization
    # with subtype `team`. Admin can re-classify post-import.
    "UserGroup": "Organization",
}


def map_lx_type(lx_type: str) -> str | None:
    """Return the Turbo EA card-type key for a LeanIX FS type, or ``None`` if unknown."""
    return LX_TO_TEA_TYPE.get(lx_type)


# ---------------------------------------------------------------------------
# LeanIX → Turbo EA relation-type mapping
# ---------------------------------------------------------------------------

# LeanIX names relations using camelCased FS pairs, e.g.
# ``relApplicationToITComponent``. Turbo EA shortens both sides (App,
# ITC, BC, DataObj, BizCtx, …). The table below covers every default
# Turbo EA relation; unknown LeanIX relation types are surfaced as
# ``metamodel_relation_type`` staged rows in Phase 3.
#
# The xlsx "Full Export" uses a second naming convention
# (``<lowerType><UpperType>Relation``, e.g. ``applicationITComponentRelation``).
# We list both forms side-by-side so both export shapes route to the
# same Turbo EA relation key without a brittle string-munging step.
LX_TO_TEA_RELATION: dict[str, str] = {
    # --- Application connections ---
    "relApplicationToBusinessCapability": "relAppToBC",
    "applicationBusinessCapabilityRelation": "relAppToBC",
    "relApplicationToBusinessContext": "relAppToBizCtx",
    "applicationBusinessContextRelation": "relAppToBizCtx",
    "relApplicationToInterface": "relAppToInterface",
    "applicationInterfaceRelation": "relAppToInterface",
    # LeanIX models app↔interface as two-sided (provider vs consumer);
    # Turbo EA has a single relation type — both flavours fold into it.
    "applicationInterfaceProviderRelation": "relAppToInterface",
    "applicationInterfaceConsumerRelation": "relAppToInterface",
    "relApplicationToDataObject": "relAppToDataObj",
    "applicationDataObjectRelation": "relAppToDataObj",
    "relApplicationToITComponent": "relAppToITC",
    "applicationITComponentRelation": "relAppToITC",
    "relApplicationSuccessor": "relAppSuccessor",
    "applicationSuccessorRelation": "relAppSuccessor",
    # --- IT-Component connections ---
    "relITComponentToTechCategory": "relITCToTechCat",
    "itComponentTechCategoryRelation": "relITCToTechCat",
    # The xlsx export calls the same edge ``itComponentTechnologyStackRelation``
    # in tenants that have renamed the Tech Category type to "Technology Stack".
    "itComponentTechnologyStackRelation": "relITCToTechCat",
    "relITComponentToPlatform": "relITCToPlatform",
    "itComponentPlatformRelation": "relITCToPlatform",
    "relITComponentSuccessor": "relITCSuccessor",
    "itComponentSuccessorRelation": "relITCSuccessor",
    # --- Interface connections ---
    "relInterfaceToDataObject": "relInterfaceToDataObj",
    "interfaceDataObjectRelation": "relInterfaceToDataObj",
    "relInterfaceToITComponent": "relInterfaceToITC",
    "interfaceITComponentRelation": "relInterfaceToITC",
    "relInterfaceSuccessor": "relInterfaceSuccessor",
    "interfaceSuccessorRelation": "relInterfaceSuccessor",
    # --- Initiative connections (LeanIX "Project" → TEA "Initiative") ---
    "relProjectToObjective": "relInitiativeToObjective",
    "projectObjectiveRelation": "relInitiativeToObjective",
    "relProjectToBusinessCapability": "relInitiativeToBC",
    "projectBusinessCapabilityRelation": "relInitiativeToBC",
    "relProjectToApplication": "relInitiativeToApp",
    "projectApplicationRelation": "relInitiativeToApp",
    "applicationProjectRelation": "relInitiativeToApp",
    "relProjectToITComponent": "relInitiativeToITC",
    "projectITComponentRelation": "relInitiativeToITC",
    "relProjectToInterface": "relInitiativeToInterface",
    "projectInterfaceRelation": "relInitiativeToInterface",
    "relProjectToDataObject": "relInitiativeToDataObj",
    "projectDataObjectRelation": "relInitiativeToDataObj",
    "relProjectToPlatform": "relInitiativeToPlatform",
    "projectPlatformRelation": "relInitiativeToPlatform",
    # Some tenants rename "Platform" to "Tech Platform" — same edge.
    "projectTechPlatformRelation": "relInitiativeToPlatform",
    "relInitiativeToObjective": "relInitiativeToObjective",
    "relInitiativeToBusinessCapability": "relInitiativeToBC",
    "relInitiativeToApplication": "relInitiativeToApp",
    "relInitiativeToITComponent": "relInitiativeToITC",
    "relInitiativeToInterface": "relInitiativeToInterface",
    "relInitiativeToDataObject": "relInitiativeToDataObj",
    "relInitiativeToPlatform": "relInitiativeToPlatform",
    "relInitiativeSuccessor": "relInitiativeSuccessor",
    "initiativeSuccessorRelation": "relInitiativeSuccessor",
    # --- Objective / Platform ---
    "relObjectiveToBusinessCapability": "relObjectiveToBC",
    "objectiveBusinessCapabilityRelation": "relObjectiveToBC",
    "relPlatformToObjective": "relPlatformToObjective",
    "platformObjectiveRelation": "relPlatformToObjective",
    "relPlatformToApplication": "relPlatformToApp",
    "platformApplicationRelation": "relPlatformToApp",
    "techPlatformApplicationRelation": "relPlatformToApp",
    "relPlatformToITComponent": "relPlatformToITC",
    "platformITComponentRelation": "relPlatformToITC",
    "techPlatformITComponentRelation": "relPlatformToITC",
    "relPlatformSuccessor": "relPlatformSuccessor",
    "platformSuccessorRelation": "relPlatformSuccessor",
    # --- Provider connections ---
    "relProviderToApplication": "relProviderToApp",
    "providerApplicationRelation": "relProviderToApp",
    "relProviderToITComponent": "relProviderToITC",
    "providerITComponentRelation": "relProviderToITC",
    "itComponentProviderRelation": "relProviderToITC",
    "relProviderToProject": "relProviderToInitiative",
    "providerProjectRelation": "relProviderToInitiative",
    "projectProviderRelation": "relProviderToInitiative",
    "relProviderToInitiative": "relProviderToInitiative",
    # --- Business Context / Process ---
    "relBusinessContextToBusinessCapability": "relBizCtxToBC",
    "businessContextBusinessCapabilityRelation": "relBizCtxToBC",
    "relProcessToBusinessCapability": "relProcessToBC",
    "processBusinessCapabilityRelation": "relProcessToBC",
    "relProcessToApplication": "relProcessToApp",
    "processApplicationRelation": "relProcessToApp",
    "applicationProcessRelation": "relProcessToApp",
    "relProcessToDataObject": "relProcessToDataObj",
    "processDataObjectRelation": "relProcessToDataObj",
    "relProcessToITComponent": "relProcessToITC",
    "processITComponentRelation": "relProcessToITC",
    "relProcessDependency": "relProcessDependency",
    "relProcessToOrganization": "relProcessToOrg",
    "processUserGroupRelation": "relProcessToOrg",
    "relProcessToProject": "relProcessToInitiative",
    "processProjectRelation": "relProcessToInitiative",
    "projectProcessRelation": "relProcessToInitiative",
    "relProcessToInitiative": "relProcessToInitiative",
    "relProcessToObjective": "relProcessToObjective",
    "processObjectiveRelation": "relProcessToObjective",
    "relProcessToBusinessContext": "relProcessToBizCtx",
    "processBusinessContextRelation": "relProcessToBizCtx",
    "relProcessSuccessor": "relProcessSuccessor",
    "processSuccessorRelation": "relProcessSuccessor",
    # --- Organization (LeanIX "UserGroup") edges ---
    "relUserGroupToApplication": "relOrgToApp",
    "applicationUserGroupRelation": "relOrgToApp",
    "applicationOwningUserGroupRelation": "relOrgToApp",
    "relUserGroupToBusinessContext": "relOrgToBizCtx",
    "userGroupBusinessContextRelation": "relOrgToBizCtx",
    "relUserGroupToITComponent": "relOrgToITC",
    "itComponentUserGroupRelation": "relOrgToITC",
    "userGroupITComponentRelation": "relOrgToITC",
    "relUserGroupToProject": "relOrgToInitiative",
    "userGroupProjectRelation": "relOrgToInitiative",
    "projectUserGroupRelation": "relOrgToInitiative",
    "relUserGroupToInitiative": "relOrgToInitiative",
    "relUserGroupToObjective": "relOrgToObjective",
    "userGroupObjectiveRelation": "relOrgToObjective",
    # NOTE: ``businessCapabilityUserGroupRelation`` (BC ↔ UserGroup),
    # ``requiresRelation``, the generic ``successorRelation``, and
    # ``projectBlocksProjectRelation`` have no native equivalent in
    # Turbo EA's seeded relation graph. They land as conflict rows so
    # the admin can either drop them or model them as a custom relation
    # type before re-running the apply pass.
}


def map_lx_relation(lx_rel: str) -> str | None:
    """Return the Turbo EA relation-type key for a LeanIX relation type, or ``None``.

    Hierarchy edges (``relToParent`` / ``relToChild``) intentionally
    return ``None`` — the snapshot parser already projects them onto
    ``FactSheet.parent_id`` so they should not be staged as relations.
    """
    if lx_rel in {"relToParent", "relToChild"}:
        return None
    return LX_TO_TEA_RELATION.get(lx_rel)


# ---------------------------------------------------------------------------
# Card-fact-sheet payload builder
# ---------------------------------------------------------------------------


def build_card_payload(fs: FactSheet, target_type: str) -> dict[str, Any]:
    """Map a LeanIX FactSheet to a ``cards`` row create-payload.

    The payload uses the Turbo EA Card model column names directly.
    Custom (un-mapped) LeanIX fields land in ``attributes`` keyed by
    their LeanIX field-name — the metamodel-extension pass (Phase 3)
    is what makes those keys first-class on the target card type.
    """
    payload: dict[str, Any] = {
        "type": target_type,
        "name": fs.name or fs.display_name or fs.leanix_id,
        "description": fs.description,
        "external_id": fs.leanix_id,
        "lifecycle": fs.lifecycle or {},
        "attributes": dict(fs.custom_fields),
        "status": "ACTIVE",
        "approval_status": "DRAFT",
    }
    if fs.category:
        payload["subtype"] = fs.category
    # User Group → Organization gets force-tagged with subtype `team`
    # so the admin can re-classify it without losing the LeanIX origin.
    if fs.type == "UserGroup" and target_type == "Organization":
        payload["subtype"] = "team"
        payload["attributes"]["leanix_origin"] = "UserGroup"
    return payload


# ---------------------------------------------------------------------------
# Diff against an existing card
# ---------------------------------------------------------------------------


_DIFF_FIELDS = ("name", "description", "subtype", "external_id")


def compute_card_diff(payload: dict[str, Any], existing: Card) -> dict[str, dict[str, Any]]:
    diff: dict[str, dict[str, Any]] = {}
    for field in _DIFF_FIELDS:
        new = payload.get(field)
        old = getattr(existing, field, None)
        if (new or None) != (old or None):
            diff[field] = {"old": old, "new": new}
    if (payload.get("lifecycle") or {}) != (existing.lifecycle or {}):
        diff["lifecycle"] = {"old": existing.lifecycle, "new": payload.get("lifecycle")}
    # Attribute-level diff — only surface keys that actually changed.
    new_attrs = payload.get("attributes") or {}
    old_attrs = existing.attributes or {}
    attr_diff = {}
    for k, v in new_attrs.items():
        if old_attrs.get(k) != v:
            attr_diff[k] = {"old": old_attrs.get(k), "new": v}
    if attr_diff:
        diff["attributes"] = attr_diff
    return diff


# ---------------------------------------------------------------------------
# Identity resolution
# ---------------------------------------------------------------------------


async def _resolve_existing_card(
    db: AsyncSession,
    leanix_id: str,
    name: str,
    target_type: str,
) -> Card | None:
    # 1. Identity-map hit (fastest, survives across imports).
    im_row = (
        await db.execute(
            select(LeanixIdentityMap).where(
                LeanixIdentityMap.leanix_id == leanix_id,
                LeanixIdentityMap.entity_kind == "card",
            )
        )
    ).scalar_one_or_none()
    if im_row is not None:
        card = (
            await db.execute(select(Card).where(Card.id == im_row.target_id))
        ).scalar_one_or_none()
        if card is not None:
            return card
        # Dangling pointer — the target card was deleted out from under
        # us (admin bulk-delete in the UI, manual SQL, etc.). Drop the
        # stale identity-map row so this re-import lands as a fresh
        # create instead of silently skipping.
        await db.delete(im_row)
        await db.flush()

    # 2. ``cards.external_id`` fallback (works even if identity map was wiped).
    card = (
        await db.execute(select(Card).where(Card.external_id == leanix_id))
    ).scalar_one_or_none()
    if card is not None:
        return card

    # 3. ``(name, type)`` last-resort. Only safe if the name happens to
    # be unique within the target type — otherwise we risk overwriting
    # the wrong card. Conservative choice: pick the oldest match.
    rows = (
        (
            await db.execute(
                select(Card)
                .where(Card.name == name, Card.type == target_type)
                .order_by(Card.created_at.asc())
                .limit(1)
            )
        )
        .scalars()
        .all()
    )
    return rows[0] if rows else None


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


async def stage_cards(
    db: AsyncSession,
    migration: LeanixMigration,
    snapshot: LeanixSnapshot,
    include_archived: bool = False,
) -> dict[str, int]:
    """Stage every fact sheet from the snapshot into ``leanix_staged_records``.

    Archived (soft-deleted in LeanIX) fact sheets are **skipped by
    default**. Pass ``include_archived=True`` if the customer wants to
    import them too — they land with Turbo EA ``status='ARCHIVED'``.
    """
    # Reset any prior staging rows for this migration.
    await db.execute(
        delete(LeanixStagedRecord).where(
            LeanixStagedRecord.migration_id == migration.id,
            LeanixStagedRecord.entity_kind == "card",
        )
    )

    stats = {"create": 0, "update": 0, "skip": 0, "conflict": 0, "unknown_type": 0, "archived": 0}

    # LX fact-sheet types the parser surfaced as a custom
    # ``MetamodelType`` (i.e. no entry in ``LX_TO_TEA_TYPE``) — the
    # ``metamodel_type`` apply pass will create a new Turbo EA card
    # type with ``key = lx_type_name``, so staging the cards with
    # ``target_type = fs.type`` in the same migration makes them apply
    # cleanly without a manual second pass.
    synthesised_types: set[str] = {
        mt.name for mt in snapshot.metamodel_types if mt.is_custom and mt.name not in LX_TO_TEA_TYPE
    }

    for fs in snapshot.fact_sheets:
        # Skip archived FS by default — admin opts in via include_archived.
        if (fs.status or "").upper() == "ARCHIVED" and not include_archived:
            stats["archived"] += 1
            continue
        target_type = map_lx_type(fs.type)
        if target_type is None and fs.type in synthesised_types:
            # New tenant card type — apply pass will create it; route
            # the card to the about-to-be-created key.
            target_type = fs.type
        if target_type is None:
            # Unknown FS type that isn't synthesised either (e.g. a
            # type observed only in a relation row but missing from the
            # fact-sheet sheets). Stage as conflict so the admin sees
            # it.
            stats["unknown_type"] += 1
            db.add(
                LeanixStagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    entity_kind="card",
                    leanix_id=fs.leanix_id,
                    leanix_data=_fs_as_dict(fs),
                    card_type_key=None,
                    action="conflict",
                    diff={"reason": f"Unmapped LeanIX type '{fs.type}'"},
                    parent_leanix_id=fs.parent_id,
                )
            )
            continue

        payload = build_card_payload(fs, target_type)
        existing = await _resolve_existing_card(db, fs.leanix_id, payload["name"], target_type)

        if existing is None:
            action = "create"
            diff = None
            target_id = None
        else:
            action = "update"
            diff = compute_card_diff(payload, existing)
            target_id = existing.id
            if not diff:
                action = "skip"
        stats[action] += 1

        db.add(
            LeanixStagedRecord(
                id=uuid.uuid4(),
                migration_id=migration.id,
                entity_kind="card",
                leanix_id=fs.leanix_id,
                leanix_data={"payload": payload, "raw": _fs_as_dict(fs)},
                card_type_key=target_type,
                action=action,
                diff=diff,
                target_id=target_id,
                parent_leanix_id=fs.parent_id,
            )
        )

    await db.flush()
    return stats


def _fs_as_dict(fs: FactSheet) -> dict[str, Any]:
    return {
        "leanix_id": fs.leanix_id,
        "type": fs.type,
        "name": fs.name,
        "category": fs.category,
        "lifecycle": fs.lifecycle,
        "custom_fields": fs.custom_fields,
        "parent_id": fs.parent_id,
    }


# ---------------------------------------------------------------------------
# Relation staging
# ---------------------------------------------------------------------------


async def stage_relations(
    db: AsyncSession,
    migration: LeanixMigration,
    snapshot: LeanixSnapshot,
) -> dict[str, int]:
    """Stage every relation from the snapshot into ``leanix_staged_records``.

    A relation is **only** stageable if both endpoints exist as staged
    card rows in this migration (or already resolved via the identity
    map). Dangling endpoints land as ``action='conflict'`` so the
    admin can see what was dropped and why.
    """
    await db.execute(
        delete(LeanixStagedRecord).where(
            LeanixStagedRecord.migration_id == migration.id,
            LeanixStagedRecord.entity_kind == "relation",
        )
    )

    stats = {"create": 0, "update": 0, "skip": 0, "conflict": 0, "unknown_type": 0}

    # Pre-build a fast index of card-staged rows so we can resolve each
    # relation's source/target without a per-relation roundtrip.
    staged_cards = (
        (
            await db.execute(
                select(LeanixStagedRecord).where(
                    LeanixStagedRecord.migration_id == migration.id,
                    LeanixStagedRecord.entity_kind == "card",
                )
            )
        )
        .scalars()
        .all()
    )
    in_snapshot: set[str] = {row.leanix_id for row in staged_cards}

    # LX relation types the parser surfaced as ``MetamodelRelationType``
    # (custom, not in the static map) — when we hit one of these, the
    # ``metamodel_relation_type`` apply pass will create a new Turbo EA
    # relation_type keyed by the LX name, so staging the relation with
    # ``tea_type = rel.type`` makes it apply cleanly in the same run.
    synthesised_rel_types: set[str] = {
        rt.name
        for rt in snapshot.metamodel_relation_types
        if rt.is_custom and rt.name not in LX_TO_TEA_RELATION
    }

    for rel in snapshot.relations:
        # Skip hierarchy edges — already folded into Card.parent_id.
        if rel.type in {"relToParent", "relToChild"}:
            continue

        tea_type = map_lx_relation(rel.type)
        if tea_type is None and rel.type in synthesised_rel_types:
            # New tenant relation type — the metamodel pass will create
            # the matching Turbo EA RelationType with ``key = rel.type``.
            tea_type = rel.type
        if tea_type is None:
            stats["unknown_type"] += 1
            db.add(
                LeanixStagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    entity_kind="relation",
                    leanix_id=rel.leanix_id,
                    leanix_data={
                        "source_id": rel.source_id,
                        "target_id": rel.target_id,
                        "lx_type": rel.type,
                    },
                    action="conflict",
                    diff={"reason": f"Unmapped LeanIX relation type '{rel.type}'"},
                )
            )
            continue

        # Endpoint resolution: both ends must end up as Turbo EA card UUIDs.
        src_target_id = await _resolve_endpoint_card_id(db, rel.source_id, in_snapshot)
        tgt_target_id = await _resolve_endpoint_card_id(db, rel.target_id, in_snapshot)
        if src_target_id is None or tgt_target_id is None:
            stats["conflict"] += 1
            missing = []
            if src_target_id is None:
                missing.append(f"source={rel.source_id}")
            if tgt_target_id is None:
                missing.append(f"target={rel.target_id}")
            db.add(
                LeanixStagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    entity_kind="relation",
                    leanix_id=rel.leanix_id,
                    leanix_data={
                        "source_id": rel.source_id,
                        "target_id": rel.target_id,
                        "lx_type": rel.type,
                        "tea_type": tea_type,
                        "attributes": rel.attributes,
                    },
                    action="conflict",
                    diff={"reason": "Endpoint not staged: " + ", ".join(missing)},
                )
            )
            continue

        # Does an equivalent relation already exist? Match on
        # (type, source_id, target_id) — Turbo EA relations are not
        # multi-edged in the default model.
        existing_rel = (
            await db.execute(
                select(Relation).where(
                    Relation.type == tea_type,
                    Relation.source_id == src_target_id,
                    Relation.target_id == tgt_target_id,
                )
            )
        ).scalar_one_or_none()

        action: str
        diff = None
        target_id = None
        if existing_rel is None:
            action = "create"
            stats["create"] += 1
        else:
            target_id = existing_rel.id
            attr_diff = _compare_relation_attrs(rel.attributes, existing_rel.attributes or {})
            if attr_diff:
                action = "update"
                diff = {"attributes": attr_diff}
                stats["update"] += 1
            else:
                action = "skip"
                stats["skip"] += 1

        db.add(
            LeanixStagedRecord(
                id=uuid.uuid4(),
                migration_id=migration.id,
                entity_kind="relation",
                leanix_id=rel.leanix_id,
                leanix_data={
                    "lx_type": rel.type,
                    "tea_type": tea_type,
                    "source_id": rel.source_id,
                    "target_id": rel.target_id,
                    "attributes": rel.attributes,
                    # Resolved endpoint UUIDs are cached on the staged
                    # row so the apply pass doesn't have to redo the
                    # identity lookup.
                    "tea_source_card_id": str(src_target_id),
                    "tea_target_card_id": str(tgt_target_id),
                },
                card_type_key=tea_type,
                action=action,
                diff=diff,
                target_id=target_id,
            )
        )

    await db.flush()
    return stats


async def _resolve_endpoint_card_id(
    db: AsyncSession,
    leanix_id: str,
    in_snapshot: set[str],
) -> uuid.UUID | None:
    """Resolve a LeanIX fact-sheet id to a Turbo EA card UUID.

    Looks in the persistent identity map first, then in the
    staged-row table for this migration (in case the card hasn't been
    applied yet — endpoints will materialise during the apply pass).
    Returns ``None`` if the endpoint is dangling.
    """
    # Identity map first (covers already-applied cards from earlier imports).
    im = (
        await db.execute(
            select(LeanixIdentityMap).where(
                LeanixIdentityMap.leanix_id == leanix_id,
                LeanixIdentityMap.entity_kind == "card",
            )
        )
    ).scalar_one_or_none()
    if im is not None:
        return im.target_id
    # Card hasn't been applied yet — endpoint will resolve at apply
    # time. Return a stable placeholder UUID (zero-UUID) so the staged
    # row is materialised; apply re-resolves before INSERT.
    if leanix_id in in_snapshot:
        return uuid.UUID("00000000-0000-0000-0000-000000000000")
    return None


def _compare_relation_attrs(
    new_attrs: dict[str, Any],
    old_attrs: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for k, v in (new_attrs or {}).items():
        if old_attrs.get(k) != v:
            out[k] = {"old": old_attrs.get(k), "new": v}
    return out


# ---------------------------------------------------------------------------
# Tag staging
# ---------------------------------------------------------------------------


async def stage_tags(
    db: AsyncSession,
    migration: LeanixMigration,
    snapshot: LeanixSnapshot,
) -> dict[str, int]:
    """Stage tag groups and tags from the snapshot.

    LeanIX models tags as ``Tag + TagGroup`` pairs (single/multi mode);
    Turbo EA has the same shape. We stage **tag-group create rows**
    keyed by group name (no group name → fall back to ``"Imported from
    LeanIX"``) and **tag create rows** keyed by ``leanix_id``. Apply
    pass materialises the groups first, then tags, then
    ``card_tags`` joins for every FS that references a tag.
    """
    await db.execute(
        delete(LeanixStagedRecord).where(
            LeanixStagedRecord.migration_id == migration.id,
            LeanixStagedRecord.entity_kind.in_(("tag", "tag_group", "card_tag")),
        )
    )

    stats = {"groups_create": 0, "groups_skip": 0, "tags_create": 0, "tags_skip": 0, "links": 0}

    # ---- Tag groups (deduped on name across the snapshot) ----
    seen_groups: dict[str, dict[str, Any]] = {}
    for lx_tag in snapshot.tags:
        group_name = lx_tag.group_name or "Imported from LeanIX"
        existing = seen_groups.get(group_name)
        if existing is None:
            seen_groups[group_name] = {
                "name": group_name,
                "mode": _normalise_tag_group_mode(lx_tag.group_mode),
            }

    for group_name, payload in seen_groups.items():
        existing_group = (
            await db.execute(select(TagGroup).where(TagGroup.name == group_name))
        ).scalar_one_or_none()
        if existing_group is None:
            stats["groups_create"] += 1
            db.add(
                LeanixStagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    entity_kind="tag_group",
                    leanix_id=group_name,
                    leanix_data=payload,
                    action="create",
                )
            )
        else:
            stats["groups_skip"] += 1
            db.add(
                LeanixStagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    entity_kind="tag_group",
                    leanix_id=group_name,
                    leanix_data=payload,
                    target_id=existing_group.id,
                    action="skip",
                )
            )

    # ---- Tags ----
    for lx_tag in snapshot.tags:
        group_name = lx_tag.group_name or "Imported from LeanIX"
        existing_tag = await _find_existing_tag(db, lx_tag.name, group_name)
        if existing_tag is None:
            stats["tags_create"] += 1
            action = "create"
            target_id = None
        else:
            stats["tags_skip"] += 1
            action = "skip"
            target_id = existing_tag.id
        db.add(
            LeanixStagedRecord(
                id=uuid.uuid4(),
                migration_id=migration.id,
                entity_kind="tag",
                leanix_id=lx_tag.leanix_id,
                leanix_data={
                    "name": lx_tag.name,
                    "group_name": group_name,
                    "color": lx_tag.color,
                },
                action=action,
                target_id=target_id,
            )
        )

    # ---- card_tag joins (one per (fact_sheet, tag) link) ----
    for fs in snapshot.fact_sheets:
        for tag_id in fs.tags:
            stats["links"] += 1
            db.add(
                LeanixStagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    entity_kind="card_tag",
                    leanix_id=f"{fs.leanix_id}:{tag_id}",
                    leanix_data={"fact_sheet_id": fs.leanix_id, "tag_id": tag_id},
                    action="create",
                )
            )

    await db.flush()
    return stats


def _normalise_tag_group_mode(lx_mode: str | None) -> str:
    if not lx_mode:
        return "multi"
    return "single" if lx_mode.upper() == "SINGLE" else "multi"


async def _find_existing_tag(db: AsyncSession, name: str, group_name: str) -> Tag | None:
    return (
        await db.execute(
            select(Tag)
            .join(TagGroup, TagGroup.id == Tag.tag_group_id)
            .where(Tag.name == name, TagGroup.name == group_name)
        )
    ).scalar_one_or_none()


# ---------------------------------------------------------------------------
# User + subscription (stakeholder) staging
# ---------------------------------------------------------------------------

# LeanIX subscription role-name → Turbo EA stakeholder role key. LeanIX
# tenant subscription roles are admin-customisable in LeanIX too, so we
# accept the lowercased free-form name and fall back to a sensible
# default for anything unrecognised. The default seeded Turbo EA roles
# are ``responsible``, ``observer``, ``process_owner``, ``it_project_manager``.
LX_SUBSCRIPTION_ROLE_MAP: dict[str, str] = {
    # ACCOUNTABLE / RESPONSIBLE typed subscriptions → "responsible"
    "application owner": "responsible",
    "responsible": "responsible",
    "owner": "responsible",
    # OBSERVER-typed subscriptions
    "observer": "observer",
    "subscriber": "observer",
    # PROCESS context
    "process owner": "process_owner",
    # IT project context
    "it project manager": "it_project_manager",
    "project manager": "it_project_manager",
}


def map_subscription_role(role_name: str | None, role_type: str | None) -> str:
    """Map a LeanIX subscription to a Turbo EA stakeholder-role key.

    Falls back to ``responsible`` for RESPONSIBLE / ACCOUNTABLE
    subscriptions and ``observer`` for OBSERVER subscriptions when the
    free-form ``role_name`` isn't recognised, matching what most
    customers expect from LeanIX.
    """
    if role_name:
        hit = LX_SUBSCRIPTION_ROLE_MAP.get(role_name.strip().lower())
        if hit is not None:
            return hit
    if role_type and role_type.upper() == "OBSERVER":
        return "observer"
    return "responsible"


async def stage_users_and_subscriptions(
    db: AsyncSession,
    migration: LeanixMigration,
    snapshot: LeanixSnapshot,
) -> tuple[dict[str, int], dict[str, int]]:
    """Stage every distinct user referenced in subscriptions + the subscriptions themselves.

    Users land first because subscriptions need a resolvable user UUID
    at apply-time. Users whose email already exists are skipped (we
    never touch existing users — re-imports respect locally-managed
    accounts). New users come in as ``is_active=False`` until the
    admin manually activates them.
    """
    await db.execute(
        delete(LeanixStagedRecord).where(
            LeanixStagedRecord.migration_id == migration.id,
            LeanixStagedRecord.entity_kind.in_(("user", "subscription")),
        )
    )

    user_stats = {"create": 0, "skip": 0, "missing_email": 0}
    sub_stats = {"create": 0, "skip": 0, "conflict": 0}

    # ---- User pass: collect every distinct (email, display_name) ----
    distinct_users: dict[str, dict[str, Any]] = {}
    for sub in snapshot.subscriptions:
        email = (sub.user_email or "").strip().lower()
        if not email:
            user_stats["missing_email"] += 1
            continue
        if email not in distinct_users:
            distinct_users[email] = {
                "email": email,
                "display_name": sub.user_display_name or email,
            }
    # The snapshot may also expose a top-level users[] section that
    # carries users without active subscriptions — also stage those.
    for u in snapshot.users:
        if u.email and u.email not in distinct_users:
            distinct_users[u.email] = {
                "email": u.email,
                "display_name": u.display_name or u.email,
            }

    for email, payload in distinct_users.items():
        existing = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if existing is not None:
            user_stats["skip"] += 1
            db.add(
                LeanixStagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    entity_kind="user",
                    leanix_id=email,
                    leanix_data=payload,
                    action="skip",
                    target_id=existing.id,
                )
            )
        else:
            user_stats["create"] += 1
            db.add(
                LeanixStagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    entity_kind="user",
                    leanix_id=email,
                    leanix_data=payload,
                    action="create",
                )
            )

    # ---- Subscription pass ----
    for sub in snapshot.subscriptions:
        email = (sub.user_email or "").strip().lower()
        if not email:
            sub_stats["conflict"] += 1
            db.add(
                LeanixStagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    entity_kind="subscription",
                    leanix_id=sub.leanix_id or f"{sub.fact_sheet_id}:noemail",
                    leanix_data={
                        "fact_sheet_id": sub.fact_sheet_id,
                        "role_name": sub.role_name,
                        "role_type": sub.role_type,
                    },
                    action="conflict",
                    diff={"reason": "Subscription has no user email — cannot resolve"},
                )
            )
            continue
        role_key = map_subscription_role(sub.role_name, sub.role_type)
        sub_stats["create"] += 1
        db.add(
            LeanixStagedRecord(
                id=uuid.uuid4(),
                migration_id=migration.id,
                entity_kind="subscription",
                leanix_id=sub.leanix_id or f"{sub.fact_sheet_id}:{email}:{role_key}",
                leanix_data={
                    "fact_sheet_id": sub.fact_sheet_id,
                    "user_email": email,
                    "role_name": sub.role_name,
                    "role_type": sub.role_type,
                    "tea_role_key": role_key,
                },
                action="create",
            )
        )

    await db.flush()
    return user_stats, sub_stats


# ---------------------------------------------------------------------------
# Document staging
# ---------------------------------------------------------------------------


async def stage_documents(
    db: AsyncSession,
    migration: LeanixMigration,
    snapshot: LeanixSnapshot,
) -> dict[str, int]:
    """Stage LeanIX documents as Turbo EA Document (URL) attachments.

    Binaries are not in the snapshot — only URLs. Anything without a
    URL is staged as ``conflict`` so the admin can see what was
    dropped.
    """
    await db.execute(
        delete(LeanixStagedRecord).where(
            LeanixStagedRecord.migration_id == migration.id,
            LeanixStagedRecord.entity_kind == "document",
        )
    )
    stats = {"create": 0, "skip": 0, "conflict": 0}
    for doc in snapshot.documents:
        if not doc.url:
            stats["conflict"] += 1
            db.add(
                LeanixStagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    entity_kind="document",
                    leanix_id=doc.leanix_id or f"{doc.fact_sheet_id}:{doc.name}",
                    leanix_data={
                        "fact_sheet_id": doc.fact_sheet_id,
                        "name": doc.name,
                    },
                    action="conflict",
                    diff={"reason": "Document has no URL (binary not in snapshot)"},
                )
            )
            continue
        stats["create"] += 1
        db.add(
            LeanixStagedRecord(
                id=uuid.uuid4(),
                migration_id=migration.id,
                entity_kind="document",
                leanix_id=doc.leanix_id or f"{doc.fact_sheet_id}:{doc.name}",
                leanix_data={
                    "fact_sheet_id": doc.fact_sheet_id,
                    "name": doc.name,
                    "url": doc.url,
                },
                action="create",
            )
        )
    await db.flush()
    return stats


# ---------------------------------------------------------------------------
# Comment staging
# ---------------------------------------------------------------------------


async def stage_comments(
    db: AsyncSession,
    migration: LeanixMigration,
    snapshot: LeanixSnapshot,
) -> dict[str, int]:
    """Stage comments. Comments whose author cannot be resolved drop with a warning.

    Threading (reply chains) is *not* preserved in Phase 3 — every
    comment lands at the top level. The snapshot rarely carries enough
    structural detail to reconstruct LeanIX's UI threading reliably.
    """
    await db.execute(
        delete(LeanixStagedRecord).where(
            LeanixStagedRecord.migration_id == migration.id,
            LeanixStagedRecord.entity_kind == "comment",
        )
    )
    stats = {"create": 0, "skip": 0, "conflict": 0}
    for comment in snapshot.comments:
        if not comment.body:
            stats["conflict"] += 1
            continue
        stats["create"] += 1
        db.add(
            LeanixStagedRecord(
                id=uuid.uuid4(),
                migration_id=migration.id,
                entity_kind="comment",
                leanix_id=comment.leanix_id or f"{comment.fact_sheet_id}:{hash(comment.body)}",
                leanix_data={
                    "fact_sheet_id": comment.fact_sheet_id,
                    "author_email": (comment.author_email or "").strip().lower(),
                    "body": comment.body,
                    "created_at": comment.created_at.isoformat() if comment.created_at else None,
                },
                action="create",
            )
        )
    await db.flush()
    return stats


# ---------------------------------------------------------------------------
# Custom-metamodel staging
# ---------------------------------------------------------------------------

# LeanIX dataType → Turbo EA fields_schema type. ``FACT_SHEET_REFERENCE``
# is intentionally absent: LeanIX models references as fields, Turbo EA
# models them as relations, so the staging service emits a
# `metamodel_relation_type` row instead of a field row.
LX_DATATYPE_TO_TEA_TYPE: dict[str, str] = {
    "STRING": "text",
    "TEXT": "text",
    "RICH_TEXT": "text",
    "INTEGER": "number",
    "DOUBLE": "number",
    "MONEY": "cost",
    "COST": "cost",
    "BOOLEAN": "boolean",
    "DATE": "date",
    "DATETIME": "date",
    "URL": "url",
    "EMAIL": "url",
    "SINGLE_SELECT": "single_select",
    "MULTIPLE_SELECT": "multiple_select",
}


def infer_tea_field_type(lx_data_type: str) -> str | None:
    """Map a LeanIX field dataType to a Turbo EA fields_schema ``type``.

    Returns ``None`` for ``FACT_SHEET_REFERENCE`` — those are converted
    into ``metamodel_relation_type`` staged rows by
    :func:`stage_metamodel`.
    """
    if lx_data_type == "FACT_SHEET_REFERENCE":
        return None
    return LX_DATATYPE_TO_TEA_TYPE.get((lx_data_type or "").upper())


async def stage_metamodel(
    db: AsyncSession,
    migration: LeanixMigration,
    snapshot: LeanixSnapshot,
) -> dict[str, int]:
    """Stage tenant-defined metamodel extensions for admin review.

    Three rows per extension kind:

    - ``metamodel_type`` — a LeanIX fact-sheet type with no Turbo EA
      counterpart. The admin picks a target ``type`` key + layer/icon
      in the preview UI; ``action=create`` until they decide.
    - ``metamodel_field`` — a custom field on any FS type. Inferred
      ``fields_schema`` fragment in ``leanix_data``; admin can accept
      / edit / remap to an existing TEA field / skip.
    - ``metamodel_relation_type`` — a tenant-defined relation type.
      Inferred endpoints from LeanIX ``from``/``to``.

    Snapshot ``factSheetTypes[].isCustom == false`` types contribute
    ONLY their custom fields (not the type itself). Built-in collisions
    flip to ``action='conflict'`` so the importer never silently
    overwrites a Turbo EA built-in type's schema.
    """
    await db.execute(
        delete(LeanixStagedRecord).where(
            LeanixStagedRecord.migration_id == migration.id,
            LeanixStagedRecord.entity_kind.in_(
                ("metamodel_type", "metamodel_field", "metamodel_relation_type")
            ),
        )
    )
    stats = {
        "new_types": 0,
        "new_fields": 0,
        "new_relation_types": 0,
        "field_conflicts": 0,
        "type_conflicts": 0,
    }

    for mm_type in snapshot.metamodel_types:
        is_default_lx_type = mm_type.name in LX_TO_TEA_TYPE
        # ---- The type itself ----
        if mm_type.is_custom and not is_default_lx_type:
            stats["new_types"] += 1
            db.add(
                LeanixStagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    entity_kind="metamodel_type",
                    leanix_id=mm_type.name,
                    leanix_data={
                        "lx_name": mm_type.name,
                        "proposed_tea_key": mm_type.name,  # default — admin can rename
                        "subtypes": mm_type.subtypes,
                    },
                    action="create",
                )
            )
        elif mm_type.is_custom and is_default_lx_type:
            # Built-in name collision — never overwrite a TEA built-in.
            stats["type_conflicts"] += 1
            db.add(
                LeanixStagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    entity_kind="metamodel_type",
                    leanix_id=mm_type.name,
                    leanix_data={"lx_name": mm_type.name},
                    action="conflict",
                    diff={
                        "reason": (
                            f"LeanIX custom type {mm_type.name!r} collides with a "
                            "built-in Turbo EA card type; pick a new key or "
                            "remap before applying."
                        )
                    },
                )
            )

        # ---- Custom fields on the type ----
        target_tea_type = LX_TO_TEA_TYPE.get(mm_type.name) or mm_type.name
        for f in mm_type.fields:
            if not f.is_custom:
                continue
            tea_field_type = infer_tea_field_type(f.data_type)
            if tea_field_type is None and f.data_type.upper() == "FACT_SHEET_REFERENCE":
                # Reference fields don't exist as fields in Turbo EA —
                # they live on the relation_types graph. Stage as a
                # relation_type row instead.
                stats["new_relation_types"] += 1
                db.add(
                    LeanixStagedRecord(
                        id=uuid.uuid4(),
                        migration_id=migration.id,
                        entity_kind="metamodel_relation_type",
                        leanix_id=f"{mm_type.name}:{f.key}",
                        leanix_data={
                            "lx_name": f.key,
                            "label": f.label,
                            "from_type": mm_type.name,
                            "to_type": None,  # unknown; admin chooses
                        },
                        action="create",
                    )
                )
                continue
            if tea_field_type is None:
                stats["field_conflicts"] += 1
                db.add(
                    LeanixStagedRecord(
                        id=uuid.uuid4(),
                        migration_id=migration.id,
                        entity_kind="metamodel_field",
                        leanix_id=f"{mm_type.name}:{f.key}",
                        leanix_data={
                            "target_type": target_tea_type,
                            "field_key": f.key,
                            "label": f.label,
                            "lx_data_type": f.data_type,
                        },
                        action="conflict",
                        diff={"reason": f"Unmappable LeanIX dataType {f.data_type!r}"},
                    )
                )
                continue
            stats["new_fields"] += 1
            db.add(
                LeanixStagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    entity_kind="metamodel_field",
                    leanix_id=f"{mm_type.name}:{f.key}",
                    card_type_key=target_tea_type,
                    leanix_data={
                        "target_type": target_tea_type,
                        "field_key": f.key,
                        "label": f.label or f.key,
                        "tea_type": tea_field_type,
                        "options": f.options,
                        "translations": f.translations,
                    },
                    action="create",
                )
            )

    for rt in snapshot.metamodel_relation_types:
        if not rt.is_custom:
            continue
        # Skip relation type names already covered by the static
        # ``LX_TO_TEA_RELATION`` map (xlsx-style + GraphQL-style) — those
        # route to a built-in Turbo EA edge and don't need a new
        # relation_type row.
        if rt.name in LX_TO_TEA_RELATION:
            continue
        # Translate LX fact-sheet type names on the endpoints to Turbo
        # EA card-type keys. For LeanIX core types ``LX_TO_TEA_TYPE``
        # has the answer (``UserGroup`` → ``Organization``,
        # ``Project`` → ``Initiative``); for tenant-custom types the
        # xlsx-parser-synthesized name is also the key the
        # ``metamodel_type`` apply pass will use, so passing the LX
        # name through directly is correct.
        src_key = LX_TO_TEA_TYPE.get(rt.source_type, rt.source_type)
        tgt_key = LX_TO_TEA_TYPE.get(rt.target_type, rt.target_type)
        stats["new_relation_types"] += 1
        db.add(
            LeanixStagedRecord(
                id=uuid.uuid4(),
                migration_id=migration.id,
                entity_kind="metamodel_relation_type",
                leanix_id=rt.name,
                leanix_data={
                    "lx_name": rt.name,
                    "label": rt.label or rt.name,
                    "from_type": src_key,
                    "to_type": tgt_key,
                    "attributes_schema": rt.attributes_schema,
                },
                action="create",
            )
        )

    await db.flush()
    return stats
