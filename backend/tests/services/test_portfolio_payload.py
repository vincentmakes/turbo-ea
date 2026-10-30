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
            {
                "id": "c",
                "name": "Ranged",
                "subtype": None,
                "attributes": {"startDate": "2024-01-01"},
                "lifecycle": {},
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
            },
            {
                "id": "c",
                "name": "Ranged",
                "type": "Application",
                "subtype": None,
                "lifecycle": {},
                "attributes": {"startDate": "2024-01-01"},
                "relations": [],
                "tag_ids": [],
            },
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
    await create_card_type(db, key="Organization", label="Organization", has_hierarchy=True)
    await create_role(
        db, key="reports_only", label="Reports", permissions={"reports.ea_dashboard": True}
    )
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
    await create_relation_type(
        db,
        key="relAppToOrg",
        label="serves",
        source_type_key="Application",
        target_type_key="Organization",
    )
    await create_relation_type(
        db,
        key="relOrgToApp",
        label="uses",
        reverse_label="is used by",
        source_type_key="Organization",
        target_type_key="Application",
        translations={"de": {"label": "nutzt"}},
        attributes_schema=[{"key": "usageType", "label": "Usage", "type": "single_select"}],
    )
    root = await create_card(db, card_type="BusinessCapability", name="Operations")
    mid = await create_card(
        db, card_type="BusinessCapability", name="Fulfilment", parent_id=root.id
    )
    leaf = await create_card(db, card_type="BusinessCapability", name="Shipping", parent_id=mid.id)
    erp = await create_card(db, card_type="Application", name="ERP")
    # CRM sits beneath ERP: a portfolio card's own parent travels with it.
    crm = await create_card(db, card_type="Application", name="CRM", parent_id=erp.id)
    lone = await create_card(db, card_type="Application", name="Lone")
    gone = await create_card(db, card_type="Application", name="Gone", status="ARCHIVED")
    portfolio = await create_card(db, card_type="Initiative", name="Portfolio")
    # A parent on a type without hierarchy is never walked.
    program = await create_card(db, card_type="Initiative", name="Program", parent_id=portfolio.id)
    old = await create_card(db, card_type="Retired", name="Mainframe")
    former = await create_card(db, card_type="BusinessCapability", name="Former", status="ARCHIVED")
    orphaned = await create_card(
        db, card_type="BusinessCapability", name="Orphaned", parent_id=former.id
    )
    zeta = await create_card(db, card_type="Organization", name="Zeta Org")
    alpha = await create_card(db, card_type="Organization", name="Alpha Org")
    await create_card(db, card_type="Organization", name="Old Org", status="ARCHIVED")
    await create_relation(
        db,
        type_key="relAppToBC",
        source_id=erp.id,
        target_id=leaf.id,
        attributes={"supportType": "core"},
    )
    # The app on the source side of an organisation relation this time.
    await create_relation(db, type_key="relAppToOrg", source_id=erp.id, target_id=alpha.id)
    await create_relation(db, type_key="relAppToBC", source_id=erp.id, target_id=former.id)
    await create_relation(db, type_key="relAppToBC", source_id=crm.id, target_id=orphaned.id)
    await create_relation(db, type_key="relInitToApp", source_id=program.id, target_id=erp.id)
    await create_relation(db, type_key="relAppToApp", source_id=erp.id, target_id=crm.id)
    await create_relation(db, type_key="relAppToRetired", source_id=erp.id, target_id=old.id)
    await create_relation(db, type_key="relAppToBC", source_id=gone.id, target_id=leaf.id)
    await create_relation(
        db,
        type_key="relOrgToApp",
        source_id=zeta.id,
        target_id=erp.id,
        attributes={"usageType": "owner"},
    )

    for_apps = TagGroup(name="Origin", mode="multi", restrict_to_types=["Application"])
    for_caps = TagGroup(name="Maturity", mode="single", restrict_to_types=["BusinessCapability"])
    everywhere = TagGroup(name="Audit", mode="multi")
    db.add_all([for_apps, for_caps, everywhere])
    await db.flush()
    in_house = Tag(tag_group_id=for_apps.id, name="Internally Developed", color="#123456")
    bought = Tag(tag_group_id=for_apps.id, name="Bought", color=None)
    db.add_all([in_house, bought])
    await db.flush()
    db.add(CardTag(card_id=erp.id, tag_id=in_house.id))
    await db.flush()

    admin = await create_user(db, email="admin@t.com", role="admin")
    viewer = await create_user(db, email="viewer@t.com", role="viewer")
    reports_only = await create_user(db, email="reports@t.com", role="reports_only")
    return {
        "app_type": app_type,
        "root": root,
        "mid": mid,
        "leaf": leaf,
        "former": former,
        "orphaned": orphaned,
        "erp": erp,
        "crm": crm,
        "lone": lone,
        "program": program,
        "zeta": zeta,
        "alpha": alpha,
        "in_house": in_house,
        "bought": bought,
        "origin_group": for_apps,
        "admin": admin,
        "viewer": viewer,
        "reports_only": reports_only,
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
    assert by_type["relAppToBC", "outgoing"] == {
        "relation_type": "relAppToBC",
        "direction": "outgoing",
        "related_id": str(env["leaf"].id),
        "related_name": "Shipping",
        "related_type": "BusinessCapability",
        "attributes": {"supportType": "core"},
    }
    assert by_type["relInitToApp", "incoming"]["related_name"] == "Program"
    # The whole entry, attributes included, on the incoming side.
    assert by_type["relOrgToApp", "incoming"] == {
        "relation_type": "relOrgToApp",
        "direction": "incoming",
        "related_id": str(env["zeta"].id),
        "related_name": "Zeta Org",
        "related_type": "Organization",
        "attributes": {"usageType": "owner"},
    }
    # A self-referencing row lands on both of its cards, once per side.
    assert by_type["relAppToApp", "outgoing"] == {
        "relation_type": "relAppToApp",
        "direction": "outgoing",
        "related_id": str(env["crm"].id),
        "related_name": "CRM",
        "related_type": "Application",
        "attributes": {},
    }
    assert sorted((r["relation_type"], r["direction"]) for r in crm["relations"]) == [
        ("relAppToApp", "incoming"),
        ("relAppToBC", "outgoing"),
    ]
    # An archived related card is no relation at all.
    assert all(r["related_name"] != "Former" for r in erp["relations"])
    assert _item(payload, "Lone") == {
        "id": str(env["lone"].id),
        "name": "Lone",
        "subtype": None,
        "attributes": {},
        "lifecycle": {},
        "relations": [],
        "org_ids": [],
        "tag_ids": [],
    }
    # Membership, not order: the items query has no ORDER BY, so the heap order a
    # sequential scan returns depends on what ran before in the same worker.
    assert sorted(i["name"] for i in payload["items"]) == ["CRM", "ERP", "Lone"]


async def test_related_capabilities_carry_their_ancestors(db, env):
    payload = await _payload(db, env["admin"], env["app_type"])
    caps = {m["name"]: m for m in payload["groupable_types"]["BusinessCapability"]}
    assert caps["Shipping"] == {
        "id": str(env["leaf"].id),
        "name": "Shipping",
        "type": "BusinessCapability",
        "parent_id": str(env["mid"].id),
    }
    # The chain up to the root is there so a parent pick can cover its children.
    assert caps["Fulfilment"] == {
        "id": str(env["mid"].id),
        "name": "Fulfilment",
        "type": "BusinessCapability",
        "parent_id": str(env["root"].id),
        "ancestor_only": True,
    }
    assert caps["Operations"] == {
        "id": str(env["root"].id),
        "name": "Operations",
        "type": "BusinessCapability",
        "parent_id": None,
        "ancestor_only": True,
    }
    # An archived parent is not loaded; an unrestricted reader keeps the
    # dangling pointer (the client files such a member as a root).
    assert "Former" not in caps
    assert caps["Orphaned"]["parent_id"] == str(env["former"].id)
    # The portfolio's own cards are members too (a self-pair reaches them),
    # each with its own parent.
    apps = {m["name"]: m for m in payload["groupable_types"]["Application"]}
    assert apps["CRM"] == {
        "id": str(env["crm"].id),
        "name": "CRM",
        "type": "Application",
        "parent_id": str(env["erp"].id),
    }
    assert apps["ERP"]["parent_id"] is None
    assert "Gone" not in apps
    # A parent on a type without hierarchy is not walked up.
    assert [m["name"] for m in payload["groupable_types"]["Initiative"]] == ["Program"]
    assert payload["groupable_types"]["Initiative"][0]["parent_id"] == str(env["program"].parent_id)


async def test_tags_and_the_tag_groups_that_apply_to_the_type(db, env):
    payload = await _payload(db, env["admin"], env["app_type"])
    assert _item(payload, "ERP")["tag_ids"] == [str(env["in_house"].id)]
    # Groups and tags come back by name, whatever order they were made in.
    assert [g["name"] for g in payload["tag_groups"]] == ["Audit", "Origin"]
    origin = payload["tag_groups"][1]
    assert origin == {
        "id": str(env["origin_group"].id),
        "name": "Origin",
        "mode": "multi",
        "tags": [
            {"id": str(env["bought"].id), "name": "Bought", "color": None},
            {"id": str(env["in_house"].id), "name": "Internally Developed", "color": "#123456"},
        ],
    }


async def test_a_hidden_card_type_offers_no_filter_options(db, env):
    payload = await _payload(db, env["admin"], env["app_type"])
    assert "Retired" not in payload["groupable_types"]
    assert {rt["key"] for rt in payload["relation_types"]} == {
        "relAppToBC",
        "relInitToApp",
        "relAppToApp",
        "relAppToRetired",
        "relAppToOrg",
        "relOrgToApp",
    }
    org = next(rt for rt in payload["relation_types"] if rt["key"] == "relOrgToApp")
    assert org == {
        "key": "relOrgToApp",
        "label": "uses",
        "reverse_label": "is used by",
        "source_type_key": "Organization",
        "target_type_key": "Application",
        "other_type_key": "Organization",
        "translations": {"de": {"label": "nutzt"}},
        "attributes_schema": [{"key": "usageType", "label": "Usage", "type": "single_select"}],
    }
    assert payload["fields_schema"] == []


async def test_the_legacy_organisation_filter(db, env):
    payload = await _payload(db, env["admin"], env["app_type"])
    assert payload["organizations"] == [
        {"id": str(env["alpha"].id), "name": "Alpha Org"},
        {"id": str(env["zeta"].id), "name": "Zeta Org"},
    ]
    # Both sides count, sorted; the archived organisation is on neither list.
    assert _item(payload, "ERP")["org_ids"] == sorted([str(env["zeta"].id), str(env["alpha"].id)])
    assert _item(payload, "CRM")["org_ids"] == []


async def test_a_reports_only_role_reads_everything_in_module_mode(db, env):
    """No ``inventory.view`` and no View cells: module mode is the whole
    landscape, where inventory mode would be nothing."""
    payload = await _payload(db, env["reports_only"], env["app_type"])
    # Membership, not order: the items query has no ORDER BY, so the heap order a
    # sequential scan returns depends on what ran before in the same worker.
    assert sorted(i["name"] for i in payload["items"]) == ["CRM", "ERP", "Lone"]
    assert {rt["key"] for rt in payload["relation_types"]} == {
        "relAppToBC",
        "relInitToApp",
        "relAppToApp",
        "relAppToRetired",
        "relAppToOrg",
        "relOrgToApp",
    }
    assert set(payload["groupable_types"]) == {
        "Application",
        "BusinessCapability",
        "Initiative",
        "Organization",
    }
    assert len(payload["organizations"]) == 2
    # Unrestricted in module mode, so a dangling parent pointer is kept.
    caps = {m["name"]: m for m in payload["groupable_types"]["BusinessCapability"]}
    assert caps["Orphaned"]["parent_id"] == str(env["former"].id)


async def test_a_reader_denied_the_type_itself_gets_no_cards(db, env):
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    ct.role_permissions = {"viewer": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    try:
        payload = await _payload(db, env["viewer"], env["app_type"])
    finally:
        PermissionService.invalidate_type_permission_cache()
    assert payload["items"] == []
    assert payload["groupable_types"] == {}


async def test_a_type_the_reader_may_not_see_is_left_out(db, env):
    ct = (await db.execute(select(CardType).where(CardType.key == "Initiative"))).scalar_one()
    ct.role_permissions = {"viewer": {"inventory.view": False}}
    org_ct = (await db.execute(select(CardType).where(CardType.key == "Organization"))).scalar_one()
    org_ct.role_permissions = {"viewer": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    try:
        payload = await _payload(db, env["viewer"], env["app_type"])
    finally:
        PermissionService.invalidate_type_permission_cache()
    # The legacy organisation list honours the deny as well.
    assert payload["organizations"] == []
    assert _item(payload, "ERP")["org_ids"] == []
    erp = _item(payload, "ERP")
    assert all(r["related_type"] != "Initiative" for r in erp["relations"])
    assert "Initiative" not in payload["groupable_types"]
    assert all(rt["other_type_key"] != "Initiative" for rt in payload["relation_types"])
    # A restricted reader never sees a pointer to a card that was not loaded —
    # the archived parent is scrubbed — while an intact chain keeps its parents.
    caps = {m["name"]: m for m in payload["groupable_types"]["BusinessCapability"]}
    assert caps["Orphaned"]["parent_id"] is None
    assert caps["Shipping"]["parent_id"] == str(env["mid"].id)
    assert caps["Fulfilment"]["parent_id"] == str(env["root"].id)
    assert caps["Operations"]["parent_id"] is None
