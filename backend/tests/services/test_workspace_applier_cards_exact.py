"""The workspace applier's card passes and its orchestration, pinned to exact values.

Covers the cards pass (topological create-or-skip, parent resolution,
reference clashes, validation), card tags, relations, the section order and
selection of ``_run``, dry-run rollback, and the final rescoring pass — the
values the nightly mutation run showed no test compared.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.tag import CardTag, Tag, TagGroup
from app.services import event_bus as event_bus_module
from app.services.permission_service import PermissionService
from app.services.workspace_io import applier, schema
from app.services.workspace_io.bundle import WorkspaceBundle
from app.services.workspace_io.sections import (
    ENTITY_SECTIONS,
    SHEET_BOOKMARK_SHARES,
    SHEET_DIAGRAM_CARDS,
    SHEET_DIAGRAM_GROUP_MEMBERS,
)
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_user,
)

APP_SCHEMA = [{"section": "Main", "fields": [{"key": "website", "type": "url"}]}]


def bundle(sheets: dict[str, list[dict]]) -> WorkspaceBundle:
    return WorkspaceBundle(manifest={}, sheets=sheets, assets={})


def counts(sr: applier.SectionResult) -> tuple[int, int, int, int, int]:
    return sr.created, sr.updated, sr.skipped, sr.conflict, sr.failed


@pytest.fixture
async def env(db):
    await create_card_type(
        db, key="Application", label="Application", has_hierarchy=True, fields_schema=APP_SCHEMA
    )
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_card_type(
        db, key="BusinessCapability", label="Business Capability", has_hierarchy=True
    )
    user = await create_user(db, email="importer@test.com")
    return SimpleNamespace(user=user)


@pytest.fixture
def published(monkeypatch):
    calls = []

    async def fake(event_type, data, db=None, card_id=None, user_id=None, batch_id=None):
        calls.append(
            {"type": event_type, "data": data, "db": db, "card_id": card_id, "user_id": user_id}
        )

    monkeypatch.setattr(event_bus_module.event_bus, "publish", fake)
    return calls


async def run_cards(db, user, rows, *, dry_run=False):
    sr = applier.SectionResult(sheet=schema.SHEET_CARDS)
    await applier._make_cards_applier(user)(db, bundle({schema.SHEET_CARDS: rows}), sr, dry_run)
    return sr


async def card_named(db, name, type_key="Application"):
    return (
        await db.execute(select(Card).where(Card.name == name, Card.type == type_key))
    ).scalar_one()


async def maybe_card(db, name, type_key="Application"):
    return (
        await db.execute(select(Card).where(Card.name == name, Card.type == type_key))
    ).scalar_one_or_none()


# ── the cards pass ──────────────────────────────────────────────────────────


async def test_a_card_row_lands_with_every_column(db, env, published):
    row = {
        "type": "Application",
        "name": "Billing",
        "parent_path": "",
        "parent_label": "sales",
        "subtype": "saas",
        "description": "Bills",
        "external_id": "x-1",
        "reference": "APP-9",
        "alias": "BIL",
        "approval_status": "APPROVED",
        "status": "ACTIVE",
        "lifecycle": '{"active": "2024-01-01"}',
        "attributes": '{"website": "https://billing"}',
    }
    sr = await run_cards(db, env.user, [row])
    card = await card_named(db, "Billing")
    assert (card.subtype, card.description, card.external_id) == ("saas", "Bills", "x-1")
    assert (card.reference, card.alias, card.approval_status) == ("APP-9", "BIL", "APPROVED")
    assert card.parent_label is None  # no parent, no link label
    assert card.lifecycle == {"active": "2024-01-01"}
    assert card.attributes == {"website": "https://billing", "hierarchyLevel": 1}
    assert card.created_by == card.updated_by == env.user.id
    assert counts(sr) == (1, 0, 0, 0, 0)
    assert published == [
        {
            "type": "card.created",
            "data": {"id": str(card.id), "type": "Application", "name": "Billing"},
            "db": db,
            "card_id": card.id,
            "user_id": env.user.id,
        }
    ]


async def test_a_bare_card_row_takes_the_defaults(db, env, published):
    await run_cards(db, env.user, [{"type": "ITComponent", "name": "Server", "lifecycle": ""}])
    card = await card_named(db, "Server", "ITComponent")
    assert (card.lifecycle, card.attributes) == ({}, {})
    assert (card.status, card.approval_status) == ("ACTIVE", "DRAFT")
    assert (card.reference, card.external_id, card.parent_id) == (None, None, None)


async def test_parents_are_created_before_their_children_whatever_the_order(db, env, published):
    rows = [
        {"type": "Application", "name": "Leaf", "parent_path": "Top / Mid"},
        {"type": "Application", "name": "Mid", "parent_path": "Top", "parent_label": "sales"},
        {"type": "Application", "name": "Top"},
    ]
    sr = await run_cards(db, env.user, rows)
    top, mid, leaf = [await card_named(db, n) for n in ("Top", "Mid", "Leaf")]
    assert (mid.parent_id, mid.parent_label) == (top.id, "sales")
    assert leaf.parent_id == mid.id
    assert [c.attributes["hierarchyLevel"] for c in (top, mid, leaf)] == [1, 2, 3]
    assert counts(sr) == (3, 0, 0, 0, 0)
    assert [p["data"]["name"] for p in published] == ["Top", "Mid", "Leaf"]


async def test_a_card_under_an_existing_parent_resolves_it_from_the_database(db, env, published):
    existing = await create_card(db, name="Existing")
    sr = await run_cards(
        db, env.user, [{"type": "Application", "name": "Child", "parent_path": "Existing"}]
    )
    assert (await card_named(db, "Child")).parent_id == existing.id
    assert counts(sr) == (1, 0, 0, 0, 0)


async def test_rows_without_a_type_or_name_fail(db, env, published):
    sr = await run_cards(db, env.user, [{"name": "Typeless"}, {"type": "Application"}])
    assert counts(sr) == (0, 0, 0, 0, 2)


async def test_a_card_already_here_or_twice_in_the_bundle_is_skipped(db, env, published):
    await create_card(db, name="Present")
    await create_card(db, name="Twin")
    await create_card(db, name="Twin")
    rows = [
        {"type": "Application", "name": "New"},
        {"type": "Application", "name": "New"},
        {"type": "Application", "name": "Present"},
        {"type": "Application", "name": "Twin"},
    ]
    sr = await run_cards(db, env.user, rows)
    assert counts(sr) == (1, 0, 3, 0, 0)
    assert sr.skip_reasons == {
        "duplicate_in_bundle": 1,
        "already_present": 1,
        "ambiguous_match": 1,
    }


async def test_an_external_id_matches_a_live_card_of_the_same_type(db, env, published):
    await create_card(db, name="Old name")
    old = await card_named(db, "Old name")
    old.external_id = "x-1"
    gone = await create_card(db, name="Retired", status="ARCHIVED")
    gone.external_id = "x-2"
    itc = await create_card(db, card_type="ITComponent", name="Server")
    itc.external_id = "x-3"
    await db.flush()
    rows = [
        {"type": "Application", "name": "Renamed", "external_id": "x-1"},
        {"type": "Application", "name": "Revived", "external_id": "x-2"},
        {"type": "Application", "name": "Other type", "external_id": "x-3"},
    ]
    sr = await run_cards(db, env.user, rows)
    assert counts(sr) == (2, 0, 1, 0, 0)
    assert sr.skip_reasons == {"already_present": 1}


async def test_a_missing_parent_is_a_conflict(db, env, published):
    sr = await run_cards(
        db, env.user, [{"type": "Application", "name": "Orphan", "parent_path": "Ghost"}]
    )
    assert counts(sr) == (0, 0, 0, 1, 0)
    assert sr.errors == ["card 'Orphan': parent 'Ghost' not found"]
    assert published == []


async def test_a_bad_url_fails_the_row_with_its_reason(db, env, published):
    sr = await run_cards(
        db,
        env.user,
        [
            {"type": "Application", "name": "Bad", "attributes": '{"website": "ftp://x"}'},
            {"type": "Application", "name": "Good"},
        ],
    )
    assert counts(sr) == (1, 0, 0, 0, 1)
    assert sr.errors == [
        "card 'Bad': 422: Field 'website' must use http://, https://, or mailto: scheme"
    ]


async def test_a_card_too_deep_for_the_capability_tree_fails(db, env, published):
    parent = None
    for level in range(1, 6):
        parent = await create_card(
            db,
            card_type="BusinessCapability",
            name=f"L{level}",
            parent_id=parent.id if parent else None,
        )
    sr = await run_cards(
        db,
        env.user,
        [{"type": "BusinessCapability", "name": "L6", "parent_path": "L1 / L2 / L3 / L4 / L5"}],
    )
    assert counts(sr) == (0, 0, 0, 0, 1)
    assert "maximum depth of 5 levels" in sr.errors[0]
    assert published == []
    # Fixed in 2.157.3: the refused card was counted as failed yet stayed in
    # the session, and the import committed it six levels deep.
    assert await maybe_card(db, "L6", "BusinessCapability") is None


async def test_a_row_the_database_refuses_leaves_the_rest_of_the_import_intact(db, env, published):
    """A value too long for its column fails at flush. Before 2.157.3 that left
    the session needing a rollback, so every later row failed with it and the
    pass itself raised."""
    sr = await run_cards(
        db,
        env.user,
        [
            {"type": "Application", "name": "Too long", "status": "S" * 30},
            {"type": "Application", "name": "After"},
        ],
    )
    assert counts(sr) == (1, 0, 0, 0, 1)
    assert sr.errors[0].startswith("card 'Too long': ")
    assert await maybe_card(db, "Too long") is None
    assert (await card_named(db, "After")).status == "ACTIVE"
    assert [c["data"]["name"] for c in published] == ["After"]


async def test_a_clashing_reference_is_regenerated_or_dropped(db, env, published):
    auto = (await db.execute(select(CardType).where(CardType.key == "ITComponent"))).scalar_one()
    auto.reference_config = {"mode": "auto", "prefix": "IT-", "start": 1, "padding": 2}
    taken_app = await create_card(db, name="Taken")
    taken_app.reference = "APP-1"
    taken_itc = await create_card(db, card_type="ITComponent", name="Taken")
    taken_itc.reference = "IT-01"
    await db.flush()
    rows = [
        {"type": "Application", "name": "Clash", "reference": "APP-1"},
        {"type": "ITComponent", "name": "Clash", "reference": "IT-01"},
        {"type": "Application", "name": "Free", "reference": "APP-2"},
        {"type": "Application", "name": "Blank", "reference": ""},
    ]
    await run_cards(db, env.user, rows)
    assert (await card_named(db, "Clash")).reference is None
    assert (await card_named(db, "Clash", "ITComponent")).reference == "IT-02"
    assert (await card_named(db, "Free")).reference == "APP-2"
    assert (await card_named(db, "Blank")).reference is None


async def test_a_dry_run_counts_the_cards_but_announces_nothing(db, env, published):
    sr = await run_cards(db, env.user, [{"type": "Application", "name": "Preview"}], dry_run=True)
    assert counts(sr) == (1, 0, 0, 0, 0)
    assert published == []


async def test_an_external_id_lookup_ignores_other_types_and_archived_cards(db, env):
    live = await create_card(db, name="Live")
    live.external_id = "e-1"
    gone = await create_card(db, name="Gone", status="ARCHIVED")
    gone.external_id = "e-2"
    await db.flush()
    assert (await applier._card_by_external_id(db, "Application", "e-1"))[0] == live.id
    assert await applier._card_by_external_id(db, "ITComponent", "e-1") is None
    assert await applier._card_by_external_id(db, "Application", "e-2") is None


# ── card tags ───────────────────────────────────────────────────────────────


async def test_card_tags_need_a_known_group_tag_and_card(db, env):
    group = TagGroup(name="Domain")
    db.add(group)
    await db.flush()
    finance = Tag(tag_group_id=group.id, name="Finance")
    db.add(finance)
    billing = await create_card(db, name="Billing")
    payroll = await create_card(db, name="Payroll")
    await db.flush()
    db.add(CardTag(card_id=payroll.id, tag_id=finance.id))
    await db.flush()
    ok = {"card_type": "Application", "card_ref": "Billing", "group_name": "Domain"}
    rows = [
        {**ok, "tag_name": "Finance"},
        {**ok, "tag_name": "Finance"},
        {**ok, "card_ref": "Payroll", "tag_name": "Finance"},
        {**ok, "group_name": "Nope", "tag_name": "X"},
        {"card_ref": "Billing", "group_name": "Domain", "tag_name": "Finance"},
        {"card_type": "Application", "group_name": "Domain", "tag_name": "Finance"},
        {**ok, "card_ref": "Ghost", "tag_name": "Finance"},
        {**ok, "tag_name": "Unknown"},
    ]
    sr = applier.SectionResult(sheet=schema.SHEET_CARD_TAGS)
    await applier._apply_card_tags(db, bundle({schema.SHEET_CARD_TAGS: rows}), sr, False)
    links = {(ct.card_id, ct.tag_id) for ct in (await db.execute(select(CardTag))).scalars()}
    assert links == {(billing.id, finance.id), (payroll.id, finance.id)}
    assert counts(sr) == (1, 0, 2, 5, 0)
    assert sr.skip_reasons == {"already_present": 2}
    assert sr.errors == [
        "card tag 'X': group 'Nope' or card ref missing — skipped",
        "card tag 'Finance': group 'Domain' or card ref missing — skipped",
        "card tag 'Finance': group 'Domain' or card ref missing — skipped",
        "card tag 'Finance': tag or card 'Ghost' unresolved — skipped",
        "card tag 'Unknown': tag or card 'Billing' unresolved — skipped",
    ]


# ── relations ───────────────────────────────────────────────────────────────


async def test_relations_resolve_both_ends_and_land_in_their_type_direction(db, env):
    await create_relation_type(db, key="app_to_itc", label="runs on", reverse_label="hosts")
    billing = await create_card(db, name="Billing")
    payroll = await create_card(db, name="Payroll")
    hr = await create_card(db, name="HR")
    server = await create_card(db, card_type="ITComponent", name="Server")
    await create_relation(db, source_id=hr.id, target_id=server.id)
    fwd = {
        "type": "app_to_itc",
        "source_type": "Application",
        "source_ref": "Billing",
        "target_type": "ITComponent",
        "target_ref": "Server",
    }
    back = {
        "type": "app_to_itc",
        "source_type": "ITComponent",
        "source_ref": "Server",
        "target_type": "Application",
    }
    rows = [
        {**fwd, "description": "runs on", "attributes": '{"k": 1}'},
        {**back, "target_ref": "Payroll"},
        fwd,
        {**back, "target_ref": "Billing"},
        {**fwd, "source_ref": "HR"},
        {**fwd, "target_ref": "Ghost"},
        {**fwd, "type": ""},
    ]
    sr = applier.SectionResult(sheet=schema.SHEET_RELATIONS)
    await applier._apply_relations(db, bundle({schema.SHEET_RELATIONS: rows}), sr, False)
    rels = {
        (r.source_id, r.target_id): r for r in (await db.execute(select(Relation))).scalars().all()
    }
    assert set(rels) == {(billing.id, server.id), (payroll.id, server.id), (hr.id, server.id)}
    first = rels[(billing.id, server.id)]
    assert (first.type, first.description, first.attributes) == ("app_to_itc", "runs on", {"k": 1})
    assert rels[(payroll.id, server.id)].attributes == {}
    assert counts(sr) == (2, 0, 3, 2, 0)
    assert sr.skip_reasons == {"already_present": 3}
    assert sr.errors == [
        "relation 'app_to_itc': endpoint(s) unresolved ('Billing' -> 'Ghost')",
        "relation '': endpoint(s) unresolved ('Billing' -> 'Server')",
    ]


# ── orchestration ───────────────────────────────────────────────────────────


@pytest.fixture
def finalized(monkeypatch):
    calls = []

    async def fake(db):
        calls.append(db)

    monkeypatch.setattr(applier, "_finalize_cards", fake)
    return calls


@pytest.fixture
def invalidated(monkeypatch):
    calls = []
    for name in (
        "invalidate_role_cache",
        "invalidate_srd_cache",
        "invalidate_type_permission_cache",
    ):
        monkeypatch.setattr(PermissionService, name, lambda n=name: calls.append(n))
    return calls


async def test_a_full_run_walks_every_section_in_dependency_order(db, env, finalized):
    result = await applier.diff_bundle(db, bundle({}), env.user)
    sheets = [s.sheet for s in result.sections]
    assert sheets == [
        schema.SHEET_CARD_TYPES,
        schema.SHEET_RELATION_TYPES,
        *(sec.sheet for sec in schema.CONFIG_SECTIONS),
        schema.SHEET_TAG_GROUPS,
        schema.SHEET_TAGS,
        schema.SHEET_USERS,
        schema.SHEET_SETTINGS,
        schema.SHEET_CARDS,
        schema.SHEET_CARD_TAGS,
        schema.SHEET_RELATIONS,
        *(ent.sheet for ent in ENTITY_SECTIONS),
        SHEET_DIAGRAM_CARDS,
        SHEET_DIAGRAM_GROUP_MEMBERS,
        SHEET_BOOKMARK_SHARES,
    ]
    assert result.dry_run is True
    assert finalized == [db]


async def test_a_selective_run_touches_only_its_sheets(db, env, finalized, invalidated):
    rows = {
        schema.SHEET_TAG_GROUPS: [{"name": "Domain"}],
        schema.SHEET_TAGS: [{"group_name": "Domain", "name": "Finance"}],
        schema.SHEET_CARDS: [{"type": "Application", "name": "Not wanted"}],
    }
    result = await applier.apply_selected(
        db,
        bundle(rows),
        env.user,
        sheets={schema.SHEET_TAG_GROUPS, schema.SHEET_TAGS},
        dry_run=False,
    )
    assert [s.sheet for s in result.sections] == [schema.SHEET_TAG_GROUPS, schema.SHEET_TAGS]
    assert [s.created for s in result.sections] == [1, 1]
    assert result.dry_run is False
    assert finalized == []
    assert (await db.execute(select(Card))).scalars().all() == []
    assert invalidated == [
        "invalidate_role_cache",
        "invalidate_srd_cache",
        "invalidate_type_permission_cache",
    ]


@pytest.mark.parametrize(
    "sheet",
    [
        schema.SHEET_CARDS,
        schema.SHEET_CARD_TAGS,
        schema.SHEET_RELATIONS,
        schema.SHEET_CALCULATIONS,
    ],
)
async def test_any_card_affecting_sheet_triggers_the_final_pass(db, env, finalized, sheet):
    await applier.apply_selected(db, bundle({}), env.user, sheets={sheet}, dry_run=True)
    assert finalized == [db]


async def test_a_dry_run_leaves_nothing_behind(db, env, finalized, invalidated):
    rows = {schema.SHEET_TAG_GROUPS: [{"name": "Preview"}]}
    result = await applier.apply_selected(
        db, bundle(rows), env.user, sheets={schema.SHEET_TAG_GROUPS}, dry_run=True
    )
    assert result.sections[0].created == 1
    assert (await db.execute(select(TagGroup))).scalars().all() == []
    assert invalidated == []


async def test_a_failing_dry_run_still_rolls_back(db, env, finalized):
    rows = {
        schema.SHEET_TAG_GROUPS: [{"name": "Preview"}],
        schema.SHEET_CARD_TYPES: [{"key": "Broken", "fields_schema": "{not json"}],
    }
    with pytest.raises(ValueError):
        await applier.diff_bundle(db, bundle(rows), env.user)
    assert (await db.execute(select(TagGroup))).scalars().all() == []


async def test_apply_bundle_commits_and_refreshes_the_permission_caches(
    db, env, finalized, invalidated
):
    result = await applier.apply_bundle(
        db, bundle({schema.SHEET_TAG_GROUPS: [{"name": "Kept"}]}), env.user
    )
    assert result.dry_run is False
    assert [g.name for g in (await db.execute(select(TagGroup))).scalars()] == ["Kept"]
    assert len(invalidated) == 3


async def test_bookmark_shares_alone_still_load_the_user_directory(db, env, finalized):
    from app.models.bookmark import Bookmark, bookmark_shares

    friend = await create_user(db, email="friend@test.com")
    bm = Bookmark(user_id=env.user.id, name="View")
    db.add(bm)
    await db.flush()
    rows = {SHEET_BOOKMARK_SHARES: [{"bookmark_id": str(bm.id), "user_email": "friend@test.com"}]}
    result = await applier.apply_selected(
        db, bundle(rows), env.user, sheets={SHEET_BOOKMARK_SHARES}, dry_run=False
    )
    assert [s.sheet for s in result.sections] == [SHEET_BOOKMARK_SHARES]
    assert result.sections[0].created == 1
    assert [r.user_id for r in (await db.execute(select(bookmark_shares))).all()] == [friend.id]


async def test_diagram_cards_alone_load_the_card_resolver(db, env, finalized):
    from app.models.diagram import Diagram, diagram_cards

    app = await create_card(db, name="Billing")
    diagram = Diagram(name="D", data={})
    db.add(diagram)
    await db.flush()
    rows = {
        SHEET_DIAGRAM_CARDS: [
            {"diagram_id": str(diagram.id), "card_type": "Application", "card_ref": "Billing"}
        ]
    }
    await applier.apply_selected(
        db, bundle(rows), env.user, sheets={SHEET_DIAGRAM_CARDS}, dry_run=False
    )
    assert [r.card_id for r in (await db.execute(select(diagram_cards))).all()] == [app.id]


# ── the final pass ──────────────────────────────────────────────────────────


async def test_the_final_pass_rescores_every_live_card_once(db, env, monkeypatch):
    from app.services import calculation_engine, data_quality

    db.add_all(
        [
            Card(type="ITComponent", name=f"C{i}", status="ACTIVE", attributes={}, lifecycle={})
            for i in range(1001)
        ]
    )
    await db.flush()
    archived = await create_card(db, card_type="ITComponent", name="Gone", status="ARCHIVED")
    archived.data_quality = 5.0
    await db.flush()
    calculated: list[uuid.UUID] = []

    async def calc(db_, card, exclude_fields=None):
        calculated.append(card.id)

    async def score(db_, card):
        return 42.0

    monkeypatch.setattr(calculation_engine, "run_calculations_for_card", calc)
    monkeypatch.setattr(data_quality, "calc_data_quality", score)
    await applier._finalize_cards(db)
    live = (await db.execute(select(Card).where(Card.status == "ACTIVE"))).scalars().all()
    assert sorted(calculated) == sorted(c.id for c in live)
    assert len(calculated) == 1001
    assert {c.data_quality for c in live} == {42.0}
    assert archived.data_quality == 5.0


async def test_the_final_pass_keeps_the_ppm_managed_fields(db, env, monkeypatch):
    from app.services import calculation_engine
    from tests.conftest import create_budget_line

    await create_card_type(db, key="Initiative", label="Initiative")
    ini = await create_card(db, card_type="Initiative", name="Programme")
    await create_budget_line(db, initiative_id=ini.id, amount=10)
    seen = {}

    async def calc(db_, card, exclude_fields=None):
        seen[card.id] = exclude_fields

    monkeypatch.setattr(calculation_engine, "run_calculations_for_card", calc)
    await applier._finalize_cards(db)
    assert seen == {ini.id: {"costBudget"}}


# ── counters accumulate, and a refused row never ends the pass ──────────────


async def test_refused_card_rows_are_counted_and_the_next_rows_still_land(db, env, published):
    rows = [
        {"name": "Typeless"},
        {"type": "Application"},
        {"type": "Application", "name": "Orphan", "parent_path": "Ghost"},
        {"type": "Application", "name": "Lost", "parent_path": "Nowhere"},
        {"type": "Application", "name": "Bad", "attributes": '{"website": "ftp://x"}'},
        {"type": "Application", "name": "Worse", "attributes": '{"website": "gopher://x"}'},
        {"type": "Application", "name": "Fine"},
    ]
    sr = await run_cards(db, env.user, rows)
    assert counts(sr) == (1, 0, 0, 2, 4)
    assert (await card_named(db, "Fine")).name == "Fine"


async def test_an_archived_card_lands_archived(db, env, published):
    await run_cards(db, env.user, [{"type": "Application", "name": "Old", "status": "ARCHIVED"}])
    assert (await card_named(db, "Old")).status == "ARCHIVED"


async def test_a_clash_falls_back_to_the_type_defaults_and_an_unknown_type_drops_it(
    db, env, published
):
    bare_auto = (
        await db.execute(select(CardType).where(CardType.key == "ITComponent"))
    ).scalar_one()
    bare_auto.reference_config = {"mode": "auto"}
    taken = await create_card(db, name="Taken")
    taken.reference = "R-1"
    await db.flush()
    rows = [
        {"type": "ITComponent", "name": "Server", "reference": "R-1"},
        {"type": "Ghost", "name": "Untyped", "reference": "R-1"},
    ]
    sr = await run_cards(db, env.user, rows)
    assert counts(sr) == (2, 0, 0, 0, 0)
    assert (await card_named(db, "Server", "ITComponent")).reference == "10000"
    assert (await card_named(db, "Untyped", "Ghost")).reference is None


async def test_relations_resolve_cards_of_every_source_and_target_type(db, env):
    await create_relation_type(db, key="app_to_itc", label="runs on", reverse_label="hosts")
    billing = await create_card(db, name="Billing")
    server = await create_card(db, card_type="ITComponent", name="Server")
    rows = [
        {
            "type": "app_to_itc",
            "source_type": "Application",
            "source_ref": "Billing",
            "target_type": "ITComponent",
            "target_ref": "Server",
        }
    ]
    sr = applier.SectionResult(sheet=schema.SHEET_RELATIONS)
    await applier._apply_relations(db, bundle({schema.SHEET_RELATIONS: rows}), sr, False)
    (rel,) = (await db.execute(select(Relation))).scalars().all()
    assert (rel.source_id, rel.target_id) == (billing.id, server.id)
    assert counts(sr) == (1, 0, 0, 0, 0)


async def test_card_tags_already_linked_are_skipped_before_new_ones(db, env):
    group = TagGroup(name="Domain")
    db.add(group)
    await db.flush()
    finance = Tag(tag_group_id=group.id, name="Finance")
    db.add(finance)
    linked = await create_card(db, name="Linked")
    one = await create_card(db, name="One")
    two = await create_card(db, name="Two")
    await db.flush()
    db.add(CardTag(card_id=linked.id, tag_id=finance.id))
    await db.flush()
    ok = {"card_type": "Application", "group_name": "Domain", "tag_name": "Finance"}
    rows = [{**ok, "card_ref": "Linked"}, {**ok, "card_ref": "One"}, {**ok, "card_ref": "Two"}]
    sr = applier.SectionResult(sheet=schema.SHEET_CARD_TAGS)
    await applier._apply_card_tags(db, bundle({schema.SHEET_CARD_TAGS: rows}), sr, False)
    await db.flush()
    links = {(ct.card_id, ct.tag_id) for ct in (await db.execute(select(CardTag))).scalars()}
    assert links == {(c.id, finance.id) for c in (linked, one, two)}
    assert counts(sr) == (2, 0, 1, 0, 0)


async def test_a_preview_creates_cards_as_the_importer_and_announces_nothing(
    db, env, finalized, published
):
    result = await applier.diff_bundle(
        db, bundle({schema.SHEET_CARDS: [{"type": "Application", "name": "Preview"}]}), env.user
    )
    (cards_section,) = [s for s in result.sections if s.sheet == schema.SHEET_CARDS]
    assert counts(cards_section) == (1, 0, 0, 0, 0)
    assert published == []


async def test_a_selective_apply_creates_cards_as_the_importer(db, env, finalized, published):
    result = await applier.apply_selected(
        db,
        bundle({schema.SHEET_CARDS: [{"type": "Application", "name": "Real"}]}),
        env.user,
        sheets={schema.SHEET_CARDS},
        dry_run=False,
    )
    assert result.sections[0].created == 1
    assert (await card_named(db, "Real")).created_by == env.user.id
    assert [p["user_id"] for p in published] == [env.user.id]


async def test_group_members_alone_are_applied_on_a_selective_run(db, env, finalized):
    result = await applier.apply_selected(
        db, bundle({}), env.user, sheets={SHEET_DIAGRAM_GROUP_MEMBERS}, dry_run=True
    )
    assert [s.sheet for s in result.sections] == [SHEET_DIAGRAM_GROUP_MEMBERS]


async def test_an_ambiguous_match_does_not_stop_the_pass(db, env, published):
    await create_card(db, name="Twin")
    await create_card(db, name="Twin")
    rows = [{"type": "Application", "name": "Twin"}, {"type": "Application", "name": "After"}]
    sr = await run_cards(db, env.user, rows)
    assert counts(sr) == (1, 0, 1, 0, 0)
    assert sr.skip_reasons == {"ambiguous_match": 1}
