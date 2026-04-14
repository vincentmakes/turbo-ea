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
    re-running the daily task is safe.
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
    await db.commit()

    result = await db.execute(select(KpiSnapshot).where(KpiSnapshot.snapshot_date == target_date))
    return result.scalar_one()


async def get_comparison_snapshot(
    db: AsyncSession,
    *,
    days_ago: int = 30,
    tolerance_days: int = 7,
) -> KpiSnapshot | None:
    """Return the snapshot closest to (today - days_ago) within +/- tolerance.

    If no snapshot in the window exists (e.g. fresh install, fewer than
    ``days_ago - tolerance`` days of history), returns None and the dashboard
    endpoint omits the trend.
    """
    today = datetime.now(timezone.utc).date()
    target = today - timedelta(days=days_ago)
    earliest = today - timedelta(days=days_ago + tolerance_days)
    latest = today - timedelta(days=max(days_ago - tolerance_days, 1))

    result = await db.execute(
        select(KpiSnapshot)
        .where(KpiSnapshot.snapshot_date >= earliest)
        .where(KpiSnapshot.snapshot_date <= latest)
    )
    rows = result.scalars().all()
    if not rows:
        return None
    return min(rows, key=lambda r: abs((r.snapshot_date - target).days))


def compute_trend_block(
    *,
    current: dict,
    previous: KpiSnapshot | None,
    comparison_days: int = 30,
) -> dict:
    """Build the ``trends`` block returned by /reports/dashboard."""

    def _delta(curr: float, prev: float | None) -> float | None:
        if prev is None or prev == 0:
            return None
        return round(((curr - prev) / prev) * 100, 1)

    fields = ("total_cards", "avg_data_quality", "approved_count", "broken_count")
    trends: dict = {
        "comparison_days": comparison_days,
        "snapshot_available": previous is not None,
        "snapshot_date": previous.snapshot_date.isoformat() if previous else None,
    }
    for field in fields:
        curr_val = current[field]
        prev_val = getattr(previous, field) if previous is not None else None
        trends[field] = {
            "current": curr_val,
            "previous": prev_val,
            "delta_pct": _delta(curr_val, prev_val),
        }
    return trends
