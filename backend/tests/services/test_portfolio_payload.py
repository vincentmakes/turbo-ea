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
    _relation_entry,
    build_portfolio_payload,
    dated_relations_by_card,
    has_timeline_dates,
    relations_in_effect_now,
    roadmap_from_portfolio,
    roadmap_rows,
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
    assert roadmap_from_portfolio(payload, "Application", {}) == {
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


def _dated_relations() -> list[dict]:
    from tests.relation_windows import WINDOWS

    return [
        {"relation_type": "r", "related_id": name, **({"lifecycle": lc} if lc else {})}
        for name, lc in WINDOWS.items()
    ]


def test_roadmap_view_filters_only_through_relations_in_effect_today():
    # The Lifecycle report has no time travel: a planned or ended relation must
    # match no filter there, and the dates themselves stay behind.
    from tests.relation_windows import COUNTING

    item = {
        "id": "a",
        "name": "Dated",
        "subtype": None,
        "attributes": {},
        "lifecycle": {"active": "2024-01-01"},
        "relations": _dated_relations(),
        "org_ids": [],
        "tag_ids": [],
    }
    payload = {
        "items": [item],
        "fields_schema": [],
        "relation_types": [],
        "groupable_types": {},
        "tag_groups": [],
    }
    kept = roadmap_from_portfolio(payload, "Application", {})["items"][0]["relations"]
    assert sorted(r["related_id"] for r in kept) == COUNTING
    assert {"relation_type": "r", "related_id": "current"} in kept
    assert all("lifecycle" not in r for r in kept)


def _portfolio_item(item_id: str, **over) -> dict:
    return {
        "id": item_id,
        "name": item_id.upper(),
        "subtype": None,
        "attributes": {},
        "lifecycle": {},
        "relations": [],
        "org_ids": [],
        "tag_ids": [],
        **over,
    }


def test_roadmap_view_keeps_an_undated_card_with_dated_relations():
    dated = [{"relation_type": "r", "related_id": "x", "lifecycle": {"active": "2030-01-01"}}]
    payload = {
        "items": [
            _portfolio_item("own", lifecycle={"active": "2024-01-01"}),
            _portfolio_item("rel"),
            _portfolio_item("none"),
            # An empty list is no dated relation.
            _portfolio_item("empty"),
        ],
        "fields_schema": [],
        "relation_types": [],
        "groupable_types": {},
        "tag_groups": [],
    }
    out = roadmap_from_portfolio(payload, "Application", {"rel": dated, "empty": []})
    assert [i["id"] for i in out["items"]] == ["own", "rel"]
    own, rel = out["items"]
    # The key travels only with something in it.
    assert "relation_lifecycles" not in own
    assert rel == {
        "id": "rel",
        "name": "REL",
        "type": "Application",
        "subtype": None,
        "lifecycle": {},
        "attributes": {},
        "relations": [],
        "tag_ids": [],
        "relation_lifecycles": dated,
    }
    # A card with its own dates keeps its dated relations too.
    both = roadmap_from_portfolio(payload, "Application", {"own": dated})["items"][0]
    assert both["id"] == "own"
    assert both["relation_lifecycles"] == dated


def test_roadmap_rows_are_the_drawable_cards_with_costs_stripped():
    from types import SimpleNamespace

    def card(cid, **over):
        base = {
            "id": cid,
            "name": f"Card {cid}",
            "type": "Application",
            "subtype": None,
            "lifecycle": None,
            "attributes": None,
        }
        return SimpleNamespace(**{**base, **over})

    dated = [{"relation_type": "r", "related_id": "x", "lifecycle": {"endOfLife": "2020-01-01"}}]
    cards = [
        card(
            "a",
            subtype="saas",
            lifecycle={"active": "2024-01-01"},
            attributes={"cost": 9, "keep": "y"},
        ),
        card("b"),
        card("c", type="ITComponent"),
        card("d", attributes={"startDate": "2024-01-01", "cost": 3}),
        card("e"),
    ]
    rows = roadmap_rows(cards, {"a": {"cost"}, "d": set()}, {"c": dated, "e": []})
    assert rows == [
        {
            "id": "a",
            "name": "Card a",
            "type": "Application",
            "subtype": "saas",
            "lifecycle": {"active": "2024-01-01"},
            "attributes": {"keep": "y"},
        },
        {
            "id": "c",
            "name": "Card c",
            "type": "ITComponent",
            "subtype": None,
            "lifecycle": {},
            "attributes": {},
            "relation_lifecycles": dated,
        },
        {
            "id": "d",
            "name": "Card d",
            "type": "Application",
            "subtype": None,
            "lifecycle": {},
            # An empty strip set strips nothing.
            "attributes": {"startDate": "2024-01-01", "cost": 3},
        },
    ]
    # The input attributes are not mutated.
    assert cards[0].attributes == {"cost": 9, "keep": "y"}


def test_a_relation_entry_names_every_field_the_reports_read():
    """The exact shape the Portfolio, Capability Map and Lifecycle clients read
    (``app_relations``): a key renamed here is a filter that silently matches
    nothing there."""
    from types import SimpleNamespace

    related = {"id": "c-1", "name": "Sales", "type": "BusinessCapability"}
    dated = SimpleNamespace(
        type="relAppToBC", attributes={"weight": 2}, lifecycle={"active": "2026-01-01"}
    )
    assert _relation_entry(dated, "outgoing", related) == {
        "relation_type": "relAppToBC",
        "direction": "outgoing",
        "related_id": "c-1",
        "related_name": "Sales",
        "related_type": "BusinessCapability",
        "attributes": {"weight": 2},
        "lifecycle": {"active": "2026-01-01"},
    }
    # No attributes reads as an empty object; no dates leave the key out.
    plain = SimpleNamespace(type="relAppToBC", attributes=None, lifecycle={})
    assert _relation_entry(plain, "incoming", related) == {
        "relation_type": "relAppToBC",
        "direction": "incoming",
        "related_id": "c-1",
        "related_name": "Sales",
        "related_type": "BusinessCapability",
        "attributes": {},
    }


def test_relations_in_effect_now_reads_the_given_day():
    from datetime import date

    rels = [
        {"relation_type": "r", "related_id": "x", "lifecycle": {"endOfLife": "2030-06-01"}},
        {"relation_type": "r", "related_id": "y", "lifecycle": {"active": "2030-06-01"}},
        {"relation_type": "r", "related_id": "z"},
    ]
    assert relations_in_effect_now(rels, today=date(2030, 5, 31)) == [
        {"relation_type": "r", "related_id": "x"},
        {"relation_type": "r", "related_id": "z"},
    ]
    assert relations_in_effect_now(rels, today=date(2030, 6, 1)) == [
        {"relation_type": "r", "related_id": "y"},
        {"relation_type": "r", "related_id": "z"},
    ]
    # The input entries are not mutated.
    assert "lifecycle" in rels[0]


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


# ---------------------------------------------------------------------------
# The Lifecycle report's relation sub-rows
# ---------------------------------------------------------------------------


async def test_dated_relations_order_ties_and_the_type_filter(db, env):
    """Sorted by the other card's name, case-insensitively, then relation type,
    direction and id; with a type, listed only on that type's cards."""
    erp, crm, zeta = env["erp"], env["crm"], env["zeta"]
    dates = {"active": "2030-01-01"}
    twin_a = await create_card(db, card_type="Organization", name="twin")
    twin_b = await create_card(db, card_type="Organization", name="Twin")
    for org in (twin_b, twin_a):
        await create_relation(
            db, type_key="relAppToOrg", source_id=erp.id, target_id=org.id, lifecycle=dates
        )
    await create_relation(
        db, type_key="relOrgToApp", source_id=twin_a.id, target_id=erp.id, lifecycle=dates
    )
    await create_relation(
        db, type_key="relAppToOrg", source_id=crm.id, target_id=zeta.id, lifecycle=dates
    )
    # Both ends of a self-pair: CRM is incoming from ERP and outgoing to Lone.
    await create_relation(
        db, type_key="relAppToApp", source_id=crm.id, target_id=env["lone"].id, lifecycle=dates
    )
    # Undated rows (the env's) and an all-blank lifecycle are never listed.
    blank = await create_card(db, card_type="Organization", name="Blank")
    await create_relation(
        db,
        type_key="relAppToOrg",
        source_id=erp.id,
        target_id=blank.id,
        lifecycle={"active": ""},
    )
    scope = await CardReadScope.load(db, env["admin"])

    out = await dated_relations_by_card(db, scope, type_key="Application")
    assert set(out) == {str(erp.id), str(crm.id), str(env["lone"].id)}
    twins = sorted([str(twin_a.id), str(twin_b.id)])
    a_first = twins[0] == str(twin_a.id)
    assert [(e["related_name"], e["relation_type"], e["direction"]) for e in out[str(erp.id)]] == [
        ("twin", "relAppToOrg", "outgoing") if a_first else ("Twin", "relAppToOrg", "outgoing"),
        ("Twin", "relAppToOrg", "outgoing") if a_first else ("twin", "relAppToOrg", "outgoing"),
        ("twin", "relOrgToApp", "incoming"),
    ]
    assert [e["related_id"] for e in out[str(erp.id)][:2]] == twins
    assert [(e["related_name"], e["direction"]) for e in out[str(crm.id)]] == [
        ("Lone", "outgoing"),
        ("Zeta Org", "outgoing"),
    ]
    assert out[str(env["lone"].id)] == [
        {
            "relation_type": "relAppToApp",
            "direction": "incoming",
            "related_id": str(crm.id),
            "related_name": "CRM",
            "related_type": "Application",
            "lifecycle": dates,
        }
    ]

    # Without a type every end is listed; with the Organization type, only theirs.
    every = await dated_relations_by_card(db, scope, type_key=None)
    assert set(every) == {
        str(erp.id),
        str(crm.id),
        str(env["lone"].id),
        str(twin_a.id),
        str(twin_b.id),
        str(zeta.id),
    }
    orgs = await dated_relations_by_card(db, scope, type_key="Organization")
    assert set(orgs) == {str(twin_a.id), str(twin_b.id), str(zeta.id)}
    assert [(e["related_name"], e["direction"]) for e in orgs[str(twin_a.id)]] == [
        ("ERP", "incoming"),
        ("ERP", "outgoing"),
    ]
    assert await dated_relations_by_card(db, scope, type_key="Initiative") == {}


async def test_dated_relations_honour_the_read_scope_on_both_ends(db, env):
    dates = {"endOfLife": "2020-01-01"}
    await create_relation(
        db,
        type_key="relInitToApp",
        source_id=env["program"].id,
        target_id=env["lone"].id,
        lifecycle=dates,
    )
    ct = (await db.execute(select(CardType).where(CardType.key == "Initiative"))).scalar_one()
    ct.role_permissions = {"viewer": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    try:
        viewer_scope = await CardReadScope.load(db, env["viewer"])
        assert await dated_relations_by_card(db, viewer_scope, type_key=None) == {}
        assert await dated_relations_by_card(db, viewer_scope, type_key="Application") == {}
    finally:
        PermissionService.invalidate_type_permission_cache()
    admin_scope = await CardReadScope.load(db, env["admin"])
    out = await dated_relations_by_card(db, admin_scope, type_key=None)
    assert out[str(env["lone"].id)][0]["related_name"] == "Program"
    assert out[str(env["program"].id)][0]["related_name"] == "Lone"
