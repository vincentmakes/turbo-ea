"""Database-backed integration tests for the workspace export/import round-trip.

Requires the project conftest + a live test Postgres (auto-provisioned by
``./scripts/test.sh``). Covers the high-risk paths: hierarchy + relation
reference fidelity on import, idempotent re-import, and secret exclusion.
"""

from __future__ import annotations

import io

import pytest
from sqlalchemy import select

from app.core.encryption import encrypt_value
from app.models.app_settings import AppSettings
from app.models.card import Card
from app.models.relation import Relation
from app.services.workspace_io import (
    apply_bundle,
    build_bundle,
    diff_bundle,
    parse_bundle,
    schema,
)
from app.services.workspace_io import bundle as bundle_io
from app.services.workspace_io import exporter as exp
from tests.conftest import (
    create_card,
    create_card_type,
    create_user,
)

pytestmark = pytest.mark.asyncio


def _make_bundle(sheets: dict[str, tuple[tuple[str, ...], frozenset[str], list[dict]]]) -> bytes:
    """Build a bundle zip from raw section records (mirrors the exporter)."""
    import openpyxl

    wb = openpyxl.Workbook(write_only=True)
    for sheet, (columns, json_cols, records) in sheets.items():
        rows = [
            {c: bundle_io.to_cell(rec.get(c), is_json=c in json_cols) for c in columns}
            for rec in records
        ]
        bundle_io.write_sheet(wb, sheet, list(columns), rows)
    buf = io.BytesIO()
    wb.save(buf)
    return bundle_io.pack(
        {"format_version": schema.FORMAT_VERSION, "app_version": "test", "sections": {}},
        buf.getvalue(),
        {},
    )


async def test_import_creates_hierarchy_and_relation(db):
    """The create path: a card type, a parent→child hierarchy, and a relation
    between two cards all land correctly from a hand-built bundle."""
    user = await create_user(db, email="importer@test.com", role="admin")

    card_types = [
        {c: None for c in exp.CARD_TYPE_COLUMNS}
        | {
            "key": "Widget",
            "label": "Widget",
            "icon": "widgets",
            "color": "#123456",
            "has_hierarchy": True,
            "has_successors": False,
            "subtypes": [],
            "fields_schema": [],
            "stakeholder_roles": [],
            "section_config": {},
            "built_in": False,
            "is_hidden": False,
            "sort_order": 0,
            "translations": {},
        }
    ]
    relation_types = [
        {c: None for c in exp.RELATION_TYPE_COLUMNS}
        | {
            "key": "widget_link",
            "label": "links to",
            "reverse_label": "linked from",
            "source_type_key": "Widget",
            "target_type_key": "Widget",
            "cardinality": "n:m",
            "attributes_schema": [],
            "built_in": False,
            "is_hidden": False,
            "sort_order": 0,
            "translations": {},
            "source_visible": True,
            "source_mandatory": False,
            "target_visible": True,
            "target_mandatory": False,
        }
    ]
    cards = [
        {
            "type": "Widget",
            "name": "Parent",
            "parent_path": "",
            "subtype": None,
            "description": "the parent",
            "external_id": "ext-parent",
            "alias": None,
            "approval_status": "DRAFT",
            "status": "ACTIVE",
            "lifecycle": {},
            "attributes": {},
        },
        {
            "type": "Widget",
            "name": "Child",
            "parent_path": "Parent",
            "subtype": None,
            "description": "the child",
            "external_id": "ext-child",
            "alias": None,
            "approval_status": "DRAFT",
            "status": "ACTIVE",
            "lifecycle": {},
            "attributes": {},
        },
    ]
    relations = [
        {
            "type": "widget_link",
            "source_type": "Widget",
            "source_ref": "Parent",
            "target_type": "Widget",
            "target_ref": "Parent / Child",
            "description": "p->c",
            "attributes": {},
        }
    ]

    raw = _make_bundle(
        {
            schema.SHEET_CARD_TYPES: (exp.CARD_TYPE_COLUMNS, exp.CARD_TYPE_JSON, card_types),
            schema.SHEET_RELATION_TYPES: (
                exp.RELATION_TYPE_COLUMNS,
                exp.RELATION_TYPE_JSON,
                relation_types,
            ),
            schema.SHEET_CARDS: (exp.CARD_COLUMNS, exp.CARD_JSON, cards),
            schema.SHEET_RELATIONS: (exp.RELATION_COLUMNS, exp.RELATION_JSON, relations),
        }
    )

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()
    assert result.total_conflict == 0, result.as_dict()

    parent = (
        await db.execute(select(Card).where(Card.name == "Parent", Card.type == "Widget"))
    ).scalar_one()
    child = (
        await db.execute(select(Card).where(Card.name == "Child", Card.type == "Widget"))
    ).scalar_one()
    assert child.parent_id == parent.id  # hierarchy preserved by parent_path

    rel = (await db.execute(select(Relation).where(Relation.type == "widget_link"))).scalar_one()
    assert rel.source_id == parent.id and rel.target_id == child.id


async def test_export_roundtrip_is_idempotent(db):
    """Export a seeded workspace, re-import it, and confirm no new cards or
    relations are created (upsert-by-key = all skip)."""
    user = await create_user(db, email="rt@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    parent = await create_card(db, card_type="Application", name="Root App", user_id=user.id)
    await create_card(
        db, card_type="Application", name="Leaf App", parent_id=parent.id, user_id=user.id
    )

    raw = await build_bundle(db)
    bundle = parse_bundle(raw)

    # Dry-run preview writes nothing and reports zero creates for cards.
    cards_before = (await db.execute(select(Card))).scalars().all()
    preview = await diff_bundle(db, bundle, user)
    cards_after_preview = (await db.execute(select(Card))).scalars().all()
    assert len(cards_before) == len(cards_after_preview)
    cards_section = next(s for s in preview.sections if s.sheet == schema.SHEET_CARDS)
    assert cards_section.created == 0  # both already exist → skipped

    # Real apply is a no-op for cards too.
    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()
    cards_section = next(s for s in result.sections if s.sheet == schema.SHEET_CARDS)
    assert cards_section.created == 0
    assert len(cards_before) == len((await db.execute(select(Card))).scalars().all())


async def test_export_excludes_secrets(db):
    """Encrypted secrets must never appear anywhere in the exported bundle."""
    row = AppSettings(
        id="default",
        general_settings={
            "currency": "EUR",
            "sso": {
                "enabled": True,
                "client_id": "pub",
                "client_secret": encrypt_value("TOPSECRET"),
            },
            "ai": {"enabled": True, "model": "gpt", "apiKey": encrypt_value("APIKEY123")},
        },
        email_settings={"smtp_host": "mail", "smtp_password": encrypt_value("MAILPW")},
    )
    db.add(row)
    await db.flush()

    raw = await build_bundle(db)

    assert b"TOPSECRET" not in raw
    assert b"APIKEY123" not in raw
    assert b"MAILPW" not in raw
    # The non-secret settings still made it across.
    assert b"EUR" in raw
    assert b"pub" in raw

    # And the parsed settings carry the public bits but not the secret keys.
    bundle = parse_bundle(raw)
    settings_rows = {r["key"]: r["value"] for r in bundle.rows(schema.SHEET_SETTINGS)}
    import json

    general = json.loads(settings_rows["general_settings"])
    assert general["currency"] == "EUR"
    assert "client_secret" not in general["sso"]
    assert "apiKey" not in general["ai"]
