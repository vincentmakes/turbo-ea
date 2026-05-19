"""Unit tests for `services/card_resolver.py` — name+path → card lookup."""

from __future__ import annotations

import pytest

from app.services.card_resolver import CardResolver, decode_ref, find_card_by_path
from tests.conftest import create_card, create_card_type, create_user


@pytest.fixture
async def resolver_env(db):
    """Cards across a 3-level hierarchy plus two same-name leaves in
    different branches so we can exercise ambiguity handling."""
    user = await create_user(db, email="resolver@test.com", role="member")
    await create_card_type(db, key="Organization", label="Organization", has_hierarchy=True)
    await create_card_type(db, key="Application", label="Application", has_hierarchy=True)

    root = await create_card(db, card_type="Organization", name="NexaTech", user_id=user.id)
    sales = await create_card(
        db, card_type="Organization", name="Sales", parent_id=root.id, user_id=user.id
    )
    eng = await create_card(
        db, card_type="Organization", name="Engineering", parent_id=root.id, user_id=user.id
    )
    # Two apps both called "CRM" but in different branches.
    crm_sales = await create_card(
        db, card_type="Application", name="CRM", parent_id=sales.id, user_id=user.id
    )
    crm_eng = await create_card(
        db, card_type="Application", name="CRM", parent_id=eng.id, user_id=user.id
    )
    # One unambiguous app at the root.
    erp = await create_card(db, card_type="Application", name="ERP", user_id=user.id)
    return {
        "user": user,
        "root": root,
        "sales": sales,
        "eng": eng,
        "crm_sales": crm_sales,
        "crm_eng": crm_eng,
        "erp": erp,
    }


def test_decode_ref_handles_escapes():
    assert decode_ref("") == []
    assert decode_ref("a / b / c") == ["a", "b", "c"]
    # Escaped slash stays inside the segment.
    assert decode_ref("a\\/b / c") == ["a/b", "c"]
    # Escaped backslash.
    assert decode_ref("a\\\\b") == ["a\\b"]


async def test_resolver_unambiguous_name(db, resolver_env):
    resolver = await CardResolver.load(db, {"Application"})
    outcome = resolver.resolve("Application", "ERP")
    assert outcome.status == "resolved"
    assert outcome.card_id == resolver_env["erp"].id


async def test_resolver_ambiguous_name_returns_candidates(db, resolver_env):
    resolver = await CardResolver.load(db, {"Application"})
    outcome = resolver.resolve("Application", "CRM")
    assert outcome.status == "ambiguous"
    assert outcome.candidates is not None
    paths = sorted(c.display_path for c in outcome.candidates)
    assert paths == ["NexaTech / Engineering / CRM", "NexaTech / Sales / CRM"]


async def test_resolver_path_disambiguates(db, resolver_env):
    resolver = await CardResolver.load(db, {"Application"})
    # Full ancestor chain (root → immediate parent) is required.
    outcome = resolver.resolve("Application", "NexaTech / Sales / CRM")
    assert outcome.status == "resolved"
    assert outcome.card_id == resolver_env["crm_sales"].id


async def test_resolver_missing_returns_missing(db, resolver_env):
    resolver = await CardResolver.load(db, {"Application"})
    outcome = resolver.resolve("Application", "DoesNotExist")
    assert outcome.status == "missing"


async def test_resolver_path_mismatch_is_missing(db, resolver_env):
    """A path that's a real ancestor name but doesn't match the chain
    of any actual card should come back missing, not resolved."""
    resolver = await CardResolver.load(db, {"Application"})
    outcome = resolver.resolve("Application", "Marketing / CRM")
    assert outcome.status == "missing"


async def test_resolver_archived_cards_are_excluded(db, resolver_env):
    """Archived cards must never match — archive is a soft-hide so the
    importer doesn't see them, just like the inventory UI."""
    resolver_env["erp"].status = "ARCHIVED"
    await db.flush()
    resolver = await CardResolver.load(db, {"Application"})
    outcome = resolver.resolve("Application", "ERP")
    assert outcome.status == "missing"


async def test_find_card_by_path_helper(db, resolver_env):
    """The convenience helper should match the resolver's behaviour."""
    outcome = await find_card_by_path(db, "Application", ["NexaTech", "Sales"], "CRM")
    assert outcome.status == "resolved"
    assert outcome.card_id == resolver_env["crm_sales"].id


async def test_resolver_case_insensitive(db, resolver_env):
    resolver = await CardResolver.load(db, {"Application"})
    outcome = resolver.resolve("Application", "erp")
    assert outcome.status == "resolved"
    outcome = resolver.resolve("Application", "nexatech / sales / crm")
    assert outcome.status == "resolved"
    assert outcome.card_id == resolver_env["crm_sales"].id
