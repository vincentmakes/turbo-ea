"""Shared lifecycle-phase helpers.

The phase precedence used here — ``endOfLife`` before ``phaseOut`` before
``active`` … — is the same array the frontend's ``LifecycleBadge`` and the
inventory grid use, so a card's "current phase" is identical everywhere it is
displayed or sorted. Keep the three in sync.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime, timezone

from app.services.fiscal_year import fiscal_year_for

# Most-advanced phase first: a card whose endOfLife date has passed is at end
# of life even though its `active` date also passed.
PHASE_PRECEDENCE = ("endOfLife", "phaseOut", "active", "phaseIn", "plan")

# Chronological order, used as the fallback when every date is still ahead.
PHASE_CHRONOLOGICAL = ("plan", "phaseIn", "active", "phaseOut", "endOfLife")


def parse_lifecycle_date(value: object) -> date | None:
    """A lifecycle phase date, or ``None`` when absent or unparseable.

    Accepts the ``YYYY-MM-DD`` the UI writes and an ISO timestamp (``…T…``),
    which imports and the API have been known to store.
    """
    if not value:
        return None
    try:
        text = str(value)
        if "T" in text:
            return datetime.fromisoformat(text).date()
        return datetime.strptime(text, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def current_lifecycle_phase(lifecycle: dict | None) -> str | None:
    """Determine which lifecycle phase a card is currently in based on dates."""
    if not lifecycle:
        return None
    today = datetime.now(timezone.utc).date()
    for phase in PHASE_PRECEDENCE:
        d = parse_lifecycle_date(lifecycle.get(phase))
        if d is not None and d <= today:
            return phase
    # If all dates are in the future, return the earliest set phase
    for phase in PHASE_CHRONOLOGICAL:
        if lifecycle.get(phase):
            return phase
    return None


def lifecycle_rank(lifecycle: dict | None) -> int:
    """Sort key ordering cards by how urgent their phase is.

    Risk-first: end-of-life and phasing-out cards sort above healthy ones, and
    cards with no lifecycle data sort last. This is the ordering that makes a
    read-only overview list actionable — the rows needing attention are the
    ones you see without scrolling.
    """
    phase = current_lifecycle_phase(lifecycle)
    if phase is None:
        return len(PHASE_PRECEDENCE)
    return PHASE_PRECEDENCE.index(phase)


# Phases that only ever *precede* going live. A card dated in one of these but
# not in ``active`` has not started yet — the same reading as the frontend's
# ``hasStartedByDate`` (``features/reports/portfolioHelpers.ts``), which every
# time-travel report filters with.
_PLANNED_PHASES = ("plan", "phaseIn")


def is_live_in_fiscal_year(lifecycle: dict | None, fiscal_year: int, start_month: int) -> bool:
    """Whether a card is part of the landscape during ``fiscal_year``.

    The cost reports use this to decide whether a card's *annual* cost counts
    in a fiscal year, and they deliberately do not pro-rate: the cost counts in
    full in every fiscal year from the one the card goes ``active`` in through
    the one its ``endOfLife`` falls in, both ends included. So a card retiring
    in November still carries its whole annual cost for that year, and none in
    the next.

    Missing dates follow the time-travel reports' rules, at fiscal-year rather
    than day granularity:

    * no ``active`` date but a ``plan`` / ``phaseIn`` date → still planned, so
      never live;
    * no start date at all → live from the beginning of time;
    * no ``endOfLife`` → never retires.

    A card with no lifecycle dates at all is therefore live in every year,
    which is what the cost report showed before it knew about lifecycles.
    """
    lc = lifecycle or {}
    active = parse_lifecycle_date(lc.get("active"))
    if active is not None:
        if fiscal_year_for(active, start_month) > fiscal_year:
            return False
    elif any(parse_lifecycle_date(lc.get(p)) is not None for p in _PLANNED_PHASES):
        return False
    end_of_life = parse_lifecycle_date(lc.get("endOfLife"))
    return end_of_life is None or fiscal_year <= fiscal_year_for(end_of_life, start_month)


def fiscal_year_span(
    lifecycles: Iterable[dict | None], start_month: int, current_fy: int
) -> tuple[int, int]:
    """The fiscal years worth offering a picker over, as ``(first, last)``.

    Covers the fiscal year of every ``active`` and ``endOfLife`` date — the only
    two dates that move a card in or out of a year — plus the current one,
    widened by a year each side so the picker can show the year *before* the
    first card goes live and the year *after* the last one retires. That is the
    same one-year padding ``computeTimelineRange`` gives the date slider.
    """
    years = {current_fy}
    for lc in lifecycles:
        if not lc:
            continue
        for phase in ("active", "endOfLife"):
            d = parse_lifecycle_date(lc.get(phase))
            if d is not None:
                years.add(fiscal_year_for(d, start_month))
    return min(years) - 1, max(years) + 1
