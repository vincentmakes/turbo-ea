"""The platform-migration apply passes, pinned to exact values.

``test_migration_stage_and_apply.py`` drives a whole snapshot through staging
and apply; these pin each pass on its own — the counters it returns, the
status and message it leaves on every staged row, the rows it writes, the
identity map it keeps — because the nightly mutation run showed those were
the values no test compared.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.models.card_type import CardType
from app.models.comment import Comment
from app.models.document import Document
from app.models.migration import IdentityMap, StagedRecord
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.stakeholder import Stakeholder
from app.models.tag import CardTag, Tag, TagGroup
from app.models.user import User
from app.services.migration import apply as ap
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)
from tests.migration_helpers import make_migration

LOGGER = "app.services.migration.apply"


def zero(**over) -> dict[str, int]:
    return {"created": 0, "updated": 0, "skipped": 0, "errors": 0, "conflicts": 0, **over}


@pytest.fixture
async def env(db):
    await create_role(db, key="member", label="Member")
    await create_card_type(db, key="Application", label="Application", has_hierarchy=True)
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_relation_type(db, key="app_to_itc", label="runs on", reverse_label="hosts")
    admin = await create_user(db, email="admin@test.com")
    migration = await make_migration(db, user=admin)
    return SimpleNamespace(admin=admin, m=migration)


async def stage(db, env, kind, source_id, *, action="create", data=None, **kw):
    row = StagedRecord(
        migration_id=env.m.id,
        source_type="inmem",
        entity_kind=kind,
        source_id=source_id,
        source_data=data if data is not None else {},
        action=action,
        **kw,
    )
    db.add(row)
    await db.flush()
    return row


async def identity(db, source_id, target_id, kind="card", source_type="inmem"):
    row = IdentityMap(
        source_id=source_id, source_type=source_type, entity_kind=kind, target_id=target_id
    )
    db.add(row)
    await db.flush()
    return row


async def identities(db, kind):
    rows = (await db.execute(select(IdentityMap).where(IdentityMap.entity_kind == kind))).scalars()
    return {(r.source_id, r.source_type): r for r in rows}


@pytest.fixture
def published(monkeypatch):
    calls = []

    async def fake(event_type, data, db=None, card_id=None, user_id=None, batch_id=None):
        calls.append(
            {"type": event_type, "data": data, "db": db, "card_id": card_id, "user_id": user_id}
        )

    monkeypatch.setattr(ap.event_bus, "publish", fake)
    return calls


# ── the entry point ─────────────────────────────────────────────────────────


PASSES = [
    ("metamodel_type", "_apply_metamodel_type_pass"),
    ("metamodel_field", "_apply_metamodel_field_pass"),
    ("metamodel_relation_type", "_apply_metamodel_relation_type_pass"),
    ("user", "_apply_user_pass"),
    ("card", "_apply_card_pass"),
    ("tag_group", "_apply_tag_group_pass"),
    ("tag", "_apply_tag_pass"),
    ("card_tag", "_apply_card_tag_pass"),
    ("relation", "_apply_relation_pass"),
    ("subscription", "_apply_subscription_pass"),
    ("document", "_apply_document_pass"),
    ("comment", "_apply_comment_pass"),
]


async def test_the_passes_run_in_dependency_order_and_their_counts_add_up(db, env, monkeypatch):
    calls = []
    for i, (_name, attr) in enumerate(PASSES, start=1):

        async def fake(db_, migration, user, i=i):
            calls.append((i, db_, migration, user))
            out = {"created": i, "skipped": 1}
            if i == 3:
                out["novel"] = 7
            return out

        monkeypatch.setattr(ap, attr, fake)
    result = await ap.apply_migration(db, env.m, env.admin)
    assert [c[0] for c in calls] == list(range(1, 13))
    assert all(c[1:] == (db, env.m, env.admin) for c in calls)
    per_pass = result.pop("per_pass")
    assert list(per_pass) == [name for name, _ in PASSES]
    assert per_pass["metamodel_relation_type"] == {"created": 3, "skipped": 1, "novel": 7}
    assert result == {
        "created": 78,
        "updated": 0,
        "skipped": 12,
        "errors": 0,
        "conflicts": 0,
        "novel": 7,
    }


# ── lifecycle dates and attribute remapping ─────────────────────────────────


class _Raises:
    def isoformat(self):
        raise RuntimeError("no")


@pytest.mark.parametrize(
    "value,expected",
    [
        (None, None),
        ("", None),
        ("   ", None),
        ("2027-06-30", "2027-06-30"),
        ("  2027-06-30T00:00:00+00:00 ", "2027-06-30"),
        ("TBD", None),
        ("2027/06/30", None),
        ("2027-06", None),
        ("2027-0630xx", None),
        ("20270-6-30", None),
        (date(2027, 6, 30), "2027-06-30"),
        (datetime(2027, 6, 30, 12, 0, tzinfo=timezone.utc), "2027-06-30"),
        (_Raises(), None),
        (SimpleNamespace(isoformat="2027-06-30"), None),
        (20270630, None),
    ],
)
def test_a_lifecycle_date_is_the_iso_date_or_nothing(value, expected):
    assert ap._coerce_lifecycle_date(value) == expected


def test_remapping_routes_skips_and_folds_into_the_lifecycle():
    lifecycle = {"plan": "2020-01-01"}
    attrs, out_lifecycle = ap._remap_attributes(
        {
            "native_a": 1,
            "native_b": 2,
            "drop": 3,
            "eol": "2030-12-31T00:00:00",
            "bad_date": "soon",
            "no_phase": "2031-01-01",
            "kept": 4,
            "blank": 5,
        },
        {
            "native_a": "teaA",
            "native_b": "teaA",
            "drop": "__skip__",
            "eol": "__lifecycle__:endOfLife",
            "bad_date": "__lifecycle__:active",
            "no_phase": "__lifecycle__:",
            "blank": "",
        },
        lifecycle=lifecycle,
    )
    assert attrs == {"teaA": 2, "kept": 4, "blank": 5}
    assert out_lifecycle == {"plan": "2020-01-01", "endOfLife": "2030-12-31"}
    assert lifecycle == {"plan": "2020-01-01"}


def test_remapping_without_a_lifecycle_starts_an_empty_one():
    assert ap._remap_attributes({"a": 1}, {}) == ({"a": 1}, {})


# ── ordering and identity helpers ───────────────────────────────────────────


def row(source_id, parent=None):
    return SimpleNamespace(source_id=source_id, parent_source_id=parent)


def test_a_reversed_chain_takes_one_round_per_level():
    rows = [row("leaf", "mid"), row("mid", "top"), row("top")]
    assert [r.source_id for r in ap._topo_sort(rows)] == ["top", "mid", "leaf"]


def test_a_cycle_is_appended_after_everything_that_could_be_placed(caplog):
    rows = [row("x", "y"), row("e", "d"), row("y", "x"), row("d"), row("f", "e")]
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        ordered = ap._topo_sort(rows)
    assert [r.source_id for r in ordered] == ["d", "e", "f", "x", "y"]
    messages = [r.getMessage() for r in caplog.records if r.name == LOGGER]
    assert messages == [
        "migration apply: cycle detected in card parent chain, appending 2 rows in arrival order"
    ]


def test_a_tree_needs_no_warning(caplog):
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        ap._topo_sort([row("a"), row("b", "a"), row("c", "outside")])
    assert [r for r in caplog.records if r.name == LOGGER] == []


async def test_an_identity_lookup_matches_id_kind_and_source(db, env):
    target = uuid.uuid4()
    await identity(db, "N1", target)
    await identity(db, "N2", uuid.uuid4(), kind="tag")
    await identity(db, "N3", uuid.uuid4(), source_type="other")
    assert await ap._identity_lookup(db, "N1", "card", "inmem") == target
    assert await ap._identity_lookup(db, "N2", "card", "inmem") is None
    assert await ap._identity_lookup(db, "N3", "card", "inmem") is None
    assert await ap._identity_lookup(db, None, "card", "inmem") is None
    assert await ap._identity_lookup(db, "", "card", "inmem") is None


async def test_a_card_identity_is_written_then_refreshed(db, env):
    first, second = uuid.uuid4(), uuid.uuid4()
    other_kind = await identity(db, "N1", uuid.uuid4(), kind="tag")
    staged = await stage(db, env, "card", "N1", target_id=first)
    await ap._upsert_identity_map(db, staged)
    await db.flush()
    (card_row,) = (await identities(db, "card")).values()
    assert (card_row.source_id, card_row.source_type, card_row.entity_kind) == (
        "N1",
        "inmem",
        "card",
    )
    assert (card_row.target_id, card_row.migration_id) == (first, env.m.id)
    assert card_row.last_seen_at is not None
    seen = card_row.last_seen_at
    later = await make_migration(db, user=env.admin)
    staged.target_id = second
    staged.migration_id = later.id
    await ap._upsert_identity_map(db, staged)
    assert (card_row.target_id, card_row.migration_id) == (second, later.id)
    assert card_row.last_seen_at >= seen
    assert other_kind.target_id != second


async def test_no_target_writes_no_identity(db, env):
    staged = await stage(db, env, "card", "N1")
    await ap._upsert_identity_map(db, staged)
    await ap._upsert_identity_map_kind(db, staged, "tag")
    await db.flush()
    assert (await db.execute(select(IdentityMap))).scalars().all() == []


async def test_an_identity_of_another_kind_is_written_and_refreshed(db, env):
    card_identity = await identity(db, "N1", uuid.uuid4())
    staged = await stage(db, env, "tag", "N1", target_id=uuid.uuid4())
    await ap._upsert_identity_map_kind(db, staged, "tag")
    await db.flush()
    tag_row = (await identities(db, "tag"))[("N1", "inmem")]
    assert (tag_row.target_id, tag_row.migration_id) == (staged.target_id, env.m.id)
    assert tag_row.last_seen_at is not None
    staged.target_id = uuid.uuid4()
    await ap._upsert_identity_map_kind(db, staged, "tag")
    assert tag_row.target_id == staged.target_id
    assert card_identity.target_id != staged.target_id


async def test_a_parent_resolves_from_this_migration_first_then_the_identity_map(db, env):
    staged_parent_target = uuid.uuid4()
    mapped = uuid.uuid4()
    await stage(db, env, "card", "P1", target_id=staged_parent_target)
    await stage(db, env, "card", "P2")  # staged, but not applied yet
    await identity(db, "P2", mapped)
    await identity(db, "P3", uuid.uuid4(), source_type="other")
    await identity(db, "P4", uuid.uuid4(), kind="tag")
    other = await make_migration(db, user=env.admin)
    db.add(
        StagedRecord(
            migration_id=other.id,
            source_type="inmem",
            entity_kind="card",
            source_id="P5",
            target_id=uuid.uuid4(),
        )
    )
    await db.flush()
    resolve = ap._resolve_parent_card_id
    assert await resolve(db, await stage(db, env, "card", "C0")) is None
    assert await resolve(db, await stage(db, env, "card", "C1", parent_source_id="P1")) == (
        staged_parent_target
    )
    assert await resolve(db, await stage(db, env, "card", "C2", parent_source_id="P2")) == mapped
    for parent in ("P3", "P4", "P5", "P6"):
        child = await stage(db, env, "card", f"C-{parent}", parent_source_id=parent)
        assert await resolve(db, child) is None


# ── the card pass ───────────────────────────────────────────────────────────


async def test_a_staged_card_is_created_with_every_payload_field(db, env, published):
    top = await create_card(db, name="Top")
    parent = await stage(db, env, "card", "P", action="skip", target_id=top.id)
    payload = {
        "type": "Application",
        "subtype": "saas",
        "name": "Billing",
        "description": "Bills",
        "lifecycle": {"active": "2024-01-01"},
        "attributes": {"k": 1},
        "status": "ACTIVE",
        "approval_status": "APPROVED",
        "external_id": "x-1",
        "alias": "BIL",
    }
    staged = await stage(db, env, "card", "N1", data={"payload": payload}, parent_source_id="P")
    assert await ap._apply_card_pass(db, env.m, env.admin) == zero(created=1, skipped=1)
    card = (await db.execute(select(Card).where(Card.name == "Billing"))).scalar_one()
    assert (card.type, card.subtype, card.description) == ("Application", "saas", "Bills")
    assert card.parent_id == parent.target_id
    assert (card.lifecycle, card.attributes) == ({"active": "2024-01-01"}, {"k": 1})
    assert (card.status, card.approval_status) == ("ACTIVE", "APPROVED")
    assert (card.external_id, card.alias) == ("x-1", "BIL")
    assert card.created_by == card.updated_by == env.admin.id
    assert (staged.target_id, staged.status) == (card.id, "applied")
    assert (await identities(db, "card"))[("N1", "inmem")].target_id == card.id
    assert published == [
        {
            "type": "card.created",
            "data": {
                "id": str(card.id),
                "type": "Application",
                "name": "Billing",
                "source": "migration",
                "source_type": "inmem",
            },
            "db": db,
            "card_id": card.id,
            "user_id": env.admin.id,
        }
    ]


async def test_a_bare_staged_card_takes_the_defaults(db, env, published):
    await stage(db, env, "card", "N1", data={"payload": {"type": "ITComponent", "name": "S"}})
    await ap._apply_card_pass(db, env.m, env.admin)
    card = (await db.execute(select(Card).where(Card.name == "S"))).scalar_one()
    assert (card.lifecycle, card.attributes) == ({}, {})
    assert (card.status, card.approval_status, card.parent_id) == ("ACTIVE", "DRAFT", None)


async def test_children_are_applied_after_their_parents(db, env, published):
    await stage(
        db,
        env,
        "card",
        "child",
        data={"payload": {"type": "Application", "name": "Child"}},
        parent_source_id="top",
    )
    await stage(db, env, "card", "top", data={"payload": {"type": "Application", "name": "Top"}})
    await ap._apply_card_pass(db, env.m, env.admin)
    top, child = [
        (await db.execute(select(Card).where(Card.name == n))).scalar_one()
        for n in ("Top", "Child")
    ]
    assert child.parent_id == top.id
    assert [p["data"]["name"] for p in published] == ["Top", "Child"]


async def test_skips_and_conflicts_are_terminal(db, env, published):
    kept = await create_card(db, name="Kept")
    skip = await stage(db, env, "card", "S1", action="skip", target_id=kept.id)
    bare_skip = await stage(db, env, "card", "S2", action="skip")
    conflict = await stage(db, env, "card", "C1", action="conflict")
    assert await ap._apply_card_pass(db, env.m, env.admin) == zero(skipped=2, conflicts=1)
    assert [s.status for s in (skip, bare_skip, conflict)] == ["applied"] * 3
    assert set(await identities(db, "card")) == {("S1", "inmem")}
    assert published == []


async def test_a_failed_identity_refresh_does_not_fail_a_skip(db, env, monkeypatch, caplog):
    async def broken(db_, staged):
        raise RuntimeError("down")

    monkeypatch.setattr(ap, "_upsert_identity_map", broken)
    await stage(db, env, "card", "S1", action="skip", target_id=uuid.uuid4())
    with caplog.at_level(logging.ERROR, logger=LOGGER):
        counts = await ap._apply_card_pass(db, env.m, env.admin)
    assert counts == zero(skipped=1)
    assert [r.getMessage() for r in caplog.records if r.name == LOGGER] == [
        "migration apply: identity_map refresh for skipped card S1 failed"
    ]


async def test_an_update_merges_and_records_exactly_what_moved(db, env, published):
    new_parent = await create_card(db, name="NewTop")
    card = await create_card(
        db,
        name="Old",
        description="d",
        subtype="saas",
        lifecycle={"plan": "2020-01-01"},
        attributes={"keep": 1, "k": 1},
    )
    card.external_id = "x-1"
    await stage(db, env, "card", "P", action="skip", target_id=new_parent.id)
    payload = {
        "name": "New",
        "description": None,
        "subtype": "",
        "lifecycle": {"active": "2024-01-01"},
        "attributes": {"k": 2},
        "external_id": "x-2",
    }
    staged = await stage(
        db,
        env,
        "card",
        "N1",
        action="update",
        target_id=card.id,
        data={"payload": payload},
        parent_source_id="P",
    )
    assert await ap._apply_card_pass(db, env.m, env.admin) == zero(updated=1, skipped=1)
    assert (card.name, card.description, card.subtype) == ("New", None, "saas")
    assert card.lifecycle == {"plan": "2020-01-01", "active": "2024-01-01"}
    assert card.attributes == {"keep": 1, "k": 2}
    assert (card.external_id, card.parent_id, card.updated_by) == (
        "x-2",
        new_parent.id,
        env.admin.id,
    )
    assert staged.status == "applied"
    assert published == [
        {
            "type": "card.updated",
            "data": {
                "id": str(card.id),
                "source": "migration",
                "source_type": "inmem",
                "changes": {
                    "name": {"old": "Old", "new": "New"},
                    "description": {"old": "d", "new": None},
                    "lifecycle": {
                        "old": {"plan": "2020-01-01"},
                        "new": {"plan": "2020-01-01", "active": "2024-01-01"},
                    },
                    "attributes": {
                        "old": {"keep": 1, "k": 1},
                        "new": {"keep": 1, "k": 2},
                    },
                    "external_id": {"old": "x-1", "new": "x-2"},
                    "parent_id": {"old": None, "new": str(new_parent.id)},
                },
            },
            "db": db,
            "card_id": card.id,
            "user_id": env.admin.id,
        }
    ]
    assert (await identities(db, "card"))[("N1", "inmem")].target_id == card.id


async def test_an_update_that_changes_nothing_leaves_the_card_alone(db, env, published):
    card = await create_card(db, name="Same", attributes={"k": 1})
    staged = await stage(
        db,
        env,
        "card",
        "N1",
        action="update",
        target_id=card.id,
        data={"payload": {"name": "Same", "attributes": {"k": 1}, "external_id": ""}},
    )
    assert await ap._apply_card_pass(db, env.m, env.admin) == zero(updated=1)
    assert card.updated_by is None
    assert published == []
    assert staged.status == "applied"


@pytest.mark.parametrize(
    "action,target,message",
    [
        ("update", None, "update staged row {id} has no target_id"),
        ("update", "ghost", "target card {target} no longer exists"),
        ("weird", None, "unknown action 'weird'"),
    ],
)
async def test_an_unplaceable_card_fails_its_row_only(db, env, published, action, target, message):
    ghost = uuid.uuid4()
    staged = await stage(
        db,
        env,
        "card",
        "N1",
        action=action,
        target_id=ghost if target else None,
        data={"payload": {"type": "Application", "name": "X"}},
    )
    await stage(db, env, "card", "N2", data={"payload": {"type": "Application", "name": "Fine"}})
    assert await ap._apply_card_pass(db, env.m, env.admin) == zero(created=1, errors=1)
    assert staged.status == "error"
    assert staged.error_message == message.format(id=staged.id, target=ghost)


async def test_the_field_mapping_of_the_native_type_rewrites_attributes(db, env, published):
    env.m.field_mappings = {
        "LXApp": {"native": "teaKey", "eolNative": "__lifecycle__:endOfLife"},
        "Other": {"untouched": "nope"},
    }
    await db.flush()
    rows = [
        ("A", "LXApp", {"native": 1, "eolNative": "2030-01-01", "free": 2}),
        ("B", "Unmapped", {"native": 1}),
        ("C", "Other", {"native": 1}),
    ]
    for source_id, native_type, attrs in rows:
        await stage(
            db,
            env,
            "card",
            source_id,
            data={
                "raw": {"type": native_type},
                "payload": {
                    "type": "Application",
                    "name": source_id,
                    "attributes": attrs,
                    "lifecycle": {"plan": "2020-01-01"},
                },
            },
        )
    await stage(
        db,
        env,
        "card",
        "D",
        data={"raw": {"type": "LXApp"}, "payload": {"type": "Application", "name": "D"}},
    )
    await ap._apply_card_pass(db, env.m, env.admin)
    cards = {c.name: c for c in (await db.execute(select(Card))).scalars()}
    assert cards["A"].attributes == {"teaKey": 1, "free": 2}
    assert cards["A"].lifecycle == {"plan": "2020-01-01", "endOfLife": "2030-01-01"}
    assert cards["B"].attributes == {"native": 1}
    assert cards["C"].attributes == {"native": 1}
    assert cards["D"].attributes == {}


# ── tags ────────────────────────────────────────────────────────────────────


async def test_tag_groups_are_created_unless_already_resolved(db, env):
    existing = TagGroup(name="Existing")
    db.add(existing)
    await db.flush()
    resolved = await stage(db, env, "tag_group", "G0", action="skip", target_id=existing.id)
    unresolved_skip = await stage(db, env, "tag_group", "G1", action="skip", data={"name": "Re"})
    new = await stage(db, env, "tag_group", "G2", data={"name": "Domain", "mode": "single"})
    await stage(db, env, "tag_group", "G3", data={"name": "Plain"})
    assert await ap._apply_tag_group_pass(db, env.m, env.admin) == zero(created=3, skipped=1)
    groups = {g.name: g for g in (await db.execute(select(TagGroup))).scalars()}
    assert (groups["Domain"].mode, groups["Domain"].description) == (
        "single",
        "Imported from inmem",
    )
    assert groups["Plain"].mode == "multi"
    assert (new.target_id, new.status) == (groups["Domain"].id, "applied")
    assert unresolved_skip.target_id == groups["Re"].id
    assert resolved.status == "applied"


async def test_tags_find_their_group_by_staged_id_fallback_name_or_database(db, env):
    staged_group = TagGroup(name="Staged")
    fallback = TagGroup(name="Imported from inmem")
    by_name = TagGroup(name="ByName")
    db.add_all([staged_group, fallback, by_name])
    await db.flush()
    await stage(db, env, "tag_group", "Staged", target_id=staged_group.id)
    await stage(db, env, "tag_group", "Pending")  # no target: not indexed
    rows = {
        "T1": {"name": "One", "group_name": "Staged", "color": "#111111"},
        "T2": {"name": "Two"},
        "T3": {"name": "Three", "group_name": "ByName"},
    }
    staged = {k: await stage(db, env, "tag", k, data=v) for k, v in rows.items()}
    assert await ap._apply_tag_pass(db, env.m, env.admin) == zero(created=3)
    tags = {t.name: t for t in (await db.execute(select(Tag))).scalars()}
    assert (tags["One"].tag_group_id, tags["One"].color) == (staged_group.id, "#111111")
    assert tags["Two"].tag_group_id == fallback.id
    assert tags["Three"].tag_group_id == by_name.id
    mapped = await identities(db, "tag")
    assert {k: mapped[(k, "inmem")].target_id for k in rows} == {
        k: s.target_id for k, s in staged.items()
    }


async def test_a_tag_without_a_group_fails_and_a_resolved_skip_is_mapped(db, env):
    group = TagGroup(name="G")
    db.add(group)
    await db.flush()
    tag = Tag(tag_group_id=group.id, name="Old")
    db.add(tag)
    await db.flush()
    skipped = await stage(db, env, "tag", "T0", action="skip", target_id=tag.id)
    lost = await stage(db, env, "tag", "T1", data={"name": "Lost", "group_name": "Nope"})
    assert await ap._apply_tag_pass(db, env.m, env.admin) == zero(skipped=1, errors=1)
    assert skipped.status == "applied"
    assert (await identities(db, "tag"))[("T0", "inmem")].target_id == tag.id
    assert (lost.status, lost.error_message) == ("error", "tag group 'Nope' not resolvable")


async def test_card_tags_link_resolved_ends_once(db, env):
    group = TagGroup(name="G")
    db.add(group)
    await db.flush()
    tag = Tag(tag_group_id=group.id, name="T")
    db.add(tag)
    card = await create_card(db, name="C")
    linked = await create_card(db, name="Linked")
    await db.flush()
    db.add(CardTag(card_id=linked.id, tag_id=tag.id))
    await identity(db, "card-1", card.id)
    await identity(db, "card-2", linked.id)
    await identity(db, "tag-1", tag.id, kind="tag")
    new = await stage(db, env, "card_tag", "L1", data={"entity_id": "card-1", "tag_id": "tag-1"})
    again = await stage(db, env, "card_tag", "L2", data={"entity_id": "card-2", "tag_id": "tag-1"})
    orphan = await stage(db, env, "card_tag", "L3", data={"entity_id": "ghost", "tag_id": "tag-1"})
    no_tag = await stage(db, env, "card_tag", "L4", data={"entity_id": "card-1"})
    assert await ap._apply_card_tag_pass(db, env.m, env.admin) == zero(created=1, skipped=3)
    links = {(ct.card_id, ct.tag_id) for ct in (await db.execute(select(CardTag))).scalars()}
    assert links == {(card.id, tag.id), (linked.id, tag.id)}
    assert [s.status for s in (new, again, orphan, no_tag)] == ["applied"] * 4
    assert (new.error_message, again.error_message) == (None, None)
    assert (
        orphan.error_message
        == no_tag.error_message
        == ("Endpoint not resolved (card or tag missing)")
    )


# ── relations ───────────────────────────────────────────────────────────────


@pytest.fixture
async def ends(db, env):
    app = await create_card(db, name="App")
    other = await create_card(db, name="Other")
    server = await create_card(db, card_type="ITComponent", name="Server")
    await identity(db, "app", app.id)
    await identity(db, "other", other.id)
    await identity(db, "server", server.id)
    return SimpleNamespace(app=app, other=other, server=server)


async def test_a_relation_is_created_in_its_type_direction(db, env, ends):
    rel = {"tea_type": "app_to_itc", "attributes": {"k": 1}}
    fwd = await stage(
        db, env, "relation", "R1", data={**rel, "from_entity_id": "app", "to_entity_id": "server"}
    )
    back = await stage(
        db,
        env,
        "relation",
        "R2",
        data={"tea_type": "app_to_itc", "from_entity_id": "server", "to_entity_id": "other"},
    )
    assert await ap._apply_relation_pass(db, env.m, env.admin) == zero(created=2)
    rels = {(r.source_id, r.target_id): r for r in (await db.execute(select(Relation))).scalars()}
    assert set(rels) == {(ends.app.id, ends.server.id), (ends.other.id, ends.server.id)}
    assert rels[(ends.app.id, ends.server.id)].attributes == {"k": 1}
    assert rels[(ends.other.id, ends.server.id)].attributes == {}
    assert fwd.target_id == rels[(ends.app.id, ends.server.id)].id
    assert back.target_id == rels[(ends.other.id, ends.server.id)].id
    assert (fwd.status, back.status) == ("applied", "applied")


async def test_a_relation_already_present_takes_the_new_attributes(db, env, ends):
    present = await create_relation(
        db, source_id=ends.app.id, target_id=ends.server.id, attributes={"a": 1, "k": 0}
    )
    staged = await stage(
        db,
        env,
        "relation",
        "R1",
        data={
            "tea_type": "app_to_itc",
            "from_entity_id": "server",
            "to_entity_id": "app",
            "attributes": {"k": 1},
        },
    )
    assert await ap._apply_relation_pass(db, env.m, env.admin) == zero(updated=1)
    assert present.attributes == {"a": 1, "k": 1}
    assert staged.target_id == present.id
    assert len((await db.execute(select(Relation))).scalars().all()) == 1


async def test_relation_updates_skips_conflicts_and_failures(db, env, ends):
    existing = await create_relation(
        db, source_id=ends.app.id, target_id=ends.server.id, attributes={"a": 1}
    )
    data = {"tea_type": "app_to_itc", "from_entity_id": "app", "to_entity_id": "server"}
    update = await stage(
        db,
        env,
        "relation",
        "U",
        action="update",
        target_id=existing.id,
        data={**data, "attributes": {"b": 2}},
    )
    skip = await stage(db, env, "relation", "S", action="skip", data=data)
    conflict = await stage(db, env, "relation", "C", action="conflict", data=data)
    orphan = await stage(db, env, "relation", "O", data={**data, "to_entity_id": "ghost"})
    no_target = await stage(db, env, "relation", "N", action="update", data=data)
    gone = await stage(db, env, "relation", "G", action="update", target_id=uuid.uuid4(), data=data)
    assert await ap._apply_relation_pass(db, env.m, env.admin) == zero(
        updated=1, skipped=2, conflicts=1, errors=2
    )
    assert existing.attributes == {"a": 1, "b": 2}
    assert [s.status for s in (update, skip, conflict, orphan)] == ["applied"] * 4
    assert orphan.error_message == "Endpoint card not resolved in identity map"
    assert (no_target.status, no_target.error_message) == (
        "error",
        "update relation has no cached target_id",
    )
    assert gone.error_message == "target relation no longer exists"


# ── metamodel passes ────────────────────────────────────────────────────────


async def test_a_custom_type_is_created_once_with_import_defaults(db, env):
    created = await stage(
        db,
        env,
        "metamodel_type",
        "Server",
        data={"proposed_tea_key": "Server", "subtypes": ["Physical", "Virtual"]},
    )
    named = await stage(db, env, "metamodel_type", "Rack", data={"native_name": "Rack"})
    existing = await stage(
        db, env, "metamodel_type", "App", data={"proposed_tea_key": "Application"}
    )
    other = await stage(db, env, "metamodel_type", "X", action="skip")
    broken = await stage(db, env, "metamodel_type", "Y", data={})
    assert await ap._apply_metamodel_type_pass(db, env.m, env.admin) == zero(
        created=2, skipped=2, errors=1
    )
    server = (await db.execute(select(CardType).where(CardType.key == "Server"))).scalar_one()
    assert (server.label, server.category, server.icon, server.color) == (
        "Server",
        "Imported",
        "extension",
        "#888888",
    )
    assert (server.built_in, server.has_hierarchy, server.has_successors) == (False, True, True)
    assert server.fields_schema == []
    assert server.subtypes == [
        {"key": "Physical", "label": "Physical"},
        {"key": "Virtual", "label": "Virtual"},
    ]
    rack = (await db.execute(select(CardType).where(CardType.key == "Rack"))).scalar_one()
    assert rack.subtypes == []
    app = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    assert (created.target_id, named.target_id, existing.target_id) == (server.id, rack.id, app.id)
    assert [s.status for s in (created, named, existing, other)] == ["applied"] * 4
    assert (broken.status, broken.error_message) == ("error", "missing proposed_tea_key")


async def test_custom_fields_land_in_an_imported_section(db, env):
    env.m.field_mappings = {"LXApp": {"mapped": "description", "dropped": "__skip__"}}
    await db.flush()
    await create_card_type(
        db,
        key="Widget",
        label="Widget",
        fields_schema=[{"section": "Main", "fields": [{"key": "taken", "type": "text"}]}],
    )
    fields = [
        ("LXApp:cost", {"field_key": "cost", "label": "Cost", "tea_type": "cost"}),
        (
            "LXApp:tier",
            {
                "field_key": "tier",
                "tea_type": "single_select",
                "options": [{"key": "a", "label": "A"}],
                "translations": {"de": "Stufe"},
            },
        ),
        ("LXApp:taken", {"field_key": "taken", "tea_type": "text"}),
        ("LXApp:mapped", {"field_key": "mapped", "tea_type": "text"}),
        ("LXApp:dropped", {"field_key": "dropped", "tea_type": "text"}),
    ]
    staged = [
        await stage(db, env, "metamodel_field", sid, data={**data, "target_type": "Widget"})
        for sid, data in fields
    ]
    skip = await stage(db, env, "metamodel_field", "LXApp:x", action="skip")
    missing = await stage(
        db,
        env,
        "metamodel_field",
        "LXApp:y",
        data={"field_key": "y", "tea_type": "text", "target_type": "Nope"},
    )
    assert await ap._apply_metamodel_field_pass(db, env.m, env.admin) == zero(
        created=2, skipped=4, errors=1
    )
    ct = (await db.execute(select(CardType).where(CardType.key == "Widget"))).scalar_one()
    await db.refresh(ct)
    assert ct.fields_schema == [
        {"section": "Main", "fields": [{"key": "taken", "type": "text"}]},
        {
            "section": "Imported from inmem",
            "columns": 1,
            "fields": [
                {"key": "cost", "label": "Cost", "type": "cost", "weight": 0},
                {
                    "key": "tier",
                    "label": "tier",
                    "type": "single_select",
                    "weight": 0,
                    "options": [{"key": "a", "label": "A"}],
                    "translations": {"de": "Stufe"},
                },
            ],
        },
    ]
    assert all(s.status == "applied" for s in [*staged, skip])
    assert (missing.status, missing.error_message) == ("error", "target card type 'Nope' not found")


async def test_a_second_import_reuses_the_imported_section(db, env):
    await create_card_type(
        db,
        key="Widget",
        label="Widget",
        fields_schema=[
            "not a section",
            {"section": "Imported from inmem", "fields": [{"key": "old"}, "junk"]},
        ],
    )
    await stage(
        db,
        env,
        "metamodel_field",
        "LX:new",
        data={"field_key": "new", "tea_type": "text", "target_type": "Widget"},
    )
    await stage(
        db,
        env,
        "metamodel_field",
        "LX:old",
        data={"field_key": "old", "tea_type": "text", "target_type": "Widget"},
    )
    assert await ap._apply_metamodel_field_pass(db, env.m, env.admin) == zero(created=1, skipped=1)
    ct = (await db.execute(select(CardType).where(CardType.key == "Widget"))).scalar_one()
    await db.refresh(ct)
    assert ct.fields_schema[1]["fields"] == [
        {"key": "old"},
        "junk",
        {"key": "new", "label": "new", "type": "text", "weight": 0},
    ]


async def test_a_custom_relation_type_needs_both_ends(db, env):
    created = await stage(
        db,
        env,
        "metamodel_relation_type",
        "R1",
        data={
            "native_name": "relServerToApp",
            "from_type": "ITComponent",
            "to_type": "Application",
            "label": "serves",
            "attributes_schema": [{"key": "k"}],
        },
    )
    plain = await stage(
        db,
        env,
        "metamodel_relation_type",
        "R2",
        data={"native_name": "relPlain", "from_type": "Application", "to_type": "ITComponent"},
    )
    existing = await stage(
        db,
        env,
        "metamodel_relation_type",
        "R3",
        data={"native_name": "app_to_itc", "from_type": "Application", "to_type": "ITComponent"},
    )
    open_end = await stage(
        db,
        env,
        "metamodel_relation_type",
        "R4",
        data={"native_name": "relRef", "from_type": "Application", "to_type": None},
    )
    skip = await stage(db, env, "metamodel_relation_type", "R5", action="skip")
    assert await ap._apply_metamodel_relation_type_pass(db, env.m, env.admin) == zero(
        created=2, skipped=3
    )
    rts = {rt.key: rt for rt in (await db.execute(select(RelationType))).scalars()}
    serves = rts["relServerToApp"]
    assert (serves.label, serves.reverse_label, serves.cardinality) == (
        "serves",
        "serves",
        "n:m",
    )
    assert (serves.source_type_key, serves.target_type_key) == ("ITComponent", "Application")
    assert (serves.attributes_schema, serves.built_in) == ([{"key": "k"}], False)
    assert (rts["relPlain"].label, rts["relPlain"].reverse_label) == ("relPlain", "relPlain")
    assert rts["relPlain"].attributes_schema == []
    assert (created.target_id, plain.target_id, existing.target_id) == (
        serves.id,
        rts["relPlain"].id,
        rts["app_to_itc"].id,
    )
    assert open_end.error_message == "Relation endpoint missing — set 'to_type' in preview"
    assert [s.status for s in (created, plain, existing, open_end, skip)] == ["applied"] * 5


# ── users and stakeholders ──────────────────────────────────────────────────


async def test_users_land_deactivated_members_and_are_mapped(db, env):
    existing = await create_user(db, email="known@test.com")
    new = await stage(db, env, "user", "new@x.com", data={"email": "new@x.com"})
    named = await stage(
        db, env, "user", "s@x.com", data={"email": "s@x.com", "display_name": "Sam"}
    )
    known = await stage(db, env, "user", "known@test.com", action="skip", target_id=existing.id)
    bad = await stage(db, env, "user", "bad", action="conflict")
    broken = await stage(db, env, "user", "broken", data={})
    assert await ap._apply_user_pass(db, env.m, env.admin) == zero(
        created=2, skipped=1, conflicts=1, errors=1
    )
    users = {u.email: u for u in (await db.execute(select(User))).scalars()}
    created = users["new@x.com"]
    assert (created.display_name, created.role, created.is_active, created.auth_provider) == (
        "new@x.com",
        "member",
        False,
        "local",
    )
    assert users["s@x.com"].display_name == "Sam"
    mapped = await identities(db, "user")
    assert mapped[("new@x.com", "inmem")].target_id == new.target_id == created.id
    assert mapped[("s@x.com", "inmem")].target_id == named.target_id
    assert mapped[("known@test.com", "inmem")].target_id == existing.id
    assert [s.status for s in (new, named, known, bad)] == ["applied"] * 4
    assert (broken.status, broken.error_message) == ("error", "'email'")


async def test_subscriptions_become_stakeholders_once(db, env, ends):
    alice = await create_user(db, email="alice@test.com")
    await identity(db, "alice@test.com", alice.id, kind="user")
    db.add(Stakeholder(card_id=ends.other.id, user_id=alice.id, role="responsible"))
    await db.flush()
    owner = await stage(
        db,
        env,
        "subscription",
        "S1",
        data={"entity_id": "app", "user_email": "alice@test.com", "tea_role_key": "owner"},
    )
    default_role = await stage(
        db, env, "subscription", "S2", data={"entity_id": "app", "user_email": "alice@test.com"}
    )
    held = await stage(
        db, env, "subscription", "S3", data={"entity_id": "other", "user_email": "alice@test.com"}
    )
    orphan = await stage(
        db, env, "subscription", "S4", data={"entity_id": "app", "user_email": "ghost@test.com"}
    )
    conflict = await stage(db, env, "subscription", "S5", action="conflict")
    assert await ap._apply_subscription_pass(db, env.m, env.admin) == zero(
        created=2, skipped=2, conflicts=1
    )
    stakes = {(s.card_id, s.role): s for s in (await db.execute(select(Stakeholder))).scalars()}
    assert set(stakes) == {
        (ends.app.id, "owner"),
        (ends.app.id, "responsible"),
        (ends.other.id, "responsible"),
    }
    assert owner.target_id == stakes[(ends.app.id, "owner")].id
    assert default_role.target_id == stakes[(ends.app.id, "responsible")].id
    assert held.target_id == stakes[(ends.other.id, "responsible")].id
    assert orphan.error_message == "Endpoint (card or user) not resolved"
    assert [s.status for s in (owner, default_role, held, orphan, conflict)] == ["applied"] * 5


# ── documents and comments ──────────────────────────────────────────────────


async def test_documents_are_created_or_matched_by_identity_then_url(db, env, ends):
    by_id = Document(card_id=ends.app.id, name="Old title", url="https://a", type="link")
    by_url = Document(card_id=ends.app.id, name="Spec", url="https://spec", type="link")
    db.add_all([by_id, by_url])
    await db.flush()
    await identity(db, "D1", by_id.id, kind="document")
    await identity(db, "D-gone", uuid.uuid4(), kind="document")
    rename = await stage(db, env, "document", "D1", data={"entity_id": "app", "name": "New title"})
    same = await stage(
        db,
        env,
        "document",
        "D2",
        data={"entity_id": "app", "name": "Spec", "url": "https://spec"},
    )
    stale = await stage(
        db,
        env,
        "document",
        "D-gone",
        data={"entity_id": "app", "name": "Fresh", "url": "https://fresh"},
    )
    orphan = await stage(db, env, "document", "D4", data={"entity_id": "ghost", "name": "X"})
    conflict = await stage(db, env, "document", "D5", action="conflict")
    broken = await stage(db, env, "document", "D6", data={"entity_id": "app"})
    assert await ap._apply_document_pass(db, env.m, env.admin) == zero(
        created=1, updated=1, skipped=2, conflicts=1, errors=1
    )
    assert by_id.name == "New title"
    fresh = (await db.execute(select(Document).where(Document.name == "Fresh"))).scalar_one()
    assert (fresh.card_id, fresh.url, fresh.type, fresh.created_by) == (
        ends.app.id,
        "https://fresh",
        "link",
        env.admin.id,
    )
    assert (rename.target_id, same.target_id, stale.target_id) == (by_id.id, by_url.id, fresh.id)
    mapped = await identities(db, "document")
    assert mapped[("D2", "inmem")].target_id == by_url.id
    assert mapped[("D-gone", "inmem")].target_id == fresh.id
    assert orphan.error_message == "Card not resolved in identity map"
    assert [s.status for s in (rename, same, stale, orphan, conflict)] == ["applied"] * 5
    assert (broken.status, broken.error_message) == ("error", "'name'")


async def test_a_document_without_a_url_is_matched_only_by_identity(db, env, ends):
    db.add(Document(card_id=ends.app.id, name="Note", url=None, type="link"))
    await db.flush()
    staged = await stage(db, env, "document", "D1", data={"entity_id": "app", "name": "Note"})
    assert await ap._find_existing_document(db, staged, ends.app.id, None) is None


async def test_comments_need_a_known_author_and_are_matched_on_reimport(db, env, ends):
    alice = await create_user(db, email="alice@test.com")
    await identity(db, "alice@test.com", alice.id, kind="user")
    edited = Comment(card_id=ends.app.id, user_id=alice.id, content="first draft")
    same = Comment(card_id=ends.app.id, user_id=alice.id, content="unchanged")
    db.add_all([edited, same])
    await db.flush()
    await identity(db, "C1", edited.id, kind="comment")
    author = {"entity_id": "app", "author_email": "alice@test.com"}
    rows = {
        "C1": await stage(db, env, "comment", "C1", data={**author, "body": "final"}),
        "C2": await stage(db, env, "comment", "C2", data={**author, "body": "unchanged"}),
        "C3": await stage(db, env, "comment", "C3", data={**author, "body": "brand new"}),
        "C4": await stage(db, env, "comment", "C4", data={"entity_id": "app", "body": "anon"}),
        "C5": await stage(
            db,
            env,
            "comment",
            "C5",
            data={"entity_id": "app", "author_email": "ghost@test.com", "body": "x"},
        ),
        "C6": await stage(db, env, "comment", "C6", data={**author, "entity_id": "ghost"}),
        "C7": await stage(db, env, "comment", "C7", data=author),
    }
    assert await ap._apply_comment_pass(db, env.m, env.admin) == zero(
        created=1, updated=1, skipped=4, errors=1
    )
    assert (edited.content, same.content) == ("final", "unchanged")
    new = (await db.execute(select(Comment).where(Comment.content == "brand new"))).scalar_one()
    assert (new.card_id, new.user_id, new.parent_id) == (ends.app.id, alice.id, None)
    assert [rows[k].target_id for k in ("C1", "C2", "C3")] == [edited.id, same.id, new.id]
    mapped = await identities(db, "comment")
    assert {k for (k, _s) in mapped} == {"C1", "C2", "C3"}
    assert (
        rows["C4"].error_message
        == rows["C5"].error_message
        == ("Author not resolved — comment skipped")
    )
    assert rows["C6"].error_message == "Card not resolved"
    assert (rows["C7"].status, rows["C7"].error_message) == ("error", "'body'")


async def test_a_comment_identity_whose_row_is_gone_falls_back_to_its_content(db, env, ends):
    alice = await create_user(db, email="alice@test.com")
    kept = Comment(card_id=ends.app.id, user_id=alice.id, content="hello")
    db.add(kept)
    await db.flush()
    await identity(db, "C1", uuid.uuid4(), kind="comment")
    staged = await stage(db, env, "comment", "C1")
    assert await ap._find_existing_comment(db, staged, ends.app.id, alice.id, "hello") is kept
    assert await ap._find_existing_comment(db, staged, ends.app.id, alice.id, "bye") is None
    other = await create_user(db, email="bob@test.com")
    assert await ap._find_existing_comment(db, staged, ends.app.id, other.id, "hello") is None


# ── per-row failure isolation ───────────────────────────────────────────────


LONG = "boom " * 300


@pytest.mark.parametrize(
    "kind,runner,data",
    [
        ("metamodel_type", "_apply_metamodel_type_pass", {"proposed_tea_key": "New"}),
        ("metamodel_relation_type", "_apply_metamodel_relation_type_pass", None),
        ("user", "_apply_user_pass", {"email": "x@test.com"}),
        ("card", "_apply_card_pass", {"payload": {"type": "Application", "name": "X"}}),
        ("tag_group", "_apply_tag_group_pass", {"name": "G"}),
        ("tag", "_apply_tag_pass", {"name": "T", "group_name": "G"}),
        ("subscription", "_apply_subscription_pass", None),
        ("document", "_apply_document_pass", {"entity_id": "app", "name": "Doc"}),
        ("comment", "_apply_comment_pass", None),
    ],
)
async def test_a_row_that_raises_is_recorded_on_its_own_row(
    db, env, ends, monkeypatch, published, kind, runner, data
):
    alice = await create_user(db, email="alice@test.com")
    await identity(db, "alice@test.com", alice.id, kind="user")
    db.add(TagGroup(name="G"))
    await db.flush()
    defaults = {
        "metamodel_relation_type": {
            "native_name": "relNew",
            "from_type": "Application",
            "to_type": "ITComponent",
        },
        "subscription": {"entity_id": "app", "user_email": "alice@test.com"},
        "comment": {"entity_id": "app", "author_email": "alice@test.com", "body": "hi"},
    }
    payload = data if data is not None else defaults[kind]
    first = await stage(db, env, kind, "F1", data=payload)
    second = await stage(db, env, kind, "F2", data=payload)

    def explode():
        raise ValueError(LONG)

    monkeypatch.setattr(ap, "uuid", SimpleNamespace(uuid4=explode, UUID=uuid.UUID))
    counts = await getattr(ap, runner)(db, env.m, env.admin)
    assert counts["errors"] == 2
    assert counts["created"] == 0
    for staged in (first, second):
        assert staged.status == "error"
        assert staged.error_message == LONG[:1000]


async def test_a_card_tag_or_relation_that_raises_is_recorded_on_its_own_row(
    db, env, ends, monkeypatch
):
    async def broken(*a, **k):
        raise ValueError(LONG)

    monkeypatch.setattr(ap, "_identity_lookup", broken)
    tag_row = await stage(db, env, "card_tag", "L1", data={"entity_id": "app", "tag_id": "t"})
    rel_row = await stage(
        db,
        env,
        "relation",
        "R1",
        data={"tea_type": "app_to_itc", "from_entity_id": "app", "to_entity_id": "server"},
    )
    assert (await ap._apply_card_tag_pass(db, env.m, env.admin))["errors"] == 1
    assert (await ap._apply_relation_pass(db, env.m, env.admin))["errors"] == 1
    for staged in (tag_row, rel_row):
        assert (staged.status, staged.error_message) == ("error", LONG[:1000])


async def test_a_field_for_an_unknown_type_records_a_truncated_reason(db, env):
    long_key = "T" * 1200
    staged = await stage(
        db,
        env,
        "metamodel_field",
        "LX:f",
        data={"field_key": "f", "tea_type": "text", "target_type": long_key},
    )
    staged2 = await stage(
        db,
        env,
        "metamodel_field",
        "LX:g",
        data={"field_key": "g", "tea_type": "text", "target_type": long_key},
    )
    assert await ap._apply_metamodel_field_pass(db, env.m, env.admin) == zero(errors=2)
    expected = f"target card type {long_key!r} not found"[:1000]
    assert (staged.status, staged.error_message) == ("error", expected)
    assert staged2.error_message == expected
