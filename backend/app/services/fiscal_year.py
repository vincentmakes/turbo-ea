"""Fiscal-year arithmetic shared by every feature that buckets by fiscal year.

The workspace's fiscal year start month lives in
``app_settings.general_settings.fiscalYearStart`` (1-12, January by default).
A fiscal year is named after the calendar year it *ends* in, so with an October
start 2025-10-15 opens FY2026. The frontend mirrors the convention in
``frontend/src/lib/fiscalYear.ts`` and ``features/ppm/costChartData.ts``.

This is a leaf module on purpose: the PPM formula context (``calculation_ppm``)
and the cost reports both need it, and the former imports the PPM models.
"""

from __future__ import annotations

from datetime import date as date_type
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_settings import AppSettings


def _fiscal_year(year: int, month: int, start_month: int) -> int:
    """Fiscal year for a (year, month), named after the year the year *ends* in.

    Note the ``start_month > 1`` guard. Without it every date would land in
    ``year + 1`` on a January start, because ``month >= 1`` is always true.
    """
    return year + (1 if 1 < start_month <= 12 and month >= start_month else 0)


def fiscal_year_for(value: date_type | None, start_month: int) -> int | None:
    """Fiscal year a date falls in, named after the year the year *ends* in.

    With a start month of October, 2025-10-15 opens FY2026 and 2025-09-30 closes
    FY2025 — the US-federal / UK convention. With the default start month of
    January the fiscal year is just the calendar year, so the distinction only
    ever shows up on installs that changed the setting.

    ``None`` for a dateless row — the caller decides what "no particular year"
    means (PPM reports it as ``unscheduled*``).
    """
    if value is None:
        return None
    return _fiscal_year(value.year, value.month, start_month)


def current_fiscal_year(start_month: int) -> int:
    """The fiscal year today (UTC) falls in."""
    today = datetime.now(timezone.utc).date()
    return _fiscal_year(today.year, today.month, start_month)


async def get_fiscal_year_start(db: AsyncSession) -> int:
    """Fiscal year start month (1-12) from app settings; January by default.

    Read per run, never cached in module state: an admin can change it in-flight
    via ``PATCH /settings/fiscal-year-start``, and a stale process-wide cache
    would make workers disagree. Bulk callers hoist it out of their loop and
    pass it down, so this is one query per recalculation, not one per card.
    """
    row = (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    month = general.get("fiscalYearStart", 1)
    return month if isinstance(month, int) and 1 <= month <= 12 else 1
