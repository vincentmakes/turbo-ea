"""Which cost values a reader does not get on the surfaces that return cards
in bulk: the per-card strip map, and the portfolio payload the Portfolio and
Lifecycle reports share."""

from __future__ import annotations

import copy
import uuid

import pytest
from sqlalchemy import event as sa_event

from app.models.stakeholder import Stakeholder
from app.services import cost_redaction as cr
from app.services.permission_service import PermissionService
from tests.conftest import (
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

APP_SCHEMA = [
    {
        "section": "General",
        "fields": [
            {"key": "costTotalAnnual", "type": "cost"},
            {"key": "costRun", "type": "cost"},
            {"key": "tier", "type": "text"},
        ],
    }
]
REL_SCHEMA = [{"key": "costShare", "type": "cost"}, {"key": "note", "type": "text"}]


@pytest.fixture(autouse=True)
def _fresh_caches():
    def clear():
        PermissionService.invalidate_role_cache()
        PermissionService.invalidate_srd_cache()
        PermissionService.invalidate_type_permission_cache()

    clear()
    yield
    clear()


@pytest.fixture
async def world(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="reader", label="Reader", permissions={"inventory.view": True})
    await create_role(
        db, key="finance", label="Finance", permissions={"inventory.view": True, "costs.view": True}
    )
    await create_card_type(db, key="Application", label="Application", fields_schema=APP_SCHEMA)
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_stakeholder_role_def(
        db, key="funder", label="Funder", permissions={"card.view": True, "card.view_costs": True}
    )
    users = {
        key: await create_user(db, email=f"{key}@test.com", role=key)
        for key in ("admin", "reader", "finance")
    }
    app = await create_card(db, card_type="Application", name="Billing")
    other = await create_card(db, card_type="Application", name="Ledger")
    server = await create_card(db, card_type="ITComponent", name="Server")
    return {"users": users, "app": app, "other": other, "server": server}


async def _fund(db, card, user):
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role="funder"))
    await db.flush()


# ── card_cost_redaction_map ─────────────────────────────────────────────────

APP_KEYS = frozenset({"costTotalAnnual", "costRun"})


async def test_a_reader_without_cost_access_strips_every_cost_bearing_card(db, world):
    cards = [world["app"], world["other"], world["server"]]
    got = await cr.card_cost_redaction_map(db, world["users"]["reader"], cards)
    # the IT Component has no cost field: it is not in the map at all
    assert got == {world["app"].id: APP_KEYS, world["other"].id: APP_KEYS}


@pytest.mark.parametrize("who", ["admin", "finance"])
async def test_a_reader_who_sees_costs_strips_nothing(db, world, who):
    cards = [world["app"], world["other"], world["server"]]
    assert await cr.card_cost_redaction_map(db, world["users"][who], cards) == {}


async def test_a_card_whose_role_shows_costs_is_absent_from_the_map(db, world):
    reader = world["users"]["reader"]
    await _fund(db, world["app"], reader)
    got = await cr.card_cost_redaction_map(db, reader, [world["app"], world["other"]])
    assert got == {world["other"].id: APP_KEYS}


async def test_nothing_to_look_at_is_an_empty_map(db, world):
    reader = world["users"]["reader"]
    assert await cr.card_cost_redaction_map(db, reader, []) == {}
    # only cards of a type without cost fields
    assert await cr.card_cost_redaction_map(db, reader, [world["server"]]) == {}


# ── redact_portfolio_costs ──────────────────────────────────────────────────


def _payload(world) -> dict:
    app, other, server = world["app"], world["other"], world["server"]

    def rel(direction, related, rtype="relAppToItc", attributes=None):
        return {
            "relation_type": rtype,
            "direction": direction,
            "related_id": str(related.id),
            "related_name": related.name,
            "related_type": related.type,
            "attributes": {"costShare": 5, "note": "n"} if attributes is None else attributes,
        }

    return {
        "items": [
            {
                "id": str(app.id),
                "name": "Billing",
                "attributes": {"costTotalAnnual": 100, "costRun": 7, "tier": "gold"},
                "relations": [
                    rel("outgoing", server),
                    rel("incoming", other, "relAppToApp"),
                    rel("outgoing", server, "plain", {"costShare": 1}),
                ],
                "tag_ids": ["t"],
            },
            {
                "id": str(other.id),
                "name": "Ledger",
                "attributes": None,
                "relations": [rel("outgoing", app, "relAppToApp")],
                "tag_ids": [],
            },
        ],
        "fields_schema": APP_SCHEMA,
        "relation_types": [
            {"key": "relAppToItc", "attributes_schema": REL_SCHEMA},
            {"key": "relAppToApp", "attributes_schema": REL_SCHEMA},
            {"key": "plain", "attributes_schema": []},
            {"key": "bare"},
        ],
        "groupable_types": {"ITComponent": []},
        "tag_groups": [],
    }


def _attrs(payload) -> list:
    return [
        (item["attributes"], [r["attributes"] for r in item["relations"]])
        for item in payload["items"]
    ]


async def test_a_reader_without_cost_access_gets_no_cost_value(db, world):
    payload = _payload(world)
    before = copy.deepcopy(payload)
    got = await cr.redact_portfolio_costs(db, world["users"]["reader"], payload)
    assert _attrs(got) == [
        # a relation type with no cost attribute keeps a key that only looks like one
        ({"tier": "gold"}, [{"note": "n"}, {"note": "n"}, {"costShare": 1}]),
        (None, [{"note": "n"}]),
    ]
    # everything else is carried through, and the input is not touched
    assert got["items"][0]["name"] == "Billing" and got["items"][0]["tag_ids"] == ["t"]
    assert got["items"][0]["relations"][0]["related_name"] == "Server"
    assert {k: v for k, v in got.items() if k != "items"} == {
        k: v for k, v in before.items() if k != "items"
    }
    assert payload == before


@pytest.mark.parametrize("who", ["admin", "finance"])
async def test_a_reader_who_sees_every_cost_gets_the_payload_itself(db, world, who):
    payload = _payload(world)
    assert await cr.redact_portfolio_costs(db, world["users"][who], payload) is payload


async def test_a_relation_follows_its_source_card(db, world):
    # The reader may see Billing's costs only. Billing is the source of its
    # outgoing relations; the Ledger → Billing relation belongs to Ledger,
    # whether it is listed on Billing (incoming) or on Ledger (outgoing).
    reader = world["users"]["reader"]
    await _fund(db, world["app"], reader)
    got = await cr.redact_portfolio_costs(db, reader, _payload(world))
    assert _attrs(got) == [
        (
            {"costTotalAnnual": 100, "costRun": 7, "tier": "gold"},
            [{"costShare": 5, "note": "n"}, {"note": "n"}, {"costShare": 1}],
        ),
        (None, [{"note": "n"}]),
    ]


async def test_owning_the_other_end_opens_the_relations_that_start_there(db, world):
    reader = world["users"]["reader"]
    await _fund(db, world["other"], reader)
    got = await cr.redact_portfolio_costs(db, reader, _payload(world))
    assert _attrs(got) == [
        ({"tier": "gold"}, [{"note": "n"}, {"costShare": 5, "note": "n"}, {"costShare": 1}]),
        (None, [{"costShare": 5, "note": "n"}]),
    ]


async def test_a_payload_with_no_cost_key_anywhere_is_returned_itself(db, world):
    payload = _payload(world)
    payload["fields_schema"] = [{"section": "g", "fields": [{"key": "tier", "type": "text"}]}]
    payload["relation_types"] = [{"key": "relAppToItc", "attributes_schema": []}, {"key": "bare"}]
    assert await cr.redact_portfolio_costs(db, world["users"]["reader"], payload) is payload


async def test_card_costs_alone_are_enough_to_redact(db, world):
    payload = _payload(world)
    payload["relation_types"] = []
    got = await cr.redact_portfolio_costs(db, world["users"]["reader"], payload)
    assert got["items"][0]["attributes"] == {"tier": "gold"}
    # no relation type is known to carry a cost: relation attributes stay
    assert got["items"][0]["relations"][0]["attributes"] == {"costShare": 5, "note": "n"}


async def test_relation_costs_alone_are_enough_to_redact(db, world):
    payload = _payload(world)
    payload["fields_schema"] = []
    got = await cr.redact_portfolio_costs(db, world["users"]["reader"], payload)
    assert got["items"][0]["attributes"] == {"costTotalAnnual": 100, "costRun": 7, "tier": "gold"}
    assert got["items"][0]["relations"][0]["attributes"] == {"note": "n"}


async def test_a_reader_who_sees_every_cost_pays_no_query(db, world):
    finance = world["users"]["finance"]
    await PermissionService.sees_all_costs(db, finance)  # the route's gate warmed the caches
    statements: list[str] = []
    bind = db.sync_session.get_bind()

    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    sa_event.listen(bind, "before_cursor_execute", _record)
    try:
        await cr.redact_portfolio_costs(db, finance, _payload(world))
    finally:
        sa_event.remove(bind, "before_cursor_execute", _record)
    assert statements == []


def test_relation_source():
    item, other = str(uuid.uuid4()), str(uuid.uuid4())
    assert cr._relation_source(item, {"direction": "outgoing", "related_id": other}) == item
    assert cr._relation_source(item, {"direction": "incoming", "related_id": other}) == other
