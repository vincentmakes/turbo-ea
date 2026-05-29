"""Unit tests for the shared pure recurrence helpers.

These cover the calendar-correct date math and lead-time logic that both the
Risk Mitigation Task service and the recurring-Todo service rely on.
"""

from __future__ import annotations

from datetime import date

from app.services.recurrence import (
    RECURRENCE_UNITS,
    add_months,
    compute_next_due,
    default_lead_time_days,
    is_within_lead_window,
)

# ---------------------------------------------------------------------------
# add_months — Jan 31 + 1 month MUST land on Feb 28/29, not Mar 3
# ---------------------------------------------------------------------------


def test_add_months_simple_addition_within_year():
    assert add_months(date(2026, 3, 15), 2) == date(2026, 5, 15)


def test_add_months_crosses_year_boundary():
    assert add_months(date(2026, 11, 5), 3) == date(2027, 2, 5)


def test_add_months_clamps_to_last_day_of_short_month():
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2024, 1, 31), 1) == date(2024, 2, 29)


def test_add_months_clamps_31_to_30_day_month():
    assert add_months(date(2026, 3, 31), 1) == date(2026, 4, 30)


def test_add_months_handles_year_jumps():
    assert add_months(date(2026, 5, 14), 24) == date(2028, 5, 14)


# ---------------------------------------------------------------------------
# compute_next_due
# ---------------------------------------------------------------------------


def test_compute_next_due_none_unit_returns_none():
    assert compute_next_due(date(2026, 1, 1), "none", 1) is None


def test_compute_next_due_zero_interval_returns_none():
    assert compute_next_due(date(2026, 1, 1), "months", 0) is None


def test_compute_next_due_days():
    assert compute_next_due(date(2026, 1, 1), "days", 10) == date(2026, 1, 11)


def test_compute_next_due_weeks():
    assert compute_next_due(date(2026, 1, 1), "weeks", 2) == date(2026, 1, 15)


def test_compute_next_due_months_clamps():
    assert compute_next_due(date(2026, 1, 31), "months", 1) == date(2026, 2, 28)


def test_compute_next_due_years():
    assert compute_next_due(date(2024, 2, 29), "years", 1) == date(2025, 2, 28)


def test_compute_next_due_unknown_unit_returns_none():
    assert compute_next_due(date(2026, 1, 1), "fortnights", 1) is None


# ---------------------------------------------------------------------------
# default_lead_time_days
# ---------------------------------------------------------------------------


def test_default_lead_time_one_shot_is_zero():
    assert default_lead_time_days("none", 1) == 0


def test_default_lead_time_per_unit_defaults():
    assert default_lead_time_days("days", 30) == 1
    assert default_lead_time_days("weeks", 8) == 2
    assert default_lead_time_days("months", 6) == 7
    assert default_lead_time_days("years", 1) == 14


def test_default_lead_time_capped_at_half_cycle():
    # Every 2 weeks → cap at floor(14/2)=7, but the 2-day base wins.
    assert default_lead_time_days("weeks", 2) == 2
    # Every 1 week → cap at floor(7/2)=3, base 2 still wins.
    assert default_lead_time_days("weeks", 1) == 2
    # Yearly cap is huge, so the 14-day base applies.
    assert default_lead_time_days("years", 1) == 14


# ---------------------------------------------------------------------------
# is_within_lead_window
# ---------------------------------------------------------------------------


def test_is_within_lead_window_null_due_always_in_window():
    assert is_within_lead_window(None, 7, date(2026, 1, 1)) is True


def test_is_within_lead_window_inside():
    # due 2026-01-10, lead 7 → window opens 2026-01-03
    assert is_within_lead_window(date(2026, 1, 10), 7, date(2026, 1, 3)) is True
    assert is_within_lead_window(date(2026, 1, 10), 7, date(2026, 1, 10)) is True


def test_is_within_lead_window_outside():
    assert is_within_lead_window(date(2026, 1, 10), 7, date(2026, 1, 2)) is False


def test_is_within_lead_window_negative_lead_clamps_to_zero():
    # Negative lead behaves like 0 → only in window on/after the due date.
    assert is_within_lead_window(date(2026, 1, 10), -5, date(2026, 1, 9)) is False
    assert is_within_lead_window(date(2026, 1, 10), -5, date(2026, 1, 10)) is True


def test_recurrence_units_constant():
    assert RECURRENCE_UNITS == ("none", "days", "weeks", "months", "years")
