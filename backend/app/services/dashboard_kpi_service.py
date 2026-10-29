"""Daily snapshots and trends for the generic dashboard KPI widgets.

A KPI widget whose config carries a ``query`` (rather than one of the preset
metrics, which keep reading ``kpi_snapshots`` through ``/reports/dashboard``)
gets its trend from ``dashboard_kpi_snapshots``: one row per day per
``metric_key``. Rows are written

- by the daily 02:00 UTC loop in ``main.py`` (``capture_dashboard_kpis``),
- once at startup when the table is empty, and
- whenever a dashboard is saved with a KPI query (``capture_for_queries``), so
  a tile an admin just added shows "vs 1 day" tomorrow, not in a month.

Snapshots are **landscape-wide** (computed through an unrestricted read
scope), so a trend is shown to unrestricted readers only — the same rule as
the built-in KPIs: a restricted reader's total compared against the whole
landscape's would be a "trend" made of the cards they cannot see.

Every function flushes and never commits: the caller owns the transaction.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Sequence
from datetime import date, datetime, timedelta, timezone
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dashboard import Dashboard, DashboardKpiSnapshot
from app.services.card_read_scope import CardReadScope
from app.services.dashboard_query import (
    DashboardQuery,
    DashboardQueryError,
    ResolvedQuery,
    base_query,
    is_narrowed,
    metric_key,
    resolve_query,
    run_query,
    with_query,
)
from app.services.kpi_snapshot_service import trend_for

log = logging.getLogger(__name__)

COMPARISON_DAYS = 30
MAX_LOOKBACK_DAYS = 365
MAX_HISTORY_DAYS = 365


def _today() -> date:
    return datetime.now(timezone.utc).date()


def kpi_queries(widgets: Any) -> list[DashboardQuery]:
    """The query of every generic KPI widget in a dashboard's ``widgets``.

    A widget that is not a dict, not a ``kpi``, a preset KPI, or whose stored
    query no longer parses is skipped — the capture must never fail a save or
    the daily loop over one stale widget.
    """
    out: list[DashboardQuery] = []
    if not isinstance(widgets, list):
        return out
    for widget in widgets:
        if not isinstance(widget, dict) or widget.get("type") != "kpi":
            continue
        config = widget.get("config")
        raw = config.get("query") if isinstance(config, dict) else None
        if not isinstance(raw, dict):
            continue
        try:
            out.append(DashboardQuery.model_validate(raw))
        except ValidationError:
            continue
    return out


async def capture_for_queries(
    db: AsyncSession,
    queries: Iterable[DashboardQuery],
    *,
    snapshot_date: date | None = None,
) -> dict[str, float]:
    """UPSERT today's landscape-wide value of each query; returns
    ``{metric_key: value}`` for the ones captured. A query the metamodel can no
    longer answer (its type or field was deleted) is skipped: its history
    stays, nothing new is recorded."""
    target = snapshot_date or _today()
    scope = CardReadScope.everything()
    captured: dict[str, float] = {}
    for query in queries:
        key = metric_key(query)
        if key in captured:
            continue
        try:
            resolved = await resolve_query(db, query)
        except DashboardQueryError as exc:
            log.debug("Dashboard KPI %s not captured: %s", key, exc.code)
            continue
        value = float((await run_query(db, resolved, scope, today=target))["total"])
        await db.execute(
            pg_insert(DashboardKpiSnapshot)
            .values(snapshot_date=target, metric_key=key, value=value)
            .on_conflict_do_update(
                index_elements=["snapshot_date", "metric_key"], set_={"value": value}
            )
        )
        captured[key] = value
    if captured:
        await db.flush()
    return captured


async def capture_dashboard_kpis(
    db: AsyncSession, *, snapshot_date: date | None = None
) -> dict[str, float]:
    """Capture every generic KPI on every dashboard (the daily task)."""
    widget_lists = (await db.execute(select(Dashboard.widgets))).scalars().all()
    queries = [q for widgets in widget_lists for q in kpi_queries(widgets)]
    return await capture_for_queries(db, queries, snapshot_date=snapshot_date)


def pick_comparison(
    rows: Sequence[tuple[date, float]], today: date, days_ago: int = COMPARISON_DAYS
) -> tuple[date, float] | None:
    """The ``(date, value)`` closest to ``today - days_ago``; ties go to the
    older snapshot, so a full month of history is preferred over yesterday."""
    if not rows:
        return None
    target = today - timedelta(days=days_ago)
    return min(rows, key=lambda r: (abs((r[0] - target).days), r[0]))


def as_metric_number(value: float, metric: str) -> float | int:
    """A stored (float) snapshot back in its metric's type: a count is whole,
    so ``trend_for`` keeps its delta an ``int`` like the built-in KPIs; a sum,
    an average and a share (a percentage) stay floats."""
    return int(round(value)) if metric == "count" else value


async def kpi_with_trend(
    db: AsyncSession,
    resolved: ResolvedQuery,
    read_scope: CardReadScope,
    *,
    preferred_days: int = COMPARISON_DAYS,
) -> dict[str, Any]:
    """``{"value", "trend"}`` — ``trend`` is ``None`` for a restricted reader.

    A narrowed count (an approval status, a lifecycle phase or flags) also
    carries ``base``: the same count without those filters, through the same
    read scope, so the tile can read "of 120" or "35 %" with no second request.
    A cost adds ``fiscal_year`` / ``fiscal_year_start`` (the year it counts in).
    """
    today = _today()
    result = await run_query(db, resolved, read_scope, today=today)
    value = result["total"]
    extra: dict[str, Any] = {
        k: result[k] for k in ("fiscal_year", "fiscal_year_start") if k in result
    }
    query = resolved.query
    if query.metric == "count" and is_narrowed(query):
        base = with_query(resolved, base_query(query))
        extra["base"] = (await run_query(db, base, read_scope, today=today))["total"]
    if not read_scope.is_unrestricted(mode="module"):
        return {"value": value, "trend": None, **extra}
    key = metric_key(resolved.query)
    earliest = today - timedelta(days=MAX_LOOKBACK_DAYS)
    rows = (
        await db.execute(
            select(DashboardKpiSnapshot.snapshot_date, DashboardKpiSnapshot.value).where(
                DashboardKpiSnapshot.metric_key == key,
                DashboardKpiSnapshot.snapshot_date >= earliest,
                DashboardKpiSnapshot.snapshot_date <= today,
            )
        )
    ).all()
    picked = pick_comparison([(d, v) for d, v in rows], today, preferred_days)
    previous = as_metric_number(picked[1], resolved.query.metric) if picked else None
    trend = trend_for(value, previous, picked[0] if picked else None, preferred_days)
    return {"value": value, "trend": trend, **extra}


def clamp_days(days: int) -> int:
    return max(1, min(days, MAX_HISTORY_DAYS))


async def kpi_history(
    db: AsyncSession,
    resolved: ResolvedQuery,
    read_scope: CardReadScope,
    *,
    days: int = 90,
) -> list[dict[str, Any]]:
    """The KPI's daily snapshots over the last ``days`` days, oldest first —
    empty for a restricted reader (the snapshots are landscape-wide)."""
    if not read_scope.is_unrestricted(mode="module"):
        return []
    today = _today()
    since = today - timedelta(days=clamp_days(days))
    rows = (
        await db.execute(
            select(DashboardKpiSnapshot.snapshot_date, DashboardKpiSnapshot.value)
            .where(
                DashboardKpiSnapshot.metric_key == metric_key(resolved.query),
                DashboardKpiSnapshot.snapshot_date >= since,
                DashboardKpiSnapshot.snapshot_date <= today,
            )
            .order_by(DashboardKpiSnapshot.snapshot_date)
        )
    ).all()
    metric = resolved.query.metric
    return [{"date": d.isoformat(), "value": as_metric_number(v, metric)} for d, v in rows]
