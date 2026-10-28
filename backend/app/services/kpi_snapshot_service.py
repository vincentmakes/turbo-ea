"""Capture and read daily KPI snapshots used to render dashboard trends."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.kpi_snapshot import KpiSnapshot


async def compute_current_kpis(db: AsyncSession) -> dict:
    """Compute the four trend KPI values from the live cards table.

    Shared by the dashboard endpoint and the snapshot capture task so the two
    cannot drift.
    """
    total_result = await db.execute(select(func.count(Card.id)).where(Card.status == "ACTIVE"))
    total_cards = total_result.scalar() or 0

    avg_result = await db.execute(
        select(func.avg(Card.data_quality)).where(Card.status == "ACTIVE")
    )
    avg_data_quality = float(avg_result.scalar() or 0)

    approved_result = await db.execute(
        select(func.count(Card.id)).where(
            Card.status == "ACTIVE", Card.approval_status == "APPROVED"
        )
    )
    approved_count = approved_result.scalar() or 0

    broken_result = await db.execute(
        select(func.count(Card.id)).where(Card.status == "ACTIVE", Card.approval_status == "BROKEN")
    )
    broken_count = broken_result.scalar() or 0

    return {
        "total_cards": int(total_cards),
        "avg_data_quality": round(avg_data_quality, 1),
        "approved_count": int(approved_count),
        "broken_count": int(broken_count),
    }


async def capture_snapshot(db: AsyncSession, snapshot_date: date | None = None) -> KpiSnapshot:
    """Capture today's KPI values into kpi_snapshots (idempotent UPSERT).

    If a snapshot for the given date already exists, it is updated in place so
    re-running the daily task is safe. The caller owns the transaction — this
    function flushes but does not commit, which keeps the nested-savepoint
    rollback pattern in tests behaving correctly.
    """
    target_date = snapshot_date or datetime.now(timezone.utc).date()
    kpis = await compute_current_kpis(db)

    stmt = (
        pg_insert(KpiSnapshot)
        .values(snapshot_date=target_date, **kpis)
        .on_conflict_do_update(
            index_elements=["snapshot_date"],
            set_={
                "total_cards": kpis["total_cards"],
                "avg_data_quality": kpis["avg_data_quality"],
                "approved_count": kpis["approved_count"],
                "broken_count": kpis["broken_count"],
            },
        )
    )
    await db.execute(stmt)
    await db.flush()

    # populate_existing forces re-hydration from the DB: the Core-level UPSERT
    # above is invisible to the ORM's identity map, so a plain SELECT would
    # return the previous (stale) row if one was already loaded in the same
    # session.
    result = await db.execute(
        select(KpiSnapshot)
        .where(KpiSnapshot.snapshot_date == target_date)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def get_comparison_snapshot(
    db: AsyncSession,
    *,
    days_ago: int = 30,
    min_days: int = 0,
    max_days: int = 365,
) -> KpiSnapshot | None:
    """Return the snapshot closest to (today - days_ago) within [min_days, max_days].

    ``min_days=0`` means today's startup baseline is a valid comparison point
    on day one (delta measures "change since startup"); after the daily 02:00
    UTC loop starts rolling, prior days' snapshots are preferred. Falls back
    to whatever snapshot is closest to the target when no exact match exists.
    """
    today = datetime.now(timezone.utc).date()
    earliest = today - timedelta(days=max_days)
    latest = today - timedelta(days=min_days)
    target = today - timedelta(days=days_ago)

    result = await db.execute(
        select(KpiSnapshot)
        .where(KpiSnapshot.snapshot_date >= earliest)
        .where(KpiSnapshot.snapshot_date <= latest)
    )
    rows = result.scalars().all()
    if not rows:
        return None
    return min(rows, key=lambda r: abs((r.snapshot_date - target).days))


def _delta_pct(curr: float, prev: float | None) -> float | None:
    if prev is None or prev == 0:
        return None
    return round(((curr - prev) / prev) * 100, 1)


def _delta_abs(curr: float, prev: float | None) -> float | None:
    if prev is None:
        return None
    diff = curr - prev
    # Preserve int for count KPIs; round the float KPI (avg_data_quality).
    if isinstance(curr, int) and isinstance(prev, int):
        return int(diff)
    return round(diff, 1)


def trend_for(
    current: float,
    previous_value: float | None,
    previous_date: date | None,
    preferred_days: int = 30,
) -> dict:
    """One KPI's trend against the snapshot taken on ``previous_date``.

    Shared by the four built-in KPIs (``compute_trend_block``) and the generic
    dashboard KPIs (``dashboard_kpi_service``) so the two arrows cannot read
    differently. ``comparison_days`` is the snapshot's actual age (at least 1,
    so a same-day startup baseline reads "vs 1 day"), or ``preferred_days``
    when there is no snapshot to compare against.
    """
    if previous_date is not None:
        today = datetime.now(timezone.utc).date()
        comparison_days = max((today - previous_date).days, 1)
    else:
        comparison_days = preferred_days
    return {
        "current": current,
        "previous": previous_value,
        "delta_abs": _delta_abs(current, previous_value),
        "delta_pct": _delta_pct(current, previous_value),
        "comparison_days": comparison_days,
        "snapshot_date": previous_date.isoformat() if previous_date is not None else None,
        "snapshot_available": previous_date is not None,
    }


_TREND_FIELD_KEYS = ("current", "previous", "delta_abs", "delta_pct")


def compute_trend_block(
    *,
    current: dict,
    previous: KpiSnapshot | None,
    preferred_days: int = 30,
) -> dict:
    """Build the ``trends`` block returned by /reports/dashboard.

    ``comparison_days`` reflects the actual age of the snapshot used, which may
    differ from ``preferred_days`` when the dataset is new (fallback to
    whatever snapshot is available).
    """
    previous_date = previous.snapshot_date if previous is not None else None
    fields = ("total_cards", "avg_data_quality", "approved_count", "broken_count")
    trends: dict = {}
    for field in fields:
        prev_val = getattr(previous, field) if previous is not None else None
        one = trend_for(current[field], prev_val, previous_date, preferred_days)
        trends.setdefault("comparison_days", one["comparison_days"])
        trends.setdefault("snapshot_available", one["snapshot_available"])
        trends.setdefault("snapshot_date", one["snapshot_date"])
        trends[field] = {k: one[k] for k in _TREND_FIELD_KEYS}
    return trends
