"""The daily sweep: time passing is not a write, so recompute what it changed.

A relation's lifecycle decides whether it is in effect today
(``lifecycle_in_effect`` in ``services/lifecycle.py``), and two stored values
read only relations in effect: calculated fields (``relations[...]`` and
``relation_count`` in a formula) and the data-quality score (a mandatory
relation side). Both are recomputed when someone writes — but a relation whose
``active`` or ``endOfLife`` date arrives at midnight is not written by anyone,
so without this sweep the stored values would describe yesterday's landscape
until the next unrelated edit of either card.

Only those two dates flip "in effect": ``active`` arriving starts a relation,
``endOfLife`` arriving ends it (``plan`` / ``phaseIn`` / ``phaseOut`` change
nothing once they are in the past). So a run finds every relation with one of
the two dates in the window ``(last swept day, today]`` and recalculates both
end cards — ACTIVE cards only, each once — inside ``derived_maintenance``: this
is derived-value maintenance, so it moves no card's ``updated_at`` and writes
no card event (``.claude/rules/db-sessions-events-audit.md``).

The last swept day is remembered in ``app_settings.general_settings`` under
``MARKER_KEY`` — a small value, read and written by key in SQL, never by
rewriting the whole blob. The first run on an install sweeps today only; a run
after a long outage catches up at most ``MAX_CATCH_UP_DAYS``.

Session discipline: one short session reads the marker and the affected ids
and commits; each batch of cards is recalculated in its own short session; a
last one advances the marker — never one session across the whole run.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, cast, func, literal, or_, select, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_settings import AppSettings
from app.models.card import Card
from app.models.relation import Relation
from app.services.lifecycle import _SQL_DATE_PATTERN, parse_lifecycle_date

#: ``general_settings`` key holding the last day swept (``YYYY-MM-DD``).
MARKER_KEY = "relationLifecycleSweptThrough"

#: A run never looks further back than this, however long the instance was down.
MAX_CATCH_UP_DAYS = 366

#: Cards recalculated per short session.
BATCH_SIZE = 100

#: The phase dates whose arrival flips whether a relation is in effect.
FLIP_PHASES = ("active", "endOfLife")


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


def sweep_window(last_swept: date | None, today: date) -> tuple[date, date] | None:
    """``(after, through)``: the days ``after < day <= through`` to sweep, or
    ``None`` when there is nothing to do.

    No marker yet sweeps ``today`` alone. A marker older than
    ``MAX_CATCH_UP_DAYS`` is clamped to that many days back. A marker on or
    after ``today`` (already swept, or a clock that went backwards) is nothing.
    """
    earliest = today - timedelta(days=MAX_CATCH_UP_DAYS)
    after = today - timedelta(days=1) if last_swept is None else max(last_swept, earliest)
    if after >= today:
        return None
    return after, today


def flip_condition(entity: Any, after: date, through: date) -> Any:
    """SQL: ``entity`` has an ``active`` or ``endOfLife`` date in
    ``(after, through]``.

    Compared exactly as ``lifecycle_in_effect_sql`` compares — the first ten
    characters as text, behind the same date pattern — never cast to ``date``,
    so one malformed value cannot fail the run.
    """
    after_text, through_text = after.isoformat(), through.isoformat()
    clauses = []
    for phase in FLIP_PHASES:
        text = entity.lifecycle[phase].astext
        day = func.left(text, 10)
        clauses.append(
            and_(text.regexp_match(_SQL_DATE_PATTERN), day > after_text, day <= through_text)
        )
    return or_(*clauses)


async def read_marker(db: AsyncSession) -> date | None:
    """The last day swept, or ``None`` when no run has recorded one."""
    raw = (
        await db.execute(
            select(AppSettings.general_settings[MARKER_KEY].astext).where(
                AppSettings.id == "default"
            )
        )
    ).scalar_one_or_none()
    return parse_lifecycle_date(raw)


async def write_marker(db: AsyncSession, day: date) -> None:
    """Record ``day`` as swept — one key, merged server-side (``||``), so no
    other setting is read or rewritten. Does not commit."""
    await db.execute(
        pg_insert(AppSettings)
        .values(id="default", general_settings={}, email_settings={})
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await db.execute(
        update(AppSettings)
        .where(AppSettings.id == "default")
        .values(
            general_settings=func.coalesce(
                AppSettings.general_settings, cast(literal({}, JSONB), JSONB)
            ).op("||")(literal({MARKER_KEY: day.isoformat()}, JSONB))
        )
    )


async def affected_card_ids(db: AsyncSession, after: date, through: date) -> list[uuid.UUID]:
    """Every ACTIVE card at either end of a relation whose ``active`` or
    ``endOfLife`` date falls in ``(after, through]`` — each once, by id."""
    flipped = flip_condition(Relation, after, through)
    ends = (
        select(Relation.source_id.label("card_id"))
        .where(flipped)
        .union(select(Relation.target_id.label("card_id")).where(flipped))
    )
    rows = await db.execute(
        select(Card.id).where(Card.id.in_(ends), Card.status == "ACTIVE").order_by(Card.id)
    )
    return list(rows.scalars().all())


async def recalculate_cards(db: AsyncSession, card_ids: list[uuid.UUID]) -> int:
    """Re-run the calculations, then the data-quality score, of ``card_ids``
    (ACTIVE ones only) as derived maintenance. Returns how many were
    recalculated. Does not commit."""
    # Local imports: the calculation engine imports half the service layer.
    from app.services.calculation_engine import run_calculations_for_card
    from app.services.data_quality import calc_data_quality
    from app.services.derived_writes import derived_maintenance
    from app.services.fiscal_year import get_fiscal_year_start

    if not card_ids:
        return 0
    cards = (
        (
            await db.execute(
                select(Card).where(Card.id.in_(card_ids), Card.status == "ACTIVE").order_by(Card.id)
            )
        )
        .scalars()
        .all()
    )
    fiscal_year_start = await get_fiscal_year_start(db)
    with derived_maintenance(db):
        for card in cards:
            # Calculations first: the score reads the fields they write.
            await run_calculations_for_card(db, card, fiscal_year_start=fiscal_year_start)
            card.data_quality = await calc_data_quality(db, card)
        await db.flush()
    return len(cards)


async def run_relation_lifecycle_sweep(
    session_factory: Callable[[], Any] | None = None, *, today: date | None = None
) -> int:
    """One sweep: recalculate every card whose relations started or ended
    since the last run, then advance the marker. Returns how many cards were
    recalculated. A failure part-way leaves the marker where it was, so the
    next run sweeps the same window again (recalculation is idempotent)."""
    if session_factory is None:
        from app.database import async_session

        session_factory = async_session
    day = today or _utc_today()

    async with session_factory() as db:
        window = sweep_window(await read_marker(db), day)
        ids = await affected_card_ids(db, *window) if window else []
        await db.commit()
    if window is None:
        return 0

    done = 0
    for start in range(0, len(ids), BATCH_SIZE):
        async with session_factory() as db:
            done += await recalculate_cards(db, ids[start : start + BATCH_SIZE])
            await db.commit()

    async with session_factory() as db:
        await write_marker(db, day)
        await db.commit()
    return done


def seconds_until_next_run(now: datetime) -> float:
    """Seconds from ``now`` (aware, UTC) to the next run: five minutes past
    the next midnight UTC, so the day has turned for every clock involved."""
    next_run = now.replace(hour=0, minute=5, second=0, microsecond=0)
    if next_run <= now:
        next_run += timedelta(days=1)
    return (next_run - now).total_seconds()
