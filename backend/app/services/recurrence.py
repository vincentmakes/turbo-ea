"""Shared, dependency-free recurrence helpers.

Pure calendar/lead-time math used by both the Risk Mitigation Task service
(``risk_mitigation_task_service.py``) and the recurring-Todo service
(``todo_recurrence_service.py``). Keeping these here means the two features
share one implementation of "what's the next due date" and "is this cycle in
its lead-time window" rather than drifting apart.

Nothing in this module imports models or the DB — it operates on plain
``date`` / ``int`` / ``str`` values so it is trivially unit-testable.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta

RECURRENCE_UNITS = ("none", "days", "weeks", "months", "years")

# Smart lead-time defaults per recurrence unit. Picked so the assignee gets a
# useful reminder window without sitting on an open Todo for the bulk of the
# cycle. See ``default_lead_time_days`` for the cap logic.
_LEAD_TIME_DEFAULT_BY_UNIT: dict[str, int] = {
    "none": 0,
    "days": 1,
    "weeks": 2,
    "months": 7,
    "years": 14,
}

# Approximate day length per unit, used for the "cap at half the cycle" rule
# so a 2-week cycle doesn't end up with a 7-day lead window overlapping the
# previous cycle.
_DAYS_IN_UNIT: dict[str, int] = {
    "days": 1,
    "weeks": 7,
    "months": 30,
    "years": 365,
}


def add_months(start: date, months: int) -> date:
    """Add ``months`` calendar months to ``start``, clamping the day to the
    last day of the target month so Jan 31 + 1 month → Feb 28 (or 29 in
    leap years) rather than overflowing into March.
    """
    total = start.year * 12 + (start.month - 1) + months
    year, month_index = divmod(total, 12)
    month = month_index + 1
    last_day = monthrange(year, month)[1]
    return date(year, month, min(start.day, last_day))


def compute_next_due(prev_due: date, unit: str, interval: int) -> date | None:
    """Return the next occurrence's due date, or ``None`` for one-shot tasks.

    Interval must be ≥ 1. Day-of-month is clamped on months/years.
    """
    if unit == "none" or interval < 1:
        return None
    if unit == "days":
        return prev_due + timedelta(days=interval)
    if unit == "weeks":
        return prev_due + timedelta(weeks=interval)
    if unit == "months":
        return add_months(prev_due, interval)
    if unit == "years":
        return add_months(prev_due, interval * 12)
    return None


def default_lead_time_days(unit: str, interval: int) -> int:
    """Return the recommended lead-time (in days) for a given recurrence.

    Returns ``0`` for one-shot tasks (no roll-forward to gate). For recurring
    tasks the per-unit default is capped at half the cycle in days, so a
    fortnightly task never gets a lead window large enough to overlap the
    previous cycle. The frontend ``recurrence`` helper mirrors this exact
    computation so the UI's suggested default matches what the server picks
    when no value is supplied.
    """
    if unit == "none" or interval < 1:
        return 0
    base = _LEAD_TIME_DEFAULT_BY_UNIT.get(unit, 0)
    days_per_unit = _DAYS_IN_UNIT.get(unit, 0)
    if days_per_unit == 0:
        return 0
    cap = max(1 if unit != "days" else 0, (interval * days_per_unit) // 2)
    return min(base, cap)


def is_within_lead_window(due_date: date | None, lead_time_days: int, today: date) -> bool:
    """Return True if ``today`` is on or after ``due_date - lead_time_days``.

    A NULL ``due_date`` is treated as "no scheduled deadline" — the cycle is
    always in window (and therefore always opens immediately). Negative
    ``lead_time_days`` clamp to 0 to match the column constraint.
    """
    if due_date is None:
        return True
    lead = max(0, lead_time_days)
    return today >= due_date - timedelta(days=lead)
