"""A public portal returns only what its page shows.

The portal admin hides fields, built-in properties and relation types with
``card_config.toggles``. Those toggles used to be applied by the page alone:
the public card endpoint sent every card whole to anonymous visitors, so a
hidden field was still in the JSON. These tests call the public endpoints
without a session, exactly as a visitor would.

Integration tests requiring a PostgreSQL test database.
"""

from __future__ import annotations

import json

import pytest

from app.models.stakeholder import Stakeholder
from app.models.tag import CardTag, Tag, TagGroup
from app.models.web_portal import WebPortal
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)

BASE = "/api/v1/web-portals/public/apps"

APP_SCHEMA = [
    {
        "section": "Main",
        "fields": [
            {"key": "shownField", "label": "Shown", "type": "text"},
            {"key": "hiddenField", "label": "Hidden", "type": "text"},
            {"key": "third", "label": "Third", "type": "text"},
            {"key": "costTotalAnnual", "label": "Cost", "type": "cost"},
            {"key": "fourth", "label": "Fourth", "type": "text"},
        ],
    }
]

OFF = {"card": False, "detail": False}

TOGGLES = {
    "field:hiddenField": OFF,
    "description": OFF,
    "tags": OFF,
    "subscribers": OFF,
    "data_quality": OFF,
    "rel:app_to_itc": {"card": True, "detail": False},
    "rel:app_to_vault": {"card": True, "detail": True},
}


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application", fields_schema=APP_SCHEMA)
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_card_type(db, key="Organization", label="Organization")
    await create_card_type(db, key="Vault", label="Vault", is_hidden=True)
    await create_relation_type(
        db, key="app_to_itc", source_type_key="Application", target_type_key="ITComponent"
    )
    await create_relation_type(
        db, key="org_to_app", source_type_key="Organization", target_type_key="Application"
    )
    # Toggled on, but its other end is a hidden card type: never shown.
    await create_relation_type(
        db, key="app_to_vault", source_type_key="Application", target_type_key="Vault"
    )

    crm = await create_card(
        db,
        card_type="Application",
        name="CRM",
        user_id=admin.id,
        description="Customer relationship management",
        lifecycle={"active": "2024-01-01"},
        data_quality=90.0,
        attributes={
            "shownField": "visible value",
            "hiddenField": "secret",
            "third": "3",
            "fourth": "4",
            "costTotalAnnual": 1000,
            "notInSchema": "orphan",
        },
    )
    erp = await create_card(
        db,
        card_type="Application",
        name="ERP",
        user_id=admin.id,
        data_quality=10.0,
        attributes={"hiddenField": "other"},
    )
    server = await create_card(db, card_type="ITComponent", name="Server", user_id=admin.id)
    retired = await create_card(
        db, card_type="ITComponent", name="Retired Server", user_id=admin.id, status="ARCHIVED"
    )
    sales = await create_card(db, card_type="Organization", name="Sales", user_id=admin.id)
    vault = await create_card(db, card_type="Vault", name="Vault 1", user_id=admin.id)
    await create_relation(db, type_key="app_to_itc", source_id=crm.id, target_id=server.id)
    await create_relation(db, type_key="app_to_itc", source_id=crm.id, target_id=retired.id)
    await create_relation(db, type_key="org_to_app", source_id=sales.id, target_id=crm.id)
    await create_relation(db, type_key="app_to_vault", source_id=crm.id, target_id=vault.id)

    group = TagGroup(name="Domain")
    db.add(group)
    await db.flush()
    tag = Tag(tag_group_id=group.id, name="Finance")
    db.add(tag)
    await db.flush()
    db.add(CardTag(card_id=crm.id, tag_id=tag.id))
    db.add(Stakeholder(card_id=crm.id, user_id=admin.id, role="responsible"))

    portal = WebPortal(
        name="Apps",
        slug="apps",
        card_type="Application",
        is_published=True,
        created_by=admin.id,
        card_config={"toggles": TOGGLES},
    )
    db.add(portal)
    await db.flush()
    return {"crm": crm, "erp": erp, "server": server, "sales": sales, "portal": portal}


async def _cards(client, query: str = "") -> dict:
    resp = await client.get(f"{BASE}/cards{query}")
    assert resp.status_code == 200
    return resp.json()


def _by_name(data: dict, name: str) -> dict:
    return next(item for item in data["items"] if item["name"] == name)


class TestHiddenValuesAreNotSent:
    async def test_hidden_field_is_absent_and_shown_fields_remain(self, client, env):
        crm = _by_name(await _cards(client), "CRM")
        assert crm["attributes"] == {"shownField": "visible value", "third": "3", "fourth": "4"}

    async def test_hidden_built_ins_are_blanked(self, client, env):
        crm = _by_name(await _cards(client), "CRM")
        assert crm["description"] is None
        assert crm["tags"] == []
        assert crm["stakeholders"] == []
        assert crm["data_quality"] is None

    async def test_built_ins_left_on_are_sent(self, client, env):
        crm = _by_name(await _cards(client), "CRM")
        assert crm["lifecycle"] == {"active": "2024-01-01"}
        assert crm["approval_status"] == "DRAFT"

    async def test_only_visible_relation_types_to_active_cards_are_sent(self, client, env):
        crm = _by_name(await _cards(client), "CRM")
        assert [(r["type"], r["related_name"]) for r in crm["relations"]] == [
            ("app_to_itc", "Server")
        ]


class TestHiddenValuesCannotBeProbed:
    async def test_attr_filter_on_a_hidden_field_is_ignored(self, client, env):
        probe = json.dumps({"hiddenField": "secret"})
        assert (await _cards(client, f"?attr_filters={probe}"))["total"] == 2

    async def test_attr_filter_on_a_shown_field_still_filters(self, client, env):
        filters = json.dumps({"shownField": "visible value"})
        data = await _cards(client, f"?attr_filters={filters}")
        assert [item["name"] for item in data["items"]] == ["CRM"]

    async def test_relation_filter_on_a_hidden_relation_type_is_ignored(self, client, env):
        probe = json.dumps({"org_to_app": str(env["sales"].id)})
        assert (await _cards(client, f"?relation_filters={probe}"))["total"] == 2

    async def test_legacy_related_filter_on_a_hidden_relation_type_is_ignored(self, client, env):
        query = f"?related_type=org_to_app&related_id={env['sales'].id}"
        assert (await _cards(client, query))["total"] == 2

    async def test_relation_filter_on_a_visible_relation_type_still_filters(self, client, env):
        filters = json.dumps({"app_to_itc": str(env["server"].id)})
        data = await _cards(client, f"?relation_filters={filters}")
        assert [item["name"] for item in data["items"]] == ["CRM"]

    async def test_sorting_by_a_hidden_property_falls_back_to_name(self, client, env):
        data = await _cards(client, "?sort_by=data_quality&sort_dir=desc")
        # By data quality, descending, CRM (90) would come first; by name,
        # descending, ERP does.
        assert [item["name"] for item in data["items"]] == ["ERP", "CRM"]


class TestRelationOptions:
    async def test_lists_cards_of_a_visible_relation_type(self, client, env):
        resp = await client.get(f"{BASE}/relation-options?type_key=ITComponent")
        assert resp.status_code == 200
        assert [o["name"] for o in resp.json()] == ["Server"]

    async def test_is_empty_for_a_type_reached_only_through_a_hidden_relation(self, client, env):
        resp = await client.get(f"{BASE}/relation-options?type_key=Organization")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_is_empty_for_a_hidden_card_type(self, client, env):
        resp = await client.get(f"{BASE}/relation-options?type_key=Vault")
        assert resp.status_code == 200
        assert resp.json() == []


class TestUntoggledPortal:
    """A portal whose admin never touched the toggles shows every field and
    built-in property, and no relations."""

    async def test_defaults(self, client, db, env):
        env["portal"].card_config = {}
        await db.flush()
        crm = _by_name(await _cards(client), "CRM")
        assert set(crm["attributes"]) == {"shownField", "hiddenField", "third", "fourth"}
        assert crm["description"] == "Customer relationship management"
        assert [t["name"] for t in crm["tags"]] == ["Finance"]
        assert len(crm["stakeholders"]) == 1
        assert crm["data_quality"] == 90.0
        assert crm["relations"] == []

    async def test_relation_options_are_empty(self, client, db, env):
        env["portal"].card_config = None
        await db.flush()
        resp = await client.get(f"{BASE}/relation-options?type_key=ITComponent")
        assert resp.json() == []


class TestWhichRelationTypesAPortalCanShow:
    """The relation types a toggle can switch on are the ones the portal page
    offers: not hidden, touching the portal's card type at either end."""

    @staticmethod
    async def _toggle(db, env, **extra):
        env["portal"].card_config = {"toggles": {**TOGGLES, **extra}}
        await db.flush()

    async def test_an_incoming_relation_type_is_sent_when_shown(self, client, db, env):
        # Application is the TARGET of org_to_app: the other end is Organization.
        await self._toggle(db, env, **{"rel:org_to_app": {"card": False, "detail": True}})
        crm = _by_name(await _cards(client), "CRM")
        assert sorted((r["type"], r["related_name"]) for r in crm["relations"]) == [
            ("app_to_itc", "Server"),
            ("org_to_app", "Sales"),
        ]
        resp = await client.get(f"{BASE}/relation-options?type_key=Organization")
        assert [o["name"] for o in resp.json()] == ["Sales"]

    async def test_a_hidden_relation_type_is_never_sent(self, client, db, env):
        await create_relation_type(
            db,
            key="app_secret_org",
            source_type_key="Application",
            target_type_key="Organization",
            is_hidden=True,
        )
        await create_relation(
            db, type_key="app_secret_org", source_id=env["crm"].id, target_id=env["sales"].id
        )
        await self._toggle(db, env, **{"rel:app_secret_org": {"card": True, "detail": True}})
        crm = _by_name(await _cards(client), "CRM")
        assert "app_secret_org" not in {r["type"] for r in crm["relations"]}
        resp = await client.get(f"{BASE}/relation-options?type_key=Organization")
        assert resp.json() == []

    async def test_a_filter_on_a_type_that_never_touches_the_portal_type_is_ignored(
        self, client, db, env
    ):
        await create_relation_type(
            db, key="itc_to_org", source_type_key="ITComponent", target_type_key="Organization"
        )
        await self._toggle(db, env, **{"rel:itc_to_org": {"card": True, "detail": True}})
        probe = json.dumps({"itc_to_org": str(env["server"].id)})
        assert (await _cards(client, f"?relation_filters={probe}"))["total"] == 2

    async def test_a_self_referencing_type_is_shown_from_both_ends(self, client, db, env):
        admin_id = env["portal"].created_by
        await create_card_type(db, key="Capability", label="Capability")
        await create_relation_type(
            db, key="cap_depends", source_type_key="Capability", target_type_key="Capability"
        )
        billing = await create_card(db, card_type="Capability", name="Billing", user_id=admin_id)
        invoicing = await create_card(
            db, card_type="Capability", name="Invoicing", user_id=admin_id
        )
        await create_relation(
            db, type_key="cap_depends", source_id=billing.id, target_id=invoicing.id
        )
        db.add(
            WebPortal(
                name="Caps",
                slug="caps",
                card_type="Capability",
                is_published=True,
                created_by=admin_id,
                card_config={"toggles": {"rel:cap_depends": {"card": True, "detail": True}}},
            )
        )
        await db.flush()

        resp = await client.get("/api/v1/web-portals/public/caps/cards")
        assert resp.status_code == 200
        related = {
            item["name"]: [r["related_name"] for r in item["relations"]]
            for item in resp.json()["items"]
        }
        assert related == {"Billing": ["Invoicing"], "Invoicing": ["Billing"]}
        options = await client.get(
            "/api/v1/web-portals/public/caps/relation-options?type_key=Capability"
        )
        assert sorted(o["name"] for o in options.json()) == ["Billing", "Invoicing"]


# ---------------------------------------------------------------------------
# Visitor filters (#1425)
# ---------------------------------------------------------------------------

PRODUCTS = "/api/v1/web-portals/public/products"

PRODUCT_SCHEMA = [
    {
        "section": "Main",
        "fields": [
            {
                "key": "tier",
                "label": "Tier",
                "type": "single_select",
                "options": [{"key": "gold"}, {"key": "silver"}],
            },
            {
                "key": "regions",
                "label": "Regions",
                "type": "multiple_select",
                "options": [{"key": "eu"}, {"key": "us"}],
            },
            {"key": "code", "label": "Code", "type": "text"},
            {"key": "size", "label": "Size", "type": "number"},
            {"key": "since", "label": "Since", "type": "date"},
            {"key": "secret", "label": "Secret", "type": "text"},
            {"key": "budget", "label": "Budget", "type": "cost"},
        ],
    }
]

PRODUCT_TOGGLES = {
    "field:secret": OFF,
    "rel:prod_to_org": {"card": True, "detail": True},
}


@pytest.fixture
async def products(db):
    """Three products, a portal showing every field but ``secret`` (and never
    the cost field), the tags and one relation type to Organization."""
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(
        db,
        key="Product",
        label="Product",
        fields_schema=PRODUCT_SCHEMA,
        subtypes=[{"key": "hw", "label": "Hardware"}, {"key": "sw", "label": "Software"}],
    )
    await create_card_type(db, key="Organization", label="Organization")
    await create_relation_type(
        db, key="prod_to_org", source_type_key="Product", target_type_key="Organization"
    )
    p1 = await create_card(
        db,
        card_type="Product",
        name="P1",
        user_id=admin.id,
        subtype="hw",
        attributes={
            "tier": "gold",
            "regions": ["eu", "us"],
            "code": "ORG-1",
            "size": 10,
            "since": "2024-01-15",
            "secret": "s1",
            "budget": 100,
        },
    )
    p2 = await create_card(
        db,
        card_type="Product",
        name="P2",
        user_id=admin.id,
        subtype="sw",
        attributes={
            "tier": "silver",
            "regions": "eu",
            "code": "ORG-2",
            "size": 50,
            "since": "2025-06-01",
            "secret": "s2",
            "budget": 900,
        },
    )
    await create_card(db, card_type="Product", name="P3", user_id=admin.id)
    sales = await create_card(db, card_type="Organization", name="Sales", user_id=admin.id)
    await create_relation(db, type_key="prod_to_org", source_id=p1.id, target_id=sales.id)
    group = TagGroup(name="Domain")
    db.add(group)
    await db.flush()
    finance = Tag(tag_group_id=group.id, name="Finance")
    other = Tag(tag_group_id=group.id, name="Other")
    db.add_all([finance, other])
    await db.flush()
    db.add(CardTag(card_id=p1.id, tag_id=finance.id))
    db.add(CardTag(card_id=p2.id, tag_id=other.id))
    portal = WebPortal(
        name="Products",
        slug="products",
        card_type="Product",
        is_published=True,
        created_by=admin.id,
        card_config={"toggles": dict(PRODUCT_TOGGLES)},
    )
    db.add(portal)
    await db.flush()
    return {
        "portal": portal,
        "p1": p1,
        "p2": p2,
        "sales": sales,
        "finance": finance,
        "other": other,
    }


async def _filtered(client, filters: dict | None = None, **params) -> dict:
    if filters is not None:
        params["filters"] = json.dumps(filters)
    resp = await client.get(f"{PRODUCTS}/cards", params=params)
    assert resp.status_code == 200
    return resp.json()


def _names(data: dict) -> list[str]:
    return sorted(item["name"] for item in data["items"])


async def _configure(db, products, **card_config) -> None:
    products["portal"].card_config = {"toggles": dict(PRODUCT_TOGGLES), **card_config}
    await db.flush()


class TestVisitorFiltersPerKind:
    async def test_nothing_set_lists_everything(self, client, products):
        assert (await _filtered(client))["total"] == 3

    async def test_a_facet_takes_several_values(self, client, products):
        data = await _filtered(client, {"attrFilters": {"tier": ["gold", "silver"]}})
        assert _names(data) == ["P1", "P2"]
        assert data["total"] == 2

    async def test_a_multiple_select_matches_one_value_among_several(self, client, products):
        data = await _filtered(client, {"attrFilters": {"regions": ["us"]}})
        assert _names(data) == ["P1"]

    async def test_empty_matches_no_value(self, client, products):
        data = await _filtered(client, {"attrFilters": {"tier": ["__empty__"]}})
        assert _names(data) == ["P3"]

    async def test_text_contains(self, client, products):
        data = await _filtered(client, {"attrConditions": {"code": {"contains": "org-2"}}})
        assert _names(data) == ["P2"]

    async def test_number_range(self, client, products):
        data = await _filtered(client, {"attrConditions": {"size": {"min": 20}}})
        assert _names(data) == ["P2"]
        data = await _filtered(client, {"attrConditions": {"size": {"min": 10, "max": 10}}})
        assert _names(data) == ["P1"]

    async def test_date_range(self, client, products):
        data = await _filtered(client, {"attrConditions": {"since": {"from": "2025-01-01"}}})
        assert _names(data) == ["P2"]

    async def test_subtype(self, client, products):
        assert _names(await _filtered(client, {"subtypeFilters": ["hw"]})) == ["P1"]
        assert _names(await _filtered(client, {"subtypeFilters": ["__empty__"]})) == ["P3"]

    async def test_tags(self, client, products):
        data = await _filtered(client, {"tagFilterIds": [str(products["finance"].id)]})
        assert _names(data) == ["P1"]

    async def test_relation(self, client, products):
        data = await _filtered(
            client, {"relationFilters": {"prod_to_org": [str(products["sales"].id)]}}
        )
        assert _names(data) == ["P1"]
        data = await _filtered(client, {"relationFilters": {"prod_to_org": ["__empty__"]}})
        assert _names(data) == ["P2", "P3"]


class TestVisitorFiltersCannotProbe:
    async def test_an_unpublished_field_changes_nothing(self, client, products):
        for filters in (
            {"attrFilters": {"secret": ["s1"]}},
            {"attrConditions": {"secret": {"contains": "s1"}}},
        ):
            data = await _filtered(client, filters)
            assert data["total"] == 3
            assert _names(data) == ["P1", "P2", "P3"]
        assert (await _filtered(client, attr_filters='{"secret": "s1"}'))["total"] == 3

    async def test_a_cost_field_changes_nothing(self, client, products):
        for filters in (
            {"attrConditions": {"budget": {"min": 500}}},
            {"attrFilters": {"budget": ["100"]}},
        ):
            assert (await _filtered(client, filters))["total"] == 3
        assert (await _filtered(client, attr_filters='{"budget": 100}'))["total"] == 3

    async def test_with_adding_off_an_unlisted_field_changes_nothing(self, client, db, products):
        await _configure(
            db, products, visitor_filters=["field:tier"], visitor_can_add_filters=False
        )
        unlisted = await _filtered(client, {"attrConditions": {"code": {"contains": "ORG-2"}}})
        assert unlisted["total"] == 3
        listed = await _filtered(client, {"attrFilters": {"tier": ["gold"]}})
        assert listed["total"] == 1
        assert (await _filtered(client, {"subtypeFilters": ["hw"]}))["total"] == 3

    async def test_with_adding_on_an_unlisted_field_filters(self, client, db, products):
        await _configure(db, products, visitor_filters=["field:tier"])
        data = await _filtered(client, {"attrConditions": {"code": {"contains": "ORG-2"}}})
        assert data["total"] == 1

    async def test_a_visitor_filter_cannot_widen_the_preset(self, client, db, products):
        products["portal"].filters = {"card_filters": {"subtypeFilters": ["hw"]}}
        await db.flush()
        assert (await _filtered(client, {"subtypeFilters": ["sw"]}))["total"] == 0
        both = await _filtered(client, {"subtypeFilters": ["hw", "sw", "__empty__"]})
        assert _names(both) == ["P1"]
        assert (await _filtered(client, subtype="sw"))["total"] == 0


class TestHiddenTags:
    async def test_tags_are_neither_published_nor_filterable(self, client, db, products):
        await _configure(db, products, toggles={**PRODUCT_TOGGLES, "tags": OFF})
        meta = (await client.get(PRODUCTS)).json()
        assert meta["tag_groups"] == []
        assert "tags" not in meta["visitor_filters"]["allowed"]
        assert "Finance" not in json.dumps(meta)
        finance = str(products["finance"].id)
        assert (await _filtered(client, {"tagFilterIds": [finance]}))["total"] == 3
        assert (await _filtered(client, tag_ids=finance))["total"] == 3

    async def test_shown_tags_are_published(self, client, products):
        meta = (await client.get(PRODUCTS)).json()
        assert [g["name"] for g in meta["tag_groups"]] == ["Domain"]


class TestMalformedInputAnswers200:
    async def test_malformed_ids(self, client, products):
        assert (await _filtered(client, tag_ids="nope,also-not"))["total"] == 3
        assert (await _filtered(client, related_type="prod_to_org", related_id="nope"))[
            "total"
        ] == 3
        bad_rel = {"relationFilters": {"prod_to_org": ["nope"]}, "tagFilterIds": ["nope"]}
        assert (await _filtered(client, bad_rel))["total"] == 3
        rel = json.dumps({"prod_to_org": "nope"})
        assert (await _filtered(client, relation_filters=rel))["total"] == 3

    async def test_malformed_filters(self, client, products):
        for raw in ("not json", "[1]", '{"attrConditions": {"size": {"min": "x"}}}'):
            resp = await client.get(f"{PRODUCTS}/cards", params={"filters": raw})
            assert resp.status_code == 200
            assert resp.json()["total"] == 3


class TestLegacyParameters:
    async def test_a_legacy_multiple_select_filter_now_matches(self, client, products):
        """Regression: ``attr_filters`` compared the stored list's text with
        the value, so a multiple-select filter never matched a card."""
        data = await _filtered(client, attr_filters=json.dumps({"regions": "us"}))
        assert _names(data) == ["P1"]

    async def test_legacy_tag_ids_match_any(self, client, products):
        ids = f"{products['finance'].id},{products['other'].id}"
        assert _names(await _filtered(client, tag_ids=ids)) == ["P1", "P2"]

    async def test_new_and_legacy_parameters_both_apply(self, client, products):
        data = await _filtered(client, {"subtypeFilters": ["hw", "sw"]}, subtype="sw")
        assert _names(data) == ["P2"]
        data = await _filtered(client, {"subtypeFilters": ["hw"]}, subtype="sw")
        assert data["total"] == 0


class TestVisitorFilterMetadata:
    async def test_the_default_lists(self, client, products):
        meta = (await client.get(PRODUCTS)).json()
        assert meta["visitor_filters"] == {
            "shown": ["subtype", "tags", "field:tier", "field:regions", "rel:prod_to_org"],
            "allowed": [
                "subtype",
                "tags",
                "field:tier",
                "field:regions",
                "field:code",
                "field:size",
                "field:since",
                "rel:prod_to_org",
            ],
            "can_add": True,
        }

    async def test_the_admins_choice_is_what_the_cards_route_enforces(self, client, db, products):
        await _configure(
            db,
            products,
            visitor_filters=["field:code", "field:secret", "field:budget"],
            visitor_can_add_filters=False,
        )
        meta = (await client.get(PRODUCTS)).json()
        assert meta["visitor_filters"] == {
            "shown": ["field:code"],
            "allowed": ["field:code"],
            "can_add": False,
        }
        assert (await _filtered(client, {"attrConditions": {"code": {"contains": "1"}}}))[
            "total"
        ] == 1
        assert (await _filtered(client, {"attrFilters": {"tier": ["gold"]}}))["total"] == 3
        # Relation filter options follow the same list: none here.
        options = await client.get(f"{PRODUCTS}/relation-options?type_key=Organization")
        assert options.json() == []

    async def test_relation_options_for_an_allowed_relation(self, client, products):
        options = await client.get(f"{PRODUCTS}/relation-options?type_key=Organization")
        assert [o["name"] for o in options.json()] == ["Sales"]
