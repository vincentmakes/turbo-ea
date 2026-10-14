"""Ids inside imported blobs follow their cards, relations and tags (#1246).

Every older round-trip test re-imported into the database it exported from,
where the cards were still there, matched themselves and kept their ids — so a
diagram whose XML still named the source's card ids looked exactly like a
correct one. These tests *wipe the inventory* between export and import, so
every card, relation and tag genuinely lands under a new primary key, and then
assert that the ids held inside diagrams, BPMN, draft links, report configs,
survey and portal filters, bookmarks, todo links and compliance findings moved
with it.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete, select

from app.models.bookmark import Bookmark
from app.models.card import Card
from app.models.comment import Comment
from app.models.diagram import Diagram, diagram_cards
from app.models.process_diagram import ProcessDiagram
from app.models.process_element import ProcessElement
from app.models.process_flow_version import ProcessFlowVersion
from app.models.relation import Relation
from app.models.saved_report import SavedReport
from app.models.survey import Survey, SurveyResponse
from app.models.tag import CardTag, Tag, TagGroup
from app.models.todo import Todo
from app.models.turbolens import TurboLensAnalysisRun, TurboLensComplianceFinding
from app.models.web_portal import WebPortal
from app.services.compliance_scanner import compute_finding_key
from app.services.workspace_io import (
    apply_bundle,
    build_bundle,
    diff_bundle,
    parse_bundle,
    schema,
)
from app.services.workspace_io.sections import ENTITY_SECTIONS
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_user,
)

pytestmark = pytest.mark.asyncio

# Every model the canary seeds, in delete order (children before cards).
_MODULE_MODELS = (
    Comment,
    SurveyResponse,
    TurboLensComplianceFinding,
    TurboLensAnalysisRun,
    Todo,
    ProcessElement,
    ProcessFlowVersion,
    ProcessDiagram,
    SavedReport,
    Survey,
    WebPortal,
    Bookmark,
    Diagram,
)


async def _wipe(db) -> None:
    """Delete the module rows, then every card, relation and tag — as if the
    bundle were going to an empty instance. The metamodel and users stay."""
    await db.execute(delete(diagram_cards))
    for model in _MODULE_MODELS:
        await db.execute(delete(model))
    await db.execute(delete(CardTag))
    await db.execute(delete(Relation))
    await db.execute(delete(Card))
    await db.execute(delete(Tag))
    await db.flush()


def _card_xml(cells: list[tuple[str, Card]], edges: list[tuple[str, Relation, str, str]]) -> str:
    parts = ['<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>']
    for cell_id, card in cells:
        parts.append(
            f'<object label="{card.name}" cardId="{card.id}" cardType="{card.type}" '
            f'cardName="{card.name}" id="{cell_id}">'
            '<mxCell vertex="1" parent="1"><mxGeometry as="geometry"/></mxCell></object>'
        )
    for edge_id, rel, src, tgt in edges:
        parts.append(
            f'<object label="uses" relationType="{rel.type}" relationId="{rel.id}" id="{edge_id}">'
            f'<mxCell edge="1" parent="1" source="{src}" target="{tgt}"/></object>'
        )
    parts.append("</root></mxGraphModel>")
    return "".join(parts)


async def _metamodel(db):
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="BusinessProcess", label="Business Process")
    await create_card_type(db, key="Organization", label="Organization")
    await create_relation_type(
        db,
        key="relAppToApp",
        label="uses",
        source_type_key="Application",
        target_type_key="Application",
    )


async def _by_name(db, name: str, type_key: str = "Application") -> Card:
    return (
        await db.execute(select(Card).where(Card.name == name, Card.type == type_key))
    ).scalar_one()


def _section(result, sheet: str):
    return next(s for s in result.sections if s.sheet == sheet)


# ── diagrams ───────────────────────────────────────────────────────────────


async def test_diagram_ids_follow_cards_to_new_primary_keys(db):
    """The bug in #1246: a diagram imported into an empty instance named the
    source's card ids, so every card on it read as deleted."""
    user = await create_user(db, email="dia@test.com", role="admin")
    await _metamodel(db)
    crm = await create_card(db, name="CRM", user_id=user.id)
    erp = await create_card(db, name="ERP", user_id=user.id)
    rel = await create_relation(db, type_key="relAppToApp", source_id=crm.id, target_id=erp.id)
    xml = _card_xml([("v1", crm), ("v2", erp)], [("e1", rel, "v1", "v2")])
    diagram = Diagram(
        name="Landscape",
        data={"xml": xml, "thumbnail": "data:image/png;base64,AA", "card_refs": [str(crm.id)]},
        created_by=user.id,
    )
    db.add(diagram)
    await db.flush()
    await db.execute(diagram_cards.insert().values(diagram_id=diagram.id, card_id=crm.id))
    await db.execute(diagram_cards.insert().values(diagram_id=diagram.id, card_id=erp.id))
    diagram_id = diagram.id
    old = {str(crm.id), str(erp.id), str(rel.id)}

    raw = await build_bundle(db)
    await _wipe(db)
    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0 and result.total_conflict == 0, result.as_dict()

    new_crm = await _by_name(db, "CRM")
    new_erp = await _by_name(db, "ERP")
    new_rel = (await db.execute(select(Relation))).scalar_one()
    assert {str(new_crm.id), str(new_erp.id), str(new_rel.id)}.isdisjoint(old)

    restored = (await db.execute(select(Diagram).where(Diagram.id == diagram_id))).scalar_one()
    assert restored.data["xml"] == (
        xml.replace(str(crm.id), str(new_crm.id))
        .replace(str(erp.id), str(new_erp.id))
        .replace(str(rel.id), str(new_rel.id))
    )
    assert restored.data["card_refs"] == [str(new_crm.id), str(new_erp.id)]
    assert restored.data["thumbnail"] == "data:image/png;base64,AA"
    links = {r.card_id for r in (await db.execute(select(diagram_cards))).all()}
    assert links == {new_crm.id, new_erp.id}
    assert _section(result, "Diagrams").references == {"remapped": 3}


async def test_reimporting_into_the_same_instance_is_still_a_no_op(db):
    user = await create_user(db, email="same@test.com", role="admin")
    await _metamodel(db)
    crm = await create_card(db, name="CRM", user_id=user.id)
    erp = await create_card(db, name="ERP", user_id=user.id)
    rel = await create_relation(db, type_key="relAppToApp", source_id=crm.id, target_id=erp.id)
    xml = _card_xml([("v1", crm), ("v2", erp)], [("e1", rel, "v1", "v2")])
    diagram = Diagram(name="Same", data={"xml": xml}, created_by=user.id)
    db.add(diagram)
    await db.flush()

    raw = await build_bundle(db)
    result = await apply_bundle(db, parse_bundle(raw), user)
    totals = result.as_dict()["totals"]
    assert totals["created"] == 0 and totals["updated"] == 0, result.as_dict()
    assert all(not s.references for s in result.sections)
    stored = (await db.execute(select(Diagram).where(Diagram.id == diagram.id))).scalar_one()
    assert stored.data["xml"] == xml


async def test_the_preview_reports_what_the_apply_does(db):
    user = await create_user(db, email="pre@test.com", role="admin")
    await _metamodel(db)
    crm = await create_card(db, name="CRM", user_id=user.id)
    db.add(Diagram(name="D", data={"xml": _card_xml([("v1", crm)], [])}, created_by=user.id))
    await db.flush()

    raw = await build_bundle(db)
    await _wipe(db)
    preview = await diff_bundle(db, parse_bundle(raw), user)
    applied = await apply_bundle(db, parse_bundle(raw), user)
    assert _section(preview, "Diagrams").references == {"remapped": 1}
    assert _section(applied, "Diagrams").references == {"remapped": 1}


# ── every other blob ───────────────────────────────────────────────────────


async def _seed_every_blob(db, user):
    """One row per kind of blob that holds a card, relation or tag id."""
    await _metamodel(db)
    crm = await create_card(db, name="CRM", user_id=user.id)
    erp = await create_card(db, name="ERP", user_id=user.id)
    callee = await create_card(db, card_type="BusinessProcess", name="Credit", user_id=user.id)
    process = await create_card(db, card_type="BusinessProcess", name="O2C", user_id=user.id)
    org = await create_card(db, card_type="Organization", name="Sales", user_id=user.id)
    rel = await create_relation(db, type_key="relAppToApp", source_id=crm.id, target_id=erp.id)
    group = TagGroup(name="Hosting", mode="multi")
    db.add(group)
    await db.flush()
    tag = Tag(tag_group_id=group.id, name="Cloud")
    db.add(tag)
    await db.flush()
    db.add(CardTag(card_id=crm.id, tag_id=tag.id))

    bpmn = (
        f'<bpmn:definitions><bpmn:callActivity id="c1" calledElement="{callee.id}"/>'
        f'<bpmn:task id="t1" turboea:processRef="{callee.id}"/></bpmn:definitions>'
    )
    run = TurboLensAnalysisRun(analysis_type="compliance", status="completed", results={})
    db.add(run)
    await db.flush()
    db.add_all(
        [
            Diagram(
                name="D",
                data={"xml": _card_xml([("v1", crm), ("v2", erp)], [("e1", rel, "v1", "v2")])},
                created_by=user.id,
            ),
            ProcessDiagram(process_id=process.id, bpmn_xml=bpmn, created_by=user.id),
            ProcessFlowVersion(
                process_id=process.id,
                status="draft",
                revision=1,
                bpmn_xml=bpmn,
                draft_element_links={
                    "t1": {
                        "application_id": str(crm.id),
                        "data_object_id": None,
                        "organization_ids": [str(org.id)],
                    }
                },
            ),
            ProcessElement(
                process_id=process.id,
                bpmn_element_id="c1",
                element_type="callActivity",
                sequence_order=0,
                called_element=str(callee.id),
                business_process_id=callee.id,
            ),
            SavedReport(
                owner_id=user.id,
                name="Deps",
                report_type="dependencies",
                config={
                    "center": str(crm.id),
                    "scopeIds": [str(erp.id)],
                    "relationFilters": {"relAppToApp": [str(erp.id)]},
                    "tagFilterIds": [str(tag.id)],
                },
            ),
            Survey(
                name="Owners",
                target_type_key="Application",
                target_filters={
                    "card_ids": [str(crm.id)],
                    "related_ids": [str(org.id)],
                    "tag_ids": [str(tag.id)],
                },
            ),
            WebPortal(
                name="Apps",
                slug="apps",
                card_type="Application",
                filters={"tag_ids": [str(tag.id)]},
            ),
            Bookmark(user_id=user.id, name="Cloud apps", filters={"tagIds": [str(tag.id)]}),
            Todo(description="Review", card_id=crm.id, link=f"/cards/{crm.id}"),
            TurboLensComplianceFinding(
                run_id=run.id,
                regulation="gdpr",
                regulation_article="Art. 30",
                scope_type="card",
                card_id=crm.id,
                requirement="Records",
                status="gap",
                severity="high",
                finding_key=compute_finding_key("card", crm.id, "gdpr", "Art. 30"),
                decision="accepted",
            ),
        ]
    )
    await db.flush()
    survey = (await db.execute(select(Survey))).scalar_one()
    db.add(
        SurveyResponse(
            survey_id=survey.id,
            card_id=crm.id,
            user_id=user.id,
            responses={
                "relAppToOrg": {
                    "current_value": [{"id": str(org.id), "name": "Sales"}],
                    "new_value": [str(org.id)],
                }
            },
        )
    )
    await db.flush()
    return {str(c) for c in (crm.id, erp.id, callee.id, process.id, org.id, rel.id, tag.id)}


def _stringify(value) -> str:
    return repr(value)


async def test_no_source_id_survives_a_cross_instance_import(db):
    """The canary: after a transfer to an empty instance, no row in any
    module section still names a card, relation or tag of the source."""
    user = await create_user(db, email="canary@test.com", role="admin")
    old_ids = await _seed_every_blob(db, user)

    raw = await build_bundle(db)
    await _wipe(db)
    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_failed == 0 and result.total_conflict == 0, result.as_dict()

    leaks = []
    for section in ENTITY_SECTIONS:
        for obj in (await db.execute(select(section.model))).scalars().all():
            for col in section.model.__table__.columns:
                text = _stringify(getattr(obj, col.name))
                for old in old_ids:
                    if old in text:
                        leaks.append(f"{section.sheet}.{col.name}")
    assert leaks == []

    new_crm = await _by_name(db, "CRM")
    finding = (await db.execute(select(TurboLensComplianceFinding))).scalar_one()
    assert finding.card_id == new_crm.id
    assert finding.finding_key == compute_finding_key("card", new_crm.id, "gdpr", "Art. 30")
    todo = (await db.execute(select(Todo))).scalar_one()
    assert todo.link == f"/cards/{new_crm.id}"
    version = (await db.execute(select(ProcessFlowVersion))).scalar_one()
    assert version.draft_element_links["t1"]["application_id"] == str(new_crm.id)
    assert version.draft_element_links["t1"]["data_object_id"] is None


async def test_a_selective_run_over_module_sheets_still_translates(db):
    """``apply_selected`` without the Cards sheet: the map is rebuilt from the
    bundle rows' references, so blobs still translate."""
    from app.services.workspace_io import apply_selected

    user = await create_user(db, email="sel@test.com", role="admin")
    await _metamodel(db)
    crm = await create_card(db, name="CRM", user_id=user.id)
    db.add(Diagram(name="D", data={"xml": _card_xml([("v1", crm)], [])}, created_by=user.id))
    await db.flush()
    raw = await build_bundle(db)
    await _wipe(db)
    new_crm = await create_card(db, name="CRM", user_id=user.id)

    await apply_selected(db, parse_bundle(raw), user, sheets={"Diagrams"}, dry_run=False)
    restored = (await db.execute(select(Diagram))).scalar_one()
    assert f'cardId="{new_crm.id}"' in restored.data["xml"]


# ── bundles written before source_id existed ───────────────────────────────


def _strip_source_ids(bundle) -> None:
    for sheet in (schema.SHEET_CARDS, schema.SHEET_RELATIONS, schema.SHEET_TAGS):
        for row in bundle.sheets.get(sheet, []):
            for col in (schema.SOURCE_ID_COLUMN, "source_card_id", "target_card_id"):
                row.pop(col, None)
    for sheet_rows in bundle.sheets.values():
        for row in sheet_rows:
            for col in [c for c in row if c.endswith("__id")]:
                row.pop(col)


async def test_a_legacy_bundle_relinks_its_diagrams_by_card_name(db):
    user = await create_user(db, email="legacy@test.com", role="admin")
    await _metamodel(db)
    # Two same-named cards under different parents (a hierarchy is per type).
    eu = await create_card(db, name="EU suite", user_id=user.id)
    us = await create_card(db, name="US suite", user_id=user.id)
    crm_eu = await create_card(db, name="CRM", parent_id=eu.id, user_id=user.id)
    crm_us = await create_card(db, name="CRM", parent_id=us.id, user_id=user.id)
    erp = await create_card(db, name="ERP", user_id=user.id)
    rel = await create_relation(db, type_key="relAppToApp", source_id=crm_eu.id, target_id=erp.id)
    # Two same-named cards; the diagram's own links say which one it drew.
    xml_eu = _card_xml([("v1", crm_eu), ("v2", erp)], [("e1", rel, "v1", "v2")])
    linked = Diagram(name="Linked", data={"xml": xml_eu}, created_by=user.id)
    # The same card with no DiagramCards row to tell the two apart.
    unlinked = Diagram(name="Unlinked", data={"xml": _card_xml([("v1", crm_us)], [])})
    db.add_all([linked, unlinked])
    await db.flush()
    await db.execute(diagram_cards.insert().values(diagram_id=linked.id, card_id=crm_eu.id))
    await db.execute(diagram_cards.insert().values(diagram_id=linked.id, card_id=erp.id))
    old_crm_us = str(crm_us.id)

    raw = await build_bundle(db)
    await _wipe(db)
    bundle = parse_bundle(raw)
    _strip_source_ids(bundle)
    result = await apply_bundle(db, bundle, user)
    assert result.total_failed == 0, result.as_dict()

    new_eu = await _by_name(db, "EU suite")
    new_crm_eu = (
        await db.execute(select(Card).where(Card.name == "CRM", Card.parent_id == new_eu.id))
    ).scalar_one()
    new_erp = await _by_name(db, "ERP")
    new_rel = (await db.execute(select(Relation))).scalar_one()

    restored = (await db.execute(select(Diagram).where(Diagram.id == linked.id))).scalar_one()
    assert f'cardId="{new_crm_eu.id}"' in restored.data["xml"]
    assert f'cardId="{new_erp.id}"' in restored.data["xml"]
    assert f'relationId="{new_rel.id}"' in restored.data["xml"]

    other = (await db.execute(select(Diagram).where(Diagram.id == unlinked.id))).scalar_one()
    assert f'cardId="{old_crm_us}"' in other.data["xml"]  # ambiguous: left alone
    section = _section(result, "Diagrams")
    assert section.references == {"relinked_by_name": 3, "ambiguous": 1}
    assert "diagram card 'CRM' (Application) matches several cards" in section.errors


# ── earlier imports are healed by a re-import ──────────────────────────────


async def test_a_reimport_heals_what_an_earlier_import_left_stale(db):
    """Instances that imported before the fix hold diagrams with the source's
    ids. Re-importing the bundle rewrites them — but never a row edited since."""
    user = await create_user(db, email="heal@test.com", role="admin")
    await _metamodel(db)
    crm = await create_card(db, name="CRM", user_id=user.id)
    stale_xml = _card_xml([("v1", crm)], [])
    untouched = Diagram(name="Untouched", data={"xml": stale_xml}, created_by=user.id)
    edited = Diagram(name="Edited", data={"xml": stale_xml}, created_by=user.id)
    db.add_all([untouched, edited])
    await db.flush()

    raw = await build_bundle(db)
    # What a pre-fix import left behind: the cards under new ids, the diagrams
    # still naming the old ones.
    await db.execute(delete(Card))
    await db.flush()
    new_crm = await create_card(db, name="CRM", user_id=user.id)
    edited.data = {"xml": stale_xml + "<!-- moved a shape -->"}
    await db.flush()

    result = await apply_bundle(db, parse_bundle(raw), user)
    section = _section(result, "Diagrams")
    assert section.updated == 1 and section.skipped == 1
    assert section.references == {"remapped": 1, "healed": 1}
    healed = (await db.execute(select(Diagram).where(Diagram.id == untouched.id))).scalar_one()
    assert healed.data["xml"] == stale_xml.replace(str(crm.id), str(new_crm.id))
    kept = (await db.execute(select(Diagram).where(Diagram.id == edited.id))).scalar_one()
    assert str(crm.id) in kept.data["xml"]

    again = await apply_bundle(db, parse_bundle(raw), user)
    assert _section(again, "Diagrams").updated == 0


# ── archived cards ─────────────────────────────────────────────────────────


async def test_reimporting_archived_cards_into_the_same_instance_creates_none(db):
    user = await create_user(db, email="arch@test.com", role="admin")
    await _metamodel(db)
    await create_card(db, name="Old", status="ARCHIVED", user_id=user.id)
    await create_card(db, name="Live", user_id=user.id)
    before = len((await db.execute(select(Card))).scalars().all())

    raw = await build_bundle(db, include_archived=True)
    result = await apply_bundle(db, parse_bundle(raw), user)
    cards = _section(result, schema.SHEET_CARDS)
    assert cards.created == 0 and cards.skip_reasons == {"already_present": 2}
    assert len((await db.execute(select(Card))).scalars().all()) == before


async def test_a_legacy_archived_row_matches_the_archived_card_it_landed_as(db):
    user = await create_user(db, email="arch2@test.com", role="admin")
    await _metamodel(db)
    old = await create_card(db, name="Old", status="ARCHIVED", user_id=user.id)
    old.reference = "APP-0007"
    await db.flush()

    raw = await build_bundle(db, include_archived=True)
    bundle = parse_bundle(raw)
    _strip_source_ids(bundle)
    result = await apply_bundle(db, bundle, user)
    assert _section(result, schema.SHEET_CARDS).created == 0
    gone = (await db.execute(select(Card).where(Card.name == "Old"))).scalars().all()
    assert [c.id for c in gone] == [old.id]


async def test_a_legacy_archived_row_does_not_merge_into_a_differently_named_card(db):
    user = await create_user(db, email="arch3@test.com", role="admin")
    await _metamodel(db)
    old = await create_card(db, name="Old", status="ARCHIVED", user_id=user.id)
    old.reference = "APP-0007"
    await db.flush()
    raw = await build_bundle(db, include_archived=True)
    old.name = "Renamed since"
    await db.flush()

    bundle = parse_bundle(raw)
    _strip_source_ids(bundle)
    result = await apply_bundle(db, bundle, user)
    assert _section(result, schema.SHEET_CARDS).created == 1


async def test_links_to_archived_cards_transfer_to_a_new_instance(db):
    """The reference resolver sees ACTIVE cards only, so a relation or a
    comment on an archived card used to be dropped as a conflict."""
    user = await create_user(db, email="arch4@test.com", role="admin")
    await _metamodel(db)
    old = await create_card(db, name="Old", status="ARCHIVED", user_id=user.id)
    older = await create_card(db, name="Older", status="ARCHIVED", user_id=user.id)
    await create_relation(db, type_key="relAppToApp", source_id=old.id, target_id=older.id)
    db.add(Comment(card_id=old.id, user_id=user.id, content="Retired in 2024"))
    await db.flush()

    raw = await build_bundle(db, include_archived=True)
    await _wipe(db)
    result = await apply_bundle(db, parse_bundle(raw), user)
    assert result.total_conflict == 0, result.as_dict()

    new_old = await _by_name(db, "Old")
    new_older = await _by_name(db, "Older")
    assert new_old.status == "ARCHIVED" and new_old.id != old.id
    rel = (await db.execute(select(Relation))).scalar_one()
    assert (rel.source_id, rel.target_id) == (new_old.id, new_older.id)
    comment = (await db.execute(select(Comment))).scalar_one()
    assert comment.card_id == new_old.id


async def test_a_source_id_of_another_type_does_not_match(db):
    """A row's id only ever matches a card of the row's own type."""
    from app.services.workspace_io import applier
    from app.services.workspace_io.bundle import WorkspaceBundle

    user = await create_user(db, email="type@test.com", role="admin")
    await _metamodel(db)
    org = await create_card(db, card_type="Organization", name="Same", user_id=user.id)
    rows = [{"type": "Application", "name": "Same", "source_id": str(org.id)}]
    sr = applier.SectionResult(sheet=schema.SHEET_CARDS)
    ids = applier.rm.IdMap()
    bundle = WorkspaceBundle(manifest={}, sheets={schema.SHEET_CARDS: rows}, assets={})
    await applier._make_cards_applier(user, ids)(db, bundle, sr, False)
    assert sr.created == 1
    created = await _by_name(db, "Same")
    assert ids.cards == {str(org.id): str(created.id)}


async def test_every_core_outcome_records_where_its_id_went(db):
    from app.services.workspace_io import applier
    from app.services.workspace_io.bundle import WorkspaceBundle

    user = await create_user(db, email="rec@test.com", role="admin")
    await _metamodel(db)
    present = await create_card(db, name="Present", user_id=user.id)
    by_ext = await create_card(db, name="Ext", user_id=user.id)
    by_ext.external_id = "x-1"
    await db.flush()
    s = [str(uuid.uuid4()) for _ in range(5)]
    rows = [
        {"type": "Application", "name": "Present", "source_id": s[0]},
        {"type": "Application", "name": "Other", "external_id": "x-1", "source_id": s[1]},
        {"type": "Application", "name": "Fresh", "source_id": s[2]},
        {"type": "Application", "name": "Fresh", "source_id": s[3]},  # duplicate in bundle
        {"type": "Application", "name": "Same id", "source_id": str(present.id)},
    ]
    ids = applier.rm.IdMap()
    sr = applier.SectionResult(sheet=schema.SHEET_CARDS)
    bundle = WorkspaceBundle(manifest={}, sheets={schema.SHEET_CARDS: rows}, assets={})
    await applier._make_cards_applier(user, ids)(db, bundle, sr, False)
    fresh = await _by_name(db, "Fresh")
    assert ids.cards == {
        s[0]: str(present.id),
        s[1]: str(by_ext.id),
        s[2]: str(fresh.id),
        s[3]: str(fresh.id),
        str(present.id): str(present.id),
    }

    # Relations and tags record both what they create and what they find.
    erp = await create_card(db, name="ERP", user_id=user.id)
    existing = await create_relation(
        db, type_key="relAppToApp", source_id=present.id, target_id=erp.id
    )
    r = [str(uuid.uuid4()) for _ in range(2)]
    rel_rows = [
        {
            "type": "relAppToApp",
            "source_type": "Application",
            "source_ref": "Present",
            "target_type": "Application",
            "target_ref": "ERP",
            "source_id": r[0],
        },
        {
            "type": "relAppToApp",
            "source_type": "Application",
            "source_ref": "Fresh",
            "target_type": "Application",
            "target_ref": "ERP",
            "source_id": r[1],
            "source_card_id": s[2],  # through the map, not the reference
        },
    ]
    sr = applier.SectionResult(sheet=schema.SHEET_RELATIONS)
    bundle = WorkspaceBundle(manifest={}, sheets={schema.SHEET_RELATIONS: rel_rows}, assets={})
    await applier._apply_relations(db, bundle, sr, False, id_map=ids)
    created = (
        await db.execute(select(Relation).where(Relation.source_id == fresh.id))
    ).scalar_one()
    assert ids.relations == {r[0]: str(existing.id), r[1]: str(created.id)}

    group = TagGroup(name="G", mode="multi")
    db.add(group)
    await db.flush()
    old_tag = Tag(tag_group_id=group.id, name="Old")
    db.add(old_tag)
    await db.flush()
    t = [str(uuid.uuid4()) for _ in range(2)]
    tag_rows = [
        {"group_name": "G", "name": "Old", "source_id": t[0]},
        {"group_name": "G", "name": "New", "source_id": t[1]},
    ]
    sr = applier.SectionResult(sheet=schema.SHEET_TAGS)
    bundle = WorkspaceBundle(manifest={}, sheets={schema.SHEET_TAGS: tag_rows}, assets={})
    await applier._apply_tags(db, bundle, sr, False, id_map=ids)
    new_tag = (await db.execute(select(Tag).where(Tag.name == "New"))).scalar_one()
    assert ids.tags == {t[0]: str(old_tag.id), t[1]: str(new_tag.id)}


async def test_a_bundle_carries_every_rows_own_id(db):
    user = await create_user(db, email="ids@test.com", role="admin")
    await _metamodel(db)
    crm = await create_card(db, name="CRM", user_id=user.id)
    erp = await create_card(db, name="ERP", user_id=user.id)
    rel = await create_relation(db, type_key="relAppToApp", source_id=crm.id, target_id=erp.id)
    group = TagGroup(name="G", mode="multi")
    db.add(group)
    await db.flush()
    tag = Tag(tag_group_id=group.id, name="T")
    db.add(tag)
    db.add(Todo(description="x", card_id=crm.id))
    await db.flush()

    bundle = parse_bundle(await build_bundle(db))
    cards = {r["name"]: r["source_id"] for r in bundle.rows(schema.SHEET_CARDS)}
    assert cards == {"CRM": str(crm.id), "ERP": str(erp.id)}
    (rel_row,) = bundle.rows(schema.SHEET_RELATIONS)
    assert (rel_row["source_id"], rel_row["source_card_id"], rel_row["target_card_id"]) == (
        str(rel.id),
        str(crm.id),
        str(erp.id),
    )
    (tag_row,) = bundle.rows(schema.SHEET_TAGS)
    assert tag_row["source_id"] == str(tag.id)
    (todo_row,) = bundle.rows("Todos")
    assert todo_row["card_id__id"] == str(crm.id)
    assert todo_row["card_id__ref"] == "CRM"
