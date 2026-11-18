"""Per-card licenses by fiscal year: licensed / actual counts per metric and license type.

Reads and writes ``card_licenses``. Flushes, never commits; the route handler commits.
Year resolution is ``yearly_rows`` (shared with costs); the carry-forward and the copy to
the Forecast year carry ``licensed`` only, so a new year never inherits last year's use.
``merge_cell`` is the one write rule (PUT, copy-to-forecast, the import).
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Final

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_license import CardLicense
from app.services import yearly_rows
from app.services.event_bus import event_bus
from app.services.fiscal_year import (
    FISCAL_YEAR_LOOKAHEAD,
    current_fiscal_year,
    get_fiscal_year_start,
)
from app.services.license_catalogue import LicenseCatalogue, load_catalogue
from app.services.license_status import (
    MetricResult,
    MetricStatus,
    card_status,
    metric_result,
)

LICENSE_TYPES: frozenset[str] = frozenset({"Application", "ITComponent"})
# Not "card.updated": rollback would replay its changes as card fields and no-op.
LICENSE_EVENT = "card.licenses_updated"
LEGACY_KEYS = ("licensedUsers", "licensedInstallations", "actualUsers", "actualInstallations")
LIST_KEY = "license_types"  # the event's changes key
MAX_COUNT = 1_000_000_000
UNSET: Final = object()  # "leave this value as it is"


class LicenseError(Exception):
    """``code``: unknown_type, archived_type, archived_metric, invalid_metric, invalid_count,
    forecast_actual, year_out_of_range."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


@dataclass
class YearLicenses:
    fiscal_year: int
    is_current: bool
    is_forecast: bool
    confirmed: bool
    fallback_from: int | None
    metrics: list[MetricResult]
    status: MetricStatus | None  # None on the Forecast year
    pair_keys: list[str]  # sorted ``metric:type`` keys of the year's cells (event payload)


def licensed_only(items: dict, years: int) -> dict:
    """The carry: every cell keeps its licensed count, its actual is dropped."""
    return {
        metric: {k: {"licensed": c.get("licensed") or 0, "actual": None} for k, c in cells.items()}
        for metric, cells in items.items()
    }


def year_licenses(
    items: dict,
    confirmed: bool,
    fallback_from: int | None,
    fy: int,
    cur: int,
    catalogue: LicenseCatalogue,
) -> YearLicenses:
    """The metrics are the ones with cells in ``items``: catalogue order, unknown keys sorted."""
    present = [m for m, cells in items.items() if cells]
    metrics = [
        metric_result(m, items[m], catalogue.type_order(m))
        for m in catalogue.ordered_metrics(present)
    ]
    is_forecast = fy == cur + FISCAL_YEAR_LOOKAHEAD
    return YearLicenses(
        fiscal_year=fy,
        is_current=fy == cur,
        is_forecast=is_forecast,
        confirmed=confirmed,
        fallback_from=fallback_from,
        metrics=metrics,
        status=None if is_forecast else card_status(metrics),
        pair_keys=sorted(f"{m}:{k}" for m, cells in items.items() for k in cells),
    )


async def _resolve(
    db: AsyncSession, card_id: uuid.UUID, fy: int, start_month: int
) -> tuple[dict, bool, int | None]:
    return await yearly_rows.resolve(db, CardLicense, card_id, fy, start_month, licensed_only)


async def items_by_card(
    db: AsyncSession, card_ids: list[uuid.UUID], years: list[int], start_month: int
) -> dict[uuid.UUID, dict[int, tuple[dict, bool, int | None]]]:
    """``{card: {year: (items, confirmed, fallback_from)}}`` in one query.

    Same resolution as a single year (``yearly_rows.resolve_year``): ``confirmed`` means
    the year has a row; only the current year falls back, licensed counts only.
    """
    cur = current_fiscal_year(start_month)
    stored: dict[uuid.UUID, dict[int, dict]] = {}
    if card_ids:
        rows = await db.execute(
            select(CardLicense.card_id, CardLicense.fiscal_year, CardLicense.items).where(
                CardLicense.card_id.in_(card_ids), CardLicense.fiscal_year <= max(years)
            )
        )
        for card_id, fy, items in rows.all():
            stored.setdefault(card_id, {})[fy] = items or {}
    out: dict[uuid.UUID, dict[int, tuple[dict, bool, int | None]]] = {}
    for card_id in card_ids:
        mine = stored.get(card_id, {})
        out[card_id] = {}
        for fy in years:
            earlier = [y for y in mine if y < fy]
            prev = (max(earlier), mine[max(earlier)]) if earlier else None
            out[card_id][fy] = yearly_rows.resolve_year(mine.get(fy), prev, fy, cur, licensed_only)
    return out


async def get_year(
    db: AsyncSession,
    card: Card,
    fiscal_year: int,
    start_month: int,
    catalogue: LicenseCatalogue | None = None,
) -> YearLicenses:
    """Any single year, no window limit. ``catalogue``: when the caller already holds it."""
    items, confirmed, fb = await _resolve(db, card.id, fiscal_year, start_month)
    return year_licenses(
        items,
        confirmed,
        fb,
        fiscal_year,
        current_fiscal_year(start_month),
        catalogue or await load_catalogue(db),
    )


async def get_window(
    db: AsyncSession,
    card: Card,
    start_month: int,
    catalogue: LicenseCatalogue | None = None,
) -> list[YearLicenses]:
    """The section's six years from one row query (not one per year)."""
    cur = current_fiscal_year(start_month)
    years = list(yearly_rows.window_years(cur))
    data = (await items_by_card(db, [card.id], years, start_month))[card.id]
    catalogue = catalogue or await load_catalogue(db)
    return [year_licenses(*data[y], y, cur, catalogue) for y in years]


def check_count(name: str, value: object) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_COUNT:
        raise LicenseError("invalid_count", f"{name} must be an integer from 0 to {MAX_COUNT}")


async def merge_cell(
    db: AsyncSession,
    card_id: uuid.UUID,
    fiscal_year: int,
    metric: str,
    key: str,
    *,
    licensed: object = UNSET,
    actual: object = UNSET,
    catalogue: LicenseCatalogue | None = None,
    start_month: int | None = None,
    allow_archived: bool = False,
) -> None:
    """The one write rule. ``UNSET`` leaves a value as it is, ``actual=None`` clears it.
    A new cell in an archived metric or type is refused unless ``allow_archived``."""
    sm = await get_fiscal_year_start(db) if start_month is None else start_month
    if not yearly_rows.in_window(fiscal_year, sm):
        raise LicenseError("year_out_of_range", f"Fiscal year {fiscal_year} is outside the window")
    catalogue = catalogue or await load_catalogue(db)
    cat_metric = catalogue.metric(metric)
    if cat_metric is None:
        raise LicenseError("invalid_metric", f"Unknown metric '{metric}'")
    cat_type = catalogue.type(metric, key)
    if cat_type is None:
        raise LicenseError("unknown_type", f"Unknown license type '{key}'")
    if licensed is not UNSET:
        check_count("licensed", licensed)
    if actual is not UNSET and actual is not None:
        check_count("actual", actual)
        if fiscal_year == current_fiscal_year(sm) + FISCAL_YEAR_LOOKAHEAD:
            raise LicenseError("forecast_actual", "The Forecast year takes licensed counts only")
    current, _, _ = await _resolve(db, card_id, fiscal_year, sm)
    if not allow_archived and key not in (current.get(metric) or {}):
        if cat_metric.archived:
            raise LicenseError("archived_metric", f"License metric '{metric}' is archived")
        if cat_type.archived:
            raise LicenseError("archived_type", f"License type '{key}' is archived")
    row = await yearly_rows.editable(db, CardLicense, card_id, fiscal_year, sm, licensed_only)
    cells = dict((row.items or {}).get(metric) or {})
    cell = dict(cells.get(key) or {"licensed": 0, "actual": None})
    if licensed is not UNSET:
        cell["licensed"] = licensed
    if actual is not UNSET:
        cell["actual"] = actual
    row.items = {**(row.items or {}), metric: {**cells, key: cell}}
    await db.flush()


async def delete_cell(
    db: AsyncSession, card_id: uuid.UUID, fiscal_year: int, metric: str, key: str
) -> bool:
    """``False`` (nothing written) when the year does not hold the cell; idempotent by design."""
    sm = await get_fiscal_year_start(db)
    if not yearly_rows.in_window(fiscal_year, sm):
        raise LicenseError("year_out_of_range", f"Fiscal year {fiscal_year} is outside the window")
    items, _, _ = await _resolve(db, card_id, fiscal_year, sm)
    if key not in (items.get(metric) or {}):
        return False
    row = await yearly_rows.editable(db, CardLicense, card_id, fiscal_year, sm, licensed_only)
    kept = {k: v for k, v in ((row.items or {}).get(metric) or {}).items() if k != key}
    rest = {m: c for m, c in (row.items or {}).items() if m != metric}
    row.items = {**rest, **({metric: kept} if kept else {})}
    await db.flush()
    return True


async def confirm_year(db: AsyncSession, card_id: uuid.UUID, fiscal_year: int) -> None:
    sm = await get_fiscal_year_start(db)
    if not yearly_rows.in_window(fiscal_year, sm):
        raise LicenseError("year_out_of_range", f"Fiscal year {fiscal_year} is outside the window")
    await yearly_rows.editable(db, CardLicense, card_id, fiscal_year, sm, licensed_only)


async def copy_to_forecast(
    db: AsyncSession,
    card_id: uuid.UUID,
    from_year: int,
    metric: str,
    key: str,
    catalogue: LicenseCatalogue | None = None,
) -> None:
    """Licensed count only, through ``merge_cell``."""
    sm = await get_fiscal_year_start(db)
    forecast = current_fiscal_year(sm) + FISCAL_YEAR_LOOKAHEAD
    if from_year >= forecast:
        raise LicenseError("year_out_of_range", "Source year must be before the Forecast year")
    items, _, _ = await _resolve(db, card_id, from_year, sm)
    src = (items.get(metric) or {}).get(key)
    if src is None:
        raise LicenseError("unknown_type", f"'{key}' has no count in FY{from_year}")
    # An archived type or metric is fine here: it already has a count, not a new addition.
    await merge_cell(
        db,
        card_id,
        forecast,
        metric,
        key,
        licensed=src.get("licensed") or 0,
        start_month=sm,
        allow_archived=True,
        catalogue=catalogue,
    )


async def publish_change(
    db: AsyncSession,
    card: Card,
    user_id: uuid.UUID,
    fiscal_year: int,
    old: YearLicenses,
    *,
    start_month: int,
    catalogue: LicenseCatalogue | None = None,
) -> YearLicenses:
    """Read the new year and publish the event. Flush only.

    The event carries ``metric:type`` keys, never counts: it is readable without licenses.view.
    """
    new = await get_year(db, card, fiscal_year, start_month, catalogue)
    await event_bus.publish(
        LICENSE_EVENT,
        {
            "id": str(card.id),
            "source": "card_licenses",
            "fiscal_year": fiscal_year,
            "changes": {LIST_KEY: {"old": old.pair_keys, "new": new.pair_keys}},
        },
        db=db,
        card_id=card.id,
        user_id=user_id,
    )
    return new


async def apply_write(
    db: AsyncSession,
    card: Card,
    user_id: uuid.UUID,
    fiscal_year: int,
    op: Callable[[LicenseCatalogue], Awaitable[object]],
) -> YearLicenses:
    """Run ``op(catalogue)`` and publish the event; a no-op write (``False``) publishes nothing."""
    sm = await get_fiscal_year_start(db)
    catalogue = await load_catalogue(db)  # read once: it cannot change inside a license write
    old = await get_year(db, card, fiscal_year, sm, catalogue)
    if await op(catalogue) is False:
        return old
    return await publish_change(
        db, card, user_id, fiscal_year, old, start_month=sm, catalogue=catalogue
    )
