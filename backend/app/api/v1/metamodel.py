from __future__ import annotations

import copy
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.card_type import CardType
from app.models.compliance_regulation import ComplianceRegulation
from app.models.ea_principle import EAPrinciple
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.resource_type import ResourceType
from app.models.stakeholder import Stakeholder
from app.models.user import User
from app.services.extensions.registry import extension_registry
from app.services.hierarchy import (
    HIERARCHY_LEVEL_KEY,
    backfill_hierarchy_levels_for_type,
    hierarchy_level_field_def,
)
from app.services.permission_service import PermissionService

logger = logging.getLogger("turboea.metamodel")

router = APIRouter(prefix="/metamodel", tags=["metamodel"])


def _scoring_signature(fields_schema: list | None, section_config: dict | None) -> dict:
    """Capture the data-quality-relevant config of a card type.

    Used to detect when an admin edit changes how scores are computed (field
    weights or the built-in contributor weights) so existing cards can be
    re-scored. Label/icon/order edits leave this signature unchanged.
    """
    field_weights: dict[str, float] = {}
    for section in fields_schema or []:
        for field in section.get("fields", []):
            if "key" in field:
                field_weights[field["key"]] = field.get("weight", 1)
    dq_cfg = (section_config or {}).get("__dataQuality") or {}
    return {"fields": field_weights, "dq": dq_cfg}


# ── Extension-gated field capabilities ─────────────────────────────────
#
# Two advanced field-authoring capabilities ship as INERT core plumbing: the
# schema understands them and the card detail renders them unconditionally, but
# an admin can only *author* them when an installed, enabled, licensed extension
# grants the matching capability (see registry.grants_for). This is the
# monetisation boundary — the free core never exposes a UI to create these, and
# the API strips any attempt to add them without the grant. Rendering is never
# gated (a licence lapse must never blank a card or delete data), and existing
# values are grandfathered so a lapse can't block unrelated metamodel edits.
CAP_FIELD_HELP = "metamodel.field_help"
CAP_CUSTOM_FIELD_TYPES = "metamodel.custom_field_types"
_BUILTIN_FIELD_TYPES = frozenset(
    {
        "text",
        "multiline_text",
        "number",
        "cost",
        "boolean",
        "date",
        "url",
        "single_select",
        "multiple_select",
    }
)


def _enforce_field_gating(
    new_schema: list | None, old_schema: list | None, granted: set[str]
) -> list:
    """Drop gated field attributes (help text, custom ``ext.*`` types) unless an
    extension grants them. Grandfathers already-stored values verbatim so a
    lapse never mutates card data or blocks an unrelated edit."""
    new_schema = new_schema or []
    help_granted = CAP_FIELD_HELP in granted
    custom_granted = CAP_CUSTOM_FIELD_TYPES in granted
    if help_granted and custom_granted:
        return new_schema

    old_fields: dict[str, dict] = {}
    for section in old_schema or []:
        for f in section.get("fields", []) if isinstance(section, dict) else []:
            if isinstance(f, dict) and "key" in f:
                old_fields[f["key"]] = f

    for section in new_schema:
        if not isinstance(section, dict):
            continue
        for f in section.get("fields", []):
            if not isinstance(f, dict):
                continue
            old = old_fields.get(f.get("key")) or {}
            if not help_granted:
                # Grandfather only the exact stored help; drop anything new/changed.
                for attr in ("help", "helpTranslations"):
                    if f.get(attr) != old.get(attr):
                        if old.get(attr) is None:
                            f.pop(attr, None)
                        else:
                            f[attr] = old[attr]
            if not custom_granted:
                ftype = f.get("type")
                if isinstance(ftype, str) and ftype.startswith("ext."):
                    old_type = old.get("type")
                    if old_type == ftype:
                        continue  # grandfather an already-stored custom type
                    f["type"] = old_type if old_type in _BUILTIN_FIELD_TYPES else "text"
    return new_schema


# ── Helpers ────────────────────────────────────────────────────────────


def _serialize_type(t: CardType) -> dict:
    return {
        "key": t.key,
        "label": t.label,
        "description": t.description,
        "icon": t.icon,
        "color": t.color,
        "category": t.category,
        "has_hierarchy": t.has_hierarchy,
        "has_successors": t.has_successors,
        "subtypes": t.subtypes or [],
        "fields_schema": t.fields_schema or [],
        "stakeholder_roles": t.stakeholder_roles or [],
        "section_config": t.section_config or {},
        "built_in": t.built_in,
        "is_hidden": t.is_hidden,
        "sort_order": t.sort_order,
        "translations": t.translations or {},
    }


def _serialize_relation_type(r: RelationType) -> dict:
    return {
        "key": r.key,
        "label": r.label,
        "reverse_label": r.reverse_label,
        "description": r.description,
        "source_type_key": r.source_type_key,
        "target_type_key": r.target_type_key,
        "cardinality": r.cardinality,
        "attributes_schema": r.attributes_schema or [],
        "built_in": r.built_in,
        "is_hidden": r.is_hidden,
        "sort_order": r.sort_order,
        "translations": r.translations or {},
        "source_visible": r.source_visible,
        "source_mandatory": r.source_mandatory,
        "target_visible": r.target_visible,
        "target_mandatory": r.target_mandatory,
    }


# Fields of a built-in attribute *definition* (field or option) that admins may
# never change. ``hidden`` is intentionally excluded — built-in values are
# locked-but-hideable.
_LOCKED_OPTION_FIELDS = ("key", "label", "color", "type", "translations", "options")


def _sanitize_relation_attribute_schema(schema: object) -> list[dict]:
    """Force ``built_in=False`` on anything a client submits.

    A client must never be able to *mint* a built-in field/option (which would
    make it un-editable to everyone else). Used on create and as the baseline
    normaliser on update for non-built-in entries.
    """
    out: list[dict] = []
    for field in schema if isinstance(schema, list) else []:
        if not isinstance(field, dict):
            continue
        f = dict(field)
        f["built_in"] = False
        opts = f.get("options")
        if isinstance(opts, list):
            f["options"] = [{**o, "built_in": False} for o in opts if isinstance(o, dict)]
        out.append(f)
    return out


def _merge_relation_attributes_schema(existing: object, incoming: object) -> list[dict]:
    """Validate + merge an incoming ``attributes_schema`` against the stored one.

    Built-in fields and options (``built_in=True`` on the stored entry) are
    locked-but-hideable: they must remain present and unchanged except their
    ``hidden`` flag may flip. Custom entries are fully editable, and any entry
    that does not match a stored built-in key is forced ``built_in=False`` so a
    client can never escalate a custom value into a locked one.

    Raises ``HTTPException(403)`` when a built-in field/option is removed or its
    locked attributes are mutated.
    """
    existing_list = existing if isinstance(existing, list) else []
    incoming_list = incoming if isinstance(incoming, list) else []

    existing_fields = {
        f["key"]: f
        for f in existing_list
        if isinstance(f, dict) and f.get("built_in") and "key" in f
    }

    incoming_by_key = {f["key"]: f for f in incoming_list if isinstance(f, dict) and "key" in f}

    # Every built-in field must survive the edit.
    for fkey in existing_fields:
        if fkey not in incoming_by_key:
            raise HTTPException(403, f"Built-in relation attribute '{fkey}' cannot be removed.")

    merged: list[dict] = []
    for field in incoming_list:
        if not isinstance(field, dict) or "key" not in field:
            continue
        base = existing_fields.get(field["key"])
        if base is None:
            # Custom field — fully editable, but normalise built_in to False.
            f = dict(field)
            f["built_in"] = False
            opts = f.get("options")
            if isinstance(opts, list):
                f["options"] = [{**o, "built_in": False} for o in opts if isinstance(o, dict)]
            merged.append(f)
            continue

        # Built-in field: locked definition; only options + hidden may evolve.
        for attr in _LOCKED_OPTION_FIELDS:
            if attr == "options":
                continue
            if field.get(attr) != base.get(attr):
                raise HTTPException(
                    403,
                    f"Built-in relation attribute '{field['key']}' cannot be edited.",
                )
        f = dict(base)
        f["built_in"] = True
        merged.append(_merge_field_options(base, field, f))

    return merged


def _merge_field_options(base_field: dict, incoming_field: dict, target: dict) -> dict:
    """Merge option lists for a built-in field: built-in options locked-but-
    hideable, custom options free, new options forced ``built_in=False``."""
    base_opts = {
        o["key"]: o
        for o in base_field.get("options", []) or []
        if isinstance(o, dict) and o.get("built_in") and "key" in o
    }
    incoming_opts = incoming_field.get("options") or []
    incoming_keys = {o["key"] for o in incoming_opts if isinstance(o, dict) and "key" in o}

    for okey in base_opts:
        if okey not in incoming_keys:
            raise HTTPException(
                403,
                f"Built-in relation value '{okey}' cannot be removed (hide it instead).",
            )

    merged_opts: list[dict] = []
    for opt in incoming_opts:
        if not isinstance(opt, dict) or "key" not in opt:
            continue
        base_opt = base_opts.get(opt["key"])
        if base_opt is None:
            merged_opts.append({**opt, "built_in": False})
            continue
        # Built-in option: locked except `hidden`.
        for attr in ("key", "label", "color", "translations"):
            if opt.get(attr) != base_opt.get(attr):
                raise HTTPException(
                    403,
                    f"Built-in relation value '{opt['key']}' cannot be edited (hide it instead).",
                )
        merged_opts.append({**base_opt, "built_in": True, "hidden": bool(opt.get("hidden", False))})

    target["options"] = merged_opts
    return target


async def _cleanup_removed_fields_and_options(
    db: AsyncSession,
    type_key: str,
    old_schema: list[dict],
    new_schema: list[dict],
) -> None:
    """Clean up card attribute data when fields or options are removed.

    - Removed fields: strip the key from attributes JSONB on all cards of this type.
    - Removed options on single_select: set the value to null.
    - Removed options on multiple_select: filter the value out of the array.
    """
    # Build lookup: field_key -> field definition
    old_fields: dict[str, dict] = {}
    for section in old_schema:
        for f in section.get("fields", []):
            old_fields[f["key"]] = f

    new_fields: dict[str, dict] = {}
    for section in new_schema:
        for f in section.get("fields", []):
            new_fields[f["key"]] = f

    # 1) Removed fields — delete the key from attributes JSONB.
    #    Extension-contributed fields (stamped ``ext``) are exempt: an
    #    extension's disable/uninstall path removes them from the schema *while
    #    preserving the stored values* (see field_contributions.remove_field_
    #    contributions), and a manual metamodel edit that drops the field must
    #    honour the same contract rather than hard-deleting the data.
    removed_field_keys = set(old_fields.keys()) - set(new_fields.keys())
    for fk in removed_field_keys:
        if old_fields[fk].get("ext"):
            logger.info(
                "Skipping data cleanup for extension-owned field '%s' on type '%s' "
                "(values preserved for re-enable)",
                fk,
                type_key,
            )
            continue
        result = await db.execute(
            text(
                "UPDATE cards SET attributes = attributes - :field_key "
                "WHERE type = :type_key AND attributes ? :field_key"
            ),
            {"type_key": type_key, "field_key": fk},
        )
        if result.rowcount:
            logger.info(
                "Cleaned up removed field '%s' from %d card(s) of type '%s'",
                fk,
                result.rowcount,
                type_key,
            )

    # 2) Removed options — null out single_select, filter out multiple_select
    for fk, new_field in new_fields.items():
        old_field = old_fields.get(fk)
        if not old_field:
            continue  # new field, nothing to clean up
        field_type = old_field.get("type", "text")
        if field_type not in ("single_select", "multiple_select"):
            continue

        old_option_keys = {o["key"] for o in old_field.get("options", [])}
        new_option_keys = {o["key"] for o in new_field.get("options", [])}
        removed_opts = old_option_keys - new_option_keys
        if not removed_opts:
            continue

        for opt_key in removed_opts:
            if field_type == "single_select":
                # Set to null where the current value matches
                result = await db.execute(
                    text(
                        "UPDATE cards SET attributes = attributes - :field_key "
                        "WHERE type = :type_key AND attributes ->> :field_key = :opt_key"
                    ),
                    {"type_key": type_key, "field_key": fk, "opt_key": opt_key},
                )
            else:
                # multiple_select: remove the option from the array
                result = await db.execute(
                    text(
                        "UPDATE cards "
                        "SET attributes = jsonb_set("
                        "  attributes, ARRAY[:field_key],"
                        "  COALESCE("
                        "    (SELECT jsonb_agg(elem) "
                        "     FROM jsonb_array_elements("
                        "       attributes->:field_key) elem"
                        "     WHERE elem #>> '{}' != :opt_key),"
                        "    '[]'::jsonb"
                        "  )"
                        ") WHERE type = :type_key "
                        "AND attributes->:field_key "
                        "@> (:opt_json)::jsonb"
                    ),
                    {
                        "type_key": type_key,
                        "field_key": fk,
                        "opt_key": opt_key,
                        "opt_json": f'["{opt_key}"]',
                    },
                )
            if result.rowcount:
                logger.info(
                    "Cleaned up removed option '%s' from field '%s' on %d card(s) of type '%s'",
                    opt_key,
                    fk,
                    result.rowcount,
                    type_key,
                )


# ── Card Types ─────────────────────────────────────────────────────────


@router.get("/types")
async def list_types(
    include_hidden: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = select(CardType).order_by(CardType.sort_order)
    if not include_hidden:
        q = q.where(CardType.is_hidden == False)  # noqa: E712
    result = await db.execute(q)
    return [_serialize_type(t) for t in result.scalars().all()]


@router.get("/types/{key}")
async def get_type(
    key: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    result = await db.execute(select(CardType).where(CardType.key == key))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Card type not found")
    return _serialize_type(t)


@router.get("/types/{key}/field-usage")
async def get_field_usage(
    key: str,
    field_key: str = Query(..., description="The field key to check"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return how many active cards have a non-null value for a given field."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(CardType).where(CardType.key == key))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Card type not found")

    count_result = await db.execute(
        select(func.count())
        .select_from(Card)
        .where(
            Card.type == key,
            Card.status == "ACTIVE",
            Card.attributes[field_key] != None,  # noqa: E711
        )
    )
    return {"field_key": field_key, "card_count": count_result.scalar() or 0}


@router.get("/types/{key}/section-usage")
async def get_section_usage(
    key: str,
    field_keys: str = Query(..., description="Comma-separated field keys in the section"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return how many active cards have data for any field in a section."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(CardType).where(CardType.key == key))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Card type not found")

    keys = [k.strip() for k in field_keys.split(",") if k.strip()]
    if not keys:
        return {"card_count": 0}

    conditions = [Card.attributes[fk] != None for fk in keys]  # noqa: E711
    count_result = await db.execute(
        select(func.count())
        .select_from(Card)
        .where(
            Card.type == key,
            Card.status == "ACTIVE",
            or_(*conditions),
        )
    )
    return {"card_count": count_result.scalar() or 0}


@router.get("/types/{key}/option-usage")
async def get_option_usage(
    key: str,
    field_key: str = Query(..., description="The field key"),
    option_key: str = Query(..., description="The option key to check"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return how many active cards use a specific option value."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(CardType).where(CardType.key == key))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Card type not found")

    # Determine the field type from the schema
    field_type = "single_select"
    for section in t.fields_schema or []:
        for f in section.get("fields", []):
            if f.get("key") == field_key:
                field_type = f.get("type", "single_select")
                break

    if field_type == "multiple_select":
        # JSONB array contains: attributes->'fieldKey' @> '["optionKey"]'
        count_result = await db.execute(
            text(
                "SELECT count(*) FROM cards "
                "WHERE type = :type_key AND status = 'ACTIVE' "
                "AND attributes->:field_key @> :option_json::jsonb"
            ),
            {
                "type_key": key,
                "field_key": field_key,
                "option_json": f'["{option_key}"]',
            },
        )
    else:
        # single_select: attributes->>'fieldKey' = 'optionKey'
        count_result = await db.execute(
            select(func.count())
            .select_from(Card)
            .where(
                Card.type == key,
                Card.status == "ACTIVE",
                Card.attributes[field_key].astext == option_key,
            )
        )

    return {
        "field_key": field_key,
        "option_key": option_key,
        "card_count": count_result.scalar() or 0,
    }


def _has_hierarchy_level_field(schema: list) -> bool:
    return any(
        isinstance(s, dict) and f.get("key") == HIERARCHY_LEVEL_KEY
        for s in (schema or [])
        for f in s.get("fields", [])
    )


def _inject_hierarchy_level_field(schema: list) -> list:
    """Return a copy of ``schema`` with the readonly ``hierarchyLevel`` field.

    No-op copy when a field keyed ``hierarchyLevel`` already exists anywhere
    (never hijack an admin-authored field). Appends to the first section,
    creating a ``General`` section when the schema is empty. Always returns a
    fresh list so a caller reassigning to a JSONB column triggers dirty tracking.
    """
    schema = copy.deepcopy(schema or [])
    if _has_hierarchy_level_field(schema):
        return schema
    if schema:
        schema[0].setdefault("fields", []).append(hierarchy_level_field_def())
    else:
        schema = [{"section": "General", "fields": [hierarchy_level_field_def()]}]
    return schema


def _remove_injected_hierarchy_level_field(schema: list) -> list:
    """Return a copy of ``schema`` without the auto-injected ``hierarchyLevel`` def.

    Only strips the injected shape (readonly number keyed ``hierarchyLevel``);
    leaves a non-matching admin-authored field alone and never touches stored
    card attribute values.
    """
    schema = copy.deepcopy(schema or [])
    for section in schema:
        if not isinstance(section, dict):
            continue
        section["fields"] = [
            f
            for f in section.get("fields", [])
            if not (
                f.get("key") == HIERARCHY_LEVEL_KEY
                and f.get("readonly")
                and f.get("type") == "number"
            )
        ]
    return schema


@router.post("/types", status_code=201)
async def create_type(
    body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    existing = await db.execute(select(CardType).where(CardType.key == body.get("key", "")))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Type key already exists")

    # Determine next sort_order
    max_order = await db.execute(select(func.max(CardType.sort_order)))
    next_order = (max_order.scalar() or 0) + 1

    default_roles = [
        {"key": "responsible", "label": "Responsible"},
        {"key": "observer", "label": "Observer"},
    ]
    await extension_registry.refresh_from_db(db)
    fields_schema = _enforce_field_gating(
        body.get("fields_schema", []), [], extension_registry.granted_capabilities()
    )
    # Auto-add the readonly hierarchyLevel field for hierarchical types (after
    # gating, which only strips help/ext.* fields — a plain number field is safe).
    if body.get("has_hierarchy"):
        fields_schema = _inject_hierarchy_level_field(fields_schema)
    t = CardType(
        key=body["key"],
        label=body["label"],
        description=body.get("description"),
        icon=body.get("icon", "category"),
        color=body.get("color", "#1976d2"),
        category=body.get("category"),
        has_hierarchy=body.get("has_hierarchy", False),
        has_successors=body.get("has_successors", False),
        subtypes=body.get("subtypes", []),
        fields_schema=fields_schema,
        stakeholder_roles=body.get("stakeholder_roles", default_roles),
        built_in=False,
        is_hidden=False,
        sort_order=body.get("sort_order", next_order),
        translations=body.get("translations", {}),
    )
    db.add(t)
    if t.has_successors:
        # Auto-provide the lineage relation type so the card detail lineage
        # section renders (issue #729).
        await _ensure_successor_relation_type(db, t.key)
    await db.commit()
    await db.refresh(t)
    return _serialize_type(t)


@router.patch("/types/{key}")
async def update_type(
    key: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(CardType).where(CardType.key == key))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Type not found")

    # Prevent removing stakeholder roles that are in use
    if "stakeholder_roles" in body:
        old_keys = {r["key"] for r in (t.stakeholder_roles or [])}
        new_keys = {r["key"] for r in (body["stakeholder_roles"] or [])}
        removed = old_keys - new_keys
        if removed:
            # Check if any stakeholders use the removed roles on cards of this type
            in_use = (
                await db.execute(
                    select(Stakeholder.role, func.count(Stakeholder.id))
                    .join(Card, Stakeholder.card_id == Card.id)
                    .where(Card.type == key, Stakeholder.role.in_(removed))
                    .group_by(Stakeholder.role)
                )
            ).all()
            if in_use:
                details = ", ".join(f"'{r}' ({c} stakeholder(s))" for r, c in in_use)
                raise HTTPException(
                    400,
                    f"Cannot remove roles that are in use: {details}. "
                    "Remove the stakeholder assignments first.",
                )

    # ── Clean up card attributes when fields or options are removed ──
    if "fields_schema" in body:
        await _cleanup_removed_fields_and_options(
            db,
            key,
            t.fields_schema or [],
            body["fields_schema"] or [],
        )
        # Strip extension-gated field attributes (help text, custom types) that
        # aren't unlocked by a licensed extension — grandfathering stored values.
        await extension_registry.refresh_from_db(db)
        body["fields_schema"] = _enforce_field_gating(
            body["fields_schema"] or [],
            t.fields_schema or [],
            extension_registry.granted_capabilities(),
        )

    # Snapshot the data-quality-relevant config so we can re-score existing
    # cards if (and only if) the admin changed field weights or the built-in
    # contributor weights.
    old_signature = _scoring_signature(t.fields_schema, t.section_config)
    old_has_hierarchy = t.has_hierarchy

    updatable = [
        "label",
        "description",
        "icon",
        "color",
        "category",
        "has_hierarchy",
        "has_successors",
        "subtypes",
        "fields_schema",
        "stakeholder_roles",
        "section_config",
        "sort_order",
        "is_hidden",
        "translations",
    ]
    for field in updatable:
        if field in body:
            setattr(t, field, body[field])

    # Auto-provide the self-referential lineage relation type whenever lineage is
    # enabled. Run unconditionally-when-true (idempotent, one indexed lookup) so it
    # also self-heals types already stuck in the issue #729 state — flag set, no
    # relation type — on their next save.
    if t.has_successors:
        await _ensure_successor_relation_type(db, t.key)

    # Keep the auto-injected hierarchyLevel field in sync with has_hierarchy.
    # Runs on the final merged state so it self-heals older hierarchical types
    # on any save (idempotent — same style as _ensure_successor_relation_type).
    if t.has_hierarchy:
        if not _has_hierarchy_level_field(t.fields_schema or []):
            t.fields_schema = _inject_hierarchy_level_field(t.fields_schema or [])
        if not old_has_hierarchy:
            # Newly hierarchical — backfill existing cards so the column/filter
            # is populated immediately instead of lazily per card edit.
            await backfill_hierarchy_levels_for_type(db, key)
    else:
        # Hierarchy disabled — drop the injected field def but KEEP card
        # attribute values (invisible without a def, meaningful again on re-enable).
        t.fields_schema = _remove_injected_hierarchy_level_field(t.fields_schema or [])

    await db.commit()
    await db.refresh(t)

    # Re-score existing cards when the scoring config actually changed, so
    # tuned data-quality weights take effect immediately instead of waiting
    # for each card to be edited.
    new_signature = _scoring_signature(t.fields_schema, t.section_config)
    if new_signature != old_signature:
        await _recompute_data_quality_for_type(db, key)

    return _serialize_type(t)


async def _recompute_data_quality_for_type(db: AsyncSession, type_key: str) -> None:
    """Recompute data_quality for every active card of a type after a config change."""
    from app.services.data_quality import calc_data_quality

    result = await db.execute(select(Card).where(Card.type == type_key, Card.status == "ACTIVE"))
    cards = result.scalars().all()
    changed = False
    for card in cards:
        score = await calc_data_quality(db, card)
        if card.data_quality != score:
            card.data_quality = score
            changed = True
    if changed:
        await db.commit()


@router.delete("/types/{key}")
async def delete_type(
    key: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(CardType).where(CardType.key == key))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Type not found")

    # Check for existing cards of this type
    count_result = await db.execute(select(func.count()).select_from(Card).where(Card.type == key))
    instance_count = count_result.scalar() or 0

    if t.built_in:
        # Soft-delete built-in types
        t.is_hidden = True
        await db.commit()
        return {"status": "hidden", "key": key, "instance_count": instance_count}

    if instance_count > 0:
        raise HTTPException(
            400,
            f"Cannot delete type '{key}': {instance_count} card(s) exist. "
            "Delete them first or hide the type instead.",
        )

    # Also delete relation types that reference this type
    await db.execute(
        select(RelationType).where(
            (RelationType.source_type_key == key) | (RelationType.target_type_key == key)
        )
    )
    rel_result = await db.execute(
        select(RelationType).where(
            (RelationType.source_type_key == key) | (RelationType.target_type_key == key)
        )
    )
    for rt in rel_result.scalars().all():
        await db.delete(rt)

    await db.delete(t)
    await db.commit()
    return {"status": "deleted", "key": key}


# ── Relation Types ─────────────────────────────────────────────────────

# Successor relations (key ends with "Successor") are a separate, UI-isolated
# category — see frontend RelationsSection/MetamodelGraph/MetamodelAdmin, which all
# filter on key.endsWith("Successor"). They are exempt from the one-relation-per-pair
# uniqueness rule so a custom self-relation can coexist with the built-in successor
# (mirrors the seeded BusinessProcess "depends on" + "succeeds" pair).
SUCCESSOR_KEY_SUFFIX = "Successor"

# Canonical label + i18n for an auto-provisioned successor (lineage) relation type.
# Mirrors the seeded built-in successors (e.g. ``relAppSuccessor`` in seed.py) so a
# relation type created when an admin enables "Supports Lineage" carries the same
# wording/translations as the built-ins. The English label is also injected into the
# translations dict to match the seed (see ``_inject_english_translations_relation``).
_SUCCESSOR_LABEL = "succeeds"
_SUCCESSOR_REVERSE_LABEL = "is preceded by"
_SUCCESSOR_TRANSLATIONS: dict = {
    "label": {
        "en": _SUCCESSOR_LABEL,
        "de": "folgt auf",
        "fr": "succède à",
        "es": "sucede a",
        "it": "succede a",
        "pt": "sucede a",
        "zh": "继承",
        "ru": "предшествует",
        "da": "efterfølger",
        "ar": "يخلف",
    },
    "reverse_label": {
        "en": _SUCCESSOR_REVERSE_LABEL,
        "de": "wird abgelöst durch",
        "fr": "est précédé par",
        "es": "es precedido por",
        "it": "è preceduto da",
        "pt": "é precedido por",
        "zh": "被继承",
        "ru": "следует за",
        "da": "efterfølges af",
        "ar": "مسبوق بـ",
    },
}


async def _ensure_successor_relation_type(db: AsyncSession, card_type_key: str) -> None:
    """Provision the self-referential ``rel{Key}Successor`` relation type that the card
    detail lineage section needs when "Supports Lineage" is enabled on a card type.

    Without this, enabling ``has_successors`` only flips the boolean and the frontend
    ``SuccessorsSection`` (which requires a non-hidden, self-referential relation type
    whose key ends in "Successor") renders nothing — see issue #729.

    Idempotent: returns early when a qualifying relation type already exists (covers the
    seeded built-ins and any prior auto-created one), un-hides an existing hidden one
    (re-enable case, preserving relation instances), and otherwise inserts a new one.
    The caller is responsible for committing.
    """
    # Already have a usable successor relation type for this self-pair? Nothing to do.
    existing = await db.execute(
        select(RelationType).where(
            RelationType.source_type_key == card_type_key,
            RelationType.target_type_key == card_type_key,
            RelationType.is_hidden == False,  # noqa: E712
            RelationType.key.endswith(SUCCESSOR_KEY_SUFFIX),
        )
    )
    if existing.scalar_one_or_none():
        return

    key = f"rel{card_type_key}{SUCCESSOR_KEY_SUFFIX}"

    # A row with the exact key may exist but be hidden (the admin disabled then
    # re-enabled lineage, or hid it manually) — un-hide instead of inserting, which
    # would violate the relation_types.key UNIQUE constraint.
    by_key = await db.execute(select(RelationType).where(RelationType.key == key))
    found = by_key.scalar_one_or_none()
    if found is not None:
        if found.is_hidden:
            found.is_hidden = False
        return

    max_order = await db.execute(select(func.max(RelationType.sort_order)))
    next_order = (max_order.scalar() or 0) + 1
    db.add(
        RelationType(
            key=key,
            label=_SUCCESSOR_LABEL,
            reverse_label=_SUCCESSOR_REVERSE_LABEL,
            source_type_key=card_type_key,
            target_type_key=card_type_key,
            cardinality="n:m",
            attributes_schema=[],
            built_in=False,
            is_hidden=False,
            sort_order=next_order,
            translations=_SUCCESSOR_TRANSLATIONS,
        )
    )


@router.get("/relation-types")
async def list_relation_types(
    type_key: str | None = Query(None, description="Filter relations connected to this type"),
    include_hidden: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = select(RelationType).order_by(RelationType.sort_order)
    if not include_hidden:
        q = q.where(RelationType.is_hidden == False)  # noqa: E712
    if type_key:
        q = q.where(
            (RelationType.source_type_key == type_key) | (RelationType.target_type_key == type_key)
        )
    result = await db.execute(q)
    return [_serialize_relation_type(r) for r in result.scalars().all()]


@router.get("/relation-types/{key}")
async def get_relation_type(
    key: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    result = await db.execute(select(RelationType).where(RelationType.key == key))
    r = result.scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Relation type not found")
    return _serialize_relation_type(r)


@router.post("/relation-types", status_code=201)
async def create_relation_type(
    body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    existing = await db.execute(select(RelationType).where(RelationType.key == body.get("key", "")))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Relation type key already exists")

    # Validate source and target types exist
    for fk in ("source_type_key", "target_type_key"):
        type_key = body.get(fk)
        if not type_key:
            raise HTTPException(400, f"{fk} is required")
        exists = await db.execute(select(CardType.key).where(CardType.key == type_key))
        if not exists.scalar_one_or_none():
            raise HTTPException(400, f"Type '{type_key}' does not exist")

    # Prevent duplicate source+target pair (ignore hidden/soft-deleted + successors)
    dup = await db.execute(
        select(RelationType).where(
            RelationType.source_type_key == body["source_type_key"],
            RelationType.target_type_key == body["target_type_key"],
            RelationType.is_hidden == False,  # noqa: E712
            ~RelationType.key.endswith(SUCCESSOR_KEY_SUFFIX),
        )
    )
    if dup.scalar_one_or_none():
        raise HTTPException(
            400,
            f"A relation type from '{body['source_type_key']}' to "
            f"'{body['target_type_key']}' already exists.",
        )

    max_order = await db.execute(select(func.max(RelationType.sort_order)))
    next_order = (max_order.scalar() or 0) + 1

    rt = RelationType(
        key=body["key"],
        label=body["label"],
        reverse_label=body.get("reverse_label"),
        description=body.get("description"),
        source_type_key=body["source_type_key"],
        target_type_key=body["target_type_key"],
        cardinality=body.get("cardinality", "n:m"),
        attributes_schema=_sanitize_relation_attribute_schema(body.get("attributes_schema", [])),
        built_in=False,
        is_hidden=False,
        sort_order=body.get("sort_order", next_order),
        translations=body.get("translations", {}),
        source_visible=body.get("source_visible", True),
        source_mandatory=body.get("source_mandatory", False),
        target_visible=body.get("target_visible", True),
        target_mandatory=body.get("target_mandatory", False),
    )
    db.add(rt)
    await db.commit()
    await db.refresh(rt)
    return _serialize_relation_type(rt)


@router.patch("/relation-types/{key}")
async def update_relation_type(
    key: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(RelationType).where(RelationType.key == key))
    r = result.scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Relation type not found")

    # Allow changing source/target only when no instances exist
    changing_endpoints = (
        "source_type_key" in body and body["source_type_key"] != r.source_type_key
    ) or ("target_type_key" in body and body["target_type_key"] != r.target_type_key)
    if changing_endpoints:
        count_result = await db.execute(
            select(func.count()).select_from(Relation).where(Relation.type == key)
        )
        if (count_result.scalar() or 0) > 0:
            raise HTTPException(
                400,
                "Cannot change source/target types: relation instances exist. Delete them first.",
            )
        # Validate new types exist
        for fk in ("source_type_key", "target_type_key"):
            if fk in body:
                exists = await db.execute(select(CardType.key).where(CardType.key == body[fk]))
                if not exists.scalar_one_or_none():
                    raise HTTPException(400, f"Type '{body[fk]}' does not exist")
        # Check for duplicate source+target
        new_src = body.get("source_type_key", r.source_type_key)
        new_tgt = body.get("target_type_key", r.target_type_key)
        dup = await db.execute(
            select(RelationType).where(
                RelationType.source_type_key == new_src,
                RelationType.target_type_key == new_tgt,
                RelationType.key != key,
                RelationType.is_hidden == False,  # noqa: E712
                ~RelationType.key.endswith(SUCCESSOR_KEY_SUFFIX),
            )
        )
        if dup.scalar_one_or_none():
            raise HTTPException(
                400,
                f"A relation type from '{new_src}' to '{new_tgt}' already exists.",
            )

    updatable = [
        "label",
        "reverse_label",
        "description",
        "cardinality",
        "attributes_schema",
        "sort_order",
        "is_hidden",
        "source_type_key",
        "target_type_key",
        "translations",
        "source_visible",
        "source_mandatory",
        "target_visible",
        "target_mandatory",
    ]
    for field in updatable:
        if field not in body:
            continue
        if field == "attributes_schema":
            # Built-in attribute fields/options are locked-but-hideable; custom
            # ones are free. Validates + sanitizes (raises 403 on locked edits).
            r.attributes_schema = _merge_relation_attributes_schema(
                r.attributes_schema or [], body["attributes_schema"]
            )
        else:
            setattr(r, field, body[field])

    await db.commit()
    await db.refresh(r)
    return _serialize_relation_type(r)


@router.get("/relation-types/{key}/instance-count")
async def get_relation_type_instance_count(
    key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return the number of relation instances using this relation type."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(RelationType).where(RelationType.key == key))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Relation type not found")
    count_result = await db.execute(
        select(func.count()).select_from(Relation).where(Relation.type == key)
    )
    return {"key": key, "instance_count": count_result.scalar() or 0}


@router.delete("/relation-types/{key}")
async def delete_relation_type(
    key: str,
    force: bool = Query(False, description="Force-delete even with existing instances"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(RelationType).where(RelationType.key == key))
    r = result.scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Relation type not found")

    # Check for existing relation instances
    count_result = await db.execute(
        select(func.count()).select_from(Relation).where(Relation.type == key)
    )
    instance_count = count_result.scalar() or 0

    if instance_count > 0 and not force:
        raise HTTPException(
            409,
            detail={
                "message": f"Relation type '{key}' has {instance_count} relation instance(s). "
                "Deleting it will remove all of them.",
                "instance_count": instance_count,
                "key": key,
            },
        )

    # Delete all relation instances first
    if instance_count > 0:
        await db.execute(Relation.__table__.delete().where(Relation.type == key))

    if r.built_in:
        # Soft-delete built-in types so they can be restored from the seed
        r.is_hidden = True
        await db.commit()
        return {"status": "hidden", "key": key, "instances_removed": instance_count}

    await db.delete(r)
    await db.commit()
    return {"status": "deleted", "key": key, "instances_removed": instance_count}


@router.post("/relation-types/{key}/restore")
async def restore_relation_type(
    key: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """Restore a soft-deleted (hidden) built-in relation type."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(RelationType).where(RelationType.key == key))
    r = result.scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Relation type not found")
    if not r.is_hidden:
        raise HTTPException(400, "Relation type is not hidden")

    # Check for duplicate source+target before restoring
    dup = await db.execute(
        select(RelationType).where(
            RelationType.source_type_key == r.source_type_key,
            RelationType.target_type_key == r.target_type_key,
            RelationType.key != key,
            RelationType.is_hidden == False,  # noqa: E712
            ~RelationType.key.endswith(SUCCESSOR_KEY_SUFFIX),
        )
    )
    if dup.scalar_one_or_none():
        raise HTTPException(
            400,
            f"Cannot restore: a relation type from '{r.source_type_key}' to "
            f"'{r.target_type_key}' already exists.",
        )

    r.is_hidden = False
    await db.commit()
    await db.refresh(r)
    return _serialize_relation_type(r)


# ── EA Principles ─────────────────────────────────────────────────────


class PrincipleCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    description: str | None = None
    rationale: str | None = None
    implications: str | None = None
    is_active: bool = True
    sort_order: int = 0


class PrincipleUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    rationale: str | None = None
    implications: str | None = None
    is_active: bool | None = None
    sort_order: int | None = None


def _serialize_principle(p: EAPrinciple) -> dict:
    return {
        "id": str(p.id),
        "title": p.title,
        "description": p.description,
        "rationale": p.rationale,
        "implications": p.implications,
        "is_active": p.is_active,
        "sort_order": p.sort_order,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


@router.get("/principles")
async def list_principles(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all EA principles ordered by sort_order."""
    result = await db.execute(
        select(EAPrinciple).order_by(EAPrinciple.sort_order, EAPrinciple.created_at)
    )
    return [_serialize_principle(p) for p in result.scalars().all()]


@router.post("/principles", status_code=201)
async def create_principle(
    body: PrincipleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new EA principle (admin only)."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    p = EAPrinciple(
        id=uuid.uuid4(),
        title=body.title,
        description=body.description,
        rationale=body.rationale,
        implications=body.implications,
        is_active=body.is_active,
        sort_order=body.sort_order,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return _serialize_principle(p)


@router.patch("/principles/{principle_id}")
async def update_principle(
    principle_id: str,
    body: PrincipleUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update an EA principle (admin only)."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(EAPrinciple).where(EAPrinciple.id == uuid.UUID(principle_id)))
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Principle not found")
    updates = body.model_dump(exclude_unset=True)
    for k, v in updates.items():
        setattr(p, k, v)
    await db.commit()
    await db.refresh(p)
    return _serialize_principle(p)


@router.delete("/principles/{principle_id}", status_code=204)
async def delete_principle(
    principle_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete an EA principle (admin only)."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    await db.execute(delete(EAPrinciple).where(EAPrinciple.id == uuid.UUID(principle_id)))
    await db.commit()


# ── Compliance Regulations ────────────────────────────────────────────


class ComplianceRegulationCreate(BaseModel):
    key: str = Field(..., min_length=1, max_length=100)
    label: str = Field(..., min_length=1, max_length=300)
    description: str | None = None
    is_enabled: bool = True
    sort_order: int = 0
    translations: dict[str, str] | None = None


class ComplianceRegulationUpdate(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=300)
    description: str | None = None
    is_enabled: bool | None = None
    sort_order: int | None = None
    translations: dict[str, str] | None = None


def _serialize_regulation(r: ComplianceRegulation) -> dict:
    return {
        "id": str(r.id),
        "key": r.key,
        "label": r.label,
        "description": r.description,
        "is_enabled": r.is_enabled,
        "built_in": r.built_in,
        "sort_order": r.sort_order,
        "translations": r.translations or {},
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


@router.get("/compliance-regulations")
async def list_compliance_regulations(
    enabled_only: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List compliance regulations, ordered by sort_order.

    Authenticated read so the TurboLens Security tab can fetch the list
    even for users without admin rights. Write operations remain gated
    behind ``admin.metamodel``.
    """
    stmt = select(ComplianceRegulation)
    if enabled_only:
        stmt = stmt.where(ComplianceRegulation.is_enabled == True)  # noqa: E712
    stmt = stmt.order_by(ComplianceRegulation.sort_order, ComplianceRegulation.label)
    result = await db.execute(stmt)
    return [_serialize_regulation(r) for r in result.scalars().all()]


@router.post("/compliance-regulations", status_code=201)
async def create_compliance_regulation(
    body: ComplianceRegulationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new compliance regulation (admin only)."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    key = body.key.strip().lower()
    if not key:
        raise HTTPException(400, "key is required")
    existing = await db.execute(select(ComplianceRegulation).where(ComplianceRegulation.key == key))
    if existing.scalar_one_or_none():
        raise HTTPException(400, f"A regulation with key '{key}' already exists")
    r = ComplianceRegulation(
        id=uuid.uuid4(),
        key=key,
        label=body.label.strip(),
        description=body.description,
        is_enabled=body.is_enabled,
        built_in=False,
        sort_order=body.sort_order,
        translations=body.translations or {},
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return _serialize_regulation(r)


@router.patch("/compliance-regulations/{regulation_id}")
async def update_compliance_regulation(
    regulation_id: str,
    body: ComplianceRegulationUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update a compliance regulation (admin only).

    The ``key`` is immutable. ``built_in`` regulations can be edited and
    disabled but never deleted.
    """
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(
        select(ComplianceRegulation).where(ComplianceRegulation.id == uuid.UUID(regulation_id))
    )
    r = result.scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Regulation not found")
    updates = body.model_dump(exclude_unset=True)
    if "label" in updates and updates["label"] is not None:
        updates["label"] = updates["label"].strip()
    if "translations" in updates and updates["translations"] is None:
        updates["translations"] = {}
    for k, v in updates.items():
        setattr(r, k, v)
    await db.commit()
    await db.refresh(r)
    return _serialize_regulation(r)


@router.delete("/compliance-regulations/{regulation_id}", status_code=204)
async def delete_compliance_regulation(
    regulation_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a compliance regulation (admin only).

    Built-in regulations are protected — they can be disabled but not
    hard-deleted, mirroring the built-in CardType pattern.
    """
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(
        select(ComplianceRegulation).where(ComplianceRegulation.id == uuid.UUID(regulation_id))
    )
    r = result.scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Regulation not found")
    if r.built_in:
        raise HTTPException(
            400,
            "Built-in regulations cannot be deleted — toggle is_enabled to disable instead.",
        )
    await db.delete(r)
    await db.commit()


# ── Resource Types (link types & file categories) ─────────────────────

_RESOURCE_KINDS = ("link_type", "file_category")


class ResourceTypeCreate(BaseModel):
    kind: str = Field(..., min_length=1, max_length=20)
    key: str = Field(..., min_length=1, max_length=100)
    label: str = Field(..., min_length=1, max_length=300)
    description: str | None = None
    icon: str | None = Field(None, max_length=100)
    is_enabled: bool = True
    sort_order: int = 0
    translations: dict[str, str] | None = None


class ResourceTypeUpdate(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=300)
    description: str | None = None
    icon: str | None = Field(None, max_length=100)
    is_enabled: bool | None = None
    sort_order: int | None = None
    translations: dict[str, str] | None = None


def _serialize_resource_type(r: ResourceType) -> dict:
    return {
        "id": str(r.id),
        "kind": r.kind,
        "key": r.key,
        "label": r.label,
        "description": r.description,
        "icon": r.icon,
        "is_enabled": r.is_enabled,
        "built_in": r.built_in,
        "sort_order": r.sort_order,
        "translations": r.translations or {},
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


@router.get("/resource-types")
async def list_resource_types(
    kind: str | None = None,
    enabled_only: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List resource types (link types & file categories).

    Authenticated read so the card Resources tab can fetch the lists for
    any user. Write operations remain gated behind ``admin.metamodel``.
    """
    stmt = select(ResourceType)
    if kind:
        stmt = stmt.where(ResourceType.kind == kind)
    if enabled_only:
        stmt = stmt.where(ResourceType.is_enabled == True)  # noqa: E712
    stmt = stmt.order_by(ResourceType.kind, ResourceType.sort_order, ResourceType.label)
    result = await db.execute(stmt)
    return [_serialize_resource_type(r) for r in result.scalars().all()]


@router.post("/resource-types", status_code=201)
async def create_resource_type(
    body: ResourceTypeCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new resource type (admin only)."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    kind = body.kind.strip()
    if kind not in _RESOURCE_KINDS:
        raise HTTPException(400, f"kind must be one of {_RESOURCE_KINDS}")
    key = body.key.strip().lower()
    if not key:
        raise HTTPException(400, "key is required")
    existing = await db.execute(
        select(ResourceType).where(ResourceType.kind == kind, ResourceType.key == key)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, f"A {kind} with key '{key}' already exists")
    r = ResourceType(
        id=uuid.uuid4(),
        kind=kind,
        key=key,
        label=body.label.strip(),
        description=body.description,
        icon=(body.icon or None),
        is_enabled=body.is_enabled,
        built_in=False,
        sort_order=body.sort_order,
        translations=body.translations or {},
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return _serialize_resource_type(r)


@router.patch("/resource-types/{resource_type_id}")
async def update_resource_type(
    resource_type_id: str,
    body: ResourceTypeUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update a resource type (admin only).

    ``kind`` and ``key`` are immutable. ``built_in`` rows can be edited and
    disabled but never deleted.
    """
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(
        select(ResourceType).where(ResourceType.id == uuid.UUID(resource_type_id))
    )
    r = result.scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Resource type not found")
    updates = body.model_dump(exclude_unset=True)
    if "label" in updates and updates["label"] is not None:
        updates["label"] = updates["label"].strip()
    if "translations" in updates and updates["translations"] is None:
        updates["translations"] = {}
    for k, v in updates.items():
        setattr(r, k, v)
    await db.commit()
    await db.refresh(r)
    return _serialize_resource_type(r)


@router.delete("/resource-types/{resource_type_id}", status_code=204)
async def delete_resource_type(
    resource_type_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a resource type (admin only).

    Built-in rows are protected — they can be disabled but not hard-deleted.
    """
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(
        select(ResourceType).where(ResourceType.id == uuid.UUID(resource_type_id))
    )
    r = result.scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Resource type not found")
    if r.built_in:
        raise HTTPException(
            400,
            "Built-in resource types cannot be deleted — toggle is_enabled to disable instead.",
        )
    await db.delete(r)
    await db.commit()
