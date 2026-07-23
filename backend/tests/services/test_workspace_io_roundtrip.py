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

    elem = ProcessElement(
        process_id=process.id,
        bpmn_element_id="task_1",
        element_type="task",
        name="Create Quote",
        lane_name="Sales",
        sequence_order=0,
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
