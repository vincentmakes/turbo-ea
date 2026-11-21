from __future__ import annotations

import copy
import logging
import re
import uuid
from dataclasses import asdict
from xml.etree.ElementTree import ParseError

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import Text, delete, func, literal, or_, select, update
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.permissions import (
    APP_PERMISSIONS,
    TYPE_SCOPED_APP_PERMISSIONS,
    validate_type_role_permissions,
)
from app.database import get_db
from app.models.archimate_viewpoint import (
    ArchimateViewpoint,
    ArchimateViewpointExample,
    ArchimateViewpointObject,
    ArchimateViewpointTabCard,
)
from app.models.card import Card
from app.models.card_type import CardType
from app.models.card_type_category import CardTypeCategory
from app.models.compliance_regulation import ComplianceRegulation
from app.models.diagram import Diagram
from app.models.ea_principle import EAPrinciple
from app.models.enterprise_object import EnterpriseObject, EnterpriseObjectCardMapping
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.resource_type import ResourceType
from app.models.role import Role
from app.models.stakeholder import Stakeholder
from app.models.user import User
from app.schemas.principle import (
    PrincipleImportRequest,
    PrincipleImportResponse,
    PrincipleImportResult,
)
from app.services import (
    audit_changes,
    audit_labels,
    audit_log,
    card_reference,
    card_type_categories,
    card_type_delete,
    principle_service,
)
from app.services.archimate import taxonomy
from app.services.archimate.archi_native_import import convert_archi_native_to_exchange
from app.services.archimate.card_type_mapping import get_card_type_mapping
from app.services.archimate.taxonomy import TAB_LAYERS
from app.services.archimate.validate import MAX_XML_BYTES, validate_exchange
from app.services.card_costs import COST_ITEM_TYPES, DERIVED_KEY
from app.services.extensions import contribution_guard, field_gate
from app.services.extensions.registry import extension_registry
from app.services.hierarchy import (
    HIERARCHY_LEVEL_KEY,
    backfill_hierarchy_levels_for_type,
    hierarchy_level_field_def,
)
from app.services.permission_service import PermissionService
from app.services.relation_orientation import side_key
from app.services.seed import (
    DEFAULT_TYPE_COLORS,
    SUCCESSOR_LABEL,
    SUCCESSOR_REVERSE_LABEL,
    SUCCESSOR_TRANSLATIONS,
    _inject_english_translations_relation,
)

logger = logging.getLogger("turboea.metamodel")

router = APIRouter(prefix="/metamodel", tags=["metamodel"])

_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


# ── Security & admin audit log ─────────────────────────────────────────
#
# Every metamodel write records one ``admin.*`` row (``services/audit_log``),
# readable without knowing the metamodel: plain columns as ``changes``
# (``audit_log.diff``), and the big JSON columns — a type's ``fields_schema``
# can run to hundreds of fields — as semantic change items
# (``services/audit_changes``): *field "Cost" added to section "Finance"*,
# *option "Legacy" renamed*, *Member: View → Deny*. Values are labels, never
# keys. An update that changed nothing records nothing.

_TYPE_AUDIT_SCALARS = (
    "label",
    "description",
    "icon",
    "color",
    "category",
    "has_hierarchy",
    "has_successors",
    "allow_card_logo",
    "sort_order",
    "is_hidden",
)
_TYPE_AUDIT_JSON = (
    "reference_config",
    "subtypes",
    "hierarchy_labels",
    "fields_schema",
    "stakeholder_roles",
    "section_config",
    "translations",
    "role_permissions",
)
_REFERENCE_AUDIT_KEYS = ("mode", "prefix", "start", "padding")
_RELATION_TYPE_AUDIT_SCALARS = (
    "label",
    "reverse_label",
    "description",
    "cardinality",
    "sort_order",
    "is_hidden",
    "source_visible",
    "source_mandatory",
    "target_visible",
    "target_mandatory",
)
_RELATION_TYPE_AUDIT_JSON = (
    "source_type_key",
    "target_type_key",
    "attributes_schema",
    "translations",
)

# The long free-text columns of a principle, clipped on each side so one edit
# of a page-long rationale cannot make an audit row arbitrarily large.
_PRINCIPLE_TEXT_FIELDS = ("description", "rationale", "implications")
# The plain columns of a compliance regulation / resource type; their
# ``translations`` (``{locale: label}``) are reported as items instead.
_CATALOGUE_AUDIT_SCALARS = ("label", "description", "is_enabled", "sort_order")
_RESOURCE_TYPE_AUDIT_SCALARS = ("label", "description", "icon", "is_enabled", "sort_order")
_CATEGORY_AUDIT_SCALARS = ("label", "color", "sort_order")


def _audit_snapshot(obj: object, fields: tuple[str, ...]) -> dict:
    """A detached copy of ``fields`` so a later in-place edit cannot alter it."""
    return {f: copy.deepcopy(getattr(obj, f, None)) for f in fields}


def _section_names(fields_schema: object) -> list:
    """The custom section names of a ``fields_schema``, in order — what
    ``custom:N`` in ``section_config.__order`` indexes into. That index skips
    the ``__description`` pseudo-section (it renders inside Description, not as
    a section of its own), exactly as ``customSectionsOf`` on the frontend and
    ``_reindexed_config`` in ``services/extensions/field_contributions``."""
    sections = fields_schema if isinstance(fields_schema, list) else []
    return [
        s.get("section")
        for s in sections
        if isinstance(s, dict) and s.get("section") != "__description"
    ]


def _field_labels(*fields_schemas: object) -> dict[str, str]:
    """``{field key: label}`` across ``fields_schemas``; the first schema that
    labels a key wins (pass the after-side first so a renamed field reads under
    its new label)."""
    out: dict[str, str] = {}
    for schema in fields_schemas:
        for section in schema if isinstance(schema, list) else []:
            if not isinstance(section, dict):
                continue
            for field in section.get("fields") or []:
                if isinstance(field, dict) and field.get("key") and field.get("label"):
                    out.setdefault(field["key"], field["label"])
    return out


def _labelled_hidden_fields(items: list, field_labels: dict[str, str]) -> list:
    """``items`` with each ``subtype.changed`` ``hidden_fields`` side mapped from
    field keys to field labels (an absent list read as empty); an item whose
    sides then agree — absent vs. ``[]`` — is dropped as no change."""
    return _labelled_subtype_list(items, "hidden_fields", field_labels)


def _optional_relations_changed(before: object, after: object) -> bool:
    """Did any subtype's ``optional_relations`` move? Gates the label query."""

    def by_key(subtypes: object) -> dict:
        return {
            st.get("key"): st.get("optional_relations") or []
            for st in (subtypes if isinstance(subtypes, list) else [])
            if isinstance(st, dict)
        }

    return by_key(before) != by_key(after)


def _relation_side_labels(
    relation_types: list, type_key: str, type_labels: dict[str, str]
) -> dict[str, str]:
    """``{side key: "verb → other type"}`` for every side of ``relation_types``
    a card of ``type_key`` sits on — how a subtype's ``optional_relations``
    (#1296) reads in the Security & admin log. The verb is read from this
    type's side, the same words the subtype dialog shows."""
    out: dict[str, str] = {}
    for rt in relation_types:
        if rt.source_type_key == type_key:
            other = type_labels.get(rt.target_type_key, rt.target_type_key)
            out[side_key(rt, True)] = f"{rt.label} → {other}"
        if rt.target_type_key == type_key:
            other = type_labels.get(rt.source_type_key, rt.source_type_key)
            out[side_key(rt, False)] = f"{rt.reverse_label or rt.label} → {other}"
    return out


async def _load_relation_side_labels(db: AsyncSession, type_key: str) -> dict[str, str]:
    """``_relation_side_labels`` over the relation types touching ``type_key``."""
    rts = (
        (
            await db.execute(
                select(RelationType).where(
                    or_(
                        RelationType.source_type_key == type_key,
                        RelationType.target_type_key == type_key,
                    )
                )
            )
        )
        .scalars()
        .all()
    )
    other_keys = {rt.source_type_key for rt in rts} | {rt.target_type_key for rt in rts}
    type_labels = (
        dict(
            (
                await db.execute(
                    select(CardType.key, CardType.label).where(CardType.key.in_(other_keys))
                )
            ).all()
        )
        if other_keys
        else {}
    )
    return _relation_side_labels(list(rts), type_key, type_labels)


def _labelled_subtype_list(items: list, prop: str, labels: dict[str, str]) -> list:
    """``items`` with each ``subtype.changed`` ``prop`` side — a list of keys —
    mapped to labels (an absent list read as empty, an unknown key kept as it
    is); an item whose sides then agree — absent vs. ``[]`` — is dropped as no
    change."""
    out = []
    for entry in items:
        if entry.get("kind") == "subtype.changed" and entry.get("property") == prop:
            old, new = (
                [labels.get(k, k) for k in (entry.get(side) or []) if isinstance(k, str)]
                for side in ("old", "new")
            )
            if old == new:
                continue
            entry = {**entry, "old": old, "new": new}
        out.append(entry)
    return out


def _normalised_reference_config(cfg: object) -> dict:
    """``cfg`` with its defaults filled in, so a stored ``{}`` and the
    ``{"mode": "off", …}`` a save writes back do not read as a change; a
    config that does not validate is compared as it stands."""
    try:
        return card_reference.validate_reference_config(cfg)  # type: ignore[arg-type]
    except card_reference.ReferenceConfigError:
        return cfg if isinstance(cfg, dict) else {}


def _reference_changes(old: object, new: object) -> dict[str, dict[str, object]]:
    """``reference_<key>`` changes for each ``reference_config`` key that moved."""
    before = _normalised_reference_config(old)
    after = _normalised_reference_config(new)
    return {
        f"reference_{key}": {"old": before.get(key), "new": after.get(key)}
        for key in _REFERENCE_AUDIT_KEYS
        if before.get(key) != after.get(key)
    }


def _type_audit_changes(
    before: dict,
    after: dict,
    role_labels: dict[str, str] | None = None,
    relation_side_labels: dict[str, str] | None = None,
) -> tuple[dict, list]:
    """``(changes, items)`` for a card-type update: the scalar columns diffed
    into ``changes`` (``reference_config`` per key), the JSON columns compared
    by ``audit_changes`` into ``items`` (capped)."""
    changes = audit_log.diff(before, after, keys=_TYPE_AUDIT_SCALARS)
    changes.update(_reference_changes(before["reference_config"], after["reference_config"]))
    items = (
        audit_changes.fields_schema_items(before["fields_schema"], after["fields_schema"])
        + audit_changes.section_config_items(
            before["section_config"],
            after["section_config"],
            _section_names(after["fields_schema"]),
        )
        + _labelled_subtype_list(
            _labelled_hidden_fields(
                audit_changes.keyed_list_items(
                    before["subtypes"],
                    after["subtypes"],
                    noun="subtype",
                    props=("color", "hidden_fields", "optional_relations"),
                ),
                _field_labels(after["fields_schema"], before["fields_schema"]),
            ),
            "optional_relations",
            relation_side_labels or {},
        )
        + audit_changes.keyed_list_items(
            before["hierarchy_labels"],
            after["hierarchy_labels"],
            noun="hierarchy_label",
            props=("color",),
        )
        + audit_changes.keyed_list_items(
            before["stakeholder_roles"], after["stakeholder_roles"], noun="stakeholder_role"
        )
        + audit_changes.translations_items(before["translations"], after["translations"])
        + audit_changes.role_permissions_items(
            before["role_permissions"], after["role_permissions"], role_labels
        )
    )
    return changes, audit_changes.cap_items(items)


async def _category_label(db: AsyncSession, key: str | None) -> str | None:
    """The registry label of a card type's ``category`` for an audit row; the
    stored string itself when no registry row answers to it, ``None`` for
    uncategorised."""
    if not key:
        return key
    return (await audit_labels.category_labels(db, [key])).get(key, key)


async def _category_change_labels(db: AsyncSession, change: dict) -> dict:
    """A ``{"old", "new"}`` category change with both keys resolved to labels
    in one query, so a move into a renamed custom category logs what an admin
    reads rather than the key the type stores."""
    labels = await audit_labels.category_labels(db, [change.get("old"), change.get("new")])
    return {side: labels.get(change.get(side), change.get(side)) for side in ("old", "new")}


def _relation_type_audit_changes(
    before: dict, after: dict, type_labels: dict[str, str]
) -> tuple[dict, list]:
    """``(changes, items)`` for a relation-type update. The endpoints are
    recorded as card-type *labels* under ``source_type`` / ``target_type``."""
    changes = audit_log.diff(before, after, keys=_RELATION_TYPE_AUDIT_SCALARS)
    for end in ("source_type", "target_type"):
        old_key, new_key = before[f"{end}_key"], after[f"{end}_key"]
        if old_key != new_key:
            changes[end] = {
                "old": _type_label(type_labels, old_key),
                "new": _type_label(type_labels, new_key),
            }
    items = audit_changes.attributes_schema_items(
        before["attributes_schema"], after["attributes_schema"]
    ) + audit_changes.translations_items(before["translations"], after["translations"])
    return changes, audit_changes.cap_items(items)


def _type_label(labels: dict[str, str], key: str | None) -> str | None:
    """A card type's label, its key when it has none (or is unknown)."""
    if key is None:
        return None
    return labels.get(key) or key


def _clip_text(value: object) -> object:
    """A long string clipped (``audit_labels.clip_text``); anything else as is."""
    return audit_labels.clip_text(value) if isinstance(value, str) else value


def _clipped(changes: dict[str, dict[str, object]]) -> dict[str, dict[str, object]]:
    """``changes`` with the long principle texts clipped on each side."""
    return {
        field: (
            {"old": _clip_text(change["old"]), "new": _clip_text(change["new"])}
            if field in _PRINCIPLE_TEXT_FIELDS
            else change
        )
        for field, change in changes.items()
    }


def _label_translation_items(old: object, new: object) -> list:
    """``translation.changed`` (property ``label``) for a regulation's or a
    resource type's ``translations``, which map a locale straight to its label."""
    return audit_changes.translations_items({"label": old}, {"label": new})


def _validate_color(body: dict) -> None:
    """Reject a ``color`` that isn't a #rrggbb hex value.

    Only enforced when the key is present so color-less creates/patches keep
    working. The column is a plain string — without this guard any value up to
    20 chars would be persisted and break every consumer that parses the hex.
    """
    if "color" in body and not (
        isinstance(body["color"], str) and _HEX_COLOR_RE.match(body["color"])
    ):
        raise HTTPException(400, "color must be a hex value in #rrggbb format")


def _validate_archimate(body: dict, *, relation: bool = False) -> None:
    """422 for names that are not in the ArchiMate 3.1 XSD enumerations.

    Card-type/subtype ``archimate_type`` is deliberately NOT validated here
    (and not written anywhere in this file) -- the EnterpriseObjectCardMapping
    bridge table is the real source of truth for card-type-to-ArchiMate
    mapping now; ``CardType.archimate_type``/``subtypes[].archimate_type``
    stay in the model and in GET responses (a later cleanup), but this write
    path no longer looks at an incoming value for either. Relation-type
    mapping (``archimate_type``/``archimate_access``/``archimate_reversed``
    below) is untouched -- that is the next plan's job.
    """
    from app.services.archimate import taxonomy as tx

    def check(label: str, value: object, allowed: object) -> None:
        # isinstance first: `in` on a frozenset raises TypeError (500) for lists/dicts.
        if value is not None and not (isinstance(value, str) and value in allowed):
            raise HTTPException(422, f"Unknown {label}: {value!r}")

    if relation:
        check("ArchiMate relationship type", body.get("archimate_type"), tx.RELATIONSHIP_TYPES)
    check("ArchiMate access type", body.get("archimate_access"), (*tx.ACCESS_TYPES, "crud"))
    if "archimate_reversed" in body and not isinstance(body["archimate_reversed"], bool):
        raise HTTPException(
            422, f"archimate_reversed must be a boolean, got {body['archimate_reversed']!r}"
        )


def _scoring_signature(
    fields_schema: list | None, section_config: dict | None, subtypes: list | None = None
) -> dict:
    """Capture the data-quality-relevant config of a card type.

    Used to detect when an admin edit changes how scores are computed (field
    weights, the required/readonly flags feeding the mandatory-field gate, the
    built-in contributor weights, or what a subtype drops out of the score —
    its ``hidden_fields`` and its ``optional_relations``, #1296) so existing
    cards can be re-scored. Label/icon/order edits leave this signature
    unchanged, and so does reordering either subtype list.
    """
    field_weights: dict[str, tuple] = {}
    for section in fields_schema or []:
        for field in section.get("fields", []):
            if "key" in field:
                field_weights[field["key"]] = (
                    field.get("weight", 1),
                    bool(field.get("required")),
                    bool(field.get("readonly")),
                )
    dq_cfg = (section_config or {}).get("__dataQuality") or {}
    # A subtype that drops nothing out of the score is left out, so adding or
    # removing an unconfigured subtype does not rescore the whole type.
    subtype_scope: dict[str, tuple] = {}
    for st in subtypes or []:
        if isinstance(st, dict) and isinstance(st.get("key"), str):
            scope = tuple(
                tuple(sorted(k for k in (st.get(prop) or []) if isinstance(k, str)))
                for prop in ("hidden_fields", "optional_relations")
            )
            if any(scope):
                subtype_scope[st["key"]] = scope
    return {"fields": field_weights, "dq": dq_cfg, "subtypes": subtype_scope}


# ── Extension-gated field capabilities ─────────────────────────────────
#
# Custom field types (``ext.*``) ship as INERT core plumbing: the schema
# understands them and the card detail renders them unconditionally, but an
# admin can only *author* one when an installed, enabled, licensed extension
# grants ``metamodel.custom_field_types`` (see registry.grants_for); the API
# rewrites any attempt to add one without the grant. Rendering is never gated
# (a licence lapse must never blank a card or delete data), and an
# already-stored custom type is grandfathered so a lapse can't block unrelated
# metamodel edits.
#
# Field help text (``help`` / ``helpTranslations``) used to sit behind a second
# grant, ``metamodel.field_help``. It is a core feature since 2.174.0 (#1297):
# every metamodel admin authors it and it is written exactly as sent. The grant
# string is still accepted in manifests (``VALID_GRANTS``) as a no-op.
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
        "percentage",
    }
)


def _enforce_field_gating(
    new_schema: list | None, old_schema: list | None, granted: set[str]
) -> list:
    """Downgrade a new or changed custom ``ext.*`` field type unless an extension
    grants ``metamodel.custom_field_types``. A type already stored on the field
    is grandfathered verbatim, so a lapse never mutates card data or blocks an
    unrelated edit. Every other attribute (help text included) passes through."""
    new_schema = new_schema or []
    if CAP_CUSTOM_FIELD_TYPES in granted:
        return new_schema

    old_types: dict[str, object] = {}
    for section in old_schema or []:
        for f in section.get("fields", []) if isinstance(section, dict) else []:
            if isinstance(f, dict) and "key" in f:
                old_types[f["key"]] = f.get("type")

    for section in new_schema:
        if not isinstance(section, dict):
            continue
        for f in section.get("fields", []):
            if not isinstance(f, dict):
                continue
            ftype = f.get("type")
            if not (isinstance(ftype, str) and ftype.startswith("ext.")):
                continue
            old_type = old_types.get(f.get("key"))
            if old_type == ftype:
                continue  # grandfather an already-stored custom type
            f["type"] = old_type if old_type in _BUILTIN_FIELD_TYPES else "text"
    return new_schema


def _guard_ext_contributions(body: dict, t: CardType, active: frozenset[str]) -> None:
    """Run ``body``'s ``fields_schema`` / ``subtypes`` / ``section_config``
    through :mod:`contribution_guard` against the stored type, in place."""
    contribution_guard.guard_card_type_row(
        body,
        stored_schema=t.fields_schema,
        stored_subtypes=t.subtypes,
        stored_config=t.section_config,
        active_keys=active,
        mode="save",
    )


def _schema_with_lock_flags(type_key: str, schema: list | None) -> list:
    """``schema`` with the two transient flags a metamodel read carries.

    - ``ext_locked: true`` on every field whose values may not change because
      the extension that contributed it is not active or licensed;
    - ``ext_protected: true`` on every field and section an ACTIVE extension
      stamped — what a card-type save cannot delete (``contribution_guard``),
      so the editor offers no delete for it.

    Computed per read from the live registry, never stored (the write guard
    strips both). Returns copies — the stored schema is never mutated.
    """
    locked = field_gate.locked_fields(type_key, schema)
    active = contribution_guard.active_extension_keys()
    protected_fields, protected_sections = contribution_guard.protected_fields_and_sections(
        schema, active
    )
    if not locked and not protected_fields and not protected_sections:
        return schema or []
    out: list = []
    for index, section in enumerate(schema or []):
        if not isinstance(section, dict):
            out.append(section)
            continue
        fields = []
        for f in section.get("fields", []):
            if isinstance(f, dict):
                flags = {}
                if f.get("key") in locked:
                    flags["ext_locked"] = True
                if contribution_guard.stamp_of(f) in active:
                    flags["ext_protected"] = True
                f = {**f, **flags}
            fields.append(f)
        flagged = {**section, "fields": fields}
        if index in protected_sections:
            flagged["ext_protected"] = True
        out.append(flagged)
    return out


# ── Helpers ────────────────────────────────────────────────────────────

# The five inventory permissions a card type may override, in the order the
# admin Permissions tab renders them. View leads: a View deny locks the rest.
_TYPE_PERMISSION_ORDER: tuple[str, ...] = (
    "inventory.view",
    "inventory.create",
    "inventory.edit",
    "inventory.archive",
    "inventory.delete",
)


async def _validated_role_permissions(
    db: AsyncSession, raw: object, *, subtypes: list[dict] | None = None
) -> dict:
    """Validate a ``role_permissions`` payload against the live role list.

    Role keys must exist (archived ones are fine — their overrides are inert
    but a round-trip of a stored map must not start failing), and a wildcard
    role can never be overridden. ``subtypes`` is the type's own subtype list
    (the request body's for a new type, the already-updated ``CardType`` row's
    for an existing one) — it validates any subtype-scoped cell.
    """
    rows = await db.execute(select(Role.key, Role.permissions))
    known: set[str] = set()
    wildcard: set[str] = set()
    for role_key, perms in rows.all():
        known.add(role_key)
        if (perms or {}).get("*"):
            wildcard.add(role_key)
    known_subtype_keys = {s["key"] for s in (subtypes or [])}
    try:
        return validate_type_role_permissions(
            raw,
            known_role_keys=known,
            wildcard_role_keys=wildcard,
            known_subtype_keys=known_subtype_keys,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _serialize_type(t: CardType, *, include_role_permissions: bool = True) -> dict:
    """Serialise a card type.

    ``role_permissions`` is the per-role RBAC matrix of the type — which roles
    may see, create, edit… its cards. Read routes pass
    ``include_role_permissions=False`` for callers without ``admin.metamodel``:
    nothing outside the admin Permissions tab needs it, and it would tell any
    user which types are hidden from which role.
    """
    out = {
        "key": t.key,
        "label": t.label,
        "description": t.description,
        "icon": t.icon,
        "color": t.color,
        "category": t.category,
        "has_hierarchy": t.has_hierarchy,
        "has_successors": t.has_successors,
        "allow_card_logo": t.allow_card_logo,
        "subtypes": contribution_guard.flag_protected_subtypes(
            t.subtypes or [], contribution_guard.active_extension_keys()
        ),
        "hierarchy_labels": t.hierarchy_labels or [],
        "fields_schema": _schema_with_lock_flags(t.key, t.fields_schema),
        "stakeholder_roles": t.stakeholder_roles or [],
        "section_config": t.section_config or {},
        "reference_config": t.reference_config or {},
        "role_permissions": t.role_permissions or {},
        "built_in": t.built_in,
        "is_hidden": t.is_hidden,
        "sort_order": t.sort_order,
        "translations": t.translations or {},
        # Seed default for built-in types (None for custom types) — powers the
        # admin "reset to default color" affordance.
        "default_color": DEFAULT_TYPE_COLORS.get(t.key),
        "archimate_type": t.archimate_type,
    }
    if not include_role_permissions:
        out.pop("role_permissions", None)
    return out


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
        "archimate_type": r.archimate_type,
        "archimate_access": r.archimate_access,
        "archimate_reversed": r.archimate_reversed,
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


def _locked_relation_value(
    code: str, message: str, attribute: object, value: object = None
) -> HTTPException:
    """A 403 for an edit of a built-in relation attribute or value.

    ``error`` is a stable code the admin UI translates (``relationValueErrors.ts``),
    naming ``attribute`` / ``value`` by their labels; ``message`` stays the
    English sentence for API and MCP callers.
    """
    detail: dict = {"error": code, "message": message, "attribute": attribute}
    if value is not None:
        detail["value"] = value
    return HTTPException(403, detail=detail)


def _merge_relation_attributes_schema(existing: object, incoming: object) -> list[dict]:
    """Validate + merge an incoming ``attributes_schema`` against the stored one.

    Built-in fields and options (``built_in=True`` on the stored entry) are
    locked-but-hideable: they must remain present and unchanged except their
    ``hidden`` flag may flip. Custom entries are fully editable, and any entry
    that does not match a stored built-in key is forced ``built_in=False`` so a
    client can never escalate a custom value into a locked one.

    Raises ``HTTPException(403)`` when a built-in field/option is removed or its
    locked attributes are mutated; ``detail.error`` names which (see
    ``_locked_relation_value``).
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
            raise _locked_relation_value(
                "relation_attribute_required",
                f"Built-in relation attribute '{fkey}' cannot be removed.",
                fkey,
            )

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
                raise _locked_relation_value(
                    "relation_attribute_locked",
                    f"Built-in relation attribute '{field['key']}' cannot be edited.",
                    field["key"],
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
            raise _locked_relation_value(
                "relation_value_required",
                f"Built-in relation value '{okey}' cannot be removed (hide it instead).",
                base_field.get("key"),
                okey,
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
                raise _locked_relation_value(
                    "relation_value_locked",
                    f"Built-in relation value '{opt['key']}' cannot be edited (hide it instead).",
                    base_field.get("key"),
                    opt["key"],
                )
        merged_opts.append({**base_opt, "built_in": True, "hidden": bool(opt.get("hidden", False))})

    target["options"] = merged_opts
    return target


def _untouched_card_update(*where):
    """``UPDATE cards`` for attribute clean-up that leaves the card undated.

    Stripping a value the metamodel no longer defines is not an edit to the
    card: ``updated_at`` and ``updated_via`` are set to themselves so their
    ``onupdate`` defaults never fire (``app/services/derived_writes.py``).
    Session sync is off — no card loaded by this request is read afterwards.
    """
    return (
        update(Card)
        .where(*where)
        .values(updated_at=Card.updated_at, updated_via=Card.updated_via)
        .execution_options(synchronize_session=False)
    )


def _strip_attribute_stmt(type_key: str, field_key: str):
    """Remove ``field_key`` from every card of the type that has it."""
    return _untouched_card_update(Card.type == type_key, Card.attributes.has_key(field_key)).values(
        attributes=Card.attributes.op("-")(literal(field_key, Text))
    )


def _clear_single_select_stmt(type_key: str, field_key: str, opt_key: str):
    """Remove a single-select value where it is the removed option."""
    return _untouched_card_update(
        Card.type == type_key, Card.attributes[field_key].astext == opt_key
    ).values(attributes=Card.attributes.op("-")(literal(field_key, Text)))


def _drop_multi_select_option_stmt(type_key: str, field_key: str, opt_key: str):
    """Filter ``opt_key`` out of a multiple-select array, leaving ``[]`` when it
    was the only value."""
    elem = func.jsonb_array_elements(Card.attributes[field_key], type_=JSONB).column_valued()
    # ``elem #>> '{}'`` is the element as text, so a non-string element that
    # prints as the option key is dropped too.
    kept = (
        select(func.jsonb_agg(elem))
        .where(elem.op("#>>", return_type=Text)(literal([], ARRAY(Text))) != opt_key)
        .scalar_subquery()
    )
    return _untouched_card_update(
        Card.type == type_key, Card.attributes[field_key].contains([opt_key])
    ).values(
        attributes=func.jsonb_set(
            Card.attributes,
            literal([field_key], ARRAY(Text)),
            func.coalesce(kept, literal([], JSONB)),
        )
    )


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
        result = await db.execute(_strip_attribute_stmt(type_key, fk))
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
                result = await db.execute(_clear_single_select_stmt(type_key, fk, opt_key))
            else:
                # multiple_select: remove the option from the array
                result = await db.execute(_drop_multi_select_option_stmt(type_key, fk, opt_key))
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
    rbac = await PermissionService.has_app_permission(db, user, "admin.metamodel")
    return [_serialize_type(t, include_role_permissions=rbac) for t in result.scalars().all()]


@router.get("/types/{key}")
async def get_type(
    key: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    result = await db.execute(select(CardType).where(CardType.key == key))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Card type not found")
    rbac = await PermissionService.has_app_permission(db, user, "admin.metamodel")
    return _serialize_type(t, include_role_permissions=rbac)


@router.get("/types/{key}/permissions")
async def get_type_permissions(
    key: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """The per-role permission matrix for one card type (admin Permissions tab).

    Gated on ``admin.metamodel`` because it reveals part of the RBAC matrix.
    It deliberately exposes only the five type-scoped inventory bits per role —
    never the full permission set, which stays behind ``admin.roles`` — so an
    admin who may edit the metamodel can see what a role inherits without
    being handed the whole role configuration.

    ``inherited`` is what the role grants landscape-wide; ``overrides`` is what
    this type stores. A cell missing from ``overrides`` inherits. Archived
    roles are omitted, and a stored override naming a role that no longer
    exists is simply not listed (it is inert at check time too).
    """
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(CardType).where(CardType.key == key))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Card type not found")

    stored = t.role_permissions or {}
    inventory_descriptions = APP_PERMISSIONS["inventory"]["permissions"]
    actions = [
        {"key": perm_key, "description": inventory_descriptions.get(perm_key, "")}
        for perm_key in _TYPE_PERMISSION_ORDER
        if perm_key in TYPE_SCOPED_APP_PERMISSIONS
    ]

    roles_result = await db.execute(
        select(Role)
        .where(Role.is_archived == False)  # noqa: E712
        .order_by(Role.sort_order, Role.key)
    )
    roles = []
    for role in roles_result.scalars().all():
        perms = role.permissions or {}
        is_wildcard = bool(perms.get("*"))
        roles.append(
            {
                "key": role.key,
                "label": role.label,
                "color": role.color,
                "is_system": role.is_system,
                "is_wildcard": is_wildcard,
                "inherited": {
                    a["key"]: True if is_wildcard else bool(perms.get(a["key"], False))
                    for a in actions
                },
                "overrides": {
                    k: v
                    for k, v in (stored.get(role.key) or {}).items()
                    if k in TYPE_SCOPED_APP_PERMISSIONS
                },
            }
        )

    subtypes = [{"key": s["key"], "label": s.get("label", s["key"])} for s in (t.subtypes or [])]
    return {"actions": actions, "roles": roles, "subtypes": subtypes}


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


@router.get("/types/{key}/reference-usage")
async def get_reference_usage(
    key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Report card ID coverage for the metamodel editor (#811).

    - ``count``   — cards of this type that already have an ID.
    - ``missing`` — cards with no ID yet (what the Generate button would fill).
    - ``locked``  — once ``count`` > 0 the prefix / start / min-digits are frozen.
    """
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(CardType).where(CardType.key == key))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Card type not found")

    count = (
        await db.execute(
            select(func.count())
            .select_from(Card)
            .where(Card.type == key, Card.reference.isnot(None))
        )
    ).scalar() or 0
    missing = (
        await db.execute(
            select(func.count()).select_from(Card).where(Card.type == key, Card.reference.is_(None))
        )
    ).scalar() or 0
    return {"count": count, "missing": missing, "locked": count > 0}


@router.post("/types/{key}/generate-references")
async def generate_references(
    key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Assign IDs to existing cards of this type that don't have one yet (#811).

    Explicit, on-demand counterpart to the type Save (which never backfills).
    Fill-only + idempotent — re-running only fills newly-missing cards, so it
    never rewrites an existing ID. Uses the stored config, so save the format
    first.

    (A future "regenerate all" would compose from the same primitive:
    ``UPDATE cards SET reference = NULL WHERE type = key`` then
    ``backfill_references_for_type`` — deliberately not built here.)
    """
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(CardType).where(CardType.key == key))
    card_type = result.scalar_one_or_none()
    if not card_type:
        raise HTTPException(404, "Card type not found")
    if card_reference.get_mode(card_type) != "auto":
        raise HTTPException(400, "Card ID generation is not enabled for this type.")
    generated = await card_reference.backfill_references_for_type(db, card_type)
    await audit_log.record(
        db,
        action="admin.metamodel.type.references_generated",
        category="admin",
        actor=user,
        target=("card_type", card_type.key, card_type.label),
        context={"generated": generated},
    )
    await db.commit()
    return {"generated": generated}


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
            select(func.count())
            .select_from(Card)
            .where(
                Card.type == key,
                Card.status == "ACTIVE",
                Card.attributes[field_key].contains([option_key]),
            )
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


@router.get("/types/{key}/hierarchy-label-usage")
async def get_hierarchy_label_usage(
    key: str,
    label_key: str = Query(..., description="The hierarchy link label key to check"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return how many active cards carry a given hierarchy link label (#1100).

    Its own endpoint rather than a branch of ``option-usage``: that one
    dispatches on a ``fields_schema`` field type and reads ``attributes``,
    whereas a link label is the ``cards.parent_label`` column.

    Deleting the option does **not** rewrite the stored values — they keep
    rendering as the unknown-option chip, and the card stays editable because
    the write validator exempts an unchanged value. This count is what lets the
    admin dialog say how many cards that will affect before they confirm.
    """
    await PermissionService.require_permission(db, user, "admin.metamodel")
    exists = await db.scalar(select(CardType.id).where(CardType.key == key))
    if not exists:
        raise HTTPException(404, "Card type not found")
    count = await db.scalar(
        select(func.count())
        .select_from(Card)
        .where(
            Card.type == key,
            Card.status == "ACTIVE",
            Card.parent_label == label_key,
        )
    )
    return {"label_key": label_key, "card_count": count or 0}


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


def _strip_subtype_archimate_type(subtypes: object) -> list:
    """Return a copy of ``subtypes`` with any ``archimate_type`` key removed.

    The EnterpriseObjectCardMapping bridge table is the real source of truth
    for card-type-to-ArchiMate mapping now; a subtype's own ``archimate_type``
    override is unread by the switched-over consumers (the frontend's
    ``elementTypesForCardType``, the MCP ``get_archimate_mapping`` tool), so
    accepting a new value here would create the illusion of effect. Each
    subtype is a free-form JSON dict (no separate column/model), so stopping
    the write means stripping the key from the dict itself, not just skipping
    validation of it.
    """
    out = []
    for sub in subtypes if isinstance(subtypes, list) else []:
        if isinstance(sub, dict) and "archimate_type" in sub:
            sub = {k: v for k, v in sub.items() if k != "archimate_type"}
        out.append(sub)
    return out


@router.post("/types", status_code=201)
async def create_type(
    body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    _validate_color(body)
    _validate_archimate(body)
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
    # Nothing is stored yet, so the guard strips every stamp a body sends: a
    # new type cannot claim fields or subtypes for an extension.
    active = contribution_guard.active_extension_keys()
    fields_schema = _enforce_field_gating(
        contribution_guard.preserve_ext_schema(body.get("fields_schema", []), [], active).schema,
        [],
        extension_registry.granted_capabilities(),
    )
    subtypes = contribution_guard.preserve_ext_subtypes(body.get("subtypes", []), [], active)
    # Auto-add the readonly hierarchyLevel field for hierarchical types (after
    # gating, which only rewrites ext.* field types — a plain number field is safe).
    if body.get("has_hierarchy"):
        fields_schema = _inject_hierarchy_level_field(fields_schema)
    try:
        reference_config = card_reference.validate_reference_config(body.get("reference_config"))
    except card_reference.ReferenceConfigError as exc:
        raise HTTPException(400, str(exc)) from exc
    role_permissions = await _validated_role_permissions(
        db, body.get("role_permissions"), subtypes=body.get("subtypes", [])
    )
    category = await _validated_category(db, body.get("category"))
    t = CardType(
        key=body["key"],
        label=body["label"],
        description=body.get("description"),
        icon=body.get("icon", "category"),
        color=body.get("color", "#1976d2"),
        category=category,
        has_hierarchy=body.get("has_hierarchy", False),
        has_successors=body.get("has_successors", False),
        allow_card_logo=body.get("allow_card_logo", False),
        subtypes=_strip_subtype_archimate_type(subtypes),
        hierarchy_labels=body.get("hierarchy_labels", []),
        fields_schema=fields_schema,
        stakeholder_roles=body.get("stakeholder_roles", default_roles),
        reference_config=reference_config,
        role_permissions=role_permissions,
        built_in=False,
        is_hidden=False,
        sort_order=body.get("sort_order", next_order),
        translations=body.get("translations", {}),
        # archimate_type is deliberately not accepted here -- see
        # _validate_archimate's docstring; the column stays NULL on create.
    )
    db.add(t)
    if t.has_successors:
        # Auto-provide the lineage relation type so the card detail lineage
        # section renders (issue #729).
        await _ensure_successor_relation_type(db, t.key)
    await audit_log.record(
        db,
        action="admin.metamodel.type.created",
        category="admin",
        actor=user,
        target=("card_type", t.key, t.label),
        context={
            "category": await _category_label(db, t.category),
            "has_hierarchy": t.has_hierarchy,
            "fields": sum(len(s.get("fields") or []) for s in t.fields_schema or []),
        },
    )
    await db.commit()
    await db.refresh(t)
    # A lookup of this key before it existed cached "no overrides"; drop it so
    # overrides created with the type apply at once, not a TTL later.
    PermissionService.invalidate_type_permission_cache(t.key)
    return _serialize_type(t)


def _fields_by_key(schema: list | None, field_key: str) -> list[tuple[str | None, dict]]:
    """Every ``(section name, field)`` with this key. The guard wants exactly one, because
    ``_cleanup_removed_fields_and_options`` keeps the LAST definition of a repeated key."""
    return [
        (sec.get("section"), f)
        for sec in schema or []
        for f in sec.get("fields") or []
        if f.get("key") == field_key
    ]


def _guard_derived_cost_field(key: str, old: list | None, new: list | None) -> None:
    """``costTotalAnnual`` on Application / ITComponent is derived from the card costs."""
    if key not in COST_ITEM_TYPES:
        return
    was = _fields_by_key(old, DERIVED_KEY)
    if not was:
        return
    now = _fields_by_key(new, DERIVED_KEY)
    if len(now) != 1 or now[0][1].get("type") != was[0][1].get("type"):
        raise HTTPException(400, "use_cost_items")


@router.patch("/types/{key}")
async def update_type(
    key: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    _validate_color(body)
    _validate_archimate(body)
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

    if "category" in body:
        body["category"] = await _validated_category(db, body["category"], t.category)

    audit_fields = _TYPE_AUDIT_SCALARS + _TYPE_AUDIT_JSON
    audit_before = _audit_snapshot(t, audit_fields)

    # What an active extension contributed survives the save (stamps, sections,
    # fields, subtypes, the section order) — before anything else reads the
    # body, so neither the cleanup nor anything after it can see a field the
    # body tried to delete, unlock or claim.
    await extension_registry.refresh_from_db(db)
    _guard_ext_contributions(body, t, contribution_guard.active_extension_keys())

    # ── Clean up card attributes when fields or options are removed ──
    if "fields_schema" in body:
        _guard_derived_cost_field(key, t.fields_schema, body["fields_schema"])
        await _cleanup_removed_fields_and_options(
            db,
            key,
            t.fields_schema or [],
            body["fields_schema"] or [],
        )
        # Downgrade custom ext.* field types that aren't unlocked by a licensed
        # extension — grandfathering stored values. Help text is core (#1297).
        body["fields_schema"] = _enforce_field_gating(
            body["fields_schema"] or [],
            t.fields_schema or [],
            extension_registry.granted_capabilities(),
        )

    # Snapshot the data-quality-relevant config so we can re-score existing
    # cards if (and only if) the admin changed field weights or the built-in
    # contributor weights.
    old_signature = _scoring_signature(t.fields_schema, t.section_config, t.subtypes)
    old_has_hierarchy = t.has_hierarchy
    old_reference_config = dict(t.reference_config or {})

    updatable = [
        "label",
        "description",
        "icon",
        "color",
        "category",
        "has_hierarchy",
        "has_successors",
        "allow_card_logo",
        "subtypes",
        "hierarchy_labels",
        "fields_schema",
        "stakeholder_roles",
        "section_config",
        "sort_order",
        "is_hidden",
        "translations",
        # archimate_type deliberately excluded -- see _validate_archimate's
        # docstring; a client-sent value is silently ignored, same as any
        # other key missing from this list.
    ]
    for field in updatable:
        if field in body:
            if field == "translations":
                # NOT NULL column — a client clearing every translation must land
                # an empty map, not a constraint violation.
                t.translations = body["translations"] or {}
            elif field == "subtypes":
                t.subtypes = _strip_subtype_archimate_type(body["subtypes"])
            else:
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

    # ── Human-readable reference config (discussion #811) ──
    if "reference_config" in body:
        try:
            new_ref_cfg = card_reference.validate_reference_config(body["reference_config"])
        except card_reference.ReferenceConfigError as exc:
            raise HTTPException(400, str(exc)) from exc
        old_ref_cfg = card_reference.validate_reference_config(old_reference_config)
        # The ID FORMAT (prefix + number series) is frozen once any card of this
        # type carries a reference — generated IDs must stay unique, never reused,
        # and stable for the card's lifetime. Only the on/off mode may still change
        # (turning it off pauses generation; existing IDs are untouched either way).
        has_refs = (
            await db.execute(
                select(Card.id).where(Card.type == key, Card.reference.isnot(None)).limit(1)
            )
        ).first() is not None
        if has_refs and any(
            new_ref_cfg[f] != old_ref_cfg[f] for f in ("prefix", "start", "padding")
        ):
            raise HTTPException(
                400,
                "The card ID format is locked because cards of this type already have IDs.",
            )
        t.reference_config = new_ref_cfg
        # NB: saving the config never backfills existing cards — that bulk,
        # permanent mutation is deliberately a separate, explicit action
        # (POST /types/{key}/generate-references), so an unrelated type Save can
        # never mint thousands of IDs by surprise. New cards still auto-generate
        # on create; only the historical backlog is generated on demand.

    # ── Per-card-type role permission overrides (discussion #1068) ──
    # Deliberately outside the generic `updatable` loop: the payload is
    # validated against the live role list, and a wildcard role is refused.
    if "role_permissions" in body:
        t.role_permissions = await _validated_role_permissions(
            db, body["role_permissions"], subtypes=t.subtypes
        )

    audit_after = _audit_snapshot(t, audit_fields)
    role_labels = (
        await audit_labels.role_labels(
            db,
            [
                *(audit_before["role_permissions"] or {}),
                *(audit_after["role_permissions"] or {}),
            ],
        )
        if audit_before["role_permissions"] != audit_after["role_permissions"]
        else {}
    )
    relation_side_labels = (
        await _load_relation_side_labels(db, key)
        if _optional_relations_changed(audit_before["subtypes"], audit_after["subtypes"])
        else {}
    )
    changes, items = _type_audit_changes(
        audit_before, audit_after, role_labels, relation_side_labels
    )
    if "category" in changes:
        changes["category"] = await _category_change_labels(db, changes["category"])
    if changes or items:
        await audit_log.record(
            db,
            action="admin.metamodel.type.updated",
            category="admin",
            actor=user,
            target=("card_type", t.key, t.label),
            changes=changes,
            items=items,
        )
    await db.commit()
    await db.refresh(t)

    # The override map is cached per process for the permission checks, so a
    # save has to drop this type's entry or the change would take up to the
    # cache TTL to reach the routes.
    PermissionService.invalidate_type_permission_cache(key)

    # Re-score existing cards when the scoring config actually changed, so
    # tuned data-quality weights take effect immediately instead of waiting
    # for each card to be edited.
    new_signature = _scoring_signature(t.fields_schema, t.section_config, t.subtypes)
    if new_signature != old_signature:
        await _recompute_data_quality_for_type(db, key)

    return _serialize_type(t)


async def _recompute_data_quality_for_type(db: AsyncSession, type_key: str) -> None:
    """Recompute data_quality for every active card of a type after a config change."""
    from app.services.data_quality import rescore_card_type

    if await rescore_card_type(db, type_key):
        await db.commit()


@router.get("/types/{key}/delete-impact")
async def get_type_delete_impact(
    key: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """What ``DELETE /types/{key}`` would remove: the confirmation dialog's numbers.

    Counts only — a card type's dependants are landscape-wide admin data, and the
    caller holds ``admin.metamodel``, so no read scope applies.
    """
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(CardType).where(CardType.key == key))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Type not found")
    impact = await card_type_delete.type_delete_impact(db, t)
    return impact.to_dict()


@router.delete("/types/{key}")
async def delete_type(
    key: str,
    delete_cards: bool = Query(
        False,
        description="Also delete every card of a custom type (with its relations). "
        "Without it, a custom type that still has cards is refused with 409.",
    ),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(CardType).where(CardType.key == key))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Type not found")

    impact = await card_type_delete.type_delete_impact(db, t)

    if t.built_in:
        # Built-in types are only ever hidden, so the seed can restore them.
        t.is_hidden = True
        await audit_log.record(
            db,
            action="admin.metamodel.type.deleted",
            category="admin",
            actor=user,
            target=("card_type", key, t.label),
            context={"mode": "hidden", "card_count": impact.card_count},
        )
        await db.commit()
        PermissionService.invalidate_type_permission_cache(key)
        return {"status": "hidden", "key": key, "instance_count": impact.card_count}

    if impact.card_count > 0:
        if not delete_cards:
            raise HTTPException(
                409,
                detail={
                    "error": "cards_present",
                    "message": f"Cannot delete type '{key}': {impact.card_count} card(s) "
                    "exist. Pass delete_cards=true to delete them with the type, "
                    "or hide the type instead.",
                    "key": key,
                    "card_count": impact.card_count,
                },
            )
        # Deleting the cards is a permanent inventory delete, so it takes that
        # permission on top of the metamodel one (every default admin holds both).
        await PermissionService.require_permission(db, user, "inventory.delete")

    await card_type_delete.delete_type_dependents(db, t, actor_id=user.id)

    # Also delete Enterprise Object card-mapping rows that reference this
    # type -- card_type_key is a FK to card_types.key with implicit
    # RESTRICT, so leaving a mapping row behind would raise an unhandled
    # IntegrityError at commit when an admin deletes a custom card type
    # they had mapped via the Card Mapping editor.
    mapping_result = await db.execute(
        select(EnterpriseObjectCardMapping).where(EnterpriseObjectCardMapping.card_type_key == key)
    )
    for m in mapping_result.scalars().all():
        await db.delete(m)
    # Flush now so the mapping deletes are issued before the CardType delete
    # below -- SQLAlchemy's unit of work has no declared relationship() tying
    # EnterpriseObjectCardMapping to CardType, so a single flush at commit
    # time is not guaranteed to order them correctly and can hit the same
    # FK violation this fix exists to avoid.
    await db.flush()

    await audit_log.record(
        db,
        action="admin.metamodel.type.deleted",
        category="admin",
        actor=user,
        target=("card_type", key, t.label),
        context={
            "mode": "deleted",
            "card_count": impact.card_count,
            "relation_count": impact.relation_count,
            "relation_types_removed": sorted(rt.label for rt in impact.relation_types),
            "calculation_count": impact.calculation_count,
            "stakeholder_role_count": impact.stakeholder_role_count,
        },
    )
    await db.delete(t)
    await db.commit()
    PermissionService.invalidate_type_permission_cache(key)
    return {
        "status": "deleted",
        "key": key,
        "cards_removed": impact.card_count,
        "relations_removed": impact.relation_count,
        "relation_types_removed": [rt.key for rt in impact.relation_types],
        "calculations_removed": impact.calculation_count,
        "stakeholder_roles_removed": impact.stakeholder_role_count,
    }


# ── Relation Types ─────────────────────────────────────────────────────

# Successor relations (key ends with "Successor") are a separate, UI-isolated
# category — see frontend RelationsSection/MetamodelGraph/MetamodelAdmin, which all
# filter on key.endsWith("Successor"). The suffix is how the auto-provisioned lineage
# relation type is found and named when an admin enables "Supports Lineage"; it no
# longer carries a uniqueness exemption, since any number of relation types may share
# an ordered (source, target) pair.
SUCCESSOR_KEY_SUFFIX = "Successor"

# Canonical label + i18n for an auto-provisioned successor (lineage) relation
# type, imported from the seed so the relation type created when an admin
# enables "Supports Lineage" is byte-identical to the seeded built-ins. The
# wording lived here as a hand-copied literal until #1091, where the reverse
# verb ("is preceded by") turned out to mean the same as the forward one and
# had to be corrected in seven seed entries, this module and a migration.
# The English label is injected into the translations dict here exactly as the
# seed does it, so `translations["label"]["en"]` shadows the raw column the
# same way for both paths.
_SUCCESSOR_LABEL = SUCCESSOR_LABEL
_SUCCESSOR_REVERSE_LABEL = SUCCESSOR_REVERSE_LABEL
_SUCCESSOR_TRANSLATIONS: dict = _inject_english_translations_relation(
    {
        "label": SUCCESSOR_LABEL,
        "reverse_label": SUCCESSOR_REVERSE_LABEL,
        "translations": copy.deepcopy(SUCCESSOR_TRANSLATIONS),
    }
)["translations"]


def _sync_english_verb_translations(r: RelationType, body: dict) -> None:
    """Keep ``translations[...]["en"]`` in step with a raw ``label`` rename.

    ``translations[property][locale]`` **shadows** the raw column everywhere the
    frontend resolves a metamodel label, and every seeded relation type carries an
    ``en`` entry (``_inject_english_translations_relation`` in ``seed.py``; existing
    installs were backfilled by migration 038). A client that renames a relation type
    by writing ``label`` alone therefore changed nothing a user could see (#912).

    Only applies when the caller does **not** manage ``translations`` itself — the
    admin UI sends its own per-locale map and must win, so this is the safety net for
    API-only writers (MCP, scripts, imports).
    """
    if "translations" in body:
        return
    trans = dict(r.translations or {})
    changed = False
    for column, prop in (("label", "label"), ("reverse_label", "reverse_label")):
        if column not in body:
            continue
        value = getattr(r, column)
        entries = trans.get(prop)
        if not isinstance(entries, dict) or "en" not in entries or entries["en"] == value:
            continue
        updated = {**entries}
        if value:
            updated["en"] = value
        else:
            # Cleared verb — drop the stale translation so resolution falls back.
            updated.pop("en", None)
        trans[prop] = updated
        changed = True
    if changed:
        r.translations = trans


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
    # `.first()`, not `scalar_one_or_none()`: any number of relation types may share
    # an ordered pair, so more than one `*Successor` self-relation is possible and
    # `scalar_one_or_none()` would raise MultipleResultsFound — a 500 on every
    # card-type create/update with `has_successors`.
    existing = await db.execute(
        select(RelationType).where(
            RelationType.source_type_key == card_type_key,
            RelationType.target_type_key == card_type_key,
            RelationType.is_hidden == False,  # noqa: E712
            RelationType.key.endswith(SUCCESSOR_KEY_SUFFIX),
        )
    )
    if existing.scalars().first() is not None:
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
            # Deep-copy: assigning the module constant by reference would let an
            # in-place edit of one row's translations corrupt it process-wide.
            translations=copy.deepcopy(_SUCCESSOR_TRANSLATIONS),
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
    _validate_archimate(body, relation=True)
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
        translations=body.get("translations") or {},
        source_visible=body.get("source_visible", True),
        source_mandatory=body.get("source_mandatory", False),
        target_visible=body.get("target_visible", True),
        target_mandatory=body.get("target_mandatory", False),
        archimate_type=body.get("archimate_type"),
        archimate_access=body.get("archimate_access"),
        archimate_reversed=body.get("archimate_reversed", False),
    )
    db.add(rt)
    labels = await audit_labels.card_type_labels(db, (rt.source_type_key, rt.target_type_key))
    await audit_log.record(
        db,
        action="admin.metamodel.relation_type.created",
        category="admin",
        actor=user,
        target=("relation_type", rt.key, rt.label),
        context={
            "source_type": _type_label(labels, rt.source_type_key),
            "target_type": _type_label(labels, rt.target_type_key),
            "cardinality": rt.cardinality,
        },
    )
    await db.commit()
    await db.refresh(rt)
    return _serialize_relation_type(rt)


@router.patch("/relation-types/{key}")
async def update_relation_type(
    key: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    _validate_archimate(body, relation=True)
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

    audit_fields = _RELATION_TYPE_AUDIT_SCALARS + _RELATION_TYPE_AUDIT_JSON
    audit_before = _audit_snapshot(r, audit_fields)

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
        "archimate_type",
        "archimate_access",
        "archimate_reversed",
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
        elif field == "translations":
            # NOT NULL column — a client clearing every translation must land
            # an empty map, not a constraint violation.
            r.translations = body["translations"] or {}
        else:
            setattr(r, field, body[field])

    _sync_english_verb_translations(r, body)

    audit_after = _audit_snapshot(r, audit_fields)
    endpoints_moved = any(
        audit_before[f] != audit_after[f] for f in ("source_type_key", "target_type_key")
    )
    type_labels = (
        await audit_labels.card_type_labels(
            db,
            (
                audit_before["source_type_key"],
                audit_before["target_type_key"],
                audit_after["source_type_key"],
                audit_after["target_type_key"],
            ),
        )
        if endpoints_moved
        else {}
    )
    changes, items = _relation_type_audit_changes(audit_before, audit_after, type_labels)
    if changes or items:
        await audit_log.record(
            db,
            action="admin.metamodel.relation_type.updated",
            category="admin",
            actor=user,
            target=("relation_type", r.key, r.label),
            changes=changes,
            items=items,
        )
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

    await audit_log.record(
        db,
        action="admin.metamodel.relation_type.deleted",
        category="admin",
        actor=user,
        target=("relation_type", key, r.label),
        context={
            "mode": "hidden" if r.built_in else "deleted",
            "instances_removed": instance_count,
        },
    )

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

    r.is_hidden = False
    await audit_log.record(
        db,
        action="admin.metamodel.relation_type.restored",
        category="admin",
        actor=user,
        target=("relation_type", key, r.label),
    )
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
        "reference_number": p.reference_number,
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
        reference_number=await principle_service.next_principle_reference(db),
        title=body.title,
        description=body.description,
        rationale=body.rationale,
        implications=body.implications,
        is_active=body.is_active,
        sort_order=body.sort_order,
    )
    db.add(p)
    await audit_log.record(
        db,
        action="admin.principle.created",
        category="admin",
        actor=user,
        target=("principle", str(p.id), p.title),
        context={"is_active": p.is_active},
    )
    await db.commit()
    await db.refresh(p)
    return _serialize_principle(p)


@router.post("/principles/bulk-import", response_model=PrincipleImportResponse)
async def bulk_import_principles(
    body: PrincipleImportRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PrincipleImportResponse:
    """Spreadsheet importer for EA principles (admin only).

    Each row is matched on ``reference_number``, then on title
    (case-insensitive). A matched principle is updated when a value differs
    and skipped when nothing does; any other row creates a principle with a
    fresh ``P-NNN`` reference. A column missing from the sheet leaves that
    field untouched. ``dry_run=True`` validates and matches every row, then
    rolls back, so the dialog can preview exactly what applying will do.
    """
    await PermissionService.require_permission(db, user, "admin.metamodel")
    # Our own savepoint, so the discard at the end of a dry run only undoes
    # this import and never reaches a wrapping transaction.
    dry_run_savepoint = await db.begin_nested() if body.dry_run else None

    outcomes = await principle_service.import_principle_rows(
        db,
        [principle_service.PrincipleImportRow(**item.model_dump()) for item in body.items],
    )
    counts = {
        status: sum(1 for o in outcomes if o.status == status)
        for status in ("created", "updated", "skipped", "failed")
    }

    if dry_run_savepoint is not None:
        await dry_run_savepoint.rollback()
    elif counts["created"] or counts["updated"]:
        await audit_log.record(
            db,
            action="admin.principle.imported",
            category="admin",
            actor=user,
            target=("principles", None, "Spreadsheet import"),
            context={
                "source": "Spreadsheet",
                "created": counts["created"],
                "updated": counts["updated"],
                "skipped": counts["skipped"],
                "failed": counts["failed"],
            },
        )
        await db.commit()
    else:
        await db.rollback()

    return PrincipleImportResponse(
        results=[PrincipleImportResult(**vars(o)) for o in outcomes],
        dry_run=body.dry_run,
        **counts,
    )


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
    changes = _clipped(audit_log.diff(p, updates))
    for k, v in updates.items():
        setattr(p, k, v)
    if changes:
        await audit_log.record(
            db,
            action="admin.principle.updated",
            category="admin",
            actor=user,
            target=("principle", str(p.id), p.title),
            changes=changes,
        )
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
    pid = uuid.UUID(principle_id)
    title = (
        await db.execute(select(EAPrinciple.title).where(EAPrinciple.id == pid))
    ).scalar_one_or_none()
    await db.execute(delete(EAPrinciple).where(EAPrinciple.id == pid))
    if title is not None:
        # Deleting an id that does not exist is a 204 no-op; only a real
        # deletion is an admin action worth a row.
        await audit_log.record(
            db,
            action="admin.principle.deleted",
            category="admin",
            actor=user,
            target=("principle", str(pid), title),
        )
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
    await audit_log.record(
        db,
        action="admin.regulation.created",
        category="admin",
        actor=user,
        target=("regulation", r.key, r.label),
        context={"is_enabled": r.is_enabled},
    )
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
    changes = audit_log.diff(r, updates, keys=_CATALOGUE_AUDIT_SCALARS)
    items = _label_translation_items(r.translations, updates.get("translations", r.translations))
    for k, v in updates.items():
        setattr(r, k, v)
    if changes or items:
        await audit_log.record(
            db,
            action="admin.regulation.updated",
            category="admin",
            actor=user,
            target=("regulation", r.key, r.label),
            changes=changes,
            items=items,
        )
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
    await audit_log.record(
        db,
        action="admin.regulation.deleted",
        category="admin",
        actor=user,
        target=("regulation", r.key, r.label),
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
    await audit_log.record(
        db,
        action="admin.metamodel.resource_type.created",
        category="admin",
        actor=user,
        target=("resource_type", str(r.id), r.label),
        context={"kind": r.kind, "key": r.key},
    )
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
    changes = audit_log.diff(r, updates, keys=_RESOURCE_TYPE_AUDIT_SCALARS)
    items = _label_translation_items(r.translations, updates.get("translations", r.translations))
    for k, v in updates.items():
        setattr(r, k, v)
    if changes or items:
        await audit_log.record(
            db,
            action="admin.metamodel.resource_type.updated",
            category="admin",
            actor=user,
            target=("resource_type", str(r.id), r.label),
            changes=changes,
            items=items,
        )
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
    await audit_log.record(
        db,
        action="admin.metamodel.resource_type.deleted",
        category="admin",
        actor=user,
        target=("resource_type", str(r.id), r.label),
        context={"kind": r.kind, "key": r.key},
    )
    await db.delete(r)
    await db.commit()


# ── Enterprise Objects ──────────────────────────────────────────────────

_VALID_ASPECTS = {"passive", "behavior", "active"}


def _serialize_enterprise_object_card_mapping(m: EnterpriseObjectCardMapping) -> dict:
    return {
        "id": str(m.id),
        "enterprise_object_key": m.enterprise_object_key,
        "card_type_key": m.card_type_key,
        "card_subtype_key": m.card_subtype_key,
    }


def _serialize_enterprise_object(
    o: EnterpriseObject, mappings: list[EnterpriseObjectCardMapping]
) -> dict:
    return {
        "key": o.key,
        "name": o.name,
        "description": o.description,
        "icon": o.icon,
        "color": o.color,
        "layer": o.layer,
        "aspect": o.aspect,
        "is_standard": o.is_standard,
        "is_locked": o.is_locked,
        "is_hidden": o.is_hidden,
        "sort_order": o.sort_order,
        "card_mappings": [_serialize_enterprise_object_card_mapping(m) for m in mappings],
    }


@router.get("/enterprise-objects")
async def list_enterprise_objects(
    include_hidden: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List the ArchiMate Enterprise Object registry with their card mappings.

    Authenticated read, like ``GET /types`` — the drawing palette calls this
    for any user who can edit a diagram, not just admins who manage the
    metamodel, so there is no ``admin.metamodel`` gate here.
    """
    q = select(EnterpriseObject).order_by(EnterpriseObject.sort_order)
    if not include_hidden:
        q = q.where(EnterpriseObject.is_hidden == False)  # noqa: E712
    result = await db.execute(q)
    objects = result.scalars().all()

    mappings_result = await db.execute(select(EnterpriseObjectCardMapping))
    mappings_by_object: dict[str, list[EnterpriseObjectCardMapping]] = {}
    for m in mappings_result.scalars().all():
        mappings_by_object.setdefault(m.enterprise_object_key, []).append(m)

    return [_serialize_enterprise_object(o, mappings_by_object.get(o.key, [])) for o in objects]


@router.post("/enterprise-objects", status_code=201)
async def create_enterprise_object(
    body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """Create a custom Enterprise Object. Always ``is_standard=False`` and
    ``is_locked=False`` — the standard registry rows only ever come from
    ``seed_enterprise_objects``."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    key = body.get("key", "")
    if key in taxonomy.ALL_ELEMENT_TYPES:
        # Reject even if no row for this standard key exists yet (e.g. a
        # fresh DB that hasn't been seeded) — the key is reserved regardless.
        raise HTTPException(409, "Key collides with a standard ArchiMate element type")
    existing = await db.execute(select(EnterpriseObject).where(EnterpriseObject.key == key))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Enterprise object key already exists")
    aspect = body.get("aspect")
    if aspect is not None and aspect not in _VALID_ASPECTS:
        raise HTTPException(422, f"aspect must be one of {sorted(_VALID_ASPECTS)} or null")

    max_order = await db.execute(select(func.max(EnterpriseObject.sort_order)))
    next_order = (max_order.scalar() or 0) + 1

    o = EnterpriseObject(
        key=body["key"],
        name=body["name"],
        description=body.get("description"),
        icon=body.get("icon", "category"),
        color=body.get("color", "#1976d2"),
        layer=body.get("layer"),
        aspect=aspect,
        is_standard=False,
        is_locked=False,
        is_hidden=body.get("is_hidden", False),
        sort_order=body.get("sort_order", next_order),
    )
    db.add(o)
    await audit_log.record(
        db,
        action="admin.metamodel.enterprise_object.created",
        category="admin",
        actor=user,
        target=("enterprise_object", o.key, o.name),
    )
    await db.commit()
    await db.refresh(o)
    return _serialize_enterprise_object(o, [])


@router.patch("/enterprise-objects/{key}")
async def update_enterprise_object(
    key: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(EnterpriseObject).where(EnterpriseObject.key == key))
    o = result.scalar_one_or_none()
    if not o:
        raise HTTPException(404, "Enterprise object not found")
    if o.is_locked:
        # Checked before touching the body at all, so a locked row's fields
        # never change even if some of the PATCH body's keys would otherwise
        # be no-ops.
        raise HTTPException(422, "Enterprise object is locked and cannot be edited")

    if "aspect" in body and body["aspect"] is not None and body["aspect"] not in _VALID_ASPECTS:
        raise HTTPException(422, f"aspect must be one of {sorted(_VALID_ASPECTS)} or null")

    updatable = [
        "name",
        "description",
        "icon",
        "color",
        "layer",
        "aspect",
        "is_hidden",
        "sort_order",
    ]
    changes = audit_log.diff(o, {k: body[k] for k in updatable if k in body}, keys=updatable)
    for field in updatable:
        if field in body:
            setattr(o, field, body[field])

    if changes:
        await audit_log.record(
            db,
            action="admin.metamodel.enterprise_object.updated",
            category="admin",
            actor=user,
            target=("enterprise_object", o.key, o.name),
            changes=changes,
        )
    await db.commit()
    await db.refresh(o)
    mappings_result = await db.execute(
        select(EnterpriseObjectCardMapping).where(
            EnterpriseObjectCardMapping.enterprise_object_key == o.key
        )
    )
    return _serialize_enterprise_object(o, mappings_result.scalars().all())


@router.post("/enterprise-objects/{key}/card-mappings", status_code=201)
async def add_card_mapping(
    key: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """Add one card-type (or card-type+subtype) mapping row to an Enterprise Object."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(EnterpriseObject).where(EnterpriseObject.key == key))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Enterprise object not found")

    card_type_key = body.get("card_type_key")
    if not card_type_key:
        raise HTTPException(400, "card_type_key is required")
    type_exists = await db.execute(select(CardType.key).where(CardType.key == card_type_key))
    if not type_exists.scalar_one_or_none():
        raise HTTPException(400, f"Card type '{card_type_key}' does not exist")

    # Deliberately not validated against the card type's live `subtypes` —
    # a later subtype rename must not retroactively break this row.
    card_subtype_key = body.get("card_subtype_key")
    if card_subtype_key is not None and not (
        isinstance(card_subtype_key, str) and card_subtype_key
    ):
        raise HTTPException(400, "card_subtype_key must be a non-empty string or omitted")

    m = EnterpriseObjectCardMapping(
        enterprise_object_key=key,
        card_type_key=card_type_key,
        card_subtype_key=card_subtype_key,
    )
    db.add(m)
    try:
        # Flushed here, ahead of audit_log.record's own flush, so the unique
        # constraint's IntegrityError is caught before anything else touches
        # the session (audit_log.record flushes too, but outside this guard).
        await db.flush()
    except IntegrityError:
        # Unique constraint is (enterprise_object_key, card_type_key,
        # card_subtype_key) with nulls_not_distinct — two NULL-subtype rows
        # for the same object+type collide too, not just literal duplicates.
        await db.rollback()
        raise HTTPException(409, "This card mapping already exists") from None
    await audit_log.record(
        db,
        action="admin.metamodel.enterprise_object.card_mapping_added",
        category="admin",
        actor=user,
        target=("enterprise_object", key, card_type_key),
        context={"card_type_key": card_type_key, "card_subtype_key": card_subtype_key},
    )
    await db.commit()
    await db.refresh(m)
    return _serialize_enterprise_object_card_mapping(m)


@router.delete("/enterprise-objects/{key}/card-mappings/{mapping_id}", status_code=204)
async def remove_card_mapping(
    key: str,
    mapping_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(
        select(EnterpriseObjectCardMapping).where(
            EnterpriseObjectCardMapping.id == uuid.UUID(mapping_id),
            EnterpriseObjectCardMapping.enterprise_object_key == key,
        )
    )
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Card mapping not found")
    await audit_log.record(
        db,
        action="admin.metamodel.enterprise_object.card_mapping_removed",
        category="admin",
        actor=user,
        target=("enterprise_object", key, m.card_type_key),
        context={"card_type_key": m.card_type_key, "card_subtype_key": m.card_subtype_key},
    )
    await db.delete(m)
    await db.commit()


# ── ArchiMate Viewpoints ─────────────────────────────────────────────────


def _serialize_viewpoint_object(o: ArchimateViewpointObject) -> dict:
    return {
        "id": str(o.id),
        "viewpoint_key": o.viewpoint_key,
        "enterprise_object_key": o.enterprise_object_key,
    }


def _serialize_viewpoint_example(e: ArchimateViewpointExample) -> dict:
    return {"id": str(e.id), "name": e.name}


def _serialize_viewpoint(
    v: ArchimateViewpoint, objects: list[str], examples: list[dict] | None = None
) -> dict:
    return {
        "key": v.key,
        "name": v.name,
        "icon": v.icon,
        "description": v.description,
        "layer": v.layer,
        "is_standard": v.is_standard,
        "is_hidden": v.is_hidden,
        "sort_order": v.sort_order,
        "objects": objects,
        # Which of TAB_LAYERS' tabs (business/application/technology) this viewpoint is tagged
        # under, for the Viewpoint Catalog's "Domain" column and the layer-scoped Diagrams pages'
        # filter. Stored, not derived: seeded from the allowed objects' layers (viewpoint_seed.py)
        # but an admin may retag it afterward independently of what the viewpoint actually allows.
        "domains": v.domains or [],
        "examples": examples or [],
    }


async def _viewpoint_examples(db: AsyncSession, key: str) -> list[dict]:
    result = await db.execute(
        select(ArchimateViewpointExample).where(ArchimateViewpointExample.viewpoint_key == key)
    )
    return [_serialize_viewpoint_example(e) for e in result.scalars().all()]


def _exchange_xml_from_upload(xml: str) -> str:
    """Convert Archi's native ``.archimate`` export to Exchange Format first;
    pass anything else (already Exchange XML, or simply invalid XML) through
    unchanged so ``validate_exchange`` reports it as a proper issue instead of
    this raising.

    Detection reuses ``convert_archi_native_to_exchange``'s own root-tag check
    (the ``archimatetool.com`` namespace vs. the Exchange XSD root): a
    ``ValueError`` from it means the root wasn't ``archimate:model``. A
    ``ParseError`` means the XML was malformed before that check even ran.
    Those are the only two exceptions that function raises today -- caught
    narrowly here, not a bare ``Exception``, so a genuine bug introduced
    into the converter later surfaces as a clear failure instead of being
    silently reinterpreted as "not Archi-native".
    """
    if len(xml.encode("utf-8", "replace")) > MAX_XML_BYTES:
        # Let validate_exchange's own size check produce the "too_large" issue
        # rather than converting a payload this large first.
        return xml
    try:
        return convert_archi_native_to_exchange(xml)
    except (ValueError, ParseError):
        return xml


@router.get("/viewpoints")
async def list_viewpoints(
    include_hidden: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List the ArchiMate Viewpoint catalog with their allowed objects.

    Authenticated read, like ``list_enterprise_objects`` — the
    diagram-creation picker calls this for any user who can create a
    diagram, not just admins who manage the metamodel, so there is no
    ``admin.metamodel`` gate here.
    """
    q = select(ArchimateViewpoint).order_by(ArchimateViewpoint.sort_order)
    if not include_hidden:
        q = q.where(ArchimateViewpoint.is_hidden == False)  # noqa: E712
    result = await db.execute(q)
    viewpoints = result.scalars().all()

    objects_result = await db.execute(select(ArchimateViewpointObject))
    objects_by_viewpoint: dict[str, list[str]] = {}
    for o in objects_result.scalars().all():
        objects_by_viewpoint.setdefault(o.viewpoint_key, []).append(o.enterprise_object_key)

    examples_result = await db.execute(select(ArchimateViewpointExample))
    examples_by_viewpoint: dict[str, list[dict]] = {}
    for e in examples_result.scalars().all():
        examples_by_viewpoint.setdefault(e.viewpoint_key, []).append(
            _serialize_viewpoint_example(e)
        )

    return [
        _serialize_viewpoint(
            v, objects_by_viewpoint.get(v.key, []), examples_by_viewpoint.get(v.key, [])
        )
        for v in viewpoints
    ]


@router.get("/viewpoints/{key}")
async def get_viewpoint(
    key: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    result = await db.execute(select(ArchimateViewpoint).where(ArchimateViewpoint.key == key))
    v = result.scalar_one_or_none()
    if not v:
        raise HTTPException(404, "Viewpoint not found")
    objects_result = await db.execute(
        select(ArchimateViewpointObject.enterprise_object_key).where(
            ArchimateViewpointObject.viewpoint_key == key
        )
    )
    objects = list(objects_result.scalars().all())
    return _serialize_viewpoint(v, objects, await _viewpoint_examples(db, key))


_DOMAINS = frozenset(TAB_LAYERS)


def _validate_domains(domains: object) -> list[str]:
    if not isinstance(domains, list) or not all(isinstance(d, str) for d in domains):
        raise HTTPException(422, "domains must be a list of strings")
    unknown = sorted(set(domains) - _DOMAINS)
    if unknown:
        raise HTTPException(422, f"Unknown domain(s): {', '.join(unknown)}")
    # De-duplicated, in TAB_LAYERS' own order -- not whatever order the client sent.
    return [d for d in TAB_LAYERS if d in domains]


@router.post("/viewpoints", status_code=201)
async def create_viewpoint(
    body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """Create a custom Viewpoint. Always ``is_standard=False`` — the standard
    registry rows only ever come from ``seed_viewpoints``."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    existing = await db.execute(
        select(ArchimateViewpoint).where(ArchimateViewpoint.key == body.get("key", ""))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Viewpoint key already exists")

    max_order = await db.execute(select(func.max(ArchimateViewpoint.sort_order)))
    next_order = (max_order.scalar() or 0) + 1

    v = ArchimateViewpoint(
        key=body["key"],
        name=body["name"],
        icon=body.get("icon", "category"),
        description=body.get("description"),
        layer=body["layer"],
        is_standard=False,
        is_hidden=body.get("is_hidden", False),
        sort_order=body.get("sort_order", next_order),
        domains=_validate_domains(body["domains"]) if "domains" in body else [],
    )
    db.add(v)
    await audit_log.record(
        db,
        action="admin.metamodel.viewpoint.created",
        category="admin",
        actor=user,
        target=("viewpoint", v.key, v.name),
    )
    await db.commit()
    await db.refresh(v)
    return _serialize_viewpoint(v, [])


@router.patch("/viewpoints/{key}")
async def update_viewpoint(
    key: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(ArchimateViewpoint).where(ArchimateViewpoint.key == key))
    v = result.scalar_one_or_none()
    if not v:
        raise HTTPException(404, "Viewpoint not found")

    if "domains" in body:
        body = {**body, "domains": _validate_domains(body["domains"])}

    updatable = ["name", "icon", "description", "layer", "is_hidden", "sort_order", "domains"]
    changes = audit_log.diff(v, {k: body[k] for k in updatable if k in body}, keys=updatable)
    for field in updatable:
        if field in body:
            setattr(v, field, body[field])

    if changes:
        await audit_log.record(
            db,
            action="admin.metamodel.viewpoint.updated",
            category="admin",
            actor=user,
            target=("viewpoint", v.key, v.name),
            changes=changes,
        )
    await db.commit()
    await db.refresh(v)
    objects_result = await db.execute(
        select(ArchimateViewpointObject.enterprise_object_key).where(
            ArchimateViewpointObject.viewpoint_key == v.key
        )
    )
    objects = list(objects_result.scalars().all())
    return _serialize_viewpoint(v, objects, await _viewpoint_examples(db, v.key))


@router.post("/viewpoints/{key}/objects", status_code=201)
async def add_viewpoint_object(
    key: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """Add one allowed Enterprise Object to a Viewpoint's allowed-objects list."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(ArchimateViewpoint).where(ArchimateViewpoint.key == key))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Viewpoint not found")

    enterprise_object_key = body.get("enterprise_object_key")
    if not enterprise_object_key:
        raise HTTPException(400, "enterprise_object_key is required")
    eo_exists = await db.execute(
        select(EnterpriseObject.key).where(EnterpriseObject.key == enterprise_object_key)
    )
    if not eo_exists.scalar_one_or_none():
        raise HTTPException(400, f"Enterprise object '{enterprise_object_key}' does not exist")

    o = ArchimateViewpointObject(viewpoint_key=key, enterprise_object_key=enterprise_object_key)
    db.add(o)
    try:
        # Flushed here, ahead of audit_log.record's own flush, so the unique
        # constraint's IntegrityError is caught before anything else touches
        # the session (audit_log.record flushes too, but outside this guard).
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "This object is already allowed on this viewpoint") from None
    await audit_log.record(
        db,
        action="admin.metamodel.viewpoint.object_added",
        category="admin",
        actor=user,
        target=("viewpoint", key, enterprise_object_key),
        context={"enterprise_object_key": enterprise_object_key},
    )
    await db.commit()
    await db.refresh(o)
    return _serialize_viewpoint_object(o)


@router.delete("/viewpoints/{key}/objects/{enterprise_object_key}", status_code=204)
async def remove_viewpoint_object(
    key: str,
    enterprise_object_key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(
        select(ArchimateViewpointObject).where(
            ArchimateViewpointObject.viewpoint_key == key,
            ArchimateViewpointObject.enterprise_object_key == enterprise_object_key,
        )
    )
    o = result.scalar_one_or_none()
    if not o:
        raise HTTPException(404, "Allowed object not found")
    await audit_log.record(
        db,
        action="admin.metamodel.viewpoint.object_removed",
        category="admin",
        actor=user,
        target=("viewpoint", key, enterprise_object_key),
        context={"enterprise_object_key": enterprise_object_key},
    )
    await db.delete(o)
    await db.commit()


@router.delete("/viewpoints/{key}")
async def delete_viewpoint(
    key: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(ArchimateViewpoint).where(ArchimateViewpoint.key == key))
    v = result.scalar_one_or_none()
    if not v:
        raise HTTPException(404, "Viewpoint not found")

    diagram_count = (
        await db.execute(
            select(func.count()).select_from(Diagram).where(Diagram.viewpoint_key == key)
        )
    ).scalar() or 0
    if diagram_count > 0:
        raise HTTPException(
            409,
            detail={
                "message": f"Viewpoint '{key}' is used by {diagram_count} diagram(s).",
                "diagram_count": diagram_count,
                "key": key,
            },
        )

    await audit_log.record(
        db,
        action="admin.metamodel.viewpoint.deleted",
        category="admin",
        actor=user,
        target=("viewpoint", key, v.name),
        context={"mode": "hidden" if v.is_standard else "deleted"},
    )

    if v.is_standard:
        # Soft-delete standard viewpoints so they can be restored from the seed.
        v.is_hidden = True
        await db.commit()
        return {"status": "hidden", "key": key}

    # The bridge tables' FKs have no ON DELETE, so clear them first.
    for model in (ArchimateViewpointObject, ArchimateViewpointExample, ArchimateViewpointTabCard):
        await db.execute(delete(model).where(model.viewpoint_key == key))
    await db.delete(v)
    await db.commit()
    return {"status": "deleted", "key": key}


@router.post("/viewpoints/{key}/examples", status_code=201)
async def upload_viewpoint_example(
    key: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """Upload an example diagram for a Viewpoint.

    ``xml`` may be Archi's native ``.archimate`` export (auto-converted via
    ``convert_archi_native_to_exchange``) or ArchiMate Exchange Format XML
    directly -- either way it is run through ``validate_exchange()`` before
    anything is persisted; on any issue this is a 422 with the validator's
    own issue list and nothing is saved.
    """
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(ArchimateViewpoint).where(ArchimateViewpoint.key == key))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Viewpoint not found")

    name = body.get("name")
    xml = body.get("xml")
    if not name or not isinstance(xml, str) or not xml.strip():
        raise HTTPException(400, "name and xml are required")

    exchange_xml = await run_in_threadpool(_exchange_xml_from_upload, xml)
    issues = await run_in_threadpool(validate_exchange, exchange_xml)
    if issues:
        raise HTTPException(
            422,
            {"message": "Invalid ArchiMate model", "issues": [asdict(i) for i in issues]},
        )

    example = ArchimateViewpointExample(viewpoint_key=key, name=name, exchange_xml=exchange_xml)
    db.add(example)
    await audit_log.record(
        db,
        action="admin.metamodel.viewpoint.example_uploaded",
        category="admin",
        actor=user,
        target=("viewpoint", key, name),
    )
    await db.commit()
    await db.refresh(example)
    return _serialize_viewpoint_example(example)


@router.delete("/viewpoints/{key}/examples/{example_id}", status_code=204)
async def delete_viewpoint_example(
    key: str,
    example_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    try:
        example_uuid = uuid.UUID(example_id)
    except ValueError:
        raise HTTPException(404, "Example not found") from None
    result = await db.execute(
        select(ArchimateViewpointExample).where(
            ArchimateViewpointExample.id == example_uuid,
            ArchimateViewpointExample.viewpoint_key == key,
        )
    )
    example = result.scalar_one_or_none()
    if not example:
        raise HTTPException(404, "Example not found")
    await audit_log.record(
        db,
        action="admin.metamodel.viewpoint.example_deleted",
        category="admin",
        actor=user,
        target=("viewpoint", key, example.name),
    )
    await db.delete(example)
    await db.commit()


@router.get("/card-type-archimate-mapping")
async def get_card_type_archimate_mapping(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """Every card type's (and subtype's) current ArchiMate element type
    mapping, resolved from the EnterpriseObjectCardMapping bridge table --
    the n:m replacement for the old single ``CardType.archimate_type``
    column. Consumed by the MCP server's ``get_archimate_mapping`` tool.

    Authenticated read, like ``GET /enterprise-objects`` — no
    ``admin.metamodel`` gate, since this only reports the live mapping.
    Excludes hidden/soft-deleted types and orders by ``sort_order``, same as
    ``GET /metamodel/types`` (the endpoint this one is meant to sit beside
    for the MCP tool, which should not see a type a `DELETE /types/{key}`
    soft-delete hid from everywhere else).
    """
    result = await db.execute(
        select(CardType.key, CardType.subtypes)
        .where(CardType.is_hidden == False)  # noqa: E712
        .order_by(CardType.sort_order)
    )
    card_types = [{"key": key, "subtypes": subtypes or []} for key, subtypes in result.all()]
    return {"card_types": await get_card_type_mapping(db, card_types)}


# ── Card type categories (the EA layers) ──────────────────────────────
#
# ``card_types.category`` names a row of this registry by ``key``. The four
# built-in layers are locked (label, colour, translations, delete); their
# position in the order is not, since a custom layer may sit between two of
# them. The logic lives in ``services/card_type_categories`` — these handlers
# only translate its answers into HTTP.


class CardTypeCategoryCreate(BaseModel):
    label: str = Field(..., max_length=300)
    color: str | None = None
    translations: dict[str, str] | None = None


class CardTypeCategoryUpdate(BaseModel):
    label: str | None = Field(None, max_length=300)
    color: str | None = None
    translations: dict[str, str] | None = None


class CardTypeCategoryOrder(BaseModel):
    keys: list[str]


def _category_http_error(exc: card_type_categories.CategoryError) -> HTTPException:
    return HTTPException(400, detail={"error": exc.code, "message": str(exc)})


def _clean_translations(translations: dict[str, str] | None) -> dict[str, str]:
    """``translations`` with blank labels dropped and the rest trimmed — an
    empty field in the editor means "fall back to the label"."""
    return {
        locale: label.strip()
        for locale, label in (translations or {}).items()
        if isinstance(label, str) and label.strip()
    }


async def _validated_category(db: AsyncSession, value: object, current: str | None = None):
    """``value`` as a card type stores it — trimmed, ``None`` when blank —
    once it names a registry key. Re-sending a type's current category is
    always accepted, so a value adopted nowhere (written before the registry
    by a path that did not adopt) cannot block an unrelated edit of the type."""
    try:
        category = card_type_categories.normalize_category_value(value)
    except card_type_categories.CategoryError as exc:
        raise _category_http_error(exc) from exc
    if category is None:
        return None
    if current is not None and category == current.strip():
        return category
    if not await card_type_categories.category_exists(db, category):
        raise HTTPException(
            400,
            detail={
                "error": "unknown_category",
                "message": f"Unknown category '{category}'. Create it under "
                "Manage categories first.",
                "category": category,
            },
        )
    return category


@router.get("/categories")
async def list_card_type_categories(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Every card type category, in layer order. Any signed-in user may read
    it — every surface that draws layers needs the labels and colours."""
    rows = await card_type_categories.list_categories(db)
    return [card_type_categories.serialize(c) for c in rows]


@router.post("/categories", status_code=201)
async def create_card_type_category(
    body: CardTypeCategoryCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a custom category; its key is the label as typed, trimmed."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    try:
        key = card_type_categories.normalize_key(body.label)
    except card_type_categories.CategoryError as exc:
        raise _category_http_error(exc) from exc
    color = body.color or card_type_categories.DEFAULT_COLOR
    _validate_color({"color": color})
    existing = await card_type_categories.list_categories(db)
    clash = card_type_categories.is_duplicate(existing, key)
    if clash is not None:
        raise HTTPException(
            409,
            detail={
                "error": "category_exists",
                "message": f"A category named '{clash.label}' already exists",
                "key": clash.key,
            },
        )
    c = CardTypeCategory(
        id=uuid.uuid4(),
        key=key,
        label=key,
        color=color,
        sort_order=await card_type_categories.next_sort_order(db),
        built_in=False,
        translations=_clean_translations(body.translations),
    )
    db.add(c)
    await audit_log.record(
        db,
        action="admin.metamodel.category.created",
        category="admin",
        actor=user,
        target=("card_type_category", c.key, c.label),
        context={"color": c.color},
    )
    await db.commit()
    await db.refresh(c)
    return card_type_categories.serialize(c)


@router.put("/categories/order")
async def reorder_card_type_categories(
    body: CardTypeCategoryOrder,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Rewrite the layer order. ``keys`` must list every category exactly once
    — the built-in layers included, since a custom one may sit between them."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    rows = await card_type_categories.list_categories(db)
    try:
        order = card_type_categories.validate_order([c.key for c in rows], body.keys)
    except card_type_categories.CategoryError as exc:
        raise _category_http_error(exc) from exc
    by_key = {c.key: c for c in rows}
    before = [c.key for c in rows]
    for index, key in enumerate(order):
        by_key[key].sort_order = index
    if order != before:
        await audit_log.record(
            db,
            action="admin.metamodel.category.reordered",
            category="admin",
            actor=user,
            target=("card_type_category", None, None),
            context={"order": [by_key[k].label for k in order]},
        )
    await db.commit()
    rows = await card_type_categories.list_categories(db)
    return [card_type_categories.serialize(c) for c in rows]


@router.patch("/categories/{key:path}")
async def update_card_type_category(
    key: str,
    body: CardTypeCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Edit a custom category's label, colour or translations. The key never
    changes (it is what card types store); a built-in layer is locked."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    c = await card_type_categories.get_category(db, key)
    if c is None:
        raise HTTPException(404, "Category not found")
    if c.built_in:
        raise HTTPException(
            400,
            detail={
                "error": "built_in_locked",
                "message": "A built-in category cannot be renamed, recoloured or deleted",
                "key": c.key,
            },
        )
    updates = body.model_dump(exclude_unset=True)
    if "label" in updates:
        try:
            updates["label"] = card_type_categories.normalize_key(updates["label"])
        except card_type_categories.CategoryError as exc:
            raise _category_http_error(exc) from exc
        rows = await card_type_categories.list_categories(db)
        clash = card_type_categories.is_duplicate(rows, updates["label"], exclude_key=c.key)
        if clash is not None:
            raise HTTPException(
                409,
                detail={
                    "error": "category_exists",
                    "message": f"A category named '{clash.label}' already exists",
                    "key": clash.key,
                },
            )
    if "color" in updates:
        if updates["color"] is None:
            updates["color"] = card_type_categories.DEFAULT_COLOR
        _validate_color(updates)
    if "translations" in updates:
        updates["translations"] = _clean_translations(updates["translations"])
    changes = audit_log.diff(c, updates, keys=_CATEGORY_AUDIT_SCALARS)
    items = _label_translation_items(c.translations, updates.get("translations", c.translations))
    for field_name, value in updates.items():
        setattr(c, field_name, value)
    if changes or items:
        await audit_log.record(
            db,
            action="admin.metamodel.category.updated",
            category="admin",
            actor=user,
            target=("card_type_category", c.key, c.label),
            changes=changes,
            items=items,
        )
    await db.commit()
    await db.refresh(c)
    return card_type_categories.serialize(c)


@router.delete("/categories/{key:path}", status_code=204)
async def delete_card_type_category(
    key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a custom category no card type uses. Built-in layers are locked;
    a category still in use answers 409 ``types_present`` with the types."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    c = await card_type_categories.get_category(db, key)
    if c is None:
        raise HTTPException(404, "Category not found")
    if c.built_in:
        raise HTTPException(
            400,
            detail={
                "error": "built_in_locked",
                "message": "A built-in category cannot be renamed, recoloured or deleted",
                "key": c.key,
            },
        )
    using = await card_type_categories.types_using(db, c.key)
    if using:
        raise HTTPException(
            409,
            detail={
                "error": "types_present",
                "message": f"Category '{c.label}' is used by {len(using)} card type(s): "
                + ", ".join(using),
                "key": c.key,
                "count": len(using),
                "types": using,
            },
        )
    await audit_log.record(
        db,
        action="admin.metamodel.category.deleted",
        category="admin",
        actor=user,
        target=("card_type_category", c.key, c.label),
        context={"color": c.color},
    )
    await db.delete(c)
    await db.commit()
