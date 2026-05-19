"""Unit tests for `services/card_uniqueness.check_sibling_name_unique`."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.services.card_uniqueness import check_sibling_name_unique
from tests.conftest import create_card, create_card_type, create_user


@pytest.fixture
async def uniq_env(db):
    user = await create_user(db, email="uniq@test.com", role="member")
    await create_card_type(db, key="Application", label="Application", has_hierarchy=True)
    await create_card_type(db, key="Organization", label="Organization", has_hierarchy=True)
    return {"user": user}


async def test_same_type_parent_and_name_raises_409(db, uniq_env):
    user = uniq_env["user"]
    await create_card(db, card_type="Application", name="ERP", user_id=user.id)
    with pytest.raises(HTTPException) as exc:
        await check_sibling_name_unique(db, type_key="Application", parent_id=None, name="ERP")
    assert exc.value.status_code == 409
    assert "ERP" in exc.value.detail


async def test_same_name_different_parent_is_ok(db, uniq_env):
    """Two `Marketing` orgs under different parents must remain allowed —
    the ref format disambiguates them via `parent_path`."""
    user = uniq_env["user"]
    europe = await create_card(db, card_type="Organization", name="Europe", user_id=user.id)
    americas = await create_card(db, card_type="Organization", name="Americas", user_id=user.id)
    await create_card(
        db, card_type="Organization", name="Marketing", parent_id=europe.id, user_id=user.id
    )
    # Different parent → no collision.
    await check_sibling_name_unique(
        db, type_key="Organization", parent_id=americas.id, name="Marketing"
    )


async def test_same_name_different_type_is_ok(db, uniq_env):
    user = uniq_env["user"]
    await create_card(db, card_type="Application", name="Reporting", user_id=user.id)
    # Same name as the Application above but under a different type.
    await check_sibling_name_unique(db, type_key="Organization", parent_id=None, name="Reporting")


async def test_case_and_whitespace_insensitive(db, uniq_env):
    """Casing / trailing spaces must not let users sneak past the
    constraint — the resolver normalises the same way."""
    user = uniq_env["user"]
    await create_card(db, card_type="Application", name="CRM", user_id=user.id)
    with pytest.raises(HTTPException) as exc:
        await check_sibling_name_unique(db, type_key="Application", parent_id=None, name="crm ")
    assert exc.value.status_code == 409


async def test_exclude_card_id_skips_self(db, uniq_env):
    """Renaming a card back to its own current name must not collide."""
    user = uniq_env["user"]
    crm = await create_card(db, card_type="Application", name="CRM", user_id=user.id)
    await check_sibling_name_unique(
        db,
        type_key="Application",
        parent_id=None,
        name="CRM",
        exclude_card_id=crm.id,
    )


async def test_archived_cards_dont_count(db, uniq_env):
    """Archived siblings are invisible to the resolver and so should not
    block new sibling creation."""
    user = uniq_env["user"]
    old = await create_card(db, card_type="Application", name="CRM", user_id=user.id)
    old.status = "ARCHIVED"
    await db.flush()
    # No collision — old CRM is archived.
    await check_sibling_name_unique(db, type_key="Application", parent_id=None, name="CRM")


async def test_empty_name_is_a_no_op(db, uniq_env):
    """An empty name fails earlier `nullable=False` validation; the
    uniqueness check is forgiving and just returns."""
    await check_sibling_name_unique(db, type_key="Application", parent_id=None, name="   ")
