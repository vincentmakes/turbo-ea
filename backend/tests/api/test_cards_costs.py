"""Integration tests: cost field stripping on /cards endpoints.

Confirms that:
- A user without costs.view sees no cost fields in card responses.
- A stakeholder role on the card changes nothing: neither the owner of a card
  nor someone who made themselves its Observer sees its costs without
  costs.view (#1412).
- A user with costs.view sees all costs.
- PATCH from a user without cost access drops cost keys silently — they cannot
  blank or change a cost they were not allowed to see.
"""

from __future__ import annotations

import pytest

from app.core.permissions import (
    MEMBER_PERMISSIONS,
    OBSERVER_CARD_PERMISSIONS,
    RESPONSIBLE_CARD_PERMISSIONS,
    VIEWER_PERMISSIONS,
)
from app.models.stakeholder import Stakeholder
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)


@pytest.fixture
async def cost_env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
    await create_card_type(
        db,
        key="Application",
        fields_schema=[
            {
                "section": "Costs",
                "fields": [
                    {"key": "costTotalAnnual", "type": "cost", "weight": 1},
                    {"key": "name2", "type": "text", "weight": 1},
                ],
            }
        ],
    )

    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    member = await create_user(db, email="member@test.com", role="member")
    card = await create_card(
        db,
        card_type="Application",
        name="App1",
        attributes={"costTotalAnnual": 1234, "name2": "x"},
    )
    other_card = await create_card(
        db,
        card_type="Application",
        name="App2",
        attributes={"costTotalAnnual": 5678, "name2": "y"},
    )
    return {
        "admin": admin,
        "viewer": viewer,
        "member": member,
        "card": card,
        "other_card": other_card,
    }


class TestGetCardCostStripping:
    async def test_admin_sees_cost(self, client, db, cost_env):
        r = await client.get(
            f"/api/v1/cards/{cost_env['card'].id}",
            headers=auth_headers(cost_env["admin"]),
        )
        assert r.status_code == 200
        assert r.json()["attributes"].get("costTotalAnnual") == 1234

    async def test_member_sees_cost_via_app_perm(self, client, db, cost_env):
        # MEMBER_PERMISSIONS grants costs.view by default in this release.
        r = await client.get(
            f"/api/v1/cards/{cost_env['card'].id}",
            headers=auth_headers(cost_env["member"]),
        )
        assert r.status_code == 200
        assert r.json()["attributes"].get("costTotalAnnual") == 1234

    async def test_viewer_does_not_see_cost(self, client, db, cost_env):
        r = await client.get(
            f"/api/v1/cards/{cost_env['card'].id}",
            headers=auth_headers(cost_env["viewer"]),
        )
        assert r.status_code == 200
        attrs = r.json()["attributes"]
        assert "costTotalAnnual" not in attrs
        assert attrs.get("name2") == "x"  # non-cost fields still present

    async def test_a_stakeholder_without_costs_view_does_not_see_cost(self, client, db, cost_env):
        # Owning a card is not a grant of its costs: `costs.view` alone decides.
        await create_stakeholder_role_def(
            db, key="responsible", permissions=RESPONSIBLE_CARD_PERMISSIONS
        )
        db.add(
            Stakeholder(
                card_id=cost_env["card"].id, user_id=cost_env["viewer"].id, role="responsible"
            )
        )
        await db.flush()

        r = await client.get(
            f"/api/v1/cards/{cost_env['card'].id}",
            headers=auth_headers(cost_env["viewer"]),
        )
        assert r.status_code == 200
        attrs = r.json()["attributes"]
        assert "costTotalAnnual" not in attrs
        assert attrs.get("name2") == "x"


class TestObservingDoesNotRevealCosts:
    """#1412: a member whose role lost `costs.view` clicked "Observe this card"
    and saw its costs. Anyone who can view a card may make themselves its
    Observer, so a stakeholder role must never stand in for the permission."""

    @pytest.fixture
    async def no_cost_member(self, db, cost_env):
        await create_role(
            db,
            key="member_without_costs",
            permissions={**MEMBER_PERMISSIONS, "costs.view": False},
        )
        await create_stakeholder_role_def(
            db, key="observer", label="Observer", permissions=OBSERVER_CARD_PERMISSIONS
        )
        return await create_user(db, email="nocost@test.com", role="member_without_costs")

    async def _observe(self, client, card, user):
        r = await client.post(f"/api/v1/cards/{card.id}/me/observe", headers=auth_headers(user))
        assert r.status_code == 201, r.text
        assert r.json()["role"] == "observer"

    async def test_card_detail_keeps_the_cost_hidden(self, client, db, cost_env, no_cost_member):
        await self._observe(client, cost_env["card"], no_cost_member)
        r = await client.get(
            f"/api/v1/cards/{cost_env['card'].id}", headers=auth_headers(no_cost_member)
        )
        assert r.status_code == 200
        attrs = r.json()["attributes"]
        assert "costTotalAnnual" not in attrs
        assert attrs.get("name2") == "x"

    async def test_effective_permissions_say_no_costs(self, client, db, cost_env, no_cost_member):
        await self._observe(client, cost_env["card"], no_cost_member)
        r = await client.get(
            f"/api/v1/cards/{cost_env['card'].id}/my-permissions",
            headers=auth_headers(no_cost_member),
        )
        assert r.status_code == 200
        body = r.json()
        assert body["stakeholder_roles"] == ["observer"]
        assert body["effective"]["can_view_costs"] is False
        assert body["effective"]["can_view"] is True

    async def test_the_list_keeps_the_cost_hidden(self, client, db, cost_env, no_cost_member):
        await self._observe(client, cost_env["card"], no_cost_member)
        r = await client.get("/api/v1/cards?type=Application", headers=auth_headers(no_cost_member))
        assert r.status_code == 200
        items = r.json()["items"]
        assert {i["name"] for i in items} == {"App1", "App2"}
        for item in items:
            assert "costTotalAnnual" not in (item.get("attributes") or {})

    async def test_regranting_costs_view_shows_the_cost(self, client, db, cost_env):
        # The same observer with the permission: it is the role, not the
        # stakeholder row, that decides either way.
        await create_stakeholder_role_def(
            db, key="observer", label="Observer", permissions=OBSERVER_CARD_PERMISSIONS
        )
        await self._observe(client, cost_env["card"], cost_env["member"])
        r = await client.get(
            f"/api/v1/cards/{cost_env['card'].id}", headers=auth_headers(cost_env["member"])
        )
        assert r.json()["attributes"].get("costTotalAnnual") == 1234


class TestListCostStripping:
    async def test_viewer_list_strips_costs(self, client, db, cost_env):
        r = await client.get(
            "/api/v1/cards?type=Application",
            headers=auth_headers(cost_env["viewer"]),
        )
        assert r.status_code == 200
        for item in r.json()["items"]:
            assert "costTotalAnnual" not in (item.get("attributes") or {})


class TestPatchDropsCostsWhenForbidden:
    async def test_editor_without_cost_access_cannot_blank_cost(self, client, db, cost_env):
        # An editor through the app role alone, without costs.view.
        await create_role(
            db,
            key="non_cost_editor",
            permissions={
                "inventory.view": True,
                "inventory.edit": True,
                "costs.view": False,
            },
        )
        editor = await create_user(db, email="editor@test.com", role="non_cost_editor")

        # Sanity: editor sees the cost stripped on GET
        r0 = await client.get(
            f"/api/v1/cards/{cost_env['card'].id}",
            headers=auth_headers(editor),
        )
        assert "costTotalAnnual" not in r0.json()["attributes"]

        # PATCH attempting to blank the cost they cannot see
        r = await client.patch(
            f"/api/v1/cards/{cost_env['card'].id}",
            json={"attributes": {"costTotalAnnual": None, "name2": "updated"}},
            headers=auth_headers(editor),
        )
        assert r.status_code == 200, r.text

        # Confirm via admin that the cost was preserved and name2 was updated
        ar = await client.get(
            f"/api/v1/cards/{cost_env['card'].id}",
            headers=auth_headers(cost_env["admin"]),
        )
        assert ar.json()["attributes"].get("costTotalAnnual") == 1234
        assert ar.json()["attributes"].get("name2") == "updated"

    async def test_a_stakeholder_editor_without_costs_view_cannot_change_cost(
        self, client, db, cost_env
    ):
        # Edit rights through a stakeholder role, no costs.view: the edit goes
        # through, the cost they cannot see stays what it was.
        await create_stakeholder_role_def(
            db,
            key="full_editor",
            label="Full Editor",
            permissions={"card.view": True, "card.edit": True},
        )
        db.add(
            Stakeholder(
                card_id=cost_env["card"].id, user_id=cost_env["viewer"].id, role="full_editor"
            )
        )
        await db.flush()

        r = await client.patch(
            f"/api/v1/cards/{cost_env['card'].id}",
            json={"attributes": {"costTotalAnnual": 9999, "name2": "z"}},
            headers=auth_headers(cost_env["viewer"]),
        )
        assert r.status_code == 200, r.text
        assert "costTotalAnnual" not in r.json()["attributes"]
        assert r.json()["attributes"].get("name2") == "z"

        ar = await client.get(
            f"/api/v1/cards/{cost_env['card'].id}",
            headers=auth_headers(cost_env["admin"]),
        )
        assert ar.json()["attributes"].get("costTotalAnnual") == 1234
        assert ar.json()["attributes"].get("name2") == "z"

    async def test_a_stakeholder_editor_with_costs_view_changes_cost(self, client, db, cost_env):
        await create_stakeholder_role_def(
            db,
            key="full_editor",
            label="Full Editor",
            permissions={"card.view": True, "card.edit": True},
        )
        await create_role(
            db, key="cost_reader", permissions={"inventory.view": True, "costs.view": True}
        )
        reader = await create_user(db, email="reader@test.com", role="cost_reader")
        db.add(Stakeholder(card_id=cost_env["card"].id, user_id=reader.id, role="full_editor"))
        await db.flush()

        r = await client.patch(
            f"/api/v1/cards/{cost_env['card'].id}",
            json={"attributes": {"costTotalAnnual": 9999, "name2": "z"}},
            headers=auth_headers(reader),
        )
        assert r.status_code == 200, r.text
        assert r.json()["attributes"].get("costTotalAnnual") == 9999
