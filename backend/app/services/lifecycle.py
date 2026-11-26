"""Shared lifecycle-phase helpers.

The phase precedence used here — ``endOfLife`` before ``phaseOut`` before
``active`` … — is the same array the frontend's ``LifecycleBadge`` and the
inventory grid use, so a card's "current phase" is identical everywhere it is
displayed or sorted. Keep the three in sync.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from datetime import date, datetime, timezone
from typing import Any, TypeVar

from sqlalchemy import and_, case, cast, func, literal, not_, or_
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


K = TypeVar("K")


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


def current_lifecycle_phase(lifecycle: dict | None, *, today: date | None = None) -> str | None:
    """Determine which lifecycle phase a card (or relation) is in on ``today``
    — by default today's UTC date — based on its dates."""
    if not lifecycle:
        return None
    today = today or _utc_today()
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


# ---------------------------------------------------------------------------
#  "In effect on a date" — one definition, two twins
# ---------------------------------------------------------------------------
#
# A relation between two cards may carry the same five phase dates a card
# does. Whether it is IN EFFECT on a date is the frontend's ``isAliveAtDate``
# rule (``features/reports/portfolioHelpers.ts``), unchanged: it has STARTED
# and is not RETIRED.
#
# * Started: its ``active`` date has arrived. With no ``active`` date, a
#   ``plan`` / ``phaseIn`` date says it is meant to start but has not, so it
#   has not started; carrying neither leaves it no start to miss, so it has.
#   That fail-open branch is what keeps an undated relation in effect, and
#   what keeps one holding only ``phaseOut`` / ``endOfLife`` in effect until
#   its end — it must already exist to be phasing out.
# * Retired: its ``endOfLife`` date has arrived (inclusive).
#
# An empty lifecycle is therefore always in effect, which is what every
# relation meant before it could carry dates.


def lifecycle_in_effect(lifecycle: dict | None, *, on: date | None = None) -> bool:
    """Whether a lifecycle is in effect on ``on`` (default: today, UTC).

    Started and not retired — see the block comment above. An unparseable
    date counts as absent, exactly as ``parse_lifecycle_date`` reads it.
    """
    on = on or _utc_today()
    lc = lifecycle if isinstance(lifecycle, dict) else {}
    active = parse_lifecycle_date(lc.get("active"))
    if active is not None:
        started = active <= on
    else:
        started = not any(parse_lifecycle_date(lc.get(p)) is not None for p in _PLANNED_PHASES)
    end_of_life = parse_lifecycle_date(lc.get("endOfLife"))
    retired = end_of_life is not None and end_of_life <= on
    return started and not retired


def link_keys_in_effect(
    dated: Mapping[K, Sequence[dict]], undated: Iterable[K], *, on: date | None = None
) -> set[K]:
    """The keys of a link collapse that are in effect on ``on`` (default:
    today, UTC).

    A report that folds several relation rows into one link — a capability and
    an application linked by two relation types, say — keeps the lifecycles of
    the dated rows per key in ``dated`` and the keys reached by at least one
    undated row in ``undated``. The link is in effect when any row behind it
    is: an undated row always is, a dated one by ``lifecycle_in_effect``.
    """
    out = set(undated)
    out.update(
        key for key, lcs in dated.items() if any(lifecycle_in_effect(lc, on=on) for lc in lcs)
    )
    return out


def lifecycle_breadth(lifecycle: dict | None, *, on: date | None = None) -> tuple[int, date]:
    """How much of the time a relation lifecycle covers, as a sort key — the
    larger, the wider: undated (always in effect) beats in effect on ``on``
    (default: today, UTC), which beats not in effect; within a rank, the later
    end wins and no end at all is latest.

    For a report that collapses several relation rows into ONE item carrying
    one lifecycle (the dependency graph's edge per card pair and relation
    type): take the row with the largest key, and the collapsed item is undated
    when any row is, in effect today when any row is, and otherwise never ends
    before the rows it stands for — it never understates the relation. Ties are
    the caller's to break deterministically (by row id).
    """
    if not lifecycle:
        return (2, date.max)
    rank = 1 if lifecycle_in_effect(lifecycle, on=on) else 0
    end_of_life = parse_lifecycle_date(lifecycle.get("endOfLife"))
    return (rank, end_of_life or date.max)


def _sql_phase_date(entity: Any, phase: str, pattern: Any, ten: Any) -> tuple[Any, Any, Any]:
    """``(has_date, no_date, first_ten)`` for one phase of ``entity.lifecycle``.

    ``has_date`` and ``no_date`` are each TRUE or FALSE, never NULL: an absent
    key, a JSON null and a SQL NULL ``lifecycle`` all yield a NULL text, which
    ``no_date`` tests for positively — ``NOT (text ~ pattern)`` alone is NULL
    there, and ``NOT NULL`` is not TRUE (the ``_jsonb_absent`` trap).

    ``pattern`` and ``ten`` are the caller's bound values, shared by every
    phase so the condition adds a handful of parameters to a statement, not
    one per comparison.
    """
    text = entity.lifecycle[phase].astext
    has_date = and_(text.is_not(None), text.regexp_match(pattern))
    no_date = or_(text.is_(None), not_(text.regexp_match(pattern)))
    return has_date, no_date, func.left(text, ten)


def lifecycle_in_effect_sql(entity: Any, *, today: date | None = None) -> Any:
    """``lifecycle_in_effect`` as a SQL condition over ``entity.lifecycle`` —
    any mapped class or alias with a ``lifecycle`` JSONB column (``Relation``,
    ``aliased(Relation)``, ``Card``).

    The same technique as ``current_lifecycle_phase_sql``: dates are compared
    as text (``left(value, 10)``) behind ``_SQL_DATE_PATTERN``, never cast to
    ``date``, and ``today`` is bound from Python's UTC clock. Every branch is
    two-valued — TRUE or FALSE, never NULL — so ``not_()`` of the whole
    condition selects exactly the rows it does not, which a sweep looking for
    relations that are *no longer* in effect relies on. A ``{}`` or SQL NULL
    ``lifecycle`` is in effect.

    Known divergence from the Python twin (shared with the phase twin): an
    impossible calendar date (``2025-02-30``), a malformed time part after
    ``T``, or a date without zero padding (``2025-1-5``) reads differently.
    Writes go through ``normalize_relation_lifecycle``, which stores every
    date zero-padded, so a relation written through the API cannot hold one.
    """
    # One bound value each, reused in every comparison below.
    today_text = literal((today or _utc_today()).isoformat())
    pattern = literal(_SQL_DATE_PATTERN)
    ten = literal(10)
    active_has, active_none, active_day = _sql_phase_date(entity, "active", pattern, ten)
    started = or_(
        and_(active_has, active_day <= today_text),
        and_(
            active_none,
            *(_sql_phase_date(entity, p, pattern, ten)[1] for p in _PLANNED_PHASES),
        ),
    )
    _eol_has, eol_none, eol_day = _sql_phase_date(entity, "endOfLife", pattern, ten)
    # "Not retired", written positively: no end-of-life date, or one still ahead.
    not_retired = or_(eol_none, eol_day > today_text)
    return and_(started, not_retired)


def live_relations_in_fiscal_year(relations: Any, fiscal_year: int, start_month: int) -> list[Any]:
    """The rows of ``relations`` (anything with a ``lifecycle``) that count in
    ``fiscal_year``.

    The cost reports work at fiscal-year granularity, so the relations they sum
    through answer to the same rule as their cards — ``is_live_in_fiscal_year``
    on the relation's own lifecycle — rather than to ``lifecycle_in_effect``'s
    single day. A relation ending in November still carries the year it ends
    in, exactly as a card retiring in November does.
    """
    return [
        rel for rel in relations if is_live_in_fiscal_year(rel.lifecycle, fiscal_year, start_month)
    ]


#: The keys a relation lifecycle may carry — a card's five phases.
LIFECYCLE_PHASES = PHASE_CHRONOLOGICAL


def normalize_relation_lifecycle(value: object) -> dict[str, str]:
    """Validate a relation lifecycle and return what is stored.

    ``value`` must be a dict (``None`` reads as ``{}``) whose keys are among
    the five phases; a ``None`` or ``""`` value drops its key; every other
    value must be a string ``parse_lifecycle_date`` reads. Each date is stored
    as zero-padded ``YYYY-MM-DD`` — the date part of an ISO timestamp — so the
    SQL twin reads exactly what the Python twin does. Phase order is not
    checked: it is advisory, as on a card. Raises ``ValueError`` naming the
    offending key.
    """
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("lifecycle must be an object of phase → date")
    out: dict[str, str] = {}
    for key, raw in value.items():
        if key not in LIFECYCLE_PHASES:
            raise ValueError(
                f"lifecycle: unknown phase {key!r} (expected one of {', '.join(LIFECYCLE_PHASES)})"
            )
        if raw is None or raw == "":
            continue
        parsed = parse_lifecycle_date(raw) if isinstance(raw, str) else None
        if parsed is None:
            raise ValueError(f"lifecycle: {key!r} is not a date (expected YYYY-MM-DD)")
        out[key] = parsed.isoformat()
    return out
