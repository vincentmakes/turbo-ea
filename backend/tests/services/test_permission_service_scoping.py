"""``PermissionService``: whose rows count, and how long an answer is cached.

The other permission suites check what a grant allows. These check the
*scoping* around it, which a wrong ``where`` clause would break silently: a
stakeholder role held on another card, or by another user, must not count;
a wildcard role is never overridden. They also pin the caches, whose expiry
decides how long a revoked grant keeps working.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.services import permission_service as ps
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
async def world(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="plain", label="Plain", permissions={"inventory.view": False})
    await create_card_type(db, key="Application", label="Application")
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="owner", permissions={"card.edit": True}
    )
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="watcher", permissions={"card.view": True}
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    me = await create_user(db, email="me@test.com", role="plain")
    other = await create_user(db, email="other@test.com", role="plain")
    cards = [
        await create_card(db, card_type="Application", name=f"App {i}", user_id=admin.id)
        for i in range(3)
    ]
    return {"me": me, "other": other, "cards": cards}


async def hold(db, card, user, role):
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role=role))
    await db.flush()


async def app_type(db) -> CardType:
    return (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()


# ── stakeholder scoping ─────────────────────────────────────────────────────


async def test_a_role_on_another_card_or_held_by_someone_else_does_not_count(db, world):
    me, other, (c0, c1, _) = world["me"], world["other"], world["cards"]
    await hold(db, c1, me, "owner")  # me, but another card
    await hold(db, c0, other, "owner")  # this card, but another user

    assert await PermissionService.is_stakeholder_of(db, me, c0.id) is False
    assert await PermissionService.has_card_permission(db, me, c0.id, "card.edit") is False
    eff = await PermissionService.get_effective_card_permissions(db, me, c0.id)
    assert eff["stakeholder_roles"] == [] and eff["card_level"] == {}
    assert eff["effective"]["can_edit"] is False
    assert eff["effective"]["can_view_costs"] is False

    assert await PermissionService.is_stakeholder_of(db, me, c1.id) is True
    assert await PermissionService.has_card_permission(db, me, c1.id, "card.edit") is True


async def test_two_roles_on_one_card_still_make_one_stakeholder(db, world):
    me, (c0, *_) = world["me"], world["cards"]
    await hold(db, c0, me, "owner")
    await hold(db, c0, me, "watcher")
    assert await PermissionService.is_stakeholder_of(db, me, c0.id) is True
    eff = await PermissionService.get_effective_card_permissions(db, me, c0.id)
    assert sorted(eff["stakeholder_roles"]) == ["owner", "watcher"]
    assert eff["card_level"] == {"card.edit": True, "card.view": True}


async def test_cost_access_is_limited_to_the_users_own_candidate_cards(db, world):
    me, other, (c0, c1, c2) = world["me"], world["other"], world["cards"]
    await hold(db, c0, me, "owner")
    await hold(db, c2, me, "owner")  # held, but not a candidate
    await hold(db, c1, other, "owner")  # a candidate, but someone else's
    got = await PermissionService.card_ids_with_cost_access(db, me, [c0.id, c1.id, None])
    assert got == {c0.id}


async def test_cost_access_for_nothing_is_nothing(db, world):
    assert await PermissionService.card_ids_with_cost_access(db, world["me"], [None]) == set()


# ── get_effective_card_permissions: the result's shape ──────────────────────


async def test_a_disabled_wildcard_is_neither_admin_nor_listed(db, world):
    await create_role(db, key="half", label="Half", permissions={"*": False, "bpm.edit": True})
    user = await create_user(db, email="half@test.com", role="half")
    eff = await PermissionService.get_effective_card_permissions(db, user, world["cards"][0].id)
    assert eff["app_level"] == {"bpm.edit": True}
    assert eff["effective"]["can_bpm_edit"] is True
    assert eff["effective"]["can_edit"] is False


async def test_a_role_that_no_longer_exists_grants_nothing(db, world):
    user = await create_user(db, email="ghost@test.com", role="plain")
    user.role = "deleted-role"
    eff = await PermissionService.get_effective_card_permissions(db, user, world["cards"][0].id)
    assert eff["app_level"] == {}
    assert not any(eff["effective"].values())


async def test_an_unknown_card_has_no_type_overrides(db, world):
    eff = await PermissionService.get_effective_card_permissions(db, world["me"], uuid.uuid4())
    assert eff["type_overrides"] == {}
    assert eff["card_level"] == {}


# ── type cells ──────────────────────────────────────────────────────────────


async def test_type_permissions_for_role_lists_only_cells_for_that_role(db, world):
    ct = await app_type(db)
    ct.role_permissions = {"plain": {"inventory.edit": True}, "other": {"x": False}}
    await create_card_type(db, key="ITComponent", label="IT Component")
    await db.flush()
    assert await PermissionService.type_permissions_for_role(db, "plain") == {
        "Application": {"inventory.edit": True}
    }


async def test_a_wildcard_role_is_never_overridden(db, world):
    ct = await app_type(db)
    ct.role_permissions = {"admin": {"inventory.view": False}}
    await db.flush()
    assert await PermissionService.type_permissions_for_role(db, "admin") == {}
    admin = (
        await db.execute(select(ps.User).where(ps.User.email == "admin@test.com"))
    ).scalar_one()
    assert (
        await PermissionService.is_type_denied(db, admin, "inventory.view", "Application") is False
    )


async def test_an_unknown_role_has_no_cells_and_no_denials(db, world):
    ct = await app_type(db)
    ct.role_permissions = {"nobody": {"inventory.view": False}}
    await db.flush()
    assert await PermissionService.type_permissions_for_role(db, "nobody") == {}
    user = world["me"]
    user.role = "nobody"
    assert (
        await PermissionService.is_type_denied(db, user, "inventory.view", "Application") is False
    )


async def test_is_type_denied_only_for_a_stored_false(db, world):
    ct = await app_type(db)
    ct.role_permissions = {"plain": {"inventory.edit": False, "inventory.create": True}}
    await db.flush()
    me = world["me"]
    assert await PermissionService.is_type_denied(db, me, "inventory.edit", "Application") is True
    assert (
        await PermissionService.is_type_denied(db, me, "inventory.create", "Application") is False
    )
    assert (
        await PermissionService.is_type_denied(db, me, "inventory.delete", "Application") is False
    )


# ── caches: answers are reused for exactly CACHE_TTL seconds ────────────────


@pytest.fixture
def clock(monkeypatch):
    now = [1_000_000.0]
    monkeypatch.setattr(ps.time, "time", lambda: now[0])
    return now


async def test_the_type_override_cache(db, world, clock):
    ct = await app_type(db)
    ct.role_permissions = {"plain": {"a": True}}
    await db.flush()
    assert await PermissionService.load_type_role_permissions(db, "Application") == {
        "plain": {"a": True}
    }
    ct.role_permissions = {"plain": {"a": False}}
    await db.flush()
    clock[0] += PermissionService.CACHE_TTL - 1
    assert await PermissionService.load_type_role_permissions(db, "Application") == {
        "plain": {"a": True}
    }  # still cached
    clock[0] += 1  # exactly CACHE_TTL after the read
    assert await PermissionService.load_type_role_permissions(db, "Application") == {
        "plain": {"a": False}
    }


async def test_the_type_override_cache_is_per_type(db, world, clock):
    ct = await app_type(db)
    ct.role_permissions = {"plain": {"a": True}}
    await db.flush()
    assert await PermissionService.load_type_role_permissions(db, "Nope") == {}
    assert await PermissionService.load_type_role_permissions(db, "Application") == {
        "plain": {"a": True}
    }


async def test_the_all_types_cache(db, world, clock):
    ct = await app_type(db)
    ct.role_permissions = {"plain": {"a": True}}
    await db.flush()
    first = await PermissionService.load_all_type_role_permissions(db)
    assert first == {"Application": {"plain": {"a": True}}}
    ct.role_permissions = {}
    await db.flush()
    clock[0] += PermissionService.CACHE_TTL - 1
    assert await PermissionService.load_all_type_role_permissions(db) == first
    clock[0] += 1
    assert await PermissionService.load_all_type_role_permissions(db) == {"Application": {}}


async def test_the_stakeholder_role_cache(db, world, clock):
    assert await PermissionService.stakeholder_role_permissions(db, "Application", "owner") == {
        "card.edit": True
    }
    srd = (
        await db.execute(
            select(StakeholderRoleDefinition).where(StakeholderRoleDefinition.key == "owner")
        )
    ).scalar_one()
    srd.permissions = {"card.edit": False}
    await db.flush()
    clock[0] += PermissionService.CACHE_TTL - 1
    assert await PermissionService.stakeholder_role_permissions(db, "Application", "owner") == {
        "card.edit": True
    }
    # another role on the same type is its own entry
    assert await PermissionService.stakeholder_role_permissions(db, "Application", "watcher") == {
        "card.view": True
    }
    clock[0] += 1
    assert await PermissionService.stakeholder_role_permissions(db, "Application", "owner") == {
        "card.edit": False
    }


async def test_an_archived_stakeholder_role_grants_nothing(db, world):
    srd = (
        await db.execute(
            select(StakeholderRoleDefinition).where(StakeholderRoleDefinition.key == "watcher")
        )
    ).scalar_one()
    srd.is_archived = True
    await db.flush()
    assert (
        await PermissionService.stakeholder_role_permissions(db, "Application", "watcher") is None
    )
