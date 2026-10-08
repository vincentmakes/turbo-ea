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
