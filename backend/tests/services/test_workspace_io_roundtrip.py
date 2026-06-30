"""Database-backed integration tests for the workspace export/import round-trip.

Requires the project conftest + a live test Postgres (auto-provisioned by
``./scripts/test.sh``). Covers the high-risk paths: hierarchy + relation
reference fidelity on import, idempotent re-import, and secret exclusion.
"""

from __future__ import annotations

import io

import pytest
from sqlalchemy import delete, select

from app.core.encryption import encrypt_value
from app.models.app_settings import AppSettings
from app.models.card import Card
from app.models.comment import Comment
from app.models.relation import Relation
from app.models.risk import Risk, RiskCard
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

    # Re-importing an unchanged export into the same instance is a true no-op:
    # nothing is created and nothing is reported as updated (config/metamodel
    # sections skip identical rows instead of blindly re-writing them).
    totals = result.as_dict()["totals"]
    assert totals["created"] == 0, result.as_dict()
    assert totals["updated"] == 0, result.as_dict()


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

    # The bundle is a (compressed) zip, so scan the *decompressed* parsed
    # content, not the raw bytes.
    import json

    bundle = parse_bundle(raw)
    haystack = json.dumps(bundle.manifest) + json.dumps(bundle.sheets, default=str)

    # Neither the secret keys nor any encrypted (`enc:`) token appear anywhere.
    assert "client_secret" not in haystack
    assert "apiKey" not in haystack
    assert "smtp_password" not in haystack
    assert "enc:" not in haystack

    # The non-secret settings still made it across.
    settings_rows = {r["key"]: r["value"] for r in bundle.rows(schema.SHEET_SETTINGS)}
    general = json.loads(settings_rows["general_settings"])
    assert general["currency"] == "EUR"
    assert general["sso"]["client_id"] == "pub"
    assert "client_secret" not in general["sso"]
    assert "apiKey" not in general["ai"]
    email = json.loads(settings_rows["email_settings"])
    assert email["smtp_host"] == "mail"
    assert "smtp_password" not in email


async def test_module_entities_roundtrip_and_recreate(db):
    """Generic entity sections: a comment, a risk, and a risk-card link export
    and re-import with preserved UUIDs, user remap (by email), and card-FK
    resolution."""
    user = await create_user(db, email="owner@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="App One", user_id=user.id)

    comment = Comment(card_id=card.id, user_id=user.id, content="hello")
    risk = Risk(reference="R-000001", title="Test risk", status="identified")
    db.add_all([comment, risk])
    await db.flush()
    db.add(RiskCard(risk_id=risk.id, card_id=card.id))
    risk.owner_id = user.id
    await db.flush()
    risk_id = risk.id

    raw = await build_bundle(db)

    # Re-importing onto the same data is a no-op for these entities (PKs exist).
    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()
    risks_section = next(s for s in result.sections if s.sheet == "Risks")
    assert risks_section.created == 0 and risks_section.skipped == 1

    # Delete the module rows, then re-apply: they come back with the same ids,
    # the owner remapped by email and the card-link re-resolved by ref.
    await db.execute(delete(RiskCard))
    await db.execute(delete(Risk).where(Risk.id == risk_id))
    await db.execute(delete(Comment).where(Comment.id == comment.id))
    await db.flush()

    result2 = await apply_bundle(db, parse_bundle(raw), user)
    assert result2.total_failed == 0, result2.as_dict()

    restored = (await db.execute(select(Risk).where(Risk.id == risk_id))).scalar_one()
    assert restored.reference == "R-000001"
    assert restored.owner_id == user.id  # remapped by email
    link = (await db.execute(select(RiskCard).where(RiskCard.risk_id == risk_id))).scalar_one()
    assert link.card_id == card.id  # card FK resolved by ref
    assert (
        await db.execute(select(Comment).where(Comment.id == comment.id))
    ).scalar_one().content == "hello"


async def test_large_json_blob_survives_export_import(db):
    """A card whose attributes exceed Excel's 32k cell limit round-trips intact
    (regression for the 'Unterminated string' import error)."""
    user = await create_user(db, email="big@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    big_attrs = {"notes": "z" * 40000, "k": list(range(50))}
    await create_card(
        db, card_type="Application", name="Big App", attributes=big_attrs, user_id=user.id
    )

    raw = await build_bundle(db)
    # The oversized cell must have been offloaded, not truncated.
    _, _, assets = bundle_io.unpack(raw)
    assert any(k.startswith("overflow/") for k in assets)

    bundle = parse_bundle(raw)
    card_rows = {r["name"]: r for r in bundle.rows(schema.SHEET_CARDS)}
    import json

    assert json.loads(card_rows["Big App"]["attributes"])["notes"] == "z" * 40000

    # Delete and re-import: the attributes come back whole.
    await db.execute(delete(Card).where(Card.name == "Big App"))
    await db.flush()
    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()
    restored = (await db.execute(select(Card).where(Card.name == "Big App"))).scalar_one()
    assert restored.attributes["notes"] == "z" * 40000


async def test_diagram_with_card_link_roundtrips(db):
    """A DrawIO diagram (XML extracted to a .drawio asset) and its card link
    survive export → delete → re-import (regression for the diagram-cards
    UUID bug)."""
    from app.models.diagram import Diagram, diagram_cards

    user = await create_user(db, email="dia@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="Linked App", user_id=user.id)
    diagram = Diagram(
        name="My Diagram",
        data={"xml": "<mxGraphModel>hi</mxGraphModel>", "thumbnail": "data:image/png;base64,AA"},
        created_by=user.id,
    )
    db.add(diagram)
    await db.flush()
    diag_id = diagram.id
    await db.execute(diagram_cards.insert().values(diagram_id=diag_id, card_id=card.id))
    await db.flush()

    raw = await build_bundle(db)
    # The DrawIO XML is offloaded as a real .drawio asset.
    _, _, assets = bundle_io.unpack(raw)
    assert any(p.endswith(".drawio") for p in assets)

    await db.execute(delete(diagram_cards))
    await db.execute(delete(Diagram).where(Diagram.id == diag_id))
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    restored = (await db.execute(select(Diagram).where(Diagram.id == diag_id))).scalar_one()
    assert restored.data["xml"] == "<mxGraphModel>hi</mxGraphModel>"
    assert restored.data["thumbnail"] == "data:image/png;base64,AA"  # meta preserved
    links = (await db.execute(select(diagram_cards))).all()
    assert any(row.diagram_id == diag_id and row.card_id == card.id for row in links)


async def test_diagram_groups_and_favorites_roundtrip(db):
    """Diagram groups, their membership, and per-user favorites survive
    export → delete → re-import."""
    from app.models.diagram import Diagram
    from app.models.diagram_favorite import DiagramFavorite
    from app.models.diagram_group import DiagramGroup, diagram_group_members

    user = await create_user(db, email="grp@test.com", role="admin")
    diagram = Diagram(name="Grouped Diagram", data={"xml": "<x/>"}, created_by=user.id)
    group = DiagramGroup(name="Domain A", color="#60a5fa", sort_order=0, created_by=user.id)
    db.add_all([diagram, group])
    await db.flush()
    diag_id, group_id = diagram.id, group.id
    await db.execute(diagram_group_members.insert().values(diagram_id=diag_id, group_id=group_id))
    db.add(DiagramFavorite(user_id=user.id, diagram_id=diag_id))
    await db.flush()

    raw = await build_bundle(db)

    await db.execute(delete(diagram_group_members))
    await db.execute(delete(DiagramFavorite))
    await db.execute(delete(DiagramGroup).where(DiagramGroup.id == group_id))
    await db.execute(delete(Diagram).where(Diagram.id == diag_id))
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    restored_group = (
        await db.execute(select(DiagramGroup).where(DiagramGroup.id == group_id))
    ).scalar_one()
    assert restored_group.name == "Domain A"
    assert restored_group.color == "#60a5fa"

    members = (await db.execute(select(diagram_group_members))).all()
    assert any(m.diagram_id == diag_id and m.group_id == group_id for m in members)

    favs = (await db.execute(select(DiagramFavorite))).scalars().all()
    assert any(f.user_id == user.id and f.diagram_id == diag_id for f in favs)


async def test_bookmark_column_state_roundtrips(db):
    """A saved view's AG Grid column layout (order/width/pinning) survives an
    export → delete → import round-trip via the generic entity engine."""
    from app.models.bookmark import Bookmark

    user = await create_user(db, email="bm-ws@test.com", role="admin")
    column_state = [
        {"colId": "core_name", "width": 240, "pinned": "left"},
        {"colId": "core_type", "width": 140},
        {"colId": "attr_costTotalAnnual", "width": 160, "hide": True},
    ]
    bm = Bookmark(
        user_id=user.id,
        name="Layout View",
        card_type="Application",
        filters={"types": ["Application"]},
        columns=["core_name", "core_type"],
        column_state=column_state,
    )
    db.add(bm)
    await db.flush()
    bm_id = bm.id

    raw = await build_bundle(db)

    await db.execute(delete(Bookmark).where(Bookmark.id == bm_id))
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    restored = (await db.execute(select(Bookmark).where(Bookmark.id == bm_id))).scalar_one()
    assert restored.column_state == column_state
    assert restored.columns == ["core_name", "core_type"]


async def test_resource_types_roundtrip(db):
    """A custom link type / file category survives an export → delete →
    import round-trip, keyed by (kind, key)."""
    from app.models.resource_type import ResourceType

    user = await create_user(db, email="rt-ws@test.com", role="admin")
    db.add(
        ResourceType(
            kind="link_type",
            key="runbook",
            label="Runbook",
            icon="menu_book",
            is_enabled=True,
            built_in=False,
            sort_order=150,
            translations={"fr": "Runbook"},
        )
    )
    db.add(
        ResourceType(
            kind="file_category",
            key="invoices",
            label="Invoices",
            icon=None,
            is_enabled=False,
            built_in=False,
            sort_order=200,
            translations={},
        )
    )
    await db.flush()

    raw = await build_bundle(db)

    await db.execute(delete(ResourceType).where(ResourceType.built_in.is_(False)))
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    rows = {(r.kind, r.key): r for r in (await db.execute(select(ResourceType))).scalars().all()}
    assert ("link_type", "runbook") in rows
    assert rows[("link_type", "runbook")].icon == "menu_book"
    assert rows[("link_type", "runbook")].translations.get("fr") == "Runbook"
    assert ("file_category", "invoices") in rows
    assert rows[("file_category", "invoices")].is_enabled is False
