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
from app.models.card_type import CardType
from app.models.comment import Comment
from app.models.relation import Relation
from app.models.relation_type import RelationType
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
    create_role,
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

    # Every skip carries a reason so the preview can explain itself: cards are
    # "already_present", the existing user is "user_exists", and unchanged
    # metamodel rows are "identical".
    sections = {s["sheet"]: s for s in result.as_dict()["sections"]}
    assert sections[schema.SHEET_CARDS]["skip_reasons"] == {"already_present": 2}
    assert sections[schema.SHEET_USERS]["skip_reasons"] == {"user_exists": 1}
    ct_reasons = sections[schema.SHEET_CARD_TYPES]["skip_reasons"]
    assert ct_reasons.get("identical", 0) >= 1
    for s in result.as_dict()["sections"]:
        assert s["skipped"] == sum(s["skip_reasons"].values()), s

    # The manifest has always carried the source app version — assert it stays.
    assert bundle.manifest.get("app_version")


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


async def test_process_element_organizations_roundtrip(db):
    """The M:N step ↔ Organization junction exports and re-imports with the
    element FK preserved verbatim and the organization card FK resolved by ref."""
    from app.models.process_element import ProcessElement, ProcessElementOrganization

    user = await create_user(db, email="bpm-owner@test.com", role="admin")
    await create_card_type(db, key="BusinessProcess", label="Business Process")
    await create_card_type(db, key="Organization", label="Organization")
    process = await create_card(db, card_type="BusinessProcess", name="O2C", user_id=user.id)
    org_a = await create_card(db, card_type="Organization", name="Sales", user_id=user.id)
    org_b = await create_card(db, card_type="Organization", name="Finance", user_id=user.id)
    callee = await create_card(db, card_type="BusinessProcess", name="Quote", user_id=user.id)

    elem = ProcessElement(
        process_id=process.id,
        bpmn_element_id="task_1",
        element_type="callActivity",
        name="Create Quote",
        lane_name="Sales",
        sequence_order=0,
        called_element=str(callee.id),
        business_process_id=callee.id,
    )
    db.add(elem)
    await db.flush()
    elem_id = elem.id
    db.add(ProcessElementOrganization(element_id=elem_id, organization_id=org_a.id))
    db.add(ProcessElementOrganization(element_id=elem_id, organization_id=org_b.id))
    await db.flush()

    raw = await build_bundle(db)

    # Delete the module rows, then re-apply: same ids, card FKs re-resolved.
    await db.execute(
        delete(ProcessElementOrganization).where(ProcessElementOrganization.element_id == elem_id)
    )
    await db.execute(delete(ProcessElement).where(ProcessElement.id == elem_id))
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    restored = (
        await db.execute(
            select(ProcessElementOrganization.organization_id).where(
                ProcessElementOrganization.element_id == elem_id
            )
        )
    ).all()
    assert {row[0] for row in restored} == {org_a.id, org_b.id}
    # The call activity's process link is a card FK, remapped by reference.
    restored_elem = (
        await db.execute(select(ProcessElement).where(ProcessElement.id == elem_id))
    ).scalar_one()
    assert restored_elem.business_process_id == callee.id
    # Same instance, so the callee kept its id; the copy following a callee to
    # a new id on another instance is pinned in test_workspace_io_id_remap.py.
    assert restored_elem.called_element == str(callee.id)


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
    UUID bug).

    The cards stay in place here, so their ids never change: this pins the
    junction and the asset round-trip only. The ids *inside* the XML following
    the cards to new primary keys (#1246) is
    ``test_workspace_io_id_remap.py``."""
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


async def test_card_logo_roundtrips(db):
    """A card's custom logo — bytes and all — plus the per-type switch that
    governs it survive export → delete → re-import."""
    from app.models.card_logo import CardLogo
    from app.models.card_type import CardType

    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
    user = await create_user(db, email="logo@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application", allow_card_logo=True)
    card = await create_card(db, card_type="Application", name="Kafka", user_id=user.id)
    db.add(
        CardLogo(
            card_id=card.id,
            mime_type="image/png",
            size=len(png),
            data=png,
            created_by=user.id,
        )
    )
    await db.flush()

    raw = await build_bundle(db)
    # The image is offloaded to the assets folder, not inlined in a cell.
    _, _, assets = bundle_io.unpack(raw)
    assert any(p.startswith("CardLogos/") for p in assets)

    await db.execute(delete(CardLogo))
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    ct.allow_card_logo = False
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    # `data` is deferred on the model, so ask for the columns explicitly —
    # the same way the serving endpoint does.
    restored = (
        await db.execute(
            select(CardLogo.data, CardLogo.mime_type).where(CardLogo.card_id == card.id)
        )
    ).one()
    assert restored.data == png
    assert restored.mime_type == "image/png"

    await db.refresh(ct)
    assert ct.allow_card_logo is True, "the per-type switch must transfer too"


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


async def test_data_quality_recomputed_after_import(db):
    """Imported cards run calculations and are scored AFTER their relations
    land — a relation-dependent formula must see the imported relations (not
    an empty landscape), and a card whose mandatory relation is satisfied by
    the bundle must not be penalised for being scored mid-import (discussion
    #667: dashboard completion drift)."""
    user = await create_user(db, email="dq@test.com", role="admin")

    card_types = [
        {c: None for c in exp.CARD_TYPE_COLUMNS}
        | {
            "key": "Widget",
            "label": "Widget",
            "icon": "widgets",
            "color": "#123456",
            "has_hierarchy": False,
            "has_successors": False,
            "subtypes": [],
            "fields_schema": [
                {
                    "section": "Main",
                    "fields": [
                        {"key": "linkCount", "label": "Links", "type": "number", "weight": 1}
                    ],
                }
            ],
            "stakeholder_roles": [],
            "section_config": {},
            "built_in": False,
            "is_hidden": False,
            "sort_order": 0,
            "translations": {},
        }
    ]
    calculations = [
        {
            "name": "link count",
            "description": None,
            "target_type_key": "Widget",
            "target_field_key": "linkCount",
            "formula": "relation_count.widget_link",
            "is_active": True,
            "execution_order": 0,
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
            "source_mandatory": True,  # every Widget needs an outgoing link
            "target_visible": True,
            "target_mandatory": False,
        }
    ]

    def _card(name: str) -> dict:
        return {
            "type": "Widget",
            "name": name,
            "parent_path": "",
            "subtype": None,
            "description": f"{name} description",
            "external_id": None,
            "alias": None,
            "approval_status": "DRAFT",
            "status": "ACTIVE",
            "lifecycle": {"active": "2026-01-01"},
            "attributes": {},
        }

    relations = [
        {
            "type": "widget_link",
            "source_type": "Widget",
            "source_ref": "Alpha",
            "target_type": "Widget",
            "target_ref": "Beta",
            "description": None,
            "attributes": {},
        }
    ]
    calc_section = next(s for s in schema.CONFIG_SECTIONS if s.sheet == schema.SHEET_CALCULATIONS)
    raw = _make_bundle(
        {
            schema.SHEET_CARD_TYPES: (exp.CARD_TYPE_COLUMNS, exp.CARD_TYPE_JSON, card_types),
            schema.SHEET_RELATION_TYPES: (
                exp.RELATION_TYPE_COLUMNS,
                exp.RELATION_TYPE_JSON,
                relation_types,
            ),
            schema.SHEET_CALCULATIONS: (
                calc_section.columns,
                calc_section.json_columns,
                calculations,
            ),
            schema.SHEET_CARDS: (exp.CARD_COLUMNS, exp.CARD_JSON, [_card("Alpha"), _card("Beta")]),
            schema.SHEET_RELATIONS: (exp.RELATION_COLUMNS, exp.RELATION_JSON, relations),
        }
    )

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()
    assert result.total_conflict == 0, result.as_dict()

    alpha = (await db.execute(select(Card).where(Card.name == "Alpha"))).scalar_one()
    beta = (await db.execute(select(Card).where(Card.name == "Beta"))).scalar_one()

    # The relation-dependent calculation ran AFTER the relation landed —
    # running it during the cards pass would have written 0 for both cards.
    assert alpha.attributes.get("linkCount") == 1
    assert beta.attributes.get("linkCount") == 1

    # Alpha: linkCount field + description + lifecycle + satisfied mandatory
    # relation = 4/4. Scoring during the cards pass would yield 50.0.
    assert alpha.data_quality == 100.0
    # Beta has no outgoing widget_link, so its relations bucket stays open.
    assert beta.data_quality == 75.0

    # The stored score matches a fresh recompute — no drift left behind.
    from app.services.data_quality import calc_data_quality

    assert alpha.data_quality == await calc_data_quality(db, alpha)
    assert beta.data_quality == await calc_data_quality(db, beta)


async def test_compliance_findings_roundtrip(db):
    """Compliance findings + the analysis runs they reference transfer;
    unreferenced (vendor/duplicate/architect) runs stay instance-local."""
    from app.models.turbolens import TurboLensAnalysisRun, TurboLensComplianceFinding

    user = await create_user(db, email="grc@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="Regulated App", user_id=user.id)

    run = TurboLensAnalysisRun(
        analysis_type="compliance", status="completed", results={"n": 1}, created_by=user.id
    )
    vendor_run = TurboLensAnalysisRun(analysis_type="vendor", status="completed", results={})
    db.add_all([run, vendor_run])
    await db.flush()
    finding = TurboLensComplianceFinding(
        run_id=run.id,
        last_seen_run_id=run.id,
        regulation="gdpr",
        regulation_article="Art. 32",
        card_id=card.id,
        requirement="Security of processing",
        status="gap",
        severity="high",
        gap_description="No encryption at rest",
        finding_key="k1",
        decision="accepted",
        reviewed_by=user.id,
    )
    db.add(finding)
    await db.flush()
    run_id, finding_id = run.id, finding.id

    raw = await build_bundle(db)
    bundle = parse_bundle(raw)

    # Only the run referenced by a finding is exported.
    run_rows = bundle.rows("TurbolensAnalysisRuns")
    assert [r["id"] for r in run_rows] == [str(run_id)]
    finding_rows = bundle.rows("ComplianceFindings")
    assert len(finding_rows) == 1
    assert finding_rows[0]["card_id__ref"] == "Regulated App"
    assert finding_rows[0]["reviewed_by__email"] == "grc@test.com"

    # Delete, re-import, and verify a faithful restore.
    await db.execute(
        delete(TurboLensComplianceFinding).where(TurboLensComplianceFinding.id == finding_id)
    )
    await db.execute(delete(TurboLensAnalysisRun).where(TurboLensAnalysisRun.id == run_id))
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()
    assert result.total_conflict == 0, result.as_dict()

    restored = (
        await db.execute(
            select(TurboLensComplianceFinding).where(TurboLensComplianceFinding.id == finding_id)
        )
    ).scalar_one()
    assert restored.run_id == run_id  # intra-module FK preserved verbatim
    assert restored.card_id == card.id  # card FK resolved by ref
    assert restored.reviewed_by == user.id  # user FK remapped by email
    assert restored.decision == "accepted"
    assert restored.severity == "high"
    restored_run = (
        await db.execute(select(TurboLensAnalysisRun).where(TurboLensAnalysisRun.id == run_id))
    ).scalar_one()
    assert restored_run.results == {"n": 1}

    # Idempotent re-apply.
    result2 = await apply_bundle(db, parse_bundle(raw), user)
    findings_section = next(s for s in result2.sections if s.sheet == "ComplianceFindings")
    assert findings_section.created == 0 and findings_section.skipped == 1


async def test_unresolved_required_user_fk_is_conflict(db):
    """A row whose NOT-NULL user FK can't be matched by email is reported as a
    conflict and skipped — it must not abort the whole import with an
    IntegrityError at flush time."""
    from app.models.bookmark import Bookmark
    from app.services.workspace_io.sections import ENTITY_SECTIONS

    user = await create_user(db, email="importer2@test.com", role="admin")
    bm_section = next(s for s in ENTITY_SECTIONS if s.sheet == "Bookmarks")
    row = {c: None for c in bm_section.header()} | {
        "id": "8a1c2f34-0000-4000-8000-000000000001",
        "name": "Ghost View",
        "visibility": "private",
        "is_default": False,
        "odata_enabled": False,
        "user_id__email": "ghost@nowhere.example",  # no Users sheet → unresolvable
    }
    raw = _make_bundle(
        {"Bookmarks": (tuple(bm_section.header()), frozenset(), [row])},
    )

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()
    bm = next(s for s in result.sections if s.sheet == "Bookmarks")
    assert bm.conflict == 1 and bm.created == 0
    assert any("ghost@nowhere.example" in e for e in bm.errors)
    assert (await db.execute(select(Bookmark).where(Bookmark.name == "Ghost View"))).first() is None


async def test_process_flow_withdrawal_roundtrips(db):
    """A withdrawn process flow keeps its withdrawal metadata across a transfer.

    ``withdrawn_by`` is an instance-local user UUID, so it has to be declared in
    the section's ``user_fk_columns`` and travel as an email — otherwise the
    withdrawal loses its attribution on the target instance and the audit trail
    silently becomes anonymous. The three scalar columns come along via
    introspection.
    """
    from datetime import datetime, timezone

    from app.models.process_flow_version import ProcessFlowVersion
    from app.services.workspace_io.sections import ENTITY_SECTIONS

    section = next(s for s in ENTITY_SECTIONS if s.sheet == "ProcessFlowVersions")
    assert "withdrawn_by" in section.user_fk_columns

    user = await create_user(db, email="quality@test.com", role="admin")
    await create_card_type(db, key="BusinessProcess", label="Business Process")
    process = await create_card(
        db, card_type="BusinessProcess", name="Withdrawn Process", user_id=user.id
    )
    now = datetime.now(timezone.utc)
    db.add(
        ProcessFlowVersion(
            process_id=process.id,
            status="withdrawn",
            revision=3,
            bpmn_xml="<bpmn>x</bpmn>",
            approved_by=user.id,
            approved_at=now,
            withdrawn_by=user.id,
            withdrawn_at=now,
            withdrawal_reason="Approved by mistake, wrong revision",
        )
    )
    await db.flush()

    raw = await build_bundle(db)
    await db.execute(delete(ProcessFlowVersion))
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    restored = (await db.execute(select(ProcessFlowVersion))).scalars().all()
    assert len(restored) == 1
    v = restored[0]
    assert v.status == "withdrawn"
    assert v.withdrawal_reason == "Approved by mistake, wrong revision"
    assert v.withdrawn_by == user.id
    assert v.withdrawn_at is not None
    # The original approval survives the transfer intact.
    assert v.approved_by == user.id


async def test_bookmark_shares_roundtrip(db):
    """A saved view shared with another user keeps its share (and can_edit
    flag) across export → delete → re-import; re-apply skips."""
    from app.models.bookmark import Bookmark, bookmark_shares
    from app.services.workspace_io.sections import SHEET_BOOKMARK_SHARES

    owner = await create_user(db, email="owner-bm@test.com", role="admin")
    peer = await create_user(db, email="peer-bm@test.com", role="member")
    bm = Bookmark(user_id=owner.id, name="Shared View", visibility="private")
    db.add(bm)
    await db.flush()
    await db.execute(
        bookmark_shares.insert().values(bookmark_id=bm.id, user_id=peer.id, can_edit=True)
    )
    await db.flush()

    raw = await build_bundle(db)
    bundle = parse_bundle(raw)
    share_rows = bundle.rows(SHEET_BOOKMARK_SHARES)
    assert share_rows == [
        {"bookmark_id": str(bm.id), "user_email": "peer-bm@test.com", "can_edit": True}
    ]

    await db.execute(delete(bookmark_shares))
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), owner)
    assert result.total_failed == 0, result.as_dict()
    restored = (await db.execute(select(bookmark_shares))).all()
    assert [(r.bookmark_id, r.user_id, r.can_edit) for r in restored] == [(bm.id, peer.id, True)]

    result2 = await apply_bundle(db, parse_bundle(raw), owner)
    shares_section = next(s for s in result2.sections if s.sheet == SHEET_BOOKMARK_SHARES)
    assert shares_section.created == 0 and shares_section.skipped == 1
    assert shares_section.skip_reasons == {"already_present": 1}


async def test_transfer_out_exposes_source_app_version():
    """The import API surfaces the bundle's source app version for the
    advisory version check in the preview UI."""
    from app.api.v1.workspace import _to_out
    from app.models.workspace_transfer import WorkspaceTransfer

    t = WorkspaceTransfer(
        filename="x.zip", status="previewed", source_app_version="1.62.3", format_version="1"
    )
    out = _to_out(t)
    assert out.source_app_version == "1.62.3"


async def test_import_cannot_reintroduce_legacy_permission_keys(db):
    """A bundle exported from a pre-024 instance must not re-poison a repaired one.

    The generic config applier writes ``permissions`` straight onto the model,
    bypassing the Pydantic validators that forgive these keys — so without the
    normaliser an old bundle would put ``card.quality_seal`` back and break the
    target's stakeholder-role editor again, with a key its admin cannot see.

    The stale key is seeded **before** the export so the bundle itself carries
    it, and the row is deleted before the import so the applier has to take its
    create path: asserting on a row the bundle merely failed to change would
    pass without the normaliser doing anything at all.
    """
    from app.models.card_type import CardType
    from app.models.stakeholder_role_definition import StakeholderRoleDefinition

    user = await create_user(db, email="legacy-perms-ws@test.com", role="admin")
    db.add(
        CardType(
            key="Application",
            label="Application",
            icon="apps",
            color="#0f7eb5",
            fields_schema=[],
        )
    )
    await db.flush()
    db.add(
        StakeholderRoleDefinition(
            card_type_key="Application",
            key="responsible",
            label="Responsible",
            color="#ff0000",
            permissions={"card.view": True, "card.quality_seal": True},
        )
    )
    await db.flush()

    raw = await build_bundle(db)
    # Prove the bundle really carries the stale key, so the assertions below
    # test the normaliser rather than an export that quietly dropped it.
    exported = parse_bundle(raw).rows(schema.SHEET_STAKEHOLDER_ROLES)
    assert any("card.quality_seal" in str(r.get("permissions", "")) for r in exported)

    await db.execute(
        delete(StakeholderRoleDefinition).where(StakeholderRoleDefinition.key == "responsible")
    )
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    stored = (
        await db.execute(
            select(StakeholderRoleDefinition.permissions).where(
                StakeholderRoleDefinition.card_type_key == "Application",
                StakeholderRoleDefinition.key == "responsible",
            )
        )
    ).scalar_one()
    assert "card.quality_seal" not in stored
    assert stored == {"card.view": True}


async def test_import_renames_legacy_app_permission_keys(db):
    """A bundle from a pre-033 instance must not reintroduce the old app names.

    This is the path no migration is watching: the config applier writes
    ``roles.permissions`` straight onto the model, bypassing the RoleCreate /
    RoleUpdate validators, so an old bundle would put ``subscriptions.view``
    back into a repaired database and break its roles admin.

    Renamed, not dropped — the opposite of the card-level keys — because each
    one still maps to a live permission, so discarding it would silently revoke
    access the role actually had. Note the seeded value is ``False``: that is
    what proves the value is carried across rather than the key merely being
    re-added as a grant.
    """
    from app.models.role import Role

    user = await create_user(db, email="legacy-app-perms-ws@test.com", role="admin")
    db.add(
        Role(
            key="auditor",
            label="Auditor",
            permissions={"inventory.view": True, "subscriptions.view": False},
            is_system=False,
        )
    )
    await db.flush()

    raw = await build_bundle(db)
    exported = parse_bundle(raw).rows(schema.SHEET_ROLES)
    assert any("subscriptions.view" in str(r.get("permissions", "")) for r in exported)

    await db.execute(delete(Role).where(Role.key == "auditor"))
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    stored = (await db.execute(select(Role.permissions).where(Role.key == "auditor"))).scalar_one()
    assert "subscriptions.view" not in stored
    assert stored == {"inventory.view": True, "stakeholders.view": False}


async def test_import_accepts_multiple_relation_types_per_pair(db):
    """A bundle may carry several relation types on one ordered card-type pair.

    The applier used to re-enforce a one-type-per-pair rule and skip the extra
    rows as conflicts, so a workspace that legitimately modelled "owns" and
    "uses" separately lost one of them on every transfer.
    """
    user = await create_user(db, email="wsmulti@test.com", role="admin")

    card_types = [
        {c: None for c in exp.CARD_TYPE_COLUMNS}
        | {
            "key": "Widget",
            "label": "Widget",
            "icon": "category",
            "color": "#123456",
            "category": "Application & Data",
            "has_hierarchy": False,
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

    def _rel_type(key: str, label: str, reverse: str) -> dict:
        return {c: None for c in exp.RELATION_TYPE_COLUMNS} | {
            "key": key,
            "label": label,
            "reverse_label": reverse,
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

    relation_types = [
        _rel_type("widget_uses", "uses", "is used by"),
        _rel_type("widget_owns", "owns", "is owned by"),
    ]

    raw = _make_bundle(
        {
            schema.SHEET_CARD_TYPES: (exp.CARD_TYPE_COLUMNS, exp.CARD_TYPE_JSON, card_types),
            schema.SHEET_RELATION_TYPES: (
                exp.RELATION_TYPE_COLUMNS,
                exp.RELATION_TYPE_JSON,
                relation_types,
            ),
        }
    )

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()
    assert result.total_conflict == 0, result.as_dict()

    stored = set(
        (
            await db.execute(
                select(RelationType.key).where(
                    RelationType.source_type_key == "Widget",
                    RelationType.target_type_key == "Widget",
                )
            )
        )
        .scalars()
        .all()
    )
    assert {"widget_uses", "widget_owns"} <= stored


async def test_card_type_role_permissions_roundtrip(db):
    """Per-card-type RBAC overrides must survive export → import.

    They are part of the metamodel, so cloning an instance has to carry them —
    otherwise the target comes up with the restriction silently lifted.
    """
    user = await create_user(db, email="rp@test.com", role="admin")
    await create_role(db, key="member", label="Member", permissions={"inventory.create": True})
    ct = await create_card_type(db, key="Application", label="Application")
    ct.role_permissions = {"member": {"inventory.create": False}}
    await db.flush()

    raw = await build_bundle(db)

    # Wipe the map, then re-import: the bundle must put it back.
    ct.role_permissions = {}
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    restored = (
        await db.execute(select(CardType).where(CardType.key == "Application"))
    ).scalar_one()
    assert restored.role_permissions == {"member": {"inventory.create": False}}


async def test_hierarchy_link_labels_roundtrip(db):
    """The vocabulary AND each card's chosen label must survive a clone (#1100).

    Both live in **bespoke** sections, which the generic introspection engine
    does not cover — the column lists in `exporter.py` are the whole
    obligation, and nothing in CI catches an omission but this test.
    """
    user = await create_user(db, email="hl@test.com", role="admin")
    vocab = [{"key": "commercial", "label": "Commercial", "color": "#2889ff"}]
    ct = await create_card_type(db, key="Organization", label="Organization", has_hierarchy=True)
    ct.hierarchy_labels = vocab
    parent = await create_card(db, card_type="Organization", name="Company A")
    await db.flush()
    child = await create_card(
        db,
        card_type="Organization",
        name="Company B",
        parent_id=parent.id,
        parent_label="commercial",
    )
    await db.flush()

    raw = await build_bundle(db)

    # Wipe both, then re-import: the bundle must put them back. The card is
    # DELETED rather than blanked — the cards section is create-only (it skips
    # a row it can already resolve), so a surviving row would be skipped and
    # the assertion would prove nothing about what the bundle carried.
    ct.hierarchy_labels = []
    await db.execute(delete(Card).where(Card.id == child.id))
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    restored_type = (
        await db.execute(select(CardType).where(CardType.key == "Organization"))
    ).scalar_one()
    assert restored_type.hierarchy_labels == vocab

    restored_child = (await db.execute(select(Card).where(Card.name == "Company B"))).scalar_one()
    assert restored_child.parent_label == "commercial"


async def test_card_type_bundle_without_the_column_keeps_the_default(db):
    """A bundle written before the column existed must not blank it.

    `role_permissions` is NOT NULL, so an older export (which carries no such
    column) has to leave the target's value alone rather than write NULL.
    """
    user = await create_user(db, email="old@test.com", role="admin")
    legacy_columns = tuple(c for c in exp.CARD_TYPE_COLUMNS if c != "role_permissions")
    card_types = [
        {c: None for c in legacy_columns}
        | {
            "key": "Widget",
            "label": "Widget",
            "icon": "widgets",
            "color": "#123456",
            "has_hierarchy": False,
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
    raw = _make_bundle(
        {
            schema.SHEET_CARD_TYPES: (
                legacy_columns,
                exp.CARD_TYPE_JSON,
                card_types,
            )
        }
    )
    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    created = (await db.execute(select(CardType).where(CardType.key == "Widget"))).scalar_one()
    assert created.role_permissions == {}


async def test_process_message_flows_roundtrip(db):
    """A message flow keeps its own id on import; the process and Interface
    card FKs are re-resolved by card ref."""
    from app.models.process_message_flow import ProcessMessageFlow

    user = await create_user(db, email="bpm-flows@test.com", role="admin")
    await create_card_type(db, key="BusinessProcess", label="Business Process")
    await create_card_type(db, key="Interface", label="Interface")
    process = await create_card(db, card_type="BusinessProcess", name="O2C", user_id=user.id)
    iface = await create_card(db, card_type="Interface", name="Order API", user_id=user.id)

    flow = ProcessMessageFlow(
        process_id=process.id,
        bpmn_element_id="MessageFlow_1",
        name="Order",
        source_ref="Task_Send",
        target_ref="Participant_Supplier",
        source_name="Send order",
        target_name="Supplier",
        sequence_order=0,
        interface_id=iface.id,
    )
    db.add(flow)
    await db.flush()
    flow_id = flow.id

    raw = await build_bundle(db)

    await db.execute(delete(ProcessMessageFlow).where(ProcessMessageFlow.id == flow_id))
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    restored = (
        await db.execute(select(ProcessMessageFlow).where(ProcessMessageFlow.id == flow_id))
    ).scalar_one()
    assert restored.process_id == process.id
    assert restored.interface_id == iface.id
    assert restored.target_name == "Supplier"


async def test_a_file_attachment_transfers_when_the_bundle_is_read_from_disk(db, tmp_path):
    """The lazy asset store has to work through the real entity engine.

    An import parses the bundle from its path and reads each asset only when
    the applier reaches its row, so this is the path a real import takes —
    ``parse_bundle(bytes)`` would not prove it.
    """
    from app.models.file_attachment import FileAttachment

    user = await create_user(db, email="lazy@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="Payroll", user_id=user.id)

    blob = b"%PDF-1.7\n" + b"contract bytes" * 500
    db.add(
        FileAttachment(
            card_id=card.id,
            name="contract.pdf",
            mime_type="application/pdf",
            size=len(blob),
            data=blob,
            created_by=user.id,
        )
    )
    await db.flush()

    raw = await build_bundle(db)

    # Wipe the attachment so the import has something to create.
    await db.execute(delete(FileAttachment))
    await db.flush()
    assert (await db.execute(select(FileAttachment))).scalars().all() == []

    path = tmp_path / "workspace.zip"
    path.write_bytes(raw)
    with parse_bundle(path) as bundle:
        assert isinstance(bundle.assets, bundle_io.ZipAssetStore)
        result = await apply_bundle(db, bundle, user)
    assert result.total_failed == 0, result.as_dict()

    restored = (await db.execute(select(FileAttachment))).scalars().all()
    assert len(restored) == 1
    assert restored[0].name == "contract.pdf"
    assert restored[0].data == blob  # byte-identical through the lazy store


async def test_import_stores_a_backwards_relation_in_its_type_direction(db):
    """A bundle exported from an instance that still held a relation stored the
    other way round (#1140) lands in the relation type's direction, with its
    attributes unchanged — and a correct row for the same pair is not doubled."""
    user = await create_user(db, email="importer@test.com", role="admin")

    def _card_type(key: str) -> dict:
        return {c: None for c in exp.CARD_TYPE_COLUMNS} | {
            "key": key,
            "label": key,
            "icon": "widgets",
            "color": "#123456",
            "has_hierarchy": False,
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

    def _card(card_type: str, name: str) -> dict:
        return {
            "type": card_type,
            "name": name,
            "parent_path": "",
            "subtype": None,
            "description": None,
            "external_id": f"ext-{name}",
            "alias": None,
            "approval_status": "DRAFT",
            "status": "ACTIVE",
            "lifecycle": {},
            "attributes": {},
        }

    def _relation(src: tuple[str, str], tgt: tuple[str, str]) -> dict:
        return {
            "type": "gadget_feeds_port",
            "source_type": src[0],
            "source_ref": src[1],
            "target_type": tgt[0],
            "target_ref": tgt[1],
            "description": None,
            "attributes": {"flowDirection": "forward"},
        }

    relation_types = [
        {c: None for c in exp.RELATION_TYPE_COLUMNS}
        | {
            "key": "gadget_feeds_port",
            "label": "feeds",
            "reverse_label": "is fed by",
            "source_type_key": "Gadget",
            "target_type_key": "Port",
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
    raw = _make_bundle(
        {
            schema.SHEET_CARD_TYPES: (
                exp.CARD_TYPE_COLUMNS,
                exp.CARD_TYPE_JSON,
                [_card_type("Gadget"), _card_type("Port")],
            ),
            schema.SHEET_RELATION_TYPES: (
                exp.RELATION_TYPE_COLUMNS,
                exp.RELATION_TYPE_JSON,
                relation_types,
            ),
            schema.SHEET_CARDS: (
                exp.CARD_COLUMNS,
                exp.CARD_JSON,
                [_card("Gadget", "G1"), _card("Port", "P1")],
            ),
            schema.SHEET_RELATIONS: (
                exp.RELATION_COLUMNS,
                exp.RELATION_JSON,
                # Backwards first, then the same relation the right way round.
                [
                    _relation(("Port", "P1"), ("Gadget", "G1")),
                    _relation(("Gadget", "G1"), ("Port", "P1")),
                ],
            ),
        }
    )

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()

    gadget = (await db.execute(select(Card).where(Card.name == "G1"))).scalar_one()
    port = (await db.execute(select(Card).where(Card.name == "P1"))).scalar_one()
    rels = (
        (await db.execute(select(Relation).where(Relation.type == "gadget_feeds_port")))
        .scalars()
        .all()
    )
    assert [(r.source_id, r.target_id) for r in rels] == [(gadget.id, port.id)]
    assert rels[0].attributes == {"flowDirection": "forward"}


async def test_card_reference_survives_export_and_reimport(db):
    """``reference`` was in ``CARD_COLUMNS`` and read by the applier, but the
    exporter never wrote it: a moved or restored card lost its human-readable
    id. Every card column now comes off the card."""
    user = await create_user(db, email="ref@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    await create_card(
        db,
        card_type="Application",
        name="Billing",
        user_id=user.id,
        attributes={"criticality": "high"},
    )
    card = (await db.execute(select(Card).where(Card.name == "Billing"))).scalar_one()
    card.reference = "APP-0042"
    card.alias = "BIL"
    card.external_id = "ext-7"
    await db.flush()

    raw = await build_bundle(db)
    row = next(r for r in parse_bundle(raw).rows(schema.SHEET_CARDS) if r["name"] == "Billing")
    assert (row["reference"], row["alias"], row["external_id"]) == ("APP-0042", "BIL", "ext-7")

    await db.execute(delete(Card).where(Card.name == "Billing"))
    await db.flush()
    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()
    restored = (await db.execute(select(Card).where(Card.name == "Billing"))).scalar_one()
    assert (restored.reference, restored.alias, restored.external_id) == (
        "APP-0042",
        "BIL",
        "ext-7",
    )


async def _billing_bundle_then_a_clash(db, reference_config):
    """A bundle holding Billing as ``APP-0042``, imported after another card has
    taken that reference: what the applier does with the clash depends on the
    type's reference config."""
    user = await create_user(db, email="clash@test.com", role="admin")
    ct = await create_card_type(db, key="Application", label="Application")
    ct.reference_config = reference_config
    await create_card(db, card_type="Application", name="Billing", user_id=user.id)
    billing = (await db.execute(select(Card).where(Card.name == "Billing"))).scalar_one()
    billing.reference = "APP-0042"
    await db.flush()
    raw = await build_bundle(db)

    await db.execute(delete(Card).where(Card.name == "Billing"))
    await create_card(db, card_type="Application", name="Other", user_id=user.id)
    other = (await db.execute(select(Card).where(Card.name == "Other"))).scalar_one()
    other.reference = "APP-0042"
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()
    restored = (await db.execute(select(Card).where(Card.name == "Billing"))).scalar_one()
    await db.refresh(other)
    assert other.reference == "APP-0042"
    return restored


async def test_a_taken_reference_is_renumbered_from_the_type_series(db):
    """Importing ``APP-0042`` where another card already holds it: an ``auto``
    type gives the imported card the next number of its series, and the card
    that held the reference keeps it."""
    restored = await _billing_bundle_then_a_clash(
        db, {"mode": "auto", "prefix": "APP-", "start": 1, "padding": 4}
    )
    assert restored.reference == "APP-0043"


async def test_a_taken_reference_is_dropped_when_the_type_numbers_nothing(db):
    """The same clash on a type whose references are off: the imported card
    lands without one rather than failing the import."""
    restored = await _billing_bundle_then_a_clash(db, {"mode": "off"})
    assert restored.reference is None


async def test_card_tags_and_relations_carry_full_card_paths(db):
    """The CardTags and Relations rows name each card by its full path, and
    an import into a landscape that lost them puts both back on the right
    cards. Re-importing into the same instance skips every row, so only a
    removal in between proves the refs resolve."""
    from app.models.tag import CardTag, Tag, TagGroup
    from tests.conftest import create_relation_type

    user = await create_user(db, email="paths@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application", has_hierarchy=True)
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_relation_type(db, key="app_to_itc")
    parent = await create_card(db, card_type="Application", name="Sales/EMEA", user_id=user.id)
    child = await create_card(
        db, card_type="Application", name="CRM", parent_id=parent.id, user_id=user.id
    )
    # Another card with the same name elsewhere: only the path tells them apart.
    await create_card(db, card_type="Application", name="CRM", user_id=user.id)
    db_card = await create_card(db, card_type="ITComponent", name="Postgres", user_id=user.id)
    group = TagGroup(name="Scope")
    db.add(group)
    await db.flush()
    tag = Tag(tag_group_id=group.id, name="In scope")
    db.add(tag)
    await db.flush()
    db.add(CardTag(card_id=child.id, tag_id=tag.id))
    db.add(Relation(type="app_to_itc", source_id=child.id, target_id=db_card.id, attributes={}))
    await db.flush()

    raw = await build_bundle(db)
    bundle = parse_bundle(raw)
    (tag_row,) = bundle.rows(schema.SHEET_CARD_TAGS)
    assert (tag_row["card_type"], tag_row["card_ref"]) == ("Application", "Sales\\/EMEA / CRM")
    assert (tag_row["group_name"], tag_row["tag_name"]) == ("Scope", "In scope")
    (rel_row,) = bundle.rows(schema.SHEET_RELATIONS)
    assert (rel_row["source_type"], rel_row["source_ref"]) == ("Application", "Sales\\/EMEA / CRM")
    assert (rel_row["target_type"], rel_row["target_ref"]) == ("ITComponent", "Postgres")

    await db.execute(delete(CardTag))
    await db.execute(delete(Relation))
    await db.flush()
    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()
    tagged = (await db.execute(select(CardTag.card_id))).scalars().all()
    assert tagged == [child.id]
    (rel,) = (await db.execute(select(Relation))).scalars().all()
    assert (rel.source_id, rel.target_id) == (child.id, db_card.id)


async def test_card_type_categories_roundtrip(db):
    """A custom category and a built-in type moved into it survive an export
    → delete → import round trip; a re-import of the same bundle is all-skip."""
    from app.models.card_type_category import CardTypeCategory
    from app.services.card_type_categories import seed_default_categories

    user = await create_user(db, email="cat-ws@test.com", role="admin")
    await seed_default_categories(db)
    db.add(
        CardTypeCategory(
            key="Security",
            label="Security Layer",
            color="#123456",
            sort_order=7,
            built_in=False,
            translations={"fr": "Sécurité"},
        )
    )
    await create_card_type(db, key="Application", built_in=True, category="Security")
    await db.flush()

    raw = await build_bundle(db)
    bundle = parse_bundle(raw)
    assert bundle.rows(schema.SHEET_CARD_TYPE_CATEGORIES)

    await db.execute(delete(CardTypeCategory).where(CardTypeCategory.built_in.is_(False)))
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()
    rows = {c.key: c for c in (await db.execute(select(CardTypeCategory))).scalars().all()}
    restored = rows["Security"]
    assert (restored.label, restored.color, restored.sort_order) == ("Security Layer", "#123456", 7)
    assert restored.translations == {"fr": "Sécurité"}
    assert restored.built_in is False
    app = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    assert app.category == "Security"

    again = await apply_bundle(db, parse_bundle(raw), user)
    section = next(s for s in again.sections if s.sheet == schema.SHEET_CARD_TYPE_CATEGORIES)
    assert (section.created, section.updated) == (0, 0)
    assert section.skipped == 5
    assert section.skip_reasons == {"identical": 5}


async def test_card_type_bundle_without_categories_sheet_adopts_the_category(db):
    """A bundle exported before the registry carries no CardTypeCategories
    sheet; the category its card types name is adopted as a custom row."""
    from app.models.card_type_category import CardTypeCategory

    user = await create_user(db, email="old-cat@test.com", role="admin")
    card_types = [
        {c: None for c in exp.CARD_TYPE_COLUMNS}
        | {
            "key": "Widget",
            "label": "Widget",
            "icon": "widgets",
            "color": "#123456",
            "category": "Legacy Layer",
            "has_hierarchy": False,
            "has_successors": False,
            "subtypes": [],
            "fields_schema": [],
            "stakeholder_roles": [],
            "section_config": {},
            "built_in": False,
            "is_hidden": False,
            "sort_order": 0,
            "translations": {},
            "reference_config": {},
            "role_permissions": {},
        }
    ]
    raw = _make_bundle(
        {schema.SHEET_CARD_TYPES: (exp.CARD_TYPE_COLUMNS, exp.CARD_TYPE_JSON, card_types)}
    )
    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()
    adopted = (
        await db.execute(select(CardTypeCategory).where(CardTypeCategory.key == "Legacy Layer"))
    ).scalar_one()
    assert adopted.label == "Legacy Layer"
    assert adopted.built_in is False
    assert adopted.color == "#999999"


async def test_a_bundle_cannot_repaint_a_built_in_category(db):
    """The four default layers' label, colour and translations are locked on
    every instance: a bundle carrying a recoloured, renamed default leaves them
    alone (``built_in_locked`` when nothing else moved), but a new place in
    the layer order is applied and counted as an update. A bundle row claiming
    ``built_in`` for a new key lands as a custom row."""
    from app.models.card_type_category import CardTypeCategory
    from app.services.card_type_categories import seed_default_categories

    user = await create_user(db, email="lock-cat@test.com", role="admin")
    await seed_default_categories(db)
    await db.flush()
    sec = next(s for s in schema.CONFIG_SECTIONS if s.sheet == schema.SHEET_CARD_TYPE_CATEGORIES)
    rows = [
        # Locked columns only — its sort_order (2) is the target's.
        {
            "key": "Application & Data",
            "label": "Apps",
            "color": "#000000",
            "sort_order": 2,
            "built_in": False,
            "translations": {"fr": "Applis"},
        },
        # A locked repaint plus a move: only the move lands.
        {
            "key": "Technical Architecture",
            "label": "Tech",
            "color": "#222222",
            "sort_order": 9,
            "built_in": False,
            "translations": {},
        },
        {
            "key": "Smuggled",
            "label": "Smuggled",
            "color": "#111111",
            "sort_order": 8,
            "built_in": True,
            "translations": {},
        },
    ]
    raw = _make_bundle({schema.SHEET_CARD_TYPE_CATEGORIES: (sec.columns, sec.json_columns, rows)})
    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()
    section = next(s for s in result.sections if s.sheet == schema.SHEET_CARD_TYPE_CATEGORIES)
    assert section.skip_reasons == {"built_in_locked": 1}
    assert (section.created, section.updated) == (1, 1)

    by_key = {c.key: c for c in (await db.execute(select(CardTypeCategory))).scalars().all()}
    app_data = by_key["Application & Data"]
    assert (app_data.label, app_data.color, app_data.sort_order, app_data.built_in) == (
        "Application & Data",
        "#0f7eb5",
        2,
        True,
    )
    assert app_data.translations["fr"] == "Application et données"
    tech = by_key["Technical Architecture"]
    assert (tech.label, tech.sort_order, tech.built_in) == ("Technical Architecture", 9, True)
    assert tech.color != "#222222"
    assert by_key["Smuggled"].built_in is False
    assert by_key["Smuggled"].sort_order == 8


async def test_a_custom_layer_between_two_defaults_survives_import(db):
    """An admin who placed a custom layer between two defaults gets that order
    back on a target whose defaults are still in seed order — the built-ins'
    ``sort_order`` is transferred even though their other columns are locked."""
    from app.models.card_type_category import CardTypeCategory
    from app.services.card_type_categories import seed_default_categories

    user = await create_user(db, email="order-cat@test.com", role="admin")
    await seed_default_categories(db)
    await db.flush()
    by_key = {c.key: c for c in (await db.execute(select(CardTypeCategory))).scalars().all()}
    db.add(
        CardTypeCategory(
            key="Security",
            label="Security",
            color="#123456",
            sort_order=2,
            built_in=False,
            translations={},
        )
    )
    by_key["Application & Data"].sort_order = 3
    by_key["Technical Architecture"].sort_order = 4
    await db.flush()
    wanted = [
        "Strategy & Transformation",
        "Business Architecture",
        "Security",
        "Application & Data",
        "Technical Architecture",
    ]

    raw = await build_bundle(db)

    # The target: the custom layer gone, the defaults back in seed order.
    await db.execute(delete(CardTypeCategory).where(CardTypeCategory.built_in.is_(False)))
    for index, key in enumerate(wanted[:2] + wanted[3:]):
        by_key[key].sort_order = index
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0, result.as_dict()
    section = next(s for s in result.sections if s.sheet == schema.SHEET_CARD_TYPE_CATEGORIES)
    assert (section.created, section.updated) == (1, 2)
    assert "built_in_locked" not in section.skip_reasons
    ordered = (
        (await db.execute(select(CardTypeCategory.key).order_by(CardTypeCategory.sort_order)))
        .scalars()
        .all()
    )
    assert ordered == wanted

    again = await apply_bundle(db, parse_bundle(raw), user)
    section = next(s for s in again.sections if s.sheet == schema.SHEET_CARD_TYPE_CATEGORIES)
    assert (section.created, section.updated) == (0, 0)
    assert section.skip_reasons == {"identical": 5}


# ── The category applier, row by row ────────────────────────────────────────
#
# ``_apply_card_type_categories`` is a bespoke applier (it runs before the card
# types and keeps a built-in row's lock), so every branch of it answers to the
# applier module's own mutation floor: an unusable row, a row carrying only its
# key, a key named twice, a cleared translations cell, and a bundle claiming
# ``built_in`` on a custom row the target already has.


def _category_bundle(columns: tuple[str, ...], rows: list[dict]) -> bytes:
    sec = next(s for s in schema.CONFIG_SECTIONS if s.sheet == schema.SHEET_CARD_TYPE_CATEGORIES)
    return _make_bundle({schema.SHEET_CARD_TYPE_CATEGORIES: (columns, sec.json_columns, rows)})


def _category_section(result):
    return next(s for s in result.sections if s.sheet == schema.SHEET_CARD_TYPE_CATEGORIES)


async def _categories_by_key(db):
    from app.models.card_type_category import CardTypeCategory

    return {c.key: c for c in (await db.execute(select(CardTypeCategory))).scalars().all()}


async def test_category_rows_without_a_key_fail_without_stopping_the_sheet(db):
    """A row with no key (an empty cell or whitespace) is counted ``failed``,
    one per row, and the rows after it are still applied."""
    user = await create_user(db, email="cat-nokey@test.com", role="admin")
    columns = ("key", "label", "color", "sort_order")
    rows = [
        {"key": None, "label": "Nameless", "color": "#123456", "sort_order": 1},
        {"key": "   ", "label": "Blank", "color": "#123456", "sort_order": 2},
        {"key": "Security", "label": "Security", "color": "#abcdef", "sort_order": 3},
    ]
    result = await apply_bundle(db, parse_bundle(_category_bundle(columns, rows)), user)
    section = _category_section(result)
    assert (section.failed, section.created, section.updated) == (2, 1, 0)
    by_key = await _categories_by_key(db)
    assert "Security" in by_key
    assert not any(k.strip() == "" for k in by_key)


async def test_a_category_row_carrying_only_its_key_takes_the_defaults(db):
    """A hand-authored pack may list the key alone: the label is the key, the
    colour the registry's default, the place in the order the next free one,
    the translations empty, and the row is custom."""
    from app.services.card_type_categories import DEFAULT_COLOR, next_sort_order

    user = await create_user(db, email="cat-keyonly@test.com", role="admin")
    await seed_default_categories_for_test(db)
    expected_order = await next_sort_order(db)
    assert expected_order > 0
    result = await apply_bundle(
        db, parse_bundle(_category_bundle(("key",), [{"key": "Security"}])), user
    )
    assert result.total_failed == 0, result.as_dict()
    assert _category_section(result).created == 1
    row = (await _categories_by_key(db))["Security"]
    assert (row.label, row.color, row.sort_order, row.built_in, row.translations) == (
        "Security",
        DEFAULT_COLOR,
        expected_order,
        False,
        {},
    )


async def test_a_category_key_named_twice_in_one_bundle_is_created_once_then_updated(db):
    """The second row for a key the sheet already created updates that row
    instead of inserting a duplicate, and two distinct new keys count as two
    creations."""
    user = await create_user(db, email="cat-twice@test.com", role="admin")
    columns = ("key", "label", "color", "sort_order", "built_in", "translations")
    rows = [
        {"key": "Security", "label": "Security", "color": "#111111", "sort_order": 50},
        {"key": "Security", "label": "Security", "color": "#222222", "sort_order": 50},
        {"key": "Operations", "label": "Operations", "color": "#333333", "sort_order": 51},
    ]
    result = await apply_bundle(db, parse_bundle(_category_bundle(columns, rows)), user)
    assert result.total_failed == 0, result.as_dict()
    section = _category_section(result)
    assert (section.created, section.updated) == (2, 1)
    by_key = await _categories_by_key(db)
    assert by_key["Security"].color == "#222222"
    assert set(by_key) >= {"Security", "Operations"}


async def test_an_empty_translations_cell_clears_a_custom_categorys_translations(db):
    """An export can blank a field: an empty ``translations`` cell on a custom
    row the target holds lands as an empty map, never as NULL."""
    from app.models.card_type_category import CardTypeCategory

    user = await create_user(db, email="cat-trans@test.com", role="admin")
    db.add(
        CardTypeCategory(
            key="Security",
            label="Security",
            color="#111111",
            sort_order=50,
            built_in=False,
            translations={"fr": "Sécurité"},
        )
    )
    await db.flush()
    columns = ("key", "label", "color", "sort_order", "translations")
    rows = [
        {"key": "Security", "label": "Security", "color": "#111111", "sort_order": 50},
    ]
    result = await apply_bundle(db, parse_bundle(_category_bundle(columns, rows)), user)
    assert result.total_failed == 0, result.as_dict()
    assert _category_section(result).updated == 1
    assert (await _categories_by_key(db))["Security"].translations == {}


async def test_a_bundle_cannot_promote_a_custom_category_to_built_in(db):
    """``built_in`` is the target's verdict: a bundle claiming it on a custom
    row the target already has changes nothing (the row is identical), and the
    rows after it are still applied."""
    from app.models.card_type_category import CardTypeCategory

    user = await create_user(db, email="cat-promote@test.com", role="admin")
    db.add(
        CardTypeCategory(
            key="Security", label="Security", color="#111111", sort_order=50, built_in=False
        )
    )
    await db.flush()
    columns = ("key", "label", "color", "sort_order", "built_in", "translations")
    rows = [
        {
            "key": "Security",
            "label": "Security",
            "color": "#111111",
            "sort_order": 50,
            "built_in": True,
            "translations": {},
        },
        {
            "key": "Operations",
            "label": "Operations",
            "color": "#333333",
            "sort_order": 51,
            "built_in": False,
            "translations": {},
        },
    ]
    result = await apply_bundle(db, parse_bundle(_category_bundle(columns, rows)), user)
    assert result.total_failed == 0, result.as_dict()
    section = _category_section(result)
    assert (section.created, section.updated) == (1, 0)
    assert section.skip_reasons == {"identical": 1}
    by_key = await _categories_by_key(db)
    assert by_key["Security"].built_in is False
    assert by_key["Operations"].built_in is False


async def seed_default_categories_for_test(db):
    from app.services.card_type_categories import seed_default_categories

    await seed_default_categories(db)
    await db.flush()
