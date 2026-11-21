"""Tests for the costs.view permission rule (app-level + stakeholder bypass)."""

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


async def _make_stakeholder(db, *, user, card, role="responsible"):
    sh = Stakeholder(card_id=card.id, user_id=user.id, role=role)
    db.add(sh)
    await db.flush()
    return sh


class TestIsStakeholderOf:
    async def test_returns_true_when_stakeholder(self, db, app_card_type):
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")
        card = await create_card(db, card_type="Application")
        await _make_stakeholder(db, user=user, card=card)

        assert await PermissionService.is_stakeholder_of(db, user, card.id) is True

    async def test_returns_false_when_not_stakeholder(self, db, app_card_type):
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")
        card = await create_card(db, card_type="Application")

        assert await PermissionService.is_stakeholder_of(db, user, card.id) is False


class TestCanViewCosts:
    async def test_admin_wildcard_grants_access(self, db, app_card_type):
        await create_role(db, key="admin", permissions={"*": True})
        user = await create_user(db, role="admin")
        card = await create_card(db, card_type="Application")

        assert await PermissionService.can_view_costs(db, user, card.id) is True

    async def test_app_perm_grants_access(self, db, app_card_type):
        await create_role(db, key="cost_role", permissions={"costs.view": True})
        user = await create_user(db, role="cost_role")
        card = await create_card(db, card_type="Application")

        assert await PermissionService.can_view_costs(db, user, card.id) is True

    async def test_stakeholder_grants_access_without_global_perm(self, db, roles):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")
        card = await create_card(db, card_type="Application")
        await _make_stakeholder(db, user=user, card=card)

        assert await PermissionService.can_view_costs(db, user, card.id) is True

    async def test_no_perm_no_stakeholder_denies(self, db, app_card_type):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")
        card = await create_card(db, card_type="Application")

        assert await PermissionService.can_view_costs(db, user, card.id) is False

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


class TestCardIdsWithCostAccess:
    async def test_global_perm_returns_all(self, db, app_card_type):
        await create_role(db, key="cost_role", permissions={"costs.view": True})
        user = await create_user(db, role="cost_role")
        c1 = await create_card(db, card_type="Application", name="A")
        c2 = await create_card(db, card_type="Application", name="B")

        out = await PermissionService.card_ids_with_cost_access(db, user, [c1.id, c2.id])
        assert out == {c1.id, c2.id}

    async def test_no_perm_returns_only_stakeholder_cards(self, db, roles):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")
        c1 = await create_card(db, card_type="Application", name="A")
        c2 = await create_card(db, card_type="Application", name="B")
        await _make_stakeholder(db, user=user, card=c1)

        out = await PermissionService.card_ids_with_cost_access(db, user, [c1.id, c2.id])
        assert out == {c1.id}

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

    async def test_filters_unknown_ids(self, db, roles):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")
        c1 = await create_card(db, card_type="Application")
        await _make_stakeholder(db, user=user, card=c1)
        random_id = uuid.uuid4()

        out = await PermissionService.card_ids_with_cost_access(db, user, [c1.id, random_id])
        assert out == {c1.id}

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

    async def test_unknown_ids_are_not_returned_without_the_app_perm(self, db, roles):
        user = await _viewer(db)
        c1 = await create_card(db, card_type="Application")
        await _make_stakeholder(db, user=user, card=c1)
        random_id = uuid.uuid4()

        out = await PermissionService.card_ids_with_cost_access(db, user, [c1.id, random_id])
        assert out == {c1.id}


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

    async def test_stakeholder_makes_can_view_costs_true(self, db, roles):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")
        card = await create_card(db, card_type="Application")
        await _make_stakeholder(db, user=user, card=card)

        eff = await PermissionService.get_effective_card_permissions(db, user, card.id)
        assert eff["effective"]["can_view_costs"] is True

    async def test_no_access_returns_false(self, db, app_card_type):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")
        card = await create_card(db, card_type="Application")

        eff = await PermissionService.get_effective_card_permissions(db, user, card.id)
        assert eff["effective"]["can_view_costs"] is False

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


class TestCanEditCosts:
    async def _roles(self, db):
        for key, edit in (("resp_c", True), ("process_owner_c", True), ("observer_c", False)):
            await create_stakeholder_role_def(
                db,
                key=key,
                label=key,
                permissions={"card.view": True, "card.edit": edit, "card.view_costs": edit},
            )

    async def test_admin_and_app_level_grant(self, db, app_card_type):
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="ce", permissions={"costs.edit": True, "costs.view": True})
        card = await create_card(db, card_type="Application")
        for role in ("admin", "ce"):
            user = await create_user(db, role=role, email=f"{role}@ce.com")
            assert await PermissionService.can_edit_costs(db, user, card.id) is True

    async def test_edit_roles_work_when_profile_cannot_edit_cards(self, db, app_card_type):
        await self._roles(db)
        await create_role(db, key="ro", permissions={"inventory.view": True})
        mine = await create_card(db, card_type="Application")
        other = await create_card(db, card_type="Application")
        for role in ("resp_c", "process_owner_c"):
            user = await create_user(db, role="ro", email=f"{role}@x.com")
            await _make_stakeholder(db, user=user, card=mine, role=role)
            assert await PermissionService.can_edit_costs(db, user, mine.id) is True
            assert await PermissionService.can_edit_costs(db, user, other.id) is False

    async def test_observer_inventory_edit_only_and_stranger_cannot(self, db, app_card_type):
        await self._roles(db)
        await create_role(
            db, key="ie", permissions={"inventory.view": True, "inventory.edit": True}
        )
        card = await create_card(db, card_type="Application")
        obs = await create_user(db, role="ie", email="obs@x.com")
        await _make_stakeholder(db, user=obs, card=card, role="observer_c")
        member = await create_user(db, role="ie", email="m@x.com")
        assert await PermissionService.can_edit_costs(db, obs, card.id) is False
        assert await PermissionService.can_edit_costs(db, member, card.id) is False


class TestShippedDefaults:
    def test_every_built_in_role_shows_costs_except_observer(self):
        from app.core.permissions import DEFAULT_CARD_PERMISSIONS_BY_ROLE

        shows = {k: v["card.view_costs"] for k, v in DEFAULT_CARD_PERMISSIONS_BY_ROLE.items()}
        assert shows.pop("observer") is False
        assert shows and all(v is True for v in shows.values())


class TestViewDeniedTypes:
    async def test_a_role_without_cells_is_denied_nothing(self, db, finance):
        assert await PermissionService.view_denied_types(db, finance) == frozenset()
        assert await PermissionService.sees_all_costs(db, finance) is True

    async def test_a_view_deny_names_its_type(self, db, finance):
        await _deny_view(db, "Application", "finance")
        assert await PermissionService.view_denied_types(db, finance) == frozenset({"Application"})
        assert await PermissionService.sees_all_costs(db, finance) is False

    @pytest.mark.parametrize(
        "cells",
        [
            {"inventory.view": True},
            {"inventory.edit": False, "inventory.delete": False},
            {"inventory.view": None},
            {},
        ],
    )
    async def test_only_an_explicit_view_deny_counts(self, db, finance, cells):
        await _deny_view(db, "Application", "finance", cells)
        assert await PermissionService.view_denied_types(db, finance) == frozenset()
        assert await PermissionService.sees_all_costs(db, finance) is True

    async def test_another_roles_deny_is_not_mine(self, db, finance):
        await _deny_view(db, "Application", "viewer")
        assert await PermissionService.view_denied_types(db, finance) == frozenset()

    async def test_the_wildcard_role_is_never_denied(self, db, finance):
        await create_role(db, key="admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await _deny_view(db, "Application", "admin")
        assert await PermissionService.view_denied_types(db, admin) == frozenset()
        assert await PermissionService.sees_all_costs(db, admin) is True

    async def test_a_user_whose_role_does_not_exist_is_denied_nothing_and_sees_nothing(
        self, db, finance
    ):
        ghost = await create_user(db, email="ghost@test.com", role="no_such_role")
        await _deny_view(db, "Application", "no_such_role")
        assert await PermissionService.view_denied_types(db, ghost) == frozenset()
        assert await PermissionService.sees_all_costs(db, ghost) is False

    async def test_without_costs_view_nobody_sees_all_costs(self, db, finance):
        viewer = await _viewer(db)
        assert await PermissionService.view_denied_types(db, viewer) == frozenset()
        assert await PermissionService.sees_all_costs(db, viewer) is False


class TestCostAccessUnderAViewDeny:
    """`costs.view` is a landscape-wide grant: a View deny on a type takes it
    away there, as it does every other. A card of that type the user still
    opens through a stakeholder role shows costs only if that role says so —
    which is what `my-permissions` already reported."""

    async def test_the_app_grant_does_not_reach_a_denied_type(self, db, finance):
        await _deny_view(db, "Application", "finance")
        app = await create_card(db, card_type="Application", name="App")
        itc = await create_card(db, card_type="ITComponent", name="Server")

        assert await PermissionService.can_view_costs(db, finance, app.id) is False
        assert await PermissionService.can_view_costs(db, finance, itc.id) is True
        eff = await PermissionService.get_effective_card_permissions(db, finance, app.id)
        assert eff["effective"]["can_view_costs"] is False

    async def test_a_role_on_the_card_decides_instead(self, db, finance):
        await _deny_view(db, "Application", "finance")
        owned = await create_card(db, card_type="Application", name="Owned")
        observed = await create_card(db, card_type="Application", name="Observed")
        await _make_stakeholder(db, user=finance, card=owned)
        await _make_stakeholder(db, user=finance, card=observed, role="observer")

        assert await PermissionService.can_view_costs(db, finance, owned.id) is True
        assert await PermissionService.can_view_costs(db, finance, observed.id) is False

    async def test_the_bulk_check_agrees_card_by_card(self, db, finance):
        await _deny_view(db, "Application", "finance")
        owned = await create_card(db, card_type="Application", name="Owned")
        observed = await create_card(db, card_type="Application", name="Observed")
        plain = await create_card(db, card_type="Application", name="Plain")
        itc = await create_card(db, card_type="ITComponent", name="Server")
        unknown = uuid.uuid4()
        await _make_stakeholder(db, user=finance, card=owned)
        await _make_stakeholder(db, user=finance, card=observed, role="observer")

        out = await PermissionService.card_ids_with_cost_access(
            db, finance, [owned.id, observed.id, plain.id, itc.id, unknown, None]
        )
        assert out == {owned.id, itc.id, unknown}
        for card in (owned, observed, plain, itc):
            assert (card.id in out) is await PermissionService.can_view_costs(db, finance, card.id)

    async def test_a_denied_card_that_was_not_asked_about_does_not_come_back(self, db, finance):
        # The user holds a cost-showing role on two cards of the denied type;
        # only one of them is a candidate.
        await _deny_view(db, "Application", "finance")
        asked = await create_card(db, card_type="Application", name="Asked")
        not_asked = await create_card(db, card_type="Application", name="Not asked")
        await _make_stakeholder(db, user=finance, card=asked)
        await _make_stakeholder(db, user=finance, card=not_asked)

        out = await PermissionService.card_ids_with_cost_access(db, finance, [asked.id])
        assert out == {asked.id}

    async def test_candidates_outside_the_denied_type_all_come_back(self, db, finance):
        await _deny_view(db, "Application", "finance")
        itc1 = await create_card(db, card_type="ITComponent", name="One")
        itc2 = await create_card(db, card_type="ITComponent", name="Two")

        out = await PermissionService.card_ids_with_cost_access(db, finance, [itc1.id, itc2.id])
        assert out == {itc1.id, itc2.id}

    async def test_only_denied_candidates_with_no_role_come_back_empty(self, db, finance):
        await _deny_view(db, "Application", "finance")
        app = await create_card(db, card_type="Application", name="App")

        assert await PermissionService.card_ids_with_cost_access(db, finance, [app.id]) == set()

    async def test_a_deny_on_another_type_changes_nothing_for_this_one(self, db, finance):
        await _deny_view(db, "ITComponent", "finance")
        app = await create_card(db, card_type="Application", name="App")

        assert await PermissionService.can_view_costs(db, finance, app.id) is True
        assert await PermissionService.card_ids_with_cost_access(db, finance, [app.id]) == {app.id}


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


async def _viewer(db):
    await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
    return await create_user(db, role="viewer")


async def _deny_view(db, type_key: str, role_key: str, cells: dict | None = None) -> None:
    from sqlalchemy import select

    from app.models.card_type import CardType

    card_type = (await db.execute(select(CardType).where(CardType.key == type_key))).scalar_one()
    card_type.role_permissions = {role_key: {"inventory.view": False} if cells is None else cells}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()


@pytest.fixture
async def finance(db, roles):
    """A role with `costs.view`, an IT Component type beside Application."""
    await create_role(db, key="finance", permissions={"inventory.view": True, "costs.view": True})
    await create_card_type(db, key="ITComponent", label="IT Component")
    return await create_user(db, email="finance@test.com", role="finance")


async def test_cost_access_batch_respects_subtype_view_denials(db, finance):
    blocked = await create_card(db, card_type="Application", name="Restricted", subtype="private")
    allowed = await create_card(db, card_type="Application", name="Allowed", subtype="public")
    await _deny_view(
        db,
        "Application",
        "finance",
        {"inventory.view": {"value": False, "subtypes": ["private"]}},
    )

    assert not await PermissionService.can_view_costs(db, finance, blocked.id)
    assert await PermissionService.can_view_costs(db, finance, allowed.id)
    assert await PermissionService.card_ids_with_cost_access(
        db, finance, [blocked.id, allowed.id]
    ) == {allowed.id}
    assert not await PermissionService.sees_all_costs(db, finance)


async def test_stream_hides_costs_when_type_view_is_denied(db, finance):
    from app.services.cost_event_redaction import reader_drop_keys

    await _deny_view(db, "Application", "finance")
    assert "cost_items" in await reader_drop_keys(db, finance)


async def test_stream_hides_licenses_when_type_view_is_denied(db):
    from app.services.cost_event_redaction import reader_drop_keys

    await create_role(db, key="lic_stream", permissions={"licenses.view": True})
    await create_card_type(db, key="Application")
    user = await create_user(db, role="lic_stream", email="lic-stream@example.com")
    await _deny_view(db, "Application", "lic_stream")
    assert "licensedUsers" in await reader_drop_keys(db, user)
