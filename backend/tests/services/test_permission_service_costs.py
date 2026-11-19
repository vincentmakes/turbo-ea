"""Tests for the cost visibility rule.

`costs.view` shows cost fields on every card. Without it, a stakeholder role
on a card shows that card's costs only when the role's definition grants
`card.view_costs`. Merely holding a role is not enough (#1412): anyone who can
view a card can make themselves its Observer, so "any stakeholder sees costs"
let every user past the permission.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import (
    MEMBER_PERMISSIONS,
    OBSERVER_CARD_PERMISSIONS,
    RESPONSIBLE_CARD_PERMISSIONS,
    VIEWER_PERMISSIONS,
)
from app.models.stakeholder import Stakeholder
from app.services.permission_service import PermissionService
from tests.conftest import (
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)


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
async def roles(db, app_card_type):
    """The two built-in stakeholder roles with their shipped permissions."""
    await create_stakeholder_role_def(
        db, key="responsible", permissions=RESPONSIBLE_CARD_PERMISSIONS
    )
    await create_stakeholder_role_def(
        db, key="observer", label="Observer", permissions=OBSERVER_CARD_PERMISSIONS
    )


async def _make_stakeholder(db, *, user, card, role="responsible"):
    sh = Stakeholder(card_id=card.id, user_id=user.id, role=role)
    db.add(sh)
    await db.flush()
    return sh


async def _viewer(db):
    await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
    return await create_user(db, role="viewer")


class TestShippedDefaults:
    def test_every_built_in_role_shows_costs_except_observer(self):
        from app.core.permissions import DEFAULT_CARD_PERMISSIONS_BY_ROLE

        shows = {k: v["card.view_costs"] for k, v in DEFAULT_CARD_PERMISSIONS_BY_ROLE.items()}
        assert shows.pop("observer") is False
        assert shows and all(v is True for v in shows.values())


class TestCanViewCosts:
    async def test_admin_wildcard_grants_access(self, db, roles):
        await create_role(db, key="admin", permissions={"*": True})
        user = await create_user(db, role="admin")
        card = await create_card(db, card_type="Application")

        assert await PermissionService.can_view_costs(db, user, card.id) is True

    async def test_app_perm_grants_access(self, db, roles):
        await create_role(db, key="cost_role", permissions={"costs.view": True})
        user = await create_user(db, role="cost_role")
        card = await create_card(db, card_type="Application")

        assert await PermissionService.can_view_costs(db, user, card.id) is True

    async def test_a_role_that_shows_costs_grants_access_without_the_app_perm(self, db, roles):
        user = await _viewer(db)
        card = await create_card(db, card_type="Application")
        other = await create_card(db, card_type="Application", name="Other")
        await _make_stakeholder(db, user=user, card=card)

        assert await PermissionService.can_view_costs(db, user, card.id) is True
        assert await PermissionService.can_view_costs(db, user, other.id) is False

    async def test_observer_does_not_grant_access(self, db, roles):
        user = await _viewer(db)
        card = await create_card(db, card_type="Application")
        await _make_stakeholder(db, user=user, card=card, role="observer")

        assert await PermissionService.can_view_costs(db, user, card.id) is False

    async def test_an_explicit_false_app_grant_does_not_block_a_role(self, db, roles):
        await create_role(
            db, key="no_costs", permissions={**MEMBER_PERMISSIONS, "costs.view": False}
        )
        user = await create_user(db, role="no_costs")
        card = await create_card(db, card_type="Application")

        assert await PermissionService.can_view_costs(db, user, card.id) is False
        await _make_stakeholder(db, user=user, card=card)
        assert await PermissionService.can_view_costs(db, user, card.id) is True

    async def test_an_undefined_role_does_not_grant_access(self, db, app_card_type):
        # No definition row for the role on this type: it grants nothing.
        user = await _viewer(db)
        card = await create_card(db, card_type="Application")
        await _make_stakeholder(db, user=user, card=card)

        assert await PermissionService.can_view_costs(db, user, card.id) is False

    async def test_an_archived_role_does_not_grant_access(self, db, app_card_type):
        await create_stakeholder_role_def(
            db, key="responsible", permissions={"card.view_costs": True}, is_archived=True
        )
        user = await _viewer(db)
        card = await create_card(db, card_type="Application")
        await _make_stakeholder(db, user=user, card=card)

        assert await PermissionService.can_view_costs(db, user, card.id) is False

    async def test_no_perm_no_stakeholder_denies(self, db, roles):
        user = await _viewer(db)
        card = await create_card(db, card_type="Application")

        assert await PermissionService.can_view_costs(db, user, card.id) is False


class TestCardIdsWithCostAccess:
    async def test_global_perm_returns_all(self, db, roles):
        await create_role(db, key="cost_role", permissions={"costs.view": True})
        user = await create_user(db, role="cost_role")
        c1 = await create_card(db, card_type="Application", name="A")
        c2 = await create_card(db, card_type="Application", name="B")

        out = await PermissionService.card_ids_with_cost_access(db, user, [c1.id, c2.id])
        assert out == {c1.id, c2.id}

    async def test_global_perm_returns_candidates_it_never_looked_up(self, db, roles):
        await create_role(db, key="cost_role", permissions={"costs.view": True})
        user = await create_user(db, role="cost_role")
        c1 = await create_card(db, card_type="Application")
        other_id = uuid.uuid4()

        out = await PermissionService.card_ids_with_cost_access(
            db, user, [c1.id, None, c1.id, other_id]
        )
        assert out == {c1.id, other_id}

    async def test_no_perm_returns_only_cards_whose_role_shows_costs(self, db, roles):
        user = await _viewer(db)
        owned = await create_card(db, card_type="Application", name="Owned")
        observed = await create_card(db, card_type="Application", name="Observed")
        neither = await create_card(db, card_type="Application", name="Neither")
        await _make_stakeholder(db, user=user, card=owned)
        await _make_stakeholder(db, user=user, card=observed, role="observer")

        out = await PermissionService.card_ids_with_cost_access(
            db, user, [owned.id, observed.id, neither.id]
        )
        assert out == {owned.id}

    async def test_one_role_that_shows_costs_is_enough(self, db, roles):
        user = await _viewer(db)
        card = await create_card(db, card_type="Application")
        await _make_stakeholder(db, user=user, card=card, role="observer")
        await _make_stakeholder(db, user=user, card=card)

        assert await PermissionService.card_ids_with_cost_access(db, user, [card.id]) == {card.id}

    async def test_a_role_held_by_someone_else_or_outside_the_candidates_does_not_count(
        self, db, roles
    ):
        user = await _viewer(db)
        colleague = await create_user(db, email="colleague@test.com", role="viewer")
        mine = await create_card(db, card_type="Application", name="Mine")
        theirs = await create_card(db, card_type="Application", name="Theirs")
        not_asked = await create_card(db, card_type="Application", name="Not asked")
        await _make_stakeholder(db, user=user, card=mine)
        await _make_stakeholder(db, user=user, card=not_asked)
        await _make_stakeholder(db, user=colleague, card=theirs)

        out = await PermissionService.card_ids_with_cost_access(db, user, [mine.id, theirs.id])
        assert out == {mine.id}

    async def test_the_role_is_read_from_the_cards_own_type(self, db, roles):
        # "responsible" shows costs on Application; on a type that defines it
        # without the grant, the same role key shows nothing.
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_stakeholder_role_def(
            db, card_type_key="ITComponent", key="responsible", permissions={"card.view": True}
        )
        user = await _viewer(db)
        app = await create_card(db, card_type="Application", name="App")
        itc = await create_card(db, card_type="ITComponent", name="Server")
        await _make_stakeholder(db, user=user, card=app)
        await _make_stakeholder(db, user=user, card=itc)

        out = await PermissionService.card_ids_with_cost_access(db, user, [app.id, itc.id])
        assert out == {app.id}
        assert await PermissionService.can_view_costs(db, user, itc.id) is False

    async def test_an_archived_or_undefined_role_shows_nothing(self, db, app_card_type):
        await create_stakeholder_role_def(
            db, key="retired", permissions={"card.view_costs": True}, is_archived=True
        )
        user = await _viewer(db)
        c1 = await create_card(db, card_type="Application", name="A")
        c2 = await create_card(db, card_type="Application", name="B")
        await _make_stakeholder(db, user=user, card=c1, role="retired")
        await _make_stakeholder(db, user=user, card=c2, role="ghost")

        assert await PermissionService.card_ids_with_cost_access(db, user, [c1.id, c2.id]) == set()

    async def test_no_perm_no_stakeholders_returns_empty(self, db, roles):
        user = await _viewer(db)
        c1 = await create_card(db, card_type="Application", name="A")

        out = await PermissionService.card_ids_with_cost_access(db, user, [c1.id])
        assert out == set()

    async def test_empty_input_returns_empty(self, db):
        await create_role(db, key="admin", permissions={"*": True})
        user = await create_user(db, role="admin")

        assert await PermissionService.card_ids_with_cost_access(db, user, []) == set()
        assert await PermissionService.card_ids_with_cost_access(db, user, [None]) == set()

    async def test_unknown_ids_are_not_returned_without_the_app_perm(self, db, roles):
        user = await _viewer(db)
        c1 = await create_card(db, card_type="Application")
        await _make_stakeholder(db, user=user, card=c1)
        random_id = uuid.uuid4()

        out = await PermissionService.card_ids_with_cost_access(db, user, [c1.id, random_id])
        assert out == {c1.id}


class TestEffectivePermissionsIncludesCanViewCosts:
    async def test_admin_can_view_costs_true(self, db, roles):
        await create_role(db, key="admin", permissions={"*": True})
        user = await create_user(db, role="admin")
        card = await create_card(db, card_type="Application")

        eff = await PermissionService.get_effective_card_permissions(db, user, card.id)
        assert eff["effective"]["can_view_costs"] is True

    async def test_app_perm_makes_can_view_costs_true(self, db, roles):
        await create_role(db, key="r", permissions={"costs.view": True})
        user = await create_user(db, role="r")
        card = await create_card(db, card_type="Application")

        eff = await PermissionService.get_effective_card_permissions(db, user, card.id)
        assert eff["effective"]["can_view_costs"] is True

    async def test_a_role_that_shows_costs_makes_can_view_costs_true(self, db, roles):
        user = await _viewer(db)
        card = await create_card(db, card_type="Application")
        await _make_stakeholder(db, user=user, card=card)

        eff = await PermissionService.get_effective_card_permissions(db, user, card.id)
        assert eff["card_level"]["card.view_costs"] is True
        assert eff["effective"]["can_view_costs"] is True

    async def test_observer_leaves_can_view_costs_false(self, db, roles):
        user = await _viewer(db)
        card = await create_card(db, card_type="Application")
        await _make_stakeholder(db, user=user, card=card, role="observer")

        eff = await PermissionService.get_effective_card_permissions(db, user, card.id)
        assert eff["stakeholder_roles"] == ["observer"]
        assert "card.view_costs" not in eff["card_level"]
        assert eff["effective"]["can_view_costs"] is False

    async def test_no_access_returns_false(self, db, roles):
        user = await _viewer(db)
        card = await create_card(db, card_type="Application")

        eff = await PermissionService.get_effective_card_permissions(db, user, card.id)
        assert eff["effective"]["can_view_costs"] is False
