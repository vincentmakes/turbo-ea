"""The card read scope: one answer to "may this user read this card?".

Four things answer that question and must never disagree:

- ``CardReadScope.clause`` — the SQL predicate every list/report query adds;
- ``CardReadScope.readable`` — its Python twin for rows already loaded;
- ``is_card_readable`` — the single-card guard (no scope load);
- ``PermissionService.check_permission("inventory.view", card, "card.view")``
  — the long-standing card read check, which inventory mode must equal.

The parity matrix below runs all four over every combination of the role's
global View grant, the type's View cell, the user's stakeholder standing on the
card and the read mode, and pins them to one independently-computed truth.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.services.card_read_scope import (
    CardReadScope,
    is_card_readable,
    require_card_readable,
    require_inventory_browse,
)
from app.services.event_bus import request_impersonation
from app.services.permission_service import PermissionService
from tests.conftest import (
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

MODES = ("inventory", "module")


async def _set_cells(db, type_key: str, overrides: dict) -> None:
    ct = (await db.execute(select(CardType).where(CardType.key == type_key))).scalar_one()
    ct.role_permissions = overrides
    await db.flush()
    PermissionService.invalidate_type_permission_cache()


async def _hold(db, card, user, role: str) -> None:
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role=role))
    await db.flush()


def _expected(*, base_view: bool, cell, mode: str, held: bool) -> bool:
    if cell is False:
        type_ok = False
    elif cell is True:
        type_ok = True
    else:
        type_ok = mode == "module" or base_view
    return type_ok or held


@pytest.fixture
async def world(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_card_type(db, key="Open", label="Open")
    await create_card_type(db, key="Secret", label="Secret")
    await create_stakeholder_role_def(
        db, card_type_key="Secret", key="grants", permissions={"card.view": True}
    )
    await create_stakeholder_role_def(
        db, card_type_key="Secret", key="nogrant", permissions={"card.edit": True}
    )
    await create_stakeholder_role_def(
        db,
        card_type_key="Secret",
        key="archived",
        permissions={"card.view": True},
        is_archived=True,
    )
    open_card = await create_card(db, card_type="Open", name="Open card")
    secret_plain = await create_card(db, card_type="Secret", name="Secret plain")
    secret_held = await create_card(db, card_type="Secret", name="Secret held")
    return {"open": open_card, "plain": secret_plain, "held": secret_held}


class TestParityMatrix:
    @pytest.mark.parametrize("base_view", [True, False])
    @pytest.mark.parametrize("cell", [None, True, False])
    @pytest.mark.parametrize("standing", [None, "grants", "nogrant", "archived"])
    async def test_every_answer_agrees(self, db, world, base_view, cell, standing):
        await create_role(db, key="r", label="R", permissions={"inventory.view": base_view})
        user = await create_user(db, email=f"{uuid.uuid4().hex[:6]}@t.com", role="r")
        if cell is not None:
            await _set_cells(db, "Secret", {"r": {"inventory.view": cell}})
        if standing:
            await _hold(db, world["held"], user, standing)

        scope = await CardReadScope.load(db, user)
        cards = [
            (world["open"], None, False),
            (world["plain"], cell, False),
            (world["held"], cell, standing == "grants"),
        ]
        ids = [c.id for c, _, _ in cards]
        for mode in MODES:
            sql = set(
                (
                    await db.execute(
                        select(Card.id).where(Card.id.in_(ids), *scope.where(Card, mode=mode))
                    )
                ).scalars()
            )
            for card, card_cell, held in cards:
                want = _expected(base_view=base_view, cell=card_cell, mode=mode, held=held)
                label = f"{card.name} mode={mode}"
                assert (card.id in sql) is want, f"SQL disagrees: {label}"
                assert scope.readable(card.id, card.type, mode=mode) is want, f"Python: {label}"
                assert (await is_card_readable(db, user, card.id, mode=mode)) is want, (
                    f"single-card guard disagrees: {label}"
                )
                if mode == "inventory":
                    legacy = await PermissionService.check_permission(
                        db, user, "inventory.view", card.id, "card.view"
                    )
                    assert legacy is want, f"check_permission disagrees: {label}"


class TestFastPath:
    async def test_wildcard_ignores_stored_cells(self, db, world):
        admin = await create_user(db, email="a@t.com", role="admin")
        await _set_cells(db, "Secret", {"admin": {"inventory.view": False}})
        scope = await CardReadScope.load(db, admin)
        assert scope.wildcard
        for mode in MODES:
            assert scope.clause(Card, mode=mode) is None
            assert scope.readable(world["plain"].id, "Secret", mode=mode)

    async def test_no_cells_means_no_clause(self, db, world):
        """Every install until an admin sets a View cell runs unchanged SQL."""
        await create_role(db, key="r", label="R", permissions={"inventory.view": True})
        user = await create_user(db, email="u@t.com", role="r")
        scope = await CardReadScope.load(db, user)
        assert scope.clause(Card, mode="inventory") is None
        assert scope.clause(Card, mode="module") is None
        assert scope.stakeholder_card_ids == frozenset()

    async def test_module_mode_unrestricted_without_global_view(self, db, world):
        """A reports-only role keeps its reports: module mode subtracts only denies."""
        await create_role(db, key="r", label="R", permissions={"reports.ea_dashboard": True})
        user = await create_user(db, email="u@t.com", role="r")
        scope = await CardReadScope.load(db, user)
        assert scope.clause(Card, mode="module") is None
        assert not scope.can_browse_inventory

    async def test_everything_scope(self):
        scope = CardReadScope.everything()
        assert scope.is_unrestricted(mode="inventory")
        assert scope.is_unrestricted(mode="module")
        assert scope.can_browse_inventory


class TestScopeQuestions:
    async def test_allow_cell_opens_the_inventory(self, db, world):
        await create_role(db, key="r", label="R", permissions={})
        user = await create_user(db, email="u@t.com", role="r")
        await _set_cells(db, "Secret", {"r": {"inventory.view": True}})
        scope = await CardReadScope.load(db, user)
        assert scope.can_browse_inventory
        assert scope.type_readable("Secret", mode="inventory")
        assert not scope.type_readable("Open", mode="inventory")
        # Returned by the route helper, not refused.
        assert (await require_inventory_browse(db, user)).allowed_types == {"Secret"}

    async def test_no_view_no_allow_refuses_browse(self, db, world):
        from fastapi import HTTPException

        await create_role(db, key="r", label="R", permissions={})
        user = await create_user(db, email="u@t.com", role="r")
        with pytest.raises(HTTPException) as exc:
            await require_inventory_browse(db, user)
        assert exc.value.status_code == 403

    async def test_type_created_after_load_is_readable_in_module_mode(self, db, world):
        await create_role(db, key="r", label="R", permissions={"inventory.view": True})
        user = await create_user(db, email="u@t.com", role="r")
        await _set_cells(db, "Secret", {"r": {"inventory.view": False}})
        scope = await CardReadScope.load(db, user)
        await create_card_type(db, key="Later", label="Later")
        later = await create_card(db, card_type="Later", name="Later card")
        found = (
            await db.execute(
                select(Card.id).where(Card.id == later.id, *scope.where(Card, mode="module"))
            )
        ).scalar_one_or_none()
        assert found == later.id
        assert scope.readable(later.id, "Later", mode="module")

    async def test_readable_card_ids(self, db, world):
        await create_role(db, key="r", label="R", permissions={"inventory.view": True})
        user = await create_user(db, email="u@t.com", role="r")
        await _set_cells(db, "Secret", {"r": {"inventory.view": False}})
        scope = await CardReadScope.load(db, user)
        ids = {world["open"].id, world["plain"].id, uuid.uuid4()}
        assert await scope.readable_card_ids(db, ids, mode="module") == {world["open"].id}

    async def test_keep_hidden_merges_back_what_the_caller_never_saw(self, db, world):
        await create_role(db, key="r", label="R", permissions={"inventory.view": True})
        user = await create_user(db, email="u@t.com", role="r")
        await _set_cells(db, "Secret", {"r": {"inventory.view": False}})
        scope = await CardReadScope.load(db, user)
        existing = {world["open"].id: "Open", world["plain"].id: "Secret"}
        # The client saw only the Open card and removed it.
        assert scope.keep_hidden(existing, set(), mode="module") == {world["plain"].id}

    async def test_unknown_card_is_404(self, db, world):
        from fastapi import HTTPException

        await create_role(db, key="r", label="R", permissions={"inventory.view": True})
        user = await create_user(db, email="u@t.com", role="r")
        with pytest.raises(HTTPException) as exc:
            await require_card_readable(db, user, uuid.uuid4(), mode="module")
        assert exc.value.status_code == 404

    async def test_impersonation_uses_the_impersonated_role(self, db, world):
        await create_role(db, key="r", label="R", permissions={"inventory.view": True})
        admin = await create_user(db, email="a@t.com", role="admin")
        await _set_cells(db, "Secret", {"r": {"inventory.view": False}})
        token = request_impersonation.set((str(admin.id), "r"))
        try:
            scope = await CardReadScope.load(db, admin)
        finally:
            request_impersonation.reset(token)
        assert not scope.wildcard
        assert not scope.readable(world["plain"].id, "Secret", mode="module")

    async def test_cells_of_another_role_do_not_apply(self, db, world):
        await create_role(db, key="r", label="R", permissions={"inventory.view": True})
        await create_role(db, key="other", label="O", permissions={"inventory.view": True})
        user = await create_user(db, email="u@t.com", role="r")
        await _set_cells(db, "Secret", {"other": {"inventory.view": False}})
        scope = await CardReadScope.load(db, user)
        assert scope.clause(Card, mode="inventory") is None


class TestViewDenyRemovesLandscapeAuthority:
    """An explicit View deny takes every landscape-wide grant on the type away."""

    @pytest.fixture
    async def member(self, db, world):
        await create_role(
            db,
            key="r",
            label="R",
            permissions={
                "inventory.view": True,
                "inventory.edit": True,
                "comments.create": True,
                "ppm.view": True,
            },
        )
        user = await create_user(db, email="u@t.com", role="r")
        await _set_cells(db, "Secret", {"r": {"inventory.view": False, "inventory.edit": True}})
        return user

    async def test_has_app_permission(self, db, member):
        for perm in ("inventory.view", "inventory.edit", "comments.create", "ppm.view"):
            assert not await PermissionService.has_app_permission(
                db, member, perm, card_type_key="Secret"
            ), perm
            assert await PermissionService.has_app_permission(
                db, member, perm, card_type_key="Open"
            ), perm

    async def test_is_type_denied(self, db, member):
        assert await PermissionService.is_type_denied(db, member, "inventory.edit", "Secret")
        assert await PermissionService.is_type_denied(db, member, "comments.create", "Secret")
        assert not await PermissionService.is_type_denied(db, member, "inventory.edit", "Open")

    async def test_effective_card_permissions(self, db, world, member):
        eff = await PermissionService.get_effective_card_permissions(db, member, world["plain"].id)
        assert eff["effective"]["can_view"] is False
        assert eff["effective"]["can_edit"] is False
        assert eff["effective"]["can_create_comments"] is False

    async def test_stakeholder_authority_survives(self, db, world, member):
        await _hold(db, world["held"], member, "grants")
        eff = await PermissionService.get_effective_card_permissions(db, member, world["held"].id)
        assert eff["effective"]["can_view"] is True

    async def test_lacking_global_view_does_not_strip_other_grants(self, db, world):
        """Only an explicit deny cell strips; a role without View keeps its writes."""
        await create_role(db, key="w", label="W", permissions={"inventory.edit": True})
        user = await create_user(db, email="w@t.com", role="w")
        assert await PermissionService.has_app_permission(
            db, user, "inventory.edit", card_type_key="Secret"
        )
