"""The card-plus-context payload behind the Portfolio and Lifecycle filters.

``build_portfolio_payload`` was lifted out of ``GET /reports/app-portfolio`` so
``GET /reports/roadmap`` could carry the same filter payload (#1305); the route
tests in ``tests/api/test_reports_app_portfolio.py`` keep pinning its HTTP
shape, these pin the builder and the roadmap view of it directly.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.card_type import CardType
from app.models.tag import CardTag, Tag, TagGroup
from app.services.card_read_scope import CardReadScope
from app.services.permission_service import PermissionService
from app.services.portfolio_payload import (
    build_portfolio_payload,
    has_timeline_dates,
    roadmap_from_portfolio,
)
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)

# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("lifecycle", "attributes", "expected"),
    [
        ({"active": "2024-01-01"}, {}, True),
        ({}, {"startDate": "2024-01-01"}, True),
        ({}, {"endDate": "2024-01-01"}, True),
        (None, None, False),
        ({"active": ""}, {"startDate": "", "endDate": None}, False),
        ({}, {"otherDate": "2024-01-01"}, False),
    ],
)
def test_has_timeline_dates(lifecycle, attributes, expected):
    assert has_timeline_dates(lifecycle, attributes) is expected


def test_roadmap_view_keeps_drawable_cards_and_the_filter_payload():
    payload = {
        "items": [
            {
                "id": "a",
                "name": "Dated",
                "subtype": "microservice",
                "attributes": None,
                "lifecycle": {"active": "2024-01-01"},
                "relations": [{"relation_type": "r", "related_id": "x"}],
                "org_ids": ["o"],
                "tag_ids": ["t"],
            },
            {
                "id": "b",
                "name": "Undated",
                "subtype": None,
                "attributes": {},
                "lifecycle": None,
                "relations": [],
                "org_ids": [],
                "tag_ids": [],
            },
        ],
        "fields_schema": [{"section": "S", "fields": []}],
        "relation_types": [{"key": "r"}],
        "groupable_types": {"Cap": [{"id": "x"}]},
        "organizations": [{"id": "o", "name": "Org"}],
        "tag_groups": [{"id": "g"}],
    }
    assert roadmap_from_portfolio(payload, "Application") == {
        "items": [
            {
                "id": "a",
                "name": "Dated",
                "type": "Application",
                "subtype": "microservice",
                "lifecycle": {"active": "2024-01-01"},
                "attributes": {},
                "relations": [{"relation_type": "r", "related_id": "x"}],
                "tag_ids": ["t"],
            }
        ],
        "fields_schema": [{"section": "S", "fields": []}],
        "relation_types": [{"key": "r"}],
        "groupable_types": {"Cap": [{"id": "x"}]},
        "tag_groups": [{"id": "g"}],
    }


# ---------------------------------------------------------------------------
# The builder against the database
# ---------------------------------------------------------------------------


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    app_type = await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="BusinessCapability", label="Capability", has_hierarchy=True)
    await create_card_type(db, key="Initiative", label="Initiative")
    await create_card_type(db, key="Retired", label="Retired", is_hidden=True)
    await create_relation_type(
        db,
        key="relAppToBC",
        label="supports",
        source_type_key="Application",
        target_type_key="BusinessCapability",
    )
    await create_relation_type(
        db,
        key="relInitToApp",
        label="changes",
        source_type_key="Initiative",
        target_type_key="Application",
    )
    await create_relation_type(
        db,
        key="relAppToApp",
        label="depends on",
        source_type_key="Application",
        target_type_key="Application",
    )
    await create_relation_type(
        db,
        key="relAppToRetired",
        label="ran on",
        source_type_key="Application",
        target_type_key="Retired",
    )
    root = await create_card(db, card_type="BusinessCapability", name="Operations")
    mid = await create_card(
        db, card_type="BusinessCapability", name="Fulfilment", parent_id=root.id
    )
    leaf = await create_card(db, card_type="BusinessCapability", name="Shipping", parent_id=mid.id)
    erp = await create_card(db, card_type="Application", name="ERP")
    crm = await create_card(db, card_type="Application", name="CRM")
    program = await create_card(db, card_type="Initiative", name="Program")
    old = await create_card(db, card_type="Retired", name="Mainframe")
    await create_relation(db, type_key="relAppToBC", source_id=erp.id, target_id=leaf.id)
    await create_relation(db, type_key="relInitToApp", source_id=program.id, target_id=erp.id)
    await create_relation(db, type_key="relAppToApp", source_id=erp.id, target_id=crm.id)
    await create_relation(db, type_key="relAppToRetired", source_id=erp.id, target_id=old.id)

    for_apps = TagGroup(name="Origin", mode="multi", restrict_to_types=["Application"])
    for_caps = TagGroup(name="Maturity", mode="single", restrict_to_types=["BusinessCapability"])
    everywhere = TagGroup(name="Audit", mode="multi")
    db.add_all([for_apps, for_caps, everywhere])
    await db.flush()
    in_house = Tag(tag_group_id=for_apps.id, name="Internally Developed", color="#123456")
    db.add(in_house)
    await db.flush()
    db.add(CardTag(card_id=erp.id, tag_id=in_house.id))
    await db.flush()

    admin = await create_user(db, email="admin@t.com", role="admin")
    viewer = await create_user(db, email="viewer@t.com", role="viewer")
    return {
        "app_type": app_type,
        "root": root,
        "mid": mid,
        "leaf": leaf,
        "erp": erp,
        "crm": crm,
        "program": program,
        "in_house": in_house,
        "admin": admin,
        "viewer": viewer,
    }


async def _payload(db, user, card_type):
    all_types = (await db.execute(select(CardType))).scalars().all()
    scope = await CardReadScope.load(db, user)
    return await build_portfolio_payload(db, scope, card_type, all_types)


def _item(payload, name):
    return next(i for i in payload["items"] if i["name"] == name)


async def test_relations_are_listed_on_the_side_each_card_sits(db, env):
    payload = await _payload(db, env["admin"], env["app_type"])
    erp = _item(payload, "ERP")
    crm = _item(payload, "CRM")
    by_type = {(r["relation_type"], r["direction"]): r for r in erp["relations"]}
    assert by_type["relAppToBC", "outgoing"]["related_id"] == str(env["leaf"].id)
    assert by_type["relAppToBC", "outgoing"]["related_type"] == "BusinessCapability"
    assert by_type["relInitToApp", "incoming"]["related_name"] == "Program"
    # A self-referencing row lands on both of its cards, once per side.
    assert by_type["relAppToApp", "outgoing"]["related_id"] == str(env["crm"].id)
    assert [(r["relation_type"], r["direction"]) for r in crm["relations"]] == [
        ("relAppToApp", "incoming")
    ]
    assert crm["tag_ids"] == []


async def test_related_capabilities_carry_their_ancestors(db, env):
    payload = await _payload(db, env["admin"], env["app_type"])
    caps = {m["name"]: m for m in payload["groupable_types"]["BusinessCapability"]}
    assert caps["Shipping"]["parent_id"] == str(env["mid"].id)
    assert "ancestor_only" not in caps["Shipping"]
    # The chain up to the root is there so a parent pick can cover its children.
    assert caps["Fulfilment"] == {
        "id": str(env["mid"].id),
        "name": "Fulfilment",
        "type": "BusinessCapability",
        "parent_id": str(env["root"].id),
        "ancestor_only": True,
    }
    assert caps["Operations"]["parent_id"] is None
    assert caps["Operations"]["ancestor_only"] is True


async def test_tags_and_the_tag_groups_that_apply_to_the_type(db, env):
    payload = await _payload(db, env["admin"], env["app_type"])
    assert _item(payload, "ERP")["tag_ids"] == [str(env["in_house"].id)]
    groups = {g["name"]: g for g in payload["tag_groups"]}
    assert set(groups) == {"Audit", "Origin"}
    assert groups["Origin"]["tags"] == [
        {"id": str(env["in_house"].id), "name": "Internally Developed", "color": "#123456"}
    ]


async def test_a_hidden_card_type_offers_no_filter_options(db, env):
    payload = await _payload(db, env["admin"], env["app_type"])
    assert "Retired" not in payload["groupable_types"]
    assert {rt["key"] for rt in payload["relation_types"]} == {
        "relAppToBC",
        "relInitToApp",
        "relAppToApp",
        "relAppToRetired",
    }


async def test_a_type_the_reader_may_not_see_is_left_out(db, env):
    ct = (await db.execute(select(CardType).where(CardType.key == "Initiative"))).scalar_one()
    ct.role_permissions = {"viewer": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    try:
        payload = await _payload(db, env["viewer"], env["app_type"])
    finally:
        PermissionService.invalidate_type_permission_cache()
    erp = _item(payload, "ERP")
    assert all(r["related_type"] != "Initiative" for r in erp["relations"])
    assert "Initiative" not in payload["groupable_types"]
    assert all(rt["other_type_key"] != "Initiative" for rt in payload["relation_types"])
