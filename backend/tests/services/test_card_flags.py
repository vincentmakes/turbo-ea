"""Unit tests for the shared card health-flag helpers.

``staleness_cutoff`` resolves the survey builder's caller-supplied "not
updated for N days/months" window. It needs no database, and its contract is
load-bearing in two directions: the cut-off it returns must match the date the
builder previews to the admin, and every malformed input must degrade to
``None`` (= no filter) rather than raising or silently matching nothing.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.services.card_flags import (
    MAX_STALENESS_BY_UNIT,
    STALE_AFTER_DAYS,
    STALENESS_UNITS,
    not_updated_condition,
    stale_cutoff,
    staleness_cutoff,
)

NOW = datetime(2026, 8, 25, 14, 30, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# staleness_cutoff — days
# ---------------------------------------------------------------------------


def test_days_subtracts_exactly():
    assert staleness_cutoff(30, "days", now=NOW) == NOW - timedelta(days=30)


def test_days_preserves_time_of_day():
    cutoff = staleness_cutoff(1, "days", now=NOW)
    assert (cutoff.hour, cutoff.minute) == (14, 30)


# ---------------------------------------------------------------------------
# staleness_cutoff — months are calendar months, not 30-day blocks
# ---------------------------------------------------------------------------


def test_months_lands_on_same_day_of_month():
    assert staleness_cutoff(6, "months", now=NOW).date() == datetime(2026, 2, 25).date()


def test_months_crosses_year_boundary():
    assert staleness_cutoff(12, "months", now=NOW).date() == datetime(2025, 8, 25).date()


def test_months_clamps_day_to_shorter_target_month():
    """Mar 31 − 1 month is Feb 28, not Mar 3."""
    now = datetime(2026, 3, 31, 9, 0, tzinfo=timezone.utc)
    assert staleness_cutoff(1, "months", now=now).date() == datetime(2026, 2, 28).date()


def test_months_clamps_into_leap_february():
    now = datetime(2028, 3, 31, 9, 0, tzinfo=timezone.utc)
    assert staleness_cutoff(1, "months", now=now).date() == datetime(2028, 2, 29).date()


def test_months_is_not_a_thirty_day_approximation():
    """A 30-day subtraction from Aug 25 gives Jul 26 — the calendar answer is
    Jul 25. If these ever coincide the month path has regressed to timedelta."""
    assert staleness_cutoff(1, "months", now=NOW) != NOW - timedelta(days=30)


# ---------------------------------------------------------------------------
# Timezone handling — Card.updated_at is timezone-aware
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("unit", STALENESS_UNITS)
def test_cutoff_is_timezone_aware(unit):
    assert staleness_cutoff(3, unit, now=NOW).tzinfo is not None


@pytest.mark.parametrize("unit", STALENESS_UNITS)
def test_naive_now_is_treated_as_utc(unit):
    cutoff = staleness_cutoff(3, unit, now=NOW.replace(tzinfo=None))
    assert cutoff.tzinfo == timezone.utc


def test_defaults_to_now_when_not_supplied():
    cutoff = staleness_cutoff(1, "days")
    assert abs((datetime.now(timezone.utc) - timedelta(days=1) - cutoff).total_seconds()) < 60


# ---------------------------------------------------------------------------
# Malformed input degrades to None (= no filter), never an exception
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("value", [0, -1, -30, None, "6", 6.5, True, False, [6], {"value": 6}])
def test_bad_value_returns_none(value):
    assert staleness_cutoff(value, "days", now=NOW) is None


@pytest.mark.parametrize("unit", STALENESS_UNITS)
def test_value_above_cap_returns_none(unit):
    assert staleness_cutoff(MAX_STALENESS_BY_UNIT[unit] + 1, unit, now=NOW) is None


@pytest.mark.parametrize("unit", STALENESS_UNITS)
def test_value_at_cap_is_accepted(unit):
    assert staleness_cutoff(MAX_STALENESS_BY_UNIT[unit], unit, now=NOW) is not None


@pytest.mark.parametrize("unit", STALENESS_UNITS)
def test_absurd_value_does_not_raise(unit):
    """Unbounded input would OverflowError/ValueError out of timedelta/date —
    the cap is what keeps a hand-edited filter from 500ing the preview."""
    assert staleness_cutoff(10**9, unit, now=NOW) is None


@pytest.mark.parametrize("unit", ["weeks", "years", "day", "", None, 1, "DAYS"])
def test_bad_unit_returns_none(unit):
    assert staleness_cutoff(6, unit, now=NOW) is None


# ---------------------------------------------------------------------------
# not_updated_condition — the survey target-filter adapter
# ---------------------------------------------------------------------------


def test_condition_built_for_a_well_formed_window():
    assert not_updated_condition({"not_updated_for": {"value": 90, "unit": "days"}}) is not None


@pytest.mark.parametrize(
    "filters",
    [
        None,
        {},
        "not-a-dict",
        {"not_updated_for": None},
        {"not_updated_for": "6 months"},
        {"not_updated_for": {}},
        {"not_updated_for": {"value": 6}},
        {"not_updated_for": {"unit": "months"}},
        {"not_updated_for": {"value": 0, "unit": "days"}},
        {"not_updated_for": {"value": 6, "unit": "weeks"}},
    ],
)
def test_absent_or_malformed_window_yields_no_condition(filters):
    assert not_updated_condition(filters) is None


def test_other_filter_keys_are_ignored():
    assert not_updated_condition({"tag_ids": ["x"], "card_ids": ["y"]}) is None


# ---------------------------------------------------------------------------
# The fixed product-wide threshold still behaves
# ---------------------------------------------------------------------------


def test_stale_cutoff_matches_the_documented_threshold():
    assert (
        abs(
            (
                datetime.now(timezone.utc) - timedelta(days=STALE_AFTER_DAYS) - stale_cutoff()
            ).total_seconds()
        )
        < 60
    )
