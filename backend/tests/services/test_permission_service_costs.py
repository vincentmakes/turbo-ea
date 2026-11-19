"""Tests for the costs.view permission rule.

`costs.view` alone decides whether cost fields are shown. A stakeholder role on
the card grants nothing here (#1412): anyone who can view a card can make
themselves its Observer, so a stakeholder exception would let every user past
the permission.
"""

from __future__ import annotations

import uuid

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.stakeholder import Stakeholder
from app.services.permission_service import PermissionService
from tests.conftest import create_card, create_role, create_user


async def _make_stakeholder(db, *, user, card, role="responsible"):
    sh = Stakeholder(card_id=card.id, user_id=user.id, role=role)
    db.add(sh)
    await db.flush()
    return sh


class TestCanViewCosts:
    async def test_admin_wildcard_grants_access(self, db, app_card_type):
        await create_role(db, key="admin", permissions={"*": True})
        user = await create_user(db, role="admin")

        assert await PermissionService.can_view_costs(db, user) is True

    async def test_app_perm_grants_access(self, db, app_card_type):
        await create_role(db, key="cost_role", permissions={"costs.view": True})
        user = await create_user(db, role="cost_role")

        assert await PermissionService.can_view_costs(db, user) is True

    async def test_a_stakeholder_role_does_not_grant_access(self, db, app_card_type):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")
        card = await create_card(db, card_type="Application")
        await _make_stakeholder(db, user=user, card=card)

        assert await PermissionService.can_view_costs(db, user) is False

    async def test_an_explicit_false_grant_denies(self, db, app_card_type):
        await create_role(
            db, key="no_costs", permissions={**MEMBER_PERMISSIONS, "costs.view": False}
        )
        user = await create_user(db, role="no_costs")

        assert await PermissionService.can_view_costs(db, user) is False

    async def test_no_perm_no_stakeholder_denies(self, db, app_card_type):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")

        assert await PermissionService.can_view_costs(db, user) is False


class TestCardIdsWithCostAccess:
    async def test_global_perm_returns_all(self, db, app_card_type):
        await create_role(db, key="cost_role", permissions={"costs.view": True})
        user = await create_user(db, role="cost_role")
        c1 = await create_card(db, card_type="Application", name="A")
        c2 = await create_card(db, card_type="Application", name="B")

        out = await PermissionService.card_ids_with_cost_access(db, user, [c1.id, c2.id])
        assert out == {c1.id, c2.id}

    async def test_no_perm_returns_nothing_even_for_stakeholder_cards(self, db, app_card_type):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")
        c1 = await create_card(db, card_type="Application", name="A")
        c2 = await create_card(db, card_type="Application", name="B")
        await _make_stakeholder(db, user=user, card=c1)

        out = await PermissionService.card_ids_with_cost_access(db, user, [c1.id, c2.id])
        assert out == set()

    async def test_no_perm_no_stakeholders_returns_empty(self, db, app_card_type):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")
        c1 = await create_card(db, card_type="Application", name="A")

        out = await PermissionService.card_ids_with_cost_access(db, user, [c1.id])
        assert out == set()

    async def test_empty_input_returns_empty(self, db):
        await create_role(db, key="admin", permissions={"*": True})
        user = await create_user(db, role="admin")

        out = await PermissionService.card_ids_with_cost_access(db, user, [])
        assert out == set()

    async def test_none_and_duplicate_candidates_are_dropped(self, db, app_card_type):
        await create_role(db, key="cost_role", permissions={"costs.view": True})
        user = await create_user(db, role="cost_role")
        c1 = await create_card(db, card_type="Application")
        other_id = uuid.uuid4()

        out = await PermissionService.card_ids_with_cost_access(
            db, user, [c1.id, None, c1.id, other_id]
        )
        assert out == {c1.id, other_id}


class TestEffectivePermissionsIncludesCanViewCosts:
    async def test_admin_can_view_costs_true(self, db, app_card_type):
        await create_role(db, key="admin", permissions={"*": True})
        user = await create_user(db, role="admin")
        card = await create_card(db, card_type="Application")

        eff = await PermissionService.get_effective_card_permissions(db, user, card.id)
        assert eff["effective"]["can_view_costs"] is True

    async def test_app_perm_makes_can_view_costs_true(self, db, app_card_type):
        await create_role(db, key="r", permissions={"costs.view": True})
        user = await create_user(db, role="r")
        card = await create_card(db, card_type="Application")

        eff = await PermissionService.get_effective_card_permissions(db, user, card.id)
        assert eff["effective"]["can_view_costs"] is True

    async def test_a_stakeholder_role_leaves_can_view_costs_false(self, db, app_card_type):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")
        card = await create_card(db, card_type="Application")
        await _make_stakeholder(db, user=user, card=card)

        eff = await PermissionService.get_effective_card_permissions(db, user, card.id)
        assert eff["stakeholder_roles"] == ["responsible"]
        assert eff["effective"]["can_view_costs"] is False

    async def test_no_access_returns_false(self, db, app_card_type):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")
        card = await create_card(db, card_type="Application")

        eff = await PermissionService.get_effective_card_permissions(db, user, card.id)
        assert eff["effective"]["can_view_costs"] is False
