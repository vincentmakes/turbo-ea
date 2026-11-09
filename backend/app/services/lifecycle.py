"""Shared lifecycle-phase helpers.

The phase precedence used here — ``endOfLife`` before ``phaseOut`` before
``active`` … — is the same array the frontend's ``LifecycleBadge`` and the
inventory grid use, so a card's "current phase" is identical everywhere it is
displayed or sorted. Keep the three in sync.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import and_, case, cast, func, literal
from sqlalchemy.dialects.postgresql import JSONB

from app.models.card import Card
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


#: A stored phase date ``parse_lifecycle_date`` reads: ``YYYY-MM-DD``, optionally
#: followed by an ISO time part (``T…``). The SQL twin compares the first ten
#: characters as text, so a value this pattern rejects can never reach a
#: comparison — one malformed card must not fail the whole inventory, which a
#: ``::date`` cast would.
_SQL_DATE_PATTERN = r"^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9:.,+Z-]+)?$"

#: The JSON values Python reads as falsy (``if lifecycle.get(phase)``): null,
#: ``""``, ``0``, ``false``, ``[]`` and ``{}``. JSONB compares numbers by
#: value, so ``0.0`` matches ``0`` as it does in Python.
_JSON_FALSY = ("null", '""', "0", "false", "[]", "{}")


def current_lifecycle_phase_sql(card: Any = Card, *, today: date | None = None) -> Any:
    """``current_lifecycle_phase`` as a SQL expression over ``card.lifecycle``
    (``Card`` or an ``aliased(Card)``): the phase key, or NULL.

    The first CASE branches walk ``PHASE_PRECEDENCE`` — the most advanced phase
    whose date has passed — and the rest ``PHASE_CHRONOLOGICAL`` on "any truthy
    value", the Python fallback when every date is still ahead.

    Dates are compared as **text** (``left(value, 10) <= today``) behind a
    regular expression guard, never cast to ``date``. ``today`` is bound from
    Python's UTC clock — the Python twin's clock — rather than SQL
    ``current_date``, which is transaction-constant and the server's zone.

    Known divergence from the Python twin: an impossible calendar date
    (``2025-02-30``), a malformed time part after ``T``, or a date Python's
    ``strptime`` accepts without zero padding (``2025-1-5``) reads differently.
    The UI only ever writes zero-padded ``YYYY-MM-DD``.
    """
    today_text = (today or datetime.now(timezone.utc).date()).isoformat()
    # Bound as text (a Python ``str`` binds as one) and cast, so each literal
    # is parsed as JSON rather than serialised again as a JSON string.
    falsy = [cast(literal(value), JSONB) for value in _JSON_FALSY]
    whens: list[tuple[Any, str]] = []
    for phase in PHASE_PRECEDENCE:
        text = card.lifecycle[phase].astext
        whens.append(
            (
                and_(text.regexp_match(_SQL_DATE_PATTERN), func.left(text, 10) <= today_text),
                phase,
            )
        )
    # An absent key (or a NULL ``lifecycle``) is SQL NULL, and ``NULL NOT IN
    # (...)`` is NULL, never true; a CASE without ELSE is NULL — "no phase".
    for phase in PHASE_CHRONOLOGICAL:
        whens.append((card.lifecycle[phase].not_in(falsy), phase))
    return case(*whens)


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
