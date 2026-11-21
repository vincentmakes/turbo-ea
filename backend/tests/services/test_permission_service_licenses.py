"""License visibility and editing depend on app and per-card grants."""

from __future__ import annotations

from sqlalchemy import select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.services.permission_service import PermissionService
from tests.conftest import (
    create_card,
    create_role,
    create_stakeholder_role_def,
    create_user,
)


async def _stake(db, *, user, card, role="responsible"):
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role=role))
    await db.flush()


async def _roles(db):
    for key, edit in (("resp_l", True), ("observer_l", False)):
        await create_stakeholder_role_def(
            db,
            key=key,
            label=key,
            permissions={"card.view": True, "card.edit": edit, "card.view_licenses": edit},
        )


async def test_observer_cannot_view_or_edit_licenses_without_grant(db, app_card_type):
    await _roles(db)
    await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
    user = await create_user(db, role="viewer")
    card = await create_card(db, card_type="Application")
    await _stake(db, user=user, card=card, role="observer_l")

    assert await PermissionService.can_view_licenses(db, user, card.id) is False
    assert await PermissionService.can_edit_licenses(db, user, card.id) is False
    assert await PermissionService.card_ids_with_license_access(db, user, [card.id]) == set()


async def test_view_by_permission_or_granted_stakeholder(db, app_card_type):
    await _roles(db)
    await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
    user = await create_user(db, role="viewer")
    a = await create_card(db, card_type="Application", name="A")
    b = await create_card(db, card_type="Application", name="B")
    await _stake(db, user=user, card=a, role="resp_l")

    assert await PermissionService.can_view_licenses(db, user, a.id) is True
    assert await PermissionService.can_view_licenses(db, user, b.id) is False

    await create_role(db, key="lic", permissions={"licenses.view": True})
    holder = await create_user(db, role="lic", email="lic@x.com")
    assert await PermissionService.can_view_licenses(db, holder, b.id) is True


async def test_edit_needs_licenses_edit_or_card_edit_stakeholder(db, app_card_type):
    await _roles(db)
    await create_role(
        db, key="member", permissions={"inventory.view": True, "inventory.edit": True}
    )
    user = await create_user(db, role="member")
    mine = await create_card(db, card_type="Application", name="Mine")
    other = await create_card(db, card_type="Application", name="Other")

    assert await PermissionService.can_edit_licenses(db, user, mine.id) is False

    await _stake(db, user=user, card=mine, role="resp_l")
    assert await PermissionService.can_edit_licenses(db, user, mine.id) is True
    assert await PermissionService.can_edit_licenses(db, user, other.id) is False

    await create_role(db, key="lic_ed", permissions={"licenses.view": True, "licenses.edit": True})
    editor = await create_user(db, role="lic_ed", email="ed@x.com")
    assert await PermissionService.can_edit_licenses(db, editor, other.id) is True


async def test_bulk_access_matches_single(db, app_card_type):
    await _roles(db)
    await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
    user = await create_user(db, role="viewer")
    cards = [await create_card(db, card_type="Application", name=f"C{i}") for i in range(3)]
    await _stake(db, user=user, card=cards[1], role="resp_l")
    ids = [c.id for c in cards]

    bulk = await PermissionService.card_ids_with_license_access(db, user, ids)
    single = {i for i in ids if await PermissionService.can_view_licenses(db, user, i)}
    assert bulk == single == {cards[1].id}

    await create_role(db, key="lic", permissions={"licenses.view": True})
    holder = await create_user(db, role="lic", email="lic@x.com")
    assert await PermissionService.card_ids_with_license_access(db, holder, ids) == set(ids)
    assert await PermissionService.card_ids_with_license_access(db, holder, []) == set()


async def test_type_deny_is_applied_to_single_and_bulk_licenses(db, app_card_type):
    await _roles(db)
    await create_role(db, key="licensed", permissions={"licenses.view": True})
    user = await create_user(db, role="licensed")
    owned = await create_card(db, card_type="Application", name="Owned")
    observed = await create_card(db, card_type="Application", name="Observed")
    await _stake(db, user=user, card=owned, role="resp_l")
    await _stake(db, user=user, card=observed, role="observer_l")
    card_type = (
        await db.execute(select(CardType).where(CardType.key == "Application"))
    ).scalar_one()
    card_type.role_permissions = {"licensed": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()

    assert await PermissionService.can_view_licenses(db, user, owned.id) is True
    assert await PermissionService.can_view_licenses(db, user, observed.id) is False
    assert await PermissionService.card_ids_with_license_access(
        db, user, [owned.id, observed.id]
    ) == {owned.id}
    effective = await PermissionService.get_effective_card_permissions(db, user, observed.id)
    assert effective["effective"]["can_view_licenses"] is False


async def test_license_edit_requires_visibility(db, app_card_type):
    await create_role(db, key="license_editor", permissions={"licenses.edit": True})
    user = await create_user(db, role="license_editor")
    card = await create_card(db, card_type="Application")
    assert await PermissionService.can_edit_licenses(db, user, card.id) is False
