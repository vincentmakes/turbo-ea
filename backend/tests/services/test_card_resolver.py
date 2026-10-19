"""Unit tests for `services/card_resolver.py` — name+path → card lookup."""

from __future__ import annotations

import pytest

from app.services.card_resolver import (
    CardResolver,
    decode_ref,
    find_card_by_path,
    unescape_whole,
)
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
    # Names holding a `/` (#1278) and a `<` (the control the issue named).
    sap = await create_card(db, card_type="Application", name="SAP S/4HANA", user_id=user.id)
    angle = await create_card(db, card_type="Application", name="A <B>", user_id=user.id)
    # A path homonym: "Billing" under "Ops", and a root card literally
    # named "Ops/Billing". The path reading must win.
    ops = await create_card(db, card_type="Application", name="Ops", user_id=user.id)
    billing = await create_card(
        db, card_type="Application", name="Billing", parent_id=ops.id, user_id=user.id
    )
    ops_billing = await create_card(
        db, card_type="Application", name="Ops/Billing", user_id=user.id
    )
    # Two "Dup" under "Ops" make the path reading of "Ops/Dup" ambiguous,
    # beside a root card literally named "Ops/Dup".
    await create_card(db, card_type="Application", name="Dup", parent_id=ops.id, user_id=user.id)
    await create_card(db, card_type="Application", name="Dup", parent_id=ops.id, user_id=user.id)
    await create_card(db, card_type="Application", name="Ops/Dup", user_id=user.id)
    # Two root cards with the same literal name.
    await create_card(db, card_type="Application", name="CI/CD", user_id=user.id)
    await create_card(db, card_type="Application", name="CI/CD", user_id=user.id)
    return {
        "user": user,
        "root": root,
        "sales": sales,
        "eng": eng,
        "crm_sales": crm_sales,
        "crm_eng": crm_eng,
        "erp": erp,
        "sap": sap,
        "angle": angle,
        "billing": billing,
        "ops_billing": ops_billing,
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


async def test_resolver_over_archived_cards_sees_only_those(db, resolver_env):
    """``status="ARCHIVED"`` flips the filter: the archived card resolves,
    its active siblings do not — workspace import matches an archived row
    against the archived card it already landed as this way."""
    resolver_env["erp"].status = "ARCHIVED"
    await db.flush()
    resolver = await CardResolver.load(db, {"Application"}, status="ARCHIVED")
    assert resolver.resolve("Application", "ERP").card_id == resolver_env["erp"].id
    assert resolver.resolve("Application", "CRM").status == "missing"


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


def test_unescape_whole_reads_one_name():
    assert unescape_whole("a\\/b") == "a/b"
    assert unescape_whole("a\\\\b") == "a\\b"
    assert unescape_whole(" x/y ") == "x/y"
    assert unescape_whole("x / y") == "x / y"
    # A trailing lone backslash escapes nothing and is kept, while an escape
    # that ends the string is still honoured.
    assert unescape_whole("a\\") == "a\\"
    assert unescape_whole("x\\/") == "x/"
    assert unescape_whole("a\\b") == "ab"
    assert unescape_whole("") == ""


async def test_unescaped_slash_is_a_path_without_the_fallback(db, resolver_env):
    """#1278: `SAP S/4HANA` read as a path is "4HANA" under "SAP S"."""
    resolver = await CardResolver.load(db, {"Application"})
    outcome = resolver.resolve("Application", "SAP S/4HANA")
    assert outcome.status == "missing"
    assert outcome.card_id is None


async def test_unescaped_slash_falls_back_to_the_literal_name(db, resolver_env):
    resolver = await CardResolver.load(db, {"Application"})
    outcome = resolver.resolve("Application", "SAP S/4HANA", literal_fallback=True)
    assert outcome.status == "resolved"
    assert outcome.card_id == resolver_env["sap"].id


async def test_escaped_slash_resolves_with_or_without_the_fallback(db, resolver_env):
    resolver = await CardResolver.load(db, {"Application"})
    for flag in (False, True):
        outcome = resolver.resolve("Application", "SAP S\\/4HANA", literal_fallback=flag)
        assert outcome.status == "resolved"
        assert outcome.card_id == resolver_env["sap"].id


async def test_the_path_reading_wins_over_a_literal_homonym(db, resolver_env):
    resolver = await CardResolver.load(db, {"Application"})
    outcome = resolver.resolve("Application", "Ops/Billing", literal_fallback=True)
    assert outcome.status == "resolved"
    assert outcome.card_id == resolver_env["billing"].id
    escaped = resolver.resolve("Application", "Ops\\/Billing", literal_fallback=True)
    assert escaped.status == "resolved"
    assert escaped.card_id == resolver_env["ops_billing"].id


async def test_an_ambiguous_path_reading_is_kept(db, resolver_env):
    """Ambiguous is an answer, not a miss: the literal "Ops/Dup" card must
    not be picked over the two "Dup" under "Ops"."""
    resolver = await CardResolver.load(db, {"Application"})
    outcome = resolver.resolve("Application", "Ops/Dup", literal_fallback=True)
    assert outcome.status == "ambiguous"
    assert outcome.card_id is None
    assert outcome.candidates is not None
    assert [c.parent_path for c in outcome.candidates] == [("Ops",), ("Ops",)]


async def test_two_literal_homonyms_are_ambiguous(db, resolver_env):
    resolver = await CardResolver.load(db, {"Application"})
    outcome = resolver.resolve("Application", "CI/CD", literal_fallback=True)
    assert outcome.status == "ambiguous"
    assert outcome.card_id is None
    assert outcome.candidates is not None
    assert [c.name for c in outcome.candidates] == ["CI/CD", "CI/CD"]


async def test_a_double_miss_keeps_the_path_reading(db, resolver_env):
    """When both readings miss, the path reading's result is returned: its
    candidates (same name, other chains) are what the caller can show."""
    resolver = await CardResolver.load(db, {"Application"})
    outcome = resolver.resolve("Application", "Marketing / CRM", literal_fallback=True)
    assert outcome.status == "missing"
    assert outcome.card_id is None
    assert outcome.candidates is not None
    assert len(outcome.candidates) == 2
    nowhere = resolver.resolve("Application", "Nowhere / At All", literal_fallback=True)
    assert nowhere.status == "missing"
    assert nowhere.candidates == []


async def test_a_single_segment_miss_stays_missing(db, resolver_env):
    resolver = await CardResolver.load(db, {"Application"})
    outcome = resolver.resolve("Application", "Nowhere", literal_fallback=True)
    assert outcome.status == "missing"
    assert outcome.card_id is None


async def test_angle_brackets_in_a_name_resolve(db, resolver_env):
    """The `<` control from #1278: nothing in the grammar treats it."""
    resolver = await CardResolver.load(db, {"Application"})
    for flag in (False, True):
        outcome = resolver.resolve("Application", "A <B>", literal_fallback=flag)
        assert outcome.status == "resolved"
        assert outcome.card_id == resolver_env["angle"].id
