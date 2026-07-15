"""Unit tests for the human-readable card reference generator (#811).

The number is always system-generated; a human may only vary the prefix.
Sequences are keyed by PREFIX, globally across all card types.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.services import card_reference
from app.services.card_reference import ReferenceConfigError, validate_reference_config
from tests.conftest import create_card, create_card_type, create_user

# ── Pure config validation ──────────────────────────────────────────────


def test_validate_defaults_when_none():
    cfg = validate_reference_config(None)
    assert cfg == {"mode": "off", "prefix": "", "start": 10000, "padding": 0}


def test_validate_accepts_auto():
    assert validate_reference_config(
        {"mode": "auto", "prefix": "APP-", "start": 5, "padding": 4}
    ) == {
        "mode": "auto",
        "prefix": "APP-",
        "start": 5,
        "padding": 4,
    }


@pytest.mark.parametrize(
    "bad",
    [
        {"mode": "manual"},  # old modes no longer valid
        {"mode": "custom"},
        {"mode": "bogus"},
        {"mode": "auto", "prefix": "has space"},
        {"mode": "auto", "prefix": "x" * 40},
        {"mode": "auto", "start": -1},
        {"mode": "auto", "padding": 99},
    ],
)
def test_validate_rejects_bad_config(bad):
    with pytest.raises(ReferenceConfigError):
        validate_reference_config(bad)


def test_validate_prefix():
    assert card_reference.validate_prefix("APP-") == "APP-"
    assert card_reference.validate_prefix("") == ""
    with pytest.raises(ReferenceConfigError):
        card_reference.validate_prefix("bad space")


# ── Pure formatting ─────────────────────────────────────────────────────


def test_format_reference_padding():
    assert card_reference.format_reference("APP-", 0, 10000) == "APP-10000"
    assert card_reference.format_reference("APP-", 6, 42) == "APP-000042"
    assert card_reference.format_reference("", 0, 7) == "7"


def test_format_reference_padding_is_a_minimum_not_a_cap():
    # Min-digits pads up to the width but never truncates: APP-999 -> APP-1000.
    assert card_reference.format_reference("APP-", 3, 999) == "APP-999"
    assert card_reference.format_reference("APP-", 3, 1000) == "APP-1000"
    assert card_reference.format_reference("APP-", 3, 12345) == "APP-12345"


# ── Helpers ─────────────────────────────────────────────────────────────


async def _typed(db, key, mode, prefix="APP-", start=10000, padding=0):
    ct = await create_card_type(db, key=key, label=key)
    ct.reference_config = {"mode": mode, "prefix": prefix, "start": start, "padding": padding}
    await db.flush()
    return ct


async def _card_with_ref(db, user, card_type, ref, name="C"):
    c = await create_card(db, card_type=card_type, name=name, user_id=user.id)
    c.reference = ref
    await db.flush()
    return c


# ── Generator (DB-backed) ───────────────────────────────────────────────


async def test_next_reference_none_for_off(db):
    off = await _typed(db, "Application", "off")
    assert await card_reference.next_reference(db, off) is None


async def test_next_reference_auto_uses_fixed_prefix(db):
    ct = await _typed(db, "Application", "auto", prefix="APP-", start=10000)
    assert await card_reference.next_reference(db, ct) == "APP-10000"


async def test_next_reference_for_prefix_first_equals_start(db):
    assert await card_reference.next_reference_for_prefix(db, "SVC-", 1, 4) == "SVC-0001"


async def test_next_reference_monotonic_and_gap_preserving(db):
    user = await create_user(db, email="ref@test.com", role="member")
    await create_card_type(db, key="Application", label="Application")
    await _card_with_ref(db, user, "Application", "APP-10005")
    # Gap below max is never backfilled — always max+1.
    assert await card_reference.next_reference_for_prefix(db, "APP-", 10000, 0) == "APP-10006"


async def test_sequence_is_global_per_prefix_across_types(db):
    """A prefix forms ONE series across all card types → no cross-type collision."""
    user = await create_user(db, email="glob@test.com", role="member")
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="BusinessProcess", label="BusinessProcess")
    # An Application already holds APP-10000...
    await _card_with_ref(db, user, "Application", "APP-10000")
    # ...so the SAME prefix on a different type continues the series, never 10000 again.
    assert await card_reference.next_reference_for_prefix(db, "APP-", 10000, 0) == "APP-10001"
    # A different prefix stays independent.
    assert await card_reference.next_reference_for_prefix(db, "PRC-", 1, 0) == "PRC-1"


async def test_backfill_auto_assigns_sequential_by_creation(db):
    user = await create_user(db, email="bf@test.com", role="member")
    ct = await _typed(db, "Application", "auto", prefix="APP-", start=10000)
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    c1 = await create_card(db, card_type="Application", name="First", user_id=user.id)
    c2 = await create_card(db, card_type="Application", name="Second", user_id=user.id)
    c1.created_at = base
    c2.created_at = base + timedelta(minutes=1)
    await db.flush()
    assert await card_reference.backfill_references_for_type(db, ct) == 2
    await db.flush()
    assert c1.reference == "APP-10000"
    assert c2.reference == "APP-10001"


async def test_backfill_noop_for_off(db):
    user = await create_user(db, email="bfo@test.com", role="member")
    ct = await _typed(db, "Application", "off")
    await create_card(db, card_type="Application", name="X", user_id=user.id)
    assert await card_reference.backfill_references_for_type(db, ct) == 0
