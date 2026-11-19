"""Cost values are removed from event payloads read by someone who may not
see that card's costs.

A ``card.updated`` event stores the whole old and new attributes, so a card's
History, the activity feeds and a mutation batch repeat the very values the
card response redacts. ``event_cost_scrub`` removes them on read; the stored
rows stay whole, because rollback restores a card from them.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import event as sa_event

from app.models.stakeholder import Stakeholder
from app.services import event_cost_scrub as scrub
from app.services.permission_service import PermissionService
from tests.conftest import (
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

COST = frozenset({"costTotalAnnual"})


def _fields(*specs: tuple[str, str]) -> list[dict]:
    return [{"section": "General", "fields": [{"key": k, "type": t} for k, t in specs]}]


# ── strip_cost_values ───────────────────────────────────────────────────────


def test_a_cost_key_leaves_both_sides_of_attributes():
    data = {
        "id": "x",
        "changes": {
            "name": {"old": "A", "new": "B"},
            "attributes": {
                "old": {"costTotalAnnual": 100, "tier": "gold"},
                "new": {"costTotalAnnual": 250, "tier": "gold"},
            },
        },
    }
    assert scrub.strip_cost_values(data, COST) == {
        "id": "x",
        "changes": {
            "name": {"old": "A", "new": "B"},
            "attributes": {"old": {"tier": "gold"}, "new": {"tier": "gold"}},
        },
    }


def test_a_side_that_is_not_a_dict_is_left_as_it_is():
    data = {"changes": {"attributes": {"old": None, "new": {"costTotalAnnual": 1, "a": 2}}}}
    assert scrub.strip_cost_values(data, COST) == {
        "changes": {"attributes": {"old": None, "new": {"a": 2}}}
    }
    odd = {"changes": {"attributes": ["costTotalAnnual"]}}
    assert scrub.strip_cost_values(odd, COST) == odd


def test_a_per_field_entry_and_its_legacy_form_are_dropped():
    data = {
        "changes": {
            "costTotalAnnual": {"old": 1, "new": 2},
            "attr_costTotalAnnual": {"old": 1, "new": 2},
            "attr_tier": {"old": "a", "new": "b"},
            "tier": [1, 2],
        }
    }
    assert scrub.strip_cost_values(data, COST) == {
        "changes": {"attr_tier": {"old": "a", "new": "b"}, "tier": [1, 2]}
    }


def test_only_the_attributes_entry_is_opened():
    # A lifecycle change is a dict too; a key that happens to share a cost
    # field's name inside it is not an attribute.
    data = {"changes": {"lifecycle": {"old": {"costTotalAnnual": 1}, "new": {}}}}
    assert scrub.strip_cost_values(data, COST) == data


def test_a_rollback_operations_fields_lose_their_cost_values():
    op = {
        "op": "restore_card_fields",
        "card_id": "c",
        "fields": {
            "name": "Old",
            "attributes": {"costTotalAnnual": 9, "tier": "gold"},
            "attr_costTotalAnnual": 9,
            "costTotalAnnual": 9,
            "attr_tier": "gold",
            "lifecycle": {"costTotalAnnual": 1},
        },
    }
    assert scrub.strip_cost_values(op, COST) == {
        "op": "restore_card_fields",
        "card_id": "c",
        "fields": {
            "name": "Old",
            "attributes": {"tier": "gold"},
            "attr_tier": "gold",
            "lifecycle": {"costTotalAnnual": 1},
        },
    }
    assert scrub.strip_cost_values({"fields": {"attributes": None}}, COST) == {
        "fields": {"attributes": None}
    }


def test_changes_and_fields_in_one_payload_are_both_cleaned():
    data = {"changes": {"costTotalAnnual": 1}, "fields": {"costTotalAnnual": 1}, "keep": True}
    assert scrub.strip_cost_values(data, COST) == {"changes": {}, "fields": {}, "keep": True}


def test_nothing_to_remove_returns_the_payload_itself():
    data = {"changes": {"attributes": {"old": {"costTotalAnnual": 1}, "new": {}}}}
    assert scrub.strip_cost_values(data, frozenset()) is data
    plain = {"name": "Billing", "changes": "renamed", "fields": ["name"]}
    assert scrub.strip_cost_values(plain, COST) is plain


def test_the_stored_payload_is_never_mutated():
    data = {
        "changes": {"attributes": {"old": {"costTotalAnnual": 1}, "new": {"costTotalAnnual": 2}}},
        "fields": {"attributes": {"costTotalAnnual": 1}},
    }
    scrub.strip_cost_values(data, COST)
    assert data == {
        "changes": {"attributes": {"old": {"costTotalAnnual": 1}, "new": {"costTotalAnnual": 2}}},
        "fields": {"attributes": {"costTotalAnnual": 1}},
    }


def test_the_legacy_prefix_is_matched_at_the_start_only():
    data = {"changes": {"x_attr_costTotalAnnual": 1, "attr_": 2, "attr_attr_costTotalAnnual": 3}}
    assert scrub.strip_cost_values(data, COST) == data
    assert scrub.LEGACY_ATTRIBUTE_PREFIX == "attr_"


# ── carries_values / subject_card_id ────────────────────────────────────────


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        ({"changes": {}}, True),
        ({"fields": {}}, True),
        ({"changes": {"a": 1}, "fields": None}, True),
        ({"changes": None, "fields": {"a": 1}}, True),
        ({"changes": ["name"]}, False),
        ({"fields": ["name"]}, False),
        ({"name": "Billing"}, False),
        ({}, False),
        (None, False),
        ("changes", False),
        ([{"changes": {}}], False),
    ],
)
def test_carries_values(data, expected):
    assert scrub.carries_values(data) is expected


def test_the_event_rows_card_wins_over_the_payload():
    row, named, other = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    assert scrub.subject_card_id(row, {"card_id": str(named), "id": str(other)}) == row
    assert scrub.subject_card_id(None, {"card_id": str(named), "id": str(other)}) == named
    assert scrub.subject_card_id(None, {"id": str(other)}) == other
    assert scrub.subject_card_id(None, {"card_id": None, "id": str(other)}) == other
    assert scrub.subject_card_id(None, {"card_id": "nope", "id": str(other)}) == other


@pytest.mark.parametrize("data", [{}, {"id": "nope"}, {"card_id": 7}, {"id": None}])
def test_a_payload_that_names_no_card_has_no_subject(data):
    assert scrub.subject_card_id(None, data) is None


# ── scrub_event_costs ───────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _fresh_caches():
    def clear():
        PermissionService.invalidate_role_cache()
        PermissionService.invalidate_srd_cache()
        PermissionService.invalidate_type_permission_cache()

    clear()
    yield
    clear()


def _change(old: dict, new: dict, **extra) -> dict:
    return {"changes": {"attributes": {"old": old, "new": new}}, **extra}


APP_BEFORE = {"costTotalAnnual": 100, "tier": "gold"}
APP_AFTER = {"costTotalAnnual": 250, "tier": "gold"}
APP_CLEAN = _change({"tier": "gold"}, {"tier": "gold"})


@pytest.fixture
async def world(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="reader", label="Reader", permissions={"inventory.view": True})
    await create_role(
        db,
        key="finance",
        label="Finance",
        permissions={"inventory.view": True, "costs.view": True},
    )
    await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=_fields(("costTotalAnnual", "cost"), ("tier", "text")),
    )
    await create_card_type(
        db,
        key="Initiative",
        label="Initiative",
        fields_schema=_fields(("costBudget", "cost"), ("costTotalAnnual", "number")),
    )
    await create_stakeholder_role_def(
        db, key="funder", label="Funder", permissions={"card.view": True, "card.view_costs": True}
    )
    await create_stakeholder_role_def(
        db, key="watcher", label="Watcher", permissions={"card.view": True}
    )
    users = {
        key: await create_user(db, email=f"{key}@test.com", role=key)
        for key in ("admin", "reader", "finance")
    }
    app = await create_card(db, card_type="Application", name="Billing")
    other = await create_card(db, card_type="Application", name="Ledger")
    initiative = await create_card(db, card_type="Initiative", name="Migration")
    return {"users": users, "app": app, "other": other, "initiative": initiative}


async def _hold(db, card, user, role):
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role=role))
    await db.flush()


async def test_a_reader_without_cost_access_gets_no_cost_value(db, world):
    stored = _change(APP_BEFORE, APP_AFTER, id=str(world["app"].id))
    [got] = await scrub.scrub_event_costs(db, world["users"]["reader"], [(world["app"].id, stored)])
    assert got == {**APP_CLEAN, "id": str(world["app"].id)}
    # the row in the session is untouched: rollback restores from it
    assert stored["changes"]["attributes"]["old"] == APP_BEFORE


@pytest.mark.parametrize("who", ["admin", "finance"])
async def test_a_reader_who_sees_every_cost_gets_the_payload_as_stored(db, world, who):
    stored = _change(APP_BEFORE, APP_AFTER)
    [got] = await scrub.scrub_event_costs(db, world["users"][who], [(world["app"].id, stored)])
    assert got is stored


async def test_a_role_that_shows_costs_keeps_them_for_its_own_card_only(db, world):
    reader = world["users"]["reader"]
    await _hold(db, world["app"], reader, "funder")
    await _hold(db, world["other"], reader, "watcher")
    mine, theirs = _change(APP_BEFORE, APP_AFTER), _change(APP_BEFORE, APP_AFTER)
    got = await scrub.scrub_event_costs(
        db, reader, [(world["app"].id, mine), (world["other"].id, theirs)]
    )
    assert got == [mine, APP_CLEAN]
    assert got[0] is mine


async def test_each_card_loses_the_cost_keys_of_its_own_type(db, world):
    # `costTotalAnnual` is a cost on Application and a plain number on
    # Initiative, whose cost field is `costBudget`.
    reader = world["users"]["reader"]
    both = {"costTotalAnnual": 1, "costBudget": 2}
    got = await scrub.scrub_event_costs(
        db,
        reader,
        [(world["app"].id, _change(both, both)), (world["initiative"].id, _change(both, both))],
    )
    assert got == [
        _change({"costBudget": 2}, {"costBudget": 2}),
        _change({"costTotalAnnual": 1}, {"costTotalAnnual": 1}),
    ]


async def test_a_card_that_is_gone_is_judged_by_the_type_its_event_names(db, world):
    reader = world["users"]["reader"]
    both = {"costTotalAnnual": 1, "costBudget": 2}
    gone = uuid.uuid4()
    got = await scrub.scrub_event_costs(
        db,
        reader,
        [
            (gone, _change(both, both, type="Initiative")),
            (gone, _change(both, both, type="NoSuchType")),
            (gone, _change(both, both)),
            (None, _change(both, both)),
        ],
    )
    assert got == [
        _change({"costTotalAnnual": 1}, {"costTotalAnnual": 1}, type="Initiative"),
        _change({}, {}, type="NoSuchType"),
        _change({}, {}),
        _change({}, {}),
    ]


async def test_a_live_cards_own_type_wins_over_what_the_payload_says(db, world):
    reader = world["users"]["reader"]
    both = {"costTotalAnnual": 1, "costBudget": 2}
    [got] = await scrub.scrub_event_costs(
        db, reader, [(world["app"].id, _change(both, both, type="Initiative"))]
    )
    assert got == _change({"costBudget": 2}, {"costBudget": 2}, type="Initiative")


async def test_a_card_less_rollback_event_is_judged_by_the_card_it_names(db, world):
    reader = world["users"]["reader"]
    await _hold(db, world["other"], reader, "funder")

    def op(card):
        return {
            "op": "restore_card_fields",
            "card_id": str(card.id),
            "fields": {"attributes": dict(APP_BEFORE)},
            "outcome": "ok",
        }

    got = await scrub.scrub_event_costs(
        db, reader, [(None, op(world["app"])), (None, op(world["other"]))]
    )
    assert got[0] == {**op(world["app"]), "fields": {"attributes": {"tier": "gold"}}}
    assert got[1] == op(world["other"])


async def test_the_event_rows_card_decides_not_the_id_in_its_payload(db, world):
    reader = world["users"]["reader"]
    await _hold(db, world["other"], reader, "funder")
    payload = _change(APP_BEFORE, APP_AFTER, id=str(world["other"].id))
    [got] = await scrub.scrub_event_costs(db, reader, [(world["app"].id, payload)])
    assert got == {**APP_CLEAN, "id": str(world["other"].id)}


async def test_payloads_without_values_keep_their_place(db, world):
    reader = world["users"]["reader"]
    plain = {"name": "Billing"}
    stored = _change(APP_BEFORE, APP_AFTER)
    got = await scrub.scrub_event_costs(
        db,
        reader,
        [(None, None), (world["app"].id, plain), (world["app"].id, stored), (None, "text")],
    )
    assert got == [None, plain, APP_CLEAN, "text"]
    assert got[1] is plain


async def test_a_view_deny_on_the_type_takes_the_app_grant_away(db, world):
    # `costs.view`, but the role may not view Applications at all: a card it
    # still opens through a stakeholder role shows no costs (as `my-permissions`
    # says), unless that role allows them.
    from sqlalchemy import select

    from app.models.card_type import CardType

    finance = world["users"]["finance"]
    app_type = (
        await db.execute(select(CardType).where(CardType.key == "Application"))
    ).scalar_one()
    app_type.role_permissions = {"finance": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    await _hold(db, world["app"], finance, "watcher")
    await _hold(db, world["other"], finance, "funder")

    both = {"costTotalAnnual": 1, "costBudget": 2}
    got = await scrub.scrub_event_costs(
        db,
        finance,
        [
            (world["app"].id, _change(APP_BEFORE, APP_AFTER)),
            (world["other"].id, _change(APP_BEFORE, APP_AFTER)),
            (world["initiative"].id, _change(both, both)),
        ],
    )
    assert got == [APP_CLEAN, _change(APP_BEFORE, APP_AFTER), _change(both, both)]


async def test_no_card_type_with_a_cost_field_means_nothing_to_remove(db):
    await create_role(db, key="reader", label="Reader", permissions={"inventory.view": True})
    await create_card_type(db, key="Application", fields_schema=_fields(("tier", "text")))
    reader = await create_user(db, email="reader@test.com", role="reader")
    card = await create_card(db, card_type="Application", name="Billing")
    stored = _change({"costTotalAnnual": 1}, {"costTotalAnnual": 2})
    [got] = await scrub.scrub_event_costs(db, reader, [(card.id, stored)])
    assert got is stored


def _count_statements(db):
    statements: list[str] = []
    bind = db.sync_session.get_bind()

    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    sa_event.listen(bind, "before_cursor_execute", _record)
    return statements, lambda: sa_event.remove(bind, "before_cursor_execute", _record)


async def test_no_query_when_there_is_nothing_to_judge(db, world):
    reader, finance = world["users"]["reader"], world["users"]["finance"]
    stored = _change(APP_BEFORE, APP_AFTER)
    # Warm the role and type-cell caches, as the route's own gate does.
    await PermissionService.sees_all_costs(db, finance)
    await PermissionService.sees_all_costs(db, reader)

    statements, stop = _count_statements(db)
    try:
        # a reader who sees every cost
        assert await scrub.scrub_event_costs(db, finance, [(world["app"].id, stored)]) == [stored]
        # no payload that carries values, whoever reads
        plain = [(world["app"].id, {"name": "Billing"}), (None, None)]
        assert await scrub.scrub_event_costs(db, reader, plain) == [{"name": "Billing"}, None]
        assert await scrub.scrub_event_costs(db, reader, []) == []
        assert statements == []
        # ...and the reader without cost access does cost queries
        await scrub.scrub_event_costs(db, reader, [(world["app"].id, stored)])
        assert statements
    finally:
        stop()


# ── operations and summaries ────────────────────────────────────────────────


async def test_operations_are_scrubbed_by_the_card_each_names(db, world):
    reader = world["users"]["reader"]
    ops = [
        {
            "op": "restore_card_fields",
            "card_id": str(world["app"].id),
            "fields": {"attributes": dict(APP_BEFORE)},
        },
        {"op": "delete_relation", "relation_id": "r"},
    ]
    assert await scrub.scrub_operation_costs(db, reader, ops) == [
        {
            "op": "restore_card_fields",
            "card_id": str(world["app"].id),
            "fields": {"attributes": {"tier": "gold"}},
        },
        {"op": "delete_relation", "relation_id": "r"},
    ]


@pytest.mark.parametrize("value", [None, "text", {"results": 1}, 3])
async def test_what_is_not_a_list_of_operations_is_returned_as_it_is(db, world, value):
    assert await scrub.scrub_operation_costs(db, world["users"]["reader"], value) is value


async def test_a_summary_has_both_of_its_operation_lists_scrubbed(db, world):
    reader = world["users"]["reader"]

    def op():
        return {"card_id": str(world["app"].id), "fields": {"attributes": dict(APP_BEFORE)}}

    clean = {"card_id": str(world["app"].id), "fields": {"attributes": {"tier": "gold"}}}
    summary = {"reverses_batch_id": "b", "forced": False, "results": [op()], "operations": [op()]}
    assert await scrub.scrub_summary_costs(db, reader, summary) == {
        "reverses_batch_id": "b",
        "forced": False,
        "results": [clean],
        "operations": [clean],
    }
    # the stored summary is not touched
    assert summary["results"] == [op()]


@pytest.mark.parametrize(
    "summary", [None, "text", [], {}, {"matches": 3}, {"results": "none"}, {"operations": None}]
)
async def test_a_summary_without_operation_lists_is_returned_itself(db, world, summary):
    assert await scrub.scrub_summary_costs(db, world["users"]["reader"], summary) is summary
