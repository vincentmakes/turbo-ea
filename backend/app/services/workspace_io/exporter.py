"""Assemble a workspace bundle (``.zip``) from the live database.

Scope: metamodel (card/relation types) + config tables (roles, stakeholder
roles, tag groups/tags, calculations, principles, compliance regulations) +
settings (secrets stripped) + users (no secrets) + the full card inventory +
relations + card tags, plus the module/card-context entities driven by the
generic :mod:`entities` engine (stakeholders, documents, comments, todos,
attachments, diagrams, BPM, PPM, GRC risks, ADR/SoAW, saved views, surveys).

Binary/large assets — file attachments, diagram and BPMN XML, and the branding
logo/favicon — are offloaded to ``assets/`` inside the zip; the workbook sheets
reference them by path.

Card and relation references are written as full ``parent_path / name`` strings
so the importer's :class:`CardResolver` resolves them exactly, with no
dependence on name uniqueness.
"""

from __future__ import annotations

import io
import os
from datetime import datetime, timezone
from typing import Any

from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import APP_VERSION
from app.models.app_settings import AppSettings
from app.models.card import Card
from app.models.card_type import CardType
from app.models.diagram import diagram_cards
from app.models.diagram_group import diagram_group_members
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.tag import CardTag, Tag, TagGroup
from app.models.user import User
from app.services.workspace_io import bundle as bundle_io
from app.services.workspace_io import entities, schema
from app.services.workspace_io.secrets import strip_secrets
from app.services.workspace_io.sections import (
    ENTITY_SECTIONS,
    SHEET_DIAGRAM_CARDS,
    SHEET_DIAGRAM_GROUP_MEMBERS,
)

# Column orders for the bespoke sheets.
CARD_TYPE_COLUMNS = (
    "key",
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
    "built_in",
    "is_hidden",
    "sort_order",
    "translations",
)
CARD_TYPE_JSON = frozenset(
    {"subtypes", "fields_schema", "stakeholder_roles", "section_config", "translations"}
)

RELATION_TYPE_COLUMNS = (
    "key",
    "label",
    "reverse_label",
    "description",
    "source_type_key",
    "target_type_key",
    "cardinality",
    "attributes_schema",
    "built_in",
    "is_hidden",
    "sort_order",
    "translations",
    "source_visible",
    "source_mandatory",
    "target_visible",
    "target_mandatory",
)
RELATION_TYPE_JSON = frozenset({"attributes_schema", "translations"})

USER_COLUMNS = ("email", "display_name", "role", "is_active", "auth_provider", "locale")

TAG_GROUP_COLUMNS = ("name", "description", "mode", "restrict_to_types", "mandatory")
TAG_GROUP_JSON = frozenset({"restrict_to_types"})
TAG_COLUMNS = ("group_name", "name", "description", "color", "sort_order")

CARD_COLUMNS = (
    "type",
    "name",
    "parent_path",
    "subtype",
    "description",
    "external_id",
    "alias",
    "approval_status",
    "status",
    "lifecycle",
    "attributes",
)
CARD_JSON = frozenset({"lifecycle", "attributes"})

RELATION_COLUMNS = (
    "type",
    "source_type",
    "source_ref",
    "target_type",
    "target_ref",
    "description",
    "attributes",
)
RELATION_JSON = frozenset({"attributes"})

CARD_TAG_COLUMNS = ("card_type", "card_ref", "group_name", "tag_name")

_MIME_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/x-icon": "ico",
    "image/vnd.microsoft.icon": "ico",
}


def _mime_ext(mime: str | None) -> str:
    return _MIME_EXT.get((mime or "").lower(), "bin")


def _card_ref(card: Card, by_id: dict[Any, Card]) -> str:
    """Full ``parent_path / name`` ref for a card (root→name, escaped)."""
    segments: list[str] = []
    seen: set[Any] = set()
    current = by_id.get(card.parent_id) if card.parent_id else None
    while current is not None and current.id not in seen and len(segments) < schema.MAX_PATH_DEPTH:
        seen.add(current.id)
        segments.insert(0, current.name)
        current = by_id.get(current.parent_id) if current.parent_id else None
    return schema.build_ref_string(segments, card.name)


def _parent_path_cell(card: Card, by_id: dict[Any, Card]) -> str:
    segments: list[str] = []
    seen: set[Any] = set()
    current = by_id.get(card.parent_id) if card.parent_id else None
    while current is not None and current.id not in seen and len(segments) < schema.MAX_PATH_DEPTH:
        seen.add(current.id)
        segments.insert(0, current.name)
        current = by_id.get(current.parent_id) if current.parent_id else None
    return schema.encode_path(segments)


async def build_bundle(db: AsyncSession, *, include_archived: bool = False) -> bytes:
    """Build the full workspace bundle and return the ``.zip`` bytes."""
    wb = Workbook(write_only=True)
    section_counts: dict[str, int] = {}
    assets: dict[str, bytes] = {}

    def _emit(sheet: str, columns: tuple[str, ...], json_cols: frozenset[str], records: list[dict]):
        rows = [
            {col: bundle_io.to_cell(rec.get(col), is_json=col in json_cols) for col in columns}
            for rec in records
        ]
        bundle_io.write_sheet(wb, sheet, list(columns), rows, assets)
        section_counts[sheet] = len(records)

    # --- Metamodel -------------------------------------------------------
    card_types = (await db.execute(select(CardType))).scalars().all()
    _emit(
        schema.SHEET_CARD_TYPES,
        CARD_TYPE_COLUMNS,
        CARD_TYPE_JSON,
        [{c: getattr(ct, c) for c in CARD_TYPE_COLUMNS} for ct in card_types],
    )
    relation_types = (await db.execute(select(RelationType))).scalars().all()
    _emit(
        schema.SHEET_RELATION_TYPES,
        RELATION_TYPE_COLUMNS,
        RELATION_TYPE_JSON,
        [{c: getattr(rt, c) for c in RELATION_TYPE_COLUMNS} for rt in relation_types],
    )

    # --- Declarative config tables --------------------------------------
    for sec in schema.CONFIG_SECTIONS:
        records: list[Any] = list((await db.execute(select(sec.model))).scalars().all())
        _emit(
            sec.sheet,
            sec.columns,
            sec.json_columns,
            [{c: getattr(r, c) for c in sec.columns} for r in records],
        )

    # --- Tag groups + tags (denormalised group name) --------------------
    tag_groups = (await db.execute(select(TagGroup))).scalars().all()
    group_by_id = {g.id: g for g in tag_groups}
    _emit(
        schema.SHEET_TAG_GROUPS,
        TAG_GROUP_COLUMNS,
        TAG_GROUP_JSON,
        [{c: getattr(g, c) for c in TAG_GROUP_COLUMNS} for g in tag_groups],
    )
    tags = (await db.execute(select(Tag))).scalars().all()
    _emit(
        schema.SHEET_TAGS,
        TAG_COLUMNS,
        frozenset(),
        [
            {
                "group_name": group_by_id[t.tag_group_id].name
                if t.tag_group_id in group_by_id
                else "",
                "name": t.name,
                "description": t.description,
                "color": t.color,
                "sort_order": t.sort_order,
            }
            for t in tags
        ],
    )

    # --- Users (no password hash, no SSO identity) ----------------------
    users = (await db.execute(select(User))).scalars().all()
    _emit(
        schema.SHEET_USERS,
        USER_COLUMNS,
        frozenset(),
        [{c: getattr(u, c) for c in USER_COLUMNS} for u in users],
    )

    # --- Settings (secrets stripped) ------------------------------------
    settings_row = (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one_or_none()
    general_clean, email_clean = strip_secrets(
        settings_row.general_settings if settings_row else {},
        settings_row.email_settings if settings_row else {},
    )
    settings_records: list[dict] = [
        {"key": "general_settings", "value": general_clean},
        {"key": "email_settings", "value": email_clean},
        {
            "key": "custom_logo_mime",
            "value": settings_row.custom_logo_mime if settings_row else None,
        },
        {
            "key": "custom_favicon_mime",
            "value": settings_row.custom_favicon_mime if settings_row else None,
        },
    ]
    _emit(schema.SHEET_SETTINGS, ("key", "value"), frozenset({"value"}), settings_records)

    # --- Cards ----------------------------------------------------------
    card_query = select(Card)
    if not include_archived:
        card_query = card_query.where(Card.status != "ARCHIVED")
    cards = (await db.execute(card_query)).scalars().all()
    by_id = {c.id: c for c in cards}
    card_records = [
        {
            "type": c.type,
            "name": c.name,
            "parent_path": _parent_path_cell(c, by_id),
            "subtype": c.subtype,
            "description": c.description,
            "external_id": c.external_id,
            "alias": c.alias,
            "approval_status": c.approval_status,
            "status": c.status,
            "lifecycle": c.lifecycle or {},
            "attributes": c.attributes or {},
        }
        for c in cards
    ]
    _emit(schema.SHEET_CARDS, CARD_COLUMNS, CARD_JSON, card_records)

    # --- Card tags ------------------------------------------------------
    tag_by_id = {t.id: t for t in tags}
    card_tags = (await db.execute(select(CardTag))).scalars().all()
    card_tag_records = []
    for ct in card_tags:
        card = by_id.get(ct.card_id)
        tag = tag_by_id.get(ct.tag_id)
        if card is None or tag is None:
            continue
        group = group_by_id.get(tag.tag_group_id)
        card_tag_records.append(
            {
                "card_type": card.type,
                "card_ref": _card_ref(card, by_id),
                "group_name": group.name if group else "",
                "tag_name": tag.name,
            }
        )
    _emit(schema.SHEET_CARD_TAGS, CARD_TAG_COLUMNS, frozenset(), card_tag_records)

    # --- Relations ------------------------------------------------------
    relations = (await db.execute(select(Relation))).scalars().all()
    relation_records = []
    for rel in relations:
        src = by_id.get(rel.source_id)
        tgt = by_id.get(rel.target_id)
        if src is None or tgt is None:
            continue  # endpoint archived/excluded from this export
        relation_records.append(
            {
                "type": rel.type,
                "source_type": src.type,
                "source_ref": _card_ref(src, by_id),
                "target_type": tgt.type,
                "target_ref": _card_ref(tgt, by_id),
                "description": rel.description,
                "attributes": rel.attributes or {},
            }
        )
    _emit(schema.SHEET_RELATIONS, RELATION_COLUMNS, RELATION_JSON, relation_records)

    # --- Generic entity sections (module + card-context tables) ---------
    full_card_map = {c.id: c for c in (await db.execute(select(Card))).scalars().all()}
    user_email = {u.id: u.email for u in users}
    for ent_sec in ENTITY_SECTIONS:
        header, rows = await entities.export_entity_section(
            db, ent_sec, full_card_map, user_email, assets
        )
        bundle_io.write_sheet(wb, ent_sec.sheet, header, rows, assets)
        section_counts[ent_sec.sheet] = len(rows)

    # Diagram↔card links (bespoke association, like CardTags).
    dc_rows: list[dict] = []
    for row in (await db.execute(select(diagram_cards))).all():
        card = full_card_map.get(row.card_id)
        if card is None:
            continue
        dc_rows.append(
            {
                "diagram_id": str(row.diagram_id),
                "card_type": card.type,
                "card_ref": _card_ref(card, full_card_map),
            }
        )
    bundle_io.write_sheet(
        wb, SHEET_DIAGRAM_CARDS, ["diagram_id", "card_type", "card_ref"], dc_rows, assets
    )
    section_counts[SHEET_DIAGRAM_CARDS] = len(dc_rows)

    # Diagram↔group membership (bespoke association; both PKs preserved on import).
    gm_rows = [
        {"diagram_id": str(row.diagram_id), "group_id": str(row.group_id)}
        for row in (await db.execute(select(diagram_group_members))).all()
    ]
    bundle_io.write_sheet(
        wb, SHEET_DIAGRAM_GROUP_MEMBERS, ["diagram_id", "group_id"], gm_rows, assets
    )
    section_counts[SHEET_DIAGRAM_GROUP_MEMBERS] = len(gm_rows)

    # Branding binaries → assets/branding/ with a real extension from the MIME.
    if settings_row and settings_row.custom_logo:
        assets[f"branding/logo.{_mime_ext(settings_row.custom_logo_mime)}"] = (
            settings_row.custom_logo
        )
    if settings_row and settings_row.custom_favicon:
        assets[f"branding/favicon.{_mime_ext(settings_row.custom_favicon_mime)}"] = (
            settings_row.custom_favicon
        )

    # --- Serialise workbook + manifest + zip ----------------------------
    buf = io.BytesIO()
    wb.save(buf)
    workbook_bytes = buf.getvalue()

    manifest = {
        "format_version": schema.FORMAT_VERSION,
        "app_version": APP_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source_url": os.getenv("TURBO_EA_PUBLIC_URL", ""),
        "include_archived": include_archived,
        "sections": section_counts,
        "assets": sorted(assets.keys()),
    }
    return bundle_io.pack(manifest, workbook_bytes, assets)
