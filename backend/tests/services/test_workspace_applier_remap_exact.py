"""The applier's id-translation plumbing (#1246), pinned to exact values.

``test_workspace_io_id_remap.py`` proves a bundle's blobs come out pointing at
the right cards after a real import. These pin the helpers underneath it one
by one — which end a relation row resolves to, which archived card a row
matches, what the remap context holds for each kind of bundle — because the
nightly mutation run showed the round trips left those values uncompared.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import delete, select

from app.models.card import Card
from app.models.comment import Comment
from app.models.relation import Relation
from app.models.tag import Tag, TagGroup
from app.models.user import User
from app.services.card_resolver import CardResolver
from app.services.workspace_io import applier, apply_bundle, build_bundle, parse_bundle, schema
from app.services.workspace_io import remap as rm
from app.services.workspace_io.bundle import WorkspaceBundle
from app.services.workspace_io.sections import SHEET_DIAGRAM_CARDS
from tests.conftest import create_card, create_card_type, create_relation_type, create_user


def uid() -> str:
    return str(uuid.uuid4())


class FakeResolver:
    """A ``CardResolver`` stand-in that records what it was asked."""

    def __init__(self, table: dict[tuple[str, str], tuple[str, uuid.UUID | None]] | None = None):
        self.table = table or {}
        self.calls: list[tuple[str, str]] = []

    def resolve(self, ctype: str, ref: str) -> SimpleNamespace:
        self.calls.append((ctype, ref))
        status, card_id = self.table.get((ctype, ref), ("missing", None))
        return SimpleNamespace(status=status, card_id=card_id)


def sheet(name: str) -> SimpleNamespace:
    return SimpleNamespace(sheet=name)


# ── SectionResult.note_references ──────────────────────────────────────────


def test_references_fold_into_the_section_counters():
    sr = applier.SectionResult(sheet="Diagrams")
    sr.note_references(rm.RewriteTally(counts={"remapped": 2, "unresolved": 1}))
    sr.note_references(rm.RewriteTally(counts={"remapped": 3, "ambiguous": 1}))
    assert sr.references == {"remapped": 5, "unresolved": 1, "ambiguous": 1}
    assert (sr.updated, sr.errors, sr.reference_notes) == (0, [], 0)


def test_reference_notes_are_capped_across_rows_but_row_failures_are_not():
    sr = applier.SectionResult(sheet="Diagrams")
    sr.errors.append("row 1 failed")
    sr.note_references(rm.RewriteTally(messages=[f"a{i}" for i in range(15)]))
    assert sr.reference_notes == 15
    sr.note_references(rm.RewriteTally(messages=[f"b{i}" for i in range(10)]))
    # 20 notes in all: the second row only had room for five more
    assert sr.reference_notes == rm.MAX_MESSAGES == 20
    assert sr.errors == [
        "row 1 failed",
        *[f"a{i}" for i in range(15)],
        *[f"b{i}" for i in range(5)],
    ]
    sr.note_references(rm.RewriteTally(messages=["late"]))
    assert "late" not in sr.errors and sr.reference_notes == 20


def test_the_last_free_note_slot_is_still_used():
    sr = applier.SectionResult(sheet="Diagrams")
    sr.note_references(rm.RewriteTally(messages=[f"a{i}" for i in range(rm.MAX_MESSAGES - 1)]))
    sr.note_references(rm.RewriteTally(messages=["last", "over"]))
    assert sr.errors[-1] == "last" and "over" not in sr.errors
    assert sr.reference_notes == rm.MAX_MESSAGES


def test_a_healed_row_counts_as_an_update_and_is_named():
    sr = applier.SectionResult(sheet="Diagrams")
    sr.note_references(rm.RewriteTally(counts={"remapped": 1}), healed=True)
    sr.note_references(rm.RewriteTally(), healed=True)
    sr.note_references(rm.RewriteTally(counts={"remapped": 1}))
    assert sr.updated == 2
    assert sr.references == {"remapped": 2, "healed": 2}


# ── _card_end ────────────────────────────────────────────────────────────────


def test_a_card_end_prefers_the_mapped_source_id_over_the_reference():
    target = uuid.uuid4()
    other = uuid.uuid4()
    ids = rm.IdMap()
    source = uid()
    ids.record(rm.CARDS, source, target)
    resolver = FakeResolver({("Application", "CRM"): ("resolved", other)})
    found = applier._card_end(ids, resolver, "Application", "CRM", source.upper())
    assert found == target and isinstance(found, uuid.UUID)
    assert resolver.calls == []
    # no type and no reference: the id is still enough
    assert applier._card_end(ids, resolver, None, None, source) == target


def test_a_card_end_falls_back_to_the_reference():
    hit = uuid.uuid4()
    resolver = FakeResolver({("Application", "CRM"): ("resolved", hit)})
    found = applier._card_end(rm.IdMap(), resolver, "Application", "CRM", uid())
    assert found == hit
    assert resolver.calls == [("Application", "CRM")]


@pytest.mark.parametrize("ctype, cref", [("", "CRM"), ("Application", ""), (None, None)])
def test_a_card_end_without_a_type_or_a_reference_asks_nothing(ctype, cref):
    resolver = FakeResolver(
        {
            ("", "CRM"): ("resolved", uuid.uuid4()),
            ("Application", ""): ("resolved", uuid.uuid4()),
        }
    )
    assert applier._card_end(rm.IdMap(), resolver, ctype, cref, None) is None
    assert resolver.calls == []


@pytest.mark.parametrize("status", ["ambiguous", "missing"])
def test_a_card_end_takes_only_a_resolved_reference(status):
    resolver = FakeResolver({("Application", "CRM"): (status, uuid.uuid4())})
    assert applier._card_end(rm.IdMap(), resolver, "Application", "CRM", None) is None


# ── _relation_key ────────────────────────────────────────────────────────────

APP_TO_ITC = SimpleNamespace(source_type_key="Application", target_type_key="ITComponent")


def _ends() -> tuple[uuid.UUID, uuid.UUID, FakeResolver]:
    app, itc = uuid.uuid4(), uuid.uuid4()
    resolver = FakeResolver(
        {("Application", "CRM"): ("resolved", app), ("ITComponent", "Postgres"): ("resolved", itc)}
    )
    return app, itc, resolver


def _relation_row(**overrides) -> dict:
    row = {
        "type": "relAppToITC",
        "source_type": "Application",
        "source_ref": "CRM",
        "target_type": "ITComponent",
        "target_ref": "Postgres",
    }
    row.update(overrides)
    return row


def test_a_relation_row_resolves_both_ends_in_the_type_direction():
    app, itc, resolver = _ends()
    key = applier._relation_key(_relation_row(), rm.IdMap(), resolver, {"relAppToITC": APP_TO_ITC})
    assert key == ("relAppToITC", app, itc)
    assert resolver.calls == [("Application", "CRM"), ("ITComponent", "Postgres")]


def test_a_backwards_relation_row_is_turned_to_the_type_direction():
    app, itc, resolver = _ends()
    row = _relation_row(
        source_type="ITComponent",
        source_ref="Postgres",
        target_type="Application",
        target_ref="CRM",
    )
    key = applier._relation_key(row, rm.IdMap(), resolver, {"relAppToITC": APP_TO_ITC})
    assert key == ("relAppToITC", app, itc)
    # an unknown relation type is left exactly as sent
    assert applier._relation_key(row, rm.IdMap(), resolver, {}) == ("relAppToITC", itc, app)


def test_a_relation_end_named_by_its_source_id_wins_over_the_reference():
    app, itc, resolver = _ends()
    moved = uuid.uuid4()
    ids = rm.IdMap()
    old = uid()
    ids.record(rm.CARDS, old, moved)
    row = _relation_row(target_card_id=old)
    key = applier._relation_key(row, ids, resolver, {"relAppToITC": APP_TO_ITC})
    assert key == ("relAppToITC", app, moved)


@pytest.mark.parametrize(
    "column", ["type", "source_type", "source_ref", "target_type", "target_ref"]
)
def test_a_relation_row_missing_a_column_resolves_to_nothing(column):
    _, _, resolver = _ends()
    row = _relation_row(**{column: ""})
    assert applier._relation_key(row, rm.IdMap(), resolver, {"relAppToITC": APP_TO_ITC}) is None
    assert resolver.calls == []


@pytest.mark.parametrize("unresolved", ["source_ref", "target_ref"])
def test_a_relation_row_with_an_unresolved_end_resolves_to_nothing(unresolved):
    _, _, resolver = _ends()
    row = _relation_row(**{unresolved: "Nowhere"})
    assert applier._relation_key(row, rm.IdMap(), resolver, {"relAppToITC": APP_TO_ITC}) is None


# ── _card_row_ref ────────────────────────────────────────────────────────────


def test_a_card_row_ref_is_its_escaped_path_and_name():
    assert applier._card_row_ref({"parent_path": "Root / Mid", "name": "Leaf"}) == (
        "Root / Mid / Leaf"
    )
    assert applier._card_row_ref({"parent_path": "", "name": "A/B"}) == "A\\/B"
    assert applier._card_row_ref({"name": "Solo"}) == "Solo"
    assert applier._card_row_ref({}) == ""


# ── _archived_card_match ───────────────────────────────────────────────────


async def _archived(db, name: str, *, reference=None, external_id=None):
    card = await create_card(db, card_type="Application", name=name, status="ARCHIVED")
    card.reference = reference
    card.external_id = external_id
    await db.flush()
    return card


async def _archived_resolver(db) -> CardResolver:
    return await CardResolver.load(db, {"Application"}, status="ARCHIVED")


async def test_an_archived_row_matches_the_one_archived_card_on_its_path(db):
    await create_card_type(db, key="Application", label="Application")
    gone = await _archived(db, "Old CRM")
    await create_card(db, card_type="Application", name="Live CRM")
    resolver = await _archived_resolver(db)
    found = await applier._archived_card_match(db, resolver, "Application", "Old CRM", None, None)
    assert found == gone.id and isinstance(found, uuid.UUID)
    # an active card is never reached through the archived resolver
    assert (
        await applier._archived_card_match(db, resolver, "Application", "Live CRM", None, None)
        is None
    )
    assert (
        await applier._archived_card_match(db, resolver, "Application", "Nowhere", "R-1", "X")
        is None
    )


async def test_two_archived_cards_on_one_path_are_told_apart_by_reference(db):
    await create_card_type(db, key="Application", label="Application")
    first = await _archived(db, "Twin", reference="APP-1", external_id="ext-1")
    second = await _archived(db, "Twin", reference="APP-2", external_id="ext-2")
    resolver = await _archived_resolver(db)

    async def match(reference, external_id):
        return await applier._archived_card_match(
            db, resolver, "Application", "Twin", reference, external_id
        )

    assert await match("APP-1", None) == first.id
    assert await match("APP-2", None) == second.id
    assert await match(None, "ext-2") == second.id
    assert await match(None, "ext-1") == first.id
    # either key is enough: the reference misses, the external id hits
    assert await match("APP-9", "ext-2") == second.id
    assert await match("APP-9", "ext-9") is None
    # nothing to tell them apart with
    assert await match(None, None) is None
    assert await match("", "") is None


async def test_both_keys_naming_different_twins_take_the_older_card(db):
    await create_card_type(db, key="Application", label="Application")
    a = await _archived(db, "Twin", reference="APP-1")
    b = await _archived(db, "Twin", external_id="ext-2")
    resolver = await _archived_resolver(db)
    found = await applier._archived_card_match(
        db, resolver, "Application", "Twin", "APP-1", "ext-2"
    )
    # created in one transaction, so created_at ties and the id decides
    assert found == min(a.id, b.id, key=str)


async def test_a_reference_that_is_not_a_string_still_matches(db):
    await create_card_type(db, key="Application", label="Application")
    await _archived(db, "Twin", reference="7", external_id="8")
    other = await _archived(db, "Twin", reference="9", external_id="10")
    resolver = await _archived_resolver(db)
    assert (
        await applier._archived_card_match(db, resolver, "Application", "Twin", 9, None) == other.id
    )
    assert (
        await applier._archived_card_match(db, resolver, "Application", "Twin", None, 10)
        == other.id
    )


async def test_an_archived_card_on_another_path_is_not_matched_by_its_reference(db):
    await create_card_type(db, key="Application", label="Application")
    await _archived(db, "Twin", reference="APP-1", external_id="ext-1")
    resolver = await _archived_resolver(db)
    # the name is known but the path is not, so the keys are never consulted
    found = await applier._archived_card_match(
        db, resolver, "Application", "Elsewhere / Twin", "APP-1", "ext-1"
    )
    assert found is None


async def test_a_reference_held_by_a_card_off_the_path_is_not_a_match(db):
    await create_card_type(db, key="Application", label="Application")
    await _archived(db, "Twin", reference="APP-1")
    await _archived(db, "Twin", reference="APP-2")
    outsider = await create_card(db, card_type="Application", name="Elsewhere")
    outsider.reference = "APP-9"
    await db.flush()
    resolver = await _archived_resolver(db)
    found = await applier._archived_card_match(db, resolver, "Application", "Twin", "APP-9", None)
    assert found is None


async def test_the_older_twin_wins_over_the_smaller_id(db):
    await create_card_type(db, key="Application", label="Application")
    a = await _archived(db, "Twin", reference="APP-1")
    b = await _archived(db, "Twin", external_id="ext-2")
    older = max(a, b, key=lambda c: str(c.id))
    older.created_at = datetime.now(timezone.utc) - timedelta(days=365)
    await db.flush()
    resolver = await _archived_resolver(db)
    found = await applier._archived_card_match(
        db, resolver, "Application", "Twin", "APP-1", "ext-2"
    )
    assert found == older.id


# ── _load_remap_context ──────────────────────────────────────────────────────


def _bundle(**sheets) -> WorkspaceBundle:
    return WorkspaceBundle(manifest={}, sheets=sheets, assets={})


def _card_row(name: str, *, source_id=..., parent_path: str = "", ctype: str = "Application"):
    row = {"type": ctype, "parent_path": parent_path, "name": name}
    if source_id is not ...:
        row[schema.SOURCE_ID_COLUMN] = source_id
    return row


async def _load(db, bundle, sheets, ids=None) -> rm.RemapContext:
    resolver = await CardResolver.load(db, {"Application", "BusinessProcess"})
    return await applier._load_remap_context(
        db, bundle, ids if ids is not None else rm.IdMap(), resolver, [sheet(s) for s in sheets]
    )


async def _metamodel(db):
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="BusinessProcess", label="Business Process")
    await create_relation_type(
        db,
        key="relAppToApp",
        label="uses",
        source_type_key="Application",
        target_type_key="Application",
    )


async def test_cards_the_run_did_not_apply_are_mapped_by_their_reference(db):
    await _metamodel(db)
    crm = await create_card(db, card_type="Application", name="CRM")
    parent = await create_card(db, card_type="Application", name="Suite")
    child = await create_card(db, card_type="Application", name="Module", parent_id=parent.id)
    await create_card(db, card_type="Application", name="Twin")
    await create_card(db, card_type="Application", name="Twin")
    s_crm, s_child, s_twin, s_missing = uid(), uid(), uid(), uid()
    bundle = _bundle(
        Cards=[
            _card_row("CRM", source_id=s_crm),
            _card_row("Module", source_id=s_child, parent_path="Suite"),
            _card_row("Twin", source_id=s_twin),
            _card_row("Missing", source_id=s_missing),
            _card_row("CRM", source_id="not-an-id"),
        ]
    )
    ctx = await _load(db, bundle, ["Todos"])
    assert ctx.ids.cards == {s_crm: str(crm.id), s_child: str(child.id)}
    assert ctx.legacy is False
    # no diagrams wanted: nothing about relations is loaded
    assert (ctx.relations_by_ends, ctx.live_card_ids, ctx.cards_by_type_name) == ({}, set(), {})
    assert ctx.diagram_card_hints == {}


async def test_a_card_the_run_already_mapped_keeps_its_mapping(db):
    await _metamodel(db)
    await create_card(db, card_type="Application", name="CRM")
    ids = rm.IdMap()
    source, earlier = uid(), uid()
    ids.record(rm.CARDS, source, earlier)
    ctx = await _load(db, _bundle(Cards=[_card_row("CRM", source_id=source)]), ["Todos"], ids)
    assert ctx.ids is ids and ctx.ids.cards == {source: earlier}


async def test_tags_are_mapped_by_group_and_name(db):
    await _metamodel(db)
    env = TagGroup(name="Env")
    tier = TagGroup(name="Tier")
    db.add_all([env, tier])
    await db.flush()
    env_prod = Tag(tag_group_id=env.id, name="Prod")
    tier_prod = Tag(tag_group_id=tier.id, name="Prod")
    db.add_all([env_prod, tier_prod])
    await db.flush()
    t_env, t_tier, t_missing = uid(), uid(), uid()
    bundle = _bundle(
        Cards=[],
        Tags=[
            # a row with no usable id comes first: one usable id is enough
            {"source_id": "not-an-id", "group_name": "Env", "name": "Prod"},
            {"source_id": t_env, "group_name": "Env", "name": "Prod"},
            {"source_id": t_tier, "group_name": "Tier", "name": "Prod"},
            {"source_id": t_missing, "group_name": "Env", "name": "Dev"},
        ],
    )
    ctx = await _load(db, bundle, ["Bookmarks"])
    assert ctx.ids.tags == {t_env: str(env_prod.id), t_tier: str(tier_prod.id)}


async def test_tags_without_any_source_id_are_left_unmapped(db):
    await _metamodel(db)
    env = TagGroup(name="Env")
    db.add(env)
    await db.flush()
    db.add(Tag(tag_group_id=env.id, name="Prod"))
    await db.flush()
    bundle = _bundle(Tags=[{"source_id": None, "group_name": "Env", "name": "Prod"}])
    assert (await _load(db, bundle, ["Bookmarks"])).ids.tags == {}


async def test_a_legacy_bundle_harvests_called_processes_from_its_steps(db):
    await _metamodel(db)
    order = await create_card(db, card_type="BusinessProcess", name="Order")
    old = uid()
    steps = [
        {
            "called_element": old,
            "business_process_id__ref": "Order",
            "business_process_id__type": "BusinessProcess",
        }
    ]
    legacy_cards = [_card_row("Ghost")]  # no source_id column at all
    ctx = await _load(db, _bundle(Cards=legacy_cards, ProcessElements=steps), ["ProcessElements"])
    assert ctx.legacy is True
    assert ctx.ids.cards == {old: str(order.id)}
    # not when the run applies no process elements
    ctx = await _load(db, _bundle(Cards=legacy_cards, ProcessElements=steps), ["Todos"])
    assert ctx.legacy is True and ctx.ids.cards == {}
    # nor for a bundle that carries its own ids
    current = [_card_row("Ghost", source_id=None)]
    ctx = await _load(db, _bundle(Cards=current, ProcessElements=steps), ["ProcessElements"])
    assert ctx.legacy is False and ctx.ids.cards == {}


async def test_a_bundle_with_no_card_rows_is_not_legacy(db):
    await _metamodel(db)
    assert (await _load(db, _bundle(), ["Diagrams"])).legacy is False


async def test_diagrams_load_every_relation_by_its_ends(db):
    await _metamodel(db)
    a = await create_card(db, card_type="Application", name="A")
    b = await create_card(db, card_type="Application", name="B")
    c = await create_card(db, card_type="Application", name="C")
    rel = Relation(type="relAppToApp", source_id=a.id, target_id=b.id)
    db.add(rel)
    await db.flush()
    r_ab, r_ac, r_bad = uid(), uid(), uid()

    def rel_row(source_id, source_ref, target_ref):
        return {
            "source_id": source_id,
            "type": "relAppToApp",
            "source_type": "Application",
            "source_ref": source_ref,
            "target_type": "Application",
            "target_ref": target_ref,
        }

    bundle = _bundle(
        Cards=[_card_row("A", source_id=uid())],
        Relations=[rel_row(r_ab, "A", "B"), rel_row(r_ac, "A", "C"), rel_row(r_bad, "A", "Z")],
    )
    ctx = await _load(db, bundle, ["Diagrams"])
    assert ctx.relations_by_ends == {("relAppToApp", str(a.id), str(b.id)): str(rel.id)}
    assert ctx.ids.relations == {r_ab: str(rel.id)}
    assert str(c.id) not in ctx.ids.relations.values()
    # a bundle that carries its ids needs no name fallback
    assert (ctx.live_card_ids, ctx.cards_by_type_name, ctx.diagram_card_hints) == (set(), {}, {})
    # without diagrams, relations are neither loaded nor mapped
    ctx = await _load(db, bundle, ["Todos"])
    assert ctx.relations_by_ends == {} and ctx.ids.relations == {}


async def test_a_legacy_bundle_with_diagrams_builds_the_name_fallback(db):
    await _metamodel(db)
    alpha = await create_card(db, card_type="Application", name="Alpha")
    alpha_too = await create_card(db, card_type="Application", name=" ALPHA ")
    gamma = await create_card(db, card_type="Application", name="Gamma")
    gone = await create_card(db, card_type="Application", name="Gone", status="ARCHIVED")
    proc = await create_card(db, card_type="BusinessProcess", name="Alpha")
    diagram = str(uuid.uuid4()).upper()
    mapped = uid()
    ids = rm.IdMap()
    ids.record(rm.CARDS, mapped, gone.id)
    bundle = _bundle(
        Cards=[_card_row("Gamma")],
        **{
            SHEET_DIAGRAM_CARDS: [
                {"diagram_id": diagram, "card_type": "Application", "card_ref": "Gamma"},
                # an archived card is reachable through the id it carries
                {"diagram_id": diagram, "card_type": "", "card_ref": "", "card_id": mapped},
                {"diagram_id": diagram, "card_type": "Application", "card_ref": "Nowhere"},
                {"diagram_id": "", "card_type": "Application", "card_ref": "Alpha"},
            ]
        },
    )
    ctx = await _load(db, bundle, ["Diagrams"], ids)
    assert ctx.legacy is True
    assert ctx.live_card_ids == {str(c.id) for c in (alpha, alpha_too, gamma, gone, proc)}
    assert {k: sorted(v) for k, v in ctx.cards_by_type_name.items()} == {
        ("Application", "alpha"): sorted([str(alpha.id), str(alpha_too.id)]),
        ("Application", "gamma"): [str(gamma.id)],
        ("BusinessProcess", "alpha"): [str(proc.id)],
    }
    assert ctx.diagram_card_hints == {diagram.lower(): {str(gamma.id), str(gone.id)}}


# ── the passes that record where an id went ────────────────────────────────


async def test_two_relation_rows_for_one_relation_both_map_to_it(db):
    await _metamodel(db)
    await create_card(db, card_type="Application", name="A")
    await create_card(db, card_type="Application", name="B")
    first, second = uid(), uid()
    row = {
        "type": "relAppToApp",
        "source_type": "Application",
        "source_ref": "A",
        "target_type": "Application",
        "target_ref": "B",
    }
    bundle = _bundle(Relations=[{**row, "source_id": first}, {**row, "source_id": second}])
    ids = rm.IdMap()
    sr = applier.SectionResult(sheet="Relations")
    await applier._apply_relations(db, bundle, sr, False, id_map=ids)
    created = (await db.execute(select(Relation))).scalar_one()
    assert (sr.created, sr.skipped) == (1, 1)
    assert ids.relations == {first: str(created.id), second: str(created.id)}


async def test_a_user_with_a_role_this_instance_lacks_lands_as_a_member(db):
    sr = applier.SectionResult(sheet="Users")
    bundle = _bundle(Users=[{"email": "ghost@example.com", "role": "superuser"}])
    await applier._apply_users(db, bundle, sr, False)
    ghost = (await db.execute(select(User).where(User.email == "ghost@example.com"))).scalar_one()
    assert (ghost.role, ghost.is_active, sr.created) == ("member", False, 1)


def _cards_bundle(*rows) -> WorkspaceBundle:
    return _bundle(Cards=[{"parent_path": "", "type": "Application", **r} for r in rows])


async def _apply_cards(db, bundle, ids=None) -> applier.SectionResult:
    user = await create_user(db, email=f"{uid()}@example.com")
    sr = applier.SectionResult(sheet="Cards")
    await applier._make_cards_applier(user, ids)(db, bundle, sr, False)
    return sr


async def test_archived_twins_in_the_cards_pass_are_told_apart_and_mapped(db):
    await create_card_type(db, key="Application", label="Application")
    first = await _archived(db, "Twin", reference="APP-1", external_id="ext-1")
    second = await _archived(db, "Twin", reference="APP-2", external_id="ext-2")
    by_reference, by_external = uid(), uid()
    ids = rm.IdMap()
    sr = await _apply_cards(
        db,
        _cards_bundle(
            {"source_id": by_reference, "name": "Twin", "status": "ARCHIVED", "reference": "APP-2"},
            # an archived card is never an external-id hit, so this reaches the
            # archived matcher, which tells the twins apart by it
            {
                "source_id": by_external,
                "name": "Twin",
                "status": "ARCHIVED",
                "external_id": "ext-1",
            },
        ),
        ids,
    )
    assert (sr.created, sr.skipped, sr.failed, sr.errors) == (0, 2, 0, [])
    assert sr.skip_reasons == {"already_present": 2}
    assert ids.cards == {by_reference: str(second.id), by_external: str(first.id)}


async def test_an_active_row_never_lands_on_an_archived_card(db):
    await create_card_type(db, key="Application", label="Application")
    gone = await _archived(db, "Old CRM")
    await _archived(db, "Retired")
    sr = await _apply_cards(
        db,
        _cards_bundle(
            # one archived row, so the archived resolver is loaded at all
            {"name": "Retired", "status": "ARCHIVED"},
            {"name": "Old CRM", "status": "ACTIVE"},
        ),
    )
    assert (sr.created, sr.skipped) == (1, 1)
    live = (
        await db.execute(select(Card).where(Card.name == "Old CRM", Card.status == "ACTIVE"))
    ).scalar_one()
    assert live.id != gone.id


async def test_a_row_without_a_type_or_a_name_fails_quietly(db):
    await create_card_type(db, key="Application", label="Application")
    sr = await _apply_cards(db, _cards_bundle({"name": ""}, {"type": "", "name": "Nameless"}))
    assert (sr.created, sr.failed, sr.errors) == (0, 2, [])


async def test_a_bundle_without_ids_still_finds_an_entity_rows_card_by_reference(db):
    # A legacy bundle names an entity row's card only by type and reference,
    # so the entity sections need the card resolver, not just the id map.
    user = await create_user(db, email="legacy-comment@example.com", role="admin")
    await _metamodel(db)
    crm = await create_card(db, card_type="Application", name="CRM", user_id=user.id)
    db.add(Comment(card_id=crm.id, user_id=user.id, content="still here"))
    await db.flush()
    bundle = parse_bundle(await build_bundle(db))
    for rows in bundle.sheets.values():
        for row in rows:
            for col in [c for c in row if c.endswith("__id") or c == schema.SOURCE_ID_COLUMN]:
                row.pop(col)
    await db.execute(delete(Comment))
    await db.execute(delete(Card))
    await db.flush()
    result = await apply_bundle(db, bundle, user)
    assert result.total_failed == 0, result.as_dict()
    new_crm = (await db.execute(select(Card).where(Card.name == "CRM"))).scalar_one()
    comment = (await db.execute(select(Comment))).scalar_one()
    assert (comment.card_id, comment.content) == (new_crm.id, "still here")


# ── remap.py: the values its own round trips left uncompared ───────────────


def test_an_unknown_id_kind_is_named_in_the_error():
    with pytest.raises(ValueError, match="^Unknown id kind 'nope'$"):
        rm.IdMap().table("nope")


def test_a_merged_tally_carries_the_other_tallys_messages():
    a = rm.RewriteTally()
    a.note("first")
    b = rm.RewriteTally()
    b.note("second")
    b.note("third")
    a.merge(b)
    assert a.messages == ["first", "second", "third"]


def test_a_relation_id_is_counted_among_relations_only():
    old, new = uid(), uid()
    xml = f'<object relationId="{old}"/><object cardId="{old}"/>'
    assert rm.count_mapped_drawio_ids(xml, {}, {old: new}) == 1
    assert rm.count_mapped_drawio_ids(xml, {old: new}, {}) == 1
    assert rm.count_mapped_drawio_ids(xml, {old: new}, {old: new}) == 2


def test_only_a_string_value_is_an_id_to_replace():
    old, new = uid(), uid()
    tally = rm.RewriteTally()
    as_object = uuid.UUID(old)
    assert rm.replace_mapped_ids([as_object, old], ({old: new},), tally) == [as_object, new]
    assert tally.counts == {rm.REMAPPED: 1}


@pytest.mark.parametrize(
    "rewrite, column, key",
    [
        (rm.rewrite_bookmark_row, "filters", "tagIds"),
        (rm.rewrite_portal_row, "filters", "tag_ids"),
        (rm.rewrite_survey_row, "target_filters", "card_ids"),
        (rm.rewrite_survey_row, "target_filters", "related_ids"),
        (rm.rewrite_survey_row, "target_filters", "tag_ids"),
    ],
)
def test_an_unmapped_id_under_a_named_filter_key_is_counted(rewrite, column, key):
    # the walk over unnamed keys cannot tell an id from any other UUID, so
    # only the keys a rewriter names report what they could not translate
    stranger = uid()
    kwargs = {column: {key: [stranger], "unnamed": [uid()]}}
    tally = rewrite(kwargs, rm.RemapContext())
    assert tally.counts == {rm.UNRESOLVED: 1}
    assert kwargs[column][key] == [stranger]


@pytest.mark.parametrize("value", [5, ["x"], {"xml": "<a/>"}])
def test_bpmn_and_link_rewrites_pass_anything_but_text_through(value):
    tally = rm.RewriteTally()
    assert rm.rewrite_bpmn_xml(value, rm.IdMap(), tally) is value
    assert rm.rewrite_link(value, rm.IdMap(), tally) is value
    assert tally.counts == {}


def test_a_diagram_whose_xml_is_not_text_is_left_alone():
    data = {"xml": ["<mxGraphModel/>"]}
    tally = rm.rewrite_diagram_data(data, None, rm.RemapContext())
    assert (tally.counts, data) == ({}, {"xml": ["<mxGraphModel/>"]})


def test_a_draft_step_with_no_link_does_not_stop_the_others():
    old, new = uid(), uid()
    ids = rm.IdMap()
    ids.record(rm.CARDS, old, new)
    links = {"Task_1": None, "Task_2": {"application_id": old}}
    out = rm.rewrite_draft_element_links(links, ids, rm.RewriteTally())
    assert out == {"Task_1": None, "Task_2": {"application_id": new}}


def test_only_the_first_card_segment_of_a_link_counts_when_unmapped():
    unmapped, old, new = uid(), uid(), uid()
    ids = rm.IdMap()
    ids.record(rm.CARDS, old, new)
    tally = rm.RewriteTally()
    link = f"/cards/{unmapped}?from=/cards/{old}"
    assert rm.rewrite_link(link, ids, tally) == f"/cards/{unmapped}?from=/cards/{new}"
    assert tally.counts == {rm.UNRESOLVED: 1, rm.REMAPPED: 1}


def test_a_card_segment_after_the_start_of_a_link_is_still_a_card():
    unmapped = uid()
    tally = rm.RewriteTally()
    link = f"/ppm/{uid()}?back=/cards/{unmapped}"
    rm.rewrite_link(link, rm.IdMap(), tally)
    # both the PPM initiative and the card are card-shaped segments
    assert tally.counts == {rm.UNRESOLVED: 2}


def test_a_cell_is_named_by_its_stamped_card_name_over_its_label():
    card = uid()
    xml = (
        f'<mxGraphModel><root><object id="v1" label="Shown" cardId="{card}" '
        f'cardType="Application" cardName="Real"><mxCell vertex="1"/></object>'
        "</root></mxGraphModel>"
    )
    scan = rm.scan_drawio_cells(xml)
    assert scan is not None
    assert [c.name for c in scan.cards] == ["Real"]
