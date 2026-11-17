"""Mass import of license counts from an Excel file (long format).

``Component | Metric | License type | Year | Licensed | Actual``, one row per cell. Three steps,
none of which commits (the route does):

* ``parse_workbook``: the bytes -> rows. Pure CPU, no database: the route runs it in a worker
  thread after giving the connection back.
* ``plan_import``: what a write would do and which rows it would refuse, with the reason. The
  dry run stops here. It uses the same predicates the write rule applies.
* ``apply_import``: one ``merge_cell`` (the single write rule) per cell, one event per card-year.
"""

from __future__ import annotations

import io
import math
import uuid
import zipfile
from dataclasses import dataclass, field
from typing import Any

import openpyxl
from sqlalchemy import Row, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.user import User
from app.services import yearly_rows
from app.services.card_licenses import (
    LICENSE_TYPES,
    UNSET,
    LicenseError,
    check_count,
    get_year,
    items_by_card,
    merge_cell,
    publish_change,
)
from app.services.card_read_scope import CardReadScope
from app.services.fiscal_year import (
    FISCAL_YEAR_LOOKAHEAD,
    current_fiscal_year,
    get_fiscal_year_start,
)
from app.services.license_catalogue import (
    CatalogueMetric,
    LicenseCatalogue,
    load_catalogue,
)
from app.services.workspace_io.bundle import _check_declared_sizes

HEADERS = ("component", "metric", "license type", "year", "licensed", "actual")
_HEADER_ALIASES = {"licence type": "license type"}
METRIC_ALIASES = {
    "users": "users",
    "user": "users",
    "installations": "installations",
    "installation": "installations",
}
MAX_XLSX_MEMBER_BYTES = 50 * 1024 * 1024
MAX_XLSX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
# shortcut: 10k rows; apply is one merge_cell per cell (several queries each) in one transaction;
# upgrade to a batched or background apply when a real import needs more.
MAX_ROWS = 10_000


class ImportFileError(ValueError):
    """Unreadable, oversized once inflated, empty or wrongly headed: a 400."""


@dataclass
class ImportRow:
    row: int
    component: str
    metric: str
    license_type: str
    year: object
    licensed: object
    actual: object


@dataclass
class RowIssue:
    row: int
    component: str
    reason: str
    detail: str = ""


@dataclass
class ImportPlan:
    cells: dict[tuple[uuid.UUID, int], list[tuple[str, str, object, object]]] = field(
        default_factory=dict
    )
    matched: int = 0
    skipped: list[RowIssue] = field(default_factory=list)


def _text(value: object) -> str:
    return "" if value is None else str(value).strip()


def _empty(value: object) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def parse_workbook(data: bytes) -> list[ImportRow]:
    """The first sheet's rows; blank rows are skipped, extra columns ignored. Numbers stay raw
    (``"12"``, ``12.0``): ``plan_import`` judges them."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ImportFileError("The file is not a valid .xlsx workbook") from exc
    with zf:
        _check_declared_sizes(
            zf,
            max_member=MAX_XLSX_MEMBER_BYTES,
            max_total=MAX_XLSX_UNCOMPRESSED_BYTES,
            error=ImportFileError,
        )
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:
        raise ImportFileError("The file could not be read as an .xlsx workbook") from exc
    try:
        if not wb.worksheets:
            raise ImportFileError("The workbook has no sheet")
        lines = wb.worksheets[0].iter_rows(values_only=True)
        header = next(lines, None)
        names = [_HEADER_ALIASES.get(_text(h).lower(), _text(h).lower()) for h in header or ()]
        missing = [h for h in HEADERS if h not in names]
        if missing:
            raise ImportFileError(f"Missing columns: {', '.join(missing)}")
        at = [names.index(h) for h in HEADERS]
        rows: list[ImportRow] = []
        for number, line in enumerate(lines, start=2):
            cells = [line[i] if i < len(line) else None for i in at]
            if all(_empty(c) for c in cells):
                continue
            if len(rows) >= MAX_ROWS:
                raise ImportFileError(f"The file has more than {MAX_ROWS} rows")
            rows.append(ImportRow(number, *[_text(c) for c in cells[:3]], *cells[3:]))
    except ImportFileError:
        raise
    except Exception as exc:
        raise ImportFileError("The file could not be read as an .xlsx workbook") from exc
    finally:
        wb.close()
    if not rows:
        raise ImportFileError("The file has no data rows")
    return rows


def _whole(value: object) -> int | None:
    """An integer from ``12``, ``12.0`` or ``"12"``; None for anything else (``12.5``, text)."""
    if isinstance(value, bool):
        return None
    try:
        num = float(value.strip()) if isinstance(value, str) else float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return int(num) if math.isfinite(num) and num == int(num) else None


def _count(value: object) -> int | None:
    """A count ``merge_cell`` accepts, or None."""
    whole = _whole(value)
    if whole is None:
        return None
    try:
        check_count("count", whole)
    except LicenseError:
        return None
    return whole


def _match_metric(value: str, catalogue: LicenseCatalogue) -> CatalogueMetric | None:
    """The metric whose casefolded key or English label is ``value``; the legacy spellings
    (``METRIC_ALIASES``) reach only the metrics keyed ``users`` / ``installations``."""
    wanted = value.casefold()
    wanted_alias = METRIC_ALIASES.get(wanted)
    hits = {
        m.key: m
        for m in catalogue.metrics
        if m.key.casefold() == wanted or m.label.casefold() == wanted or m.key == wanted_alias
    }
    return next(iter(hits.values())) if len(hits) == 1 else None


def _match_type(value: str, types) -> tuple[str | None, str | None]:
    """``(key, None)``, or ``(None, "unknown_license_type" | "ambiguous_license_type")``: the
    casefolded key or English label, among ``types`` (one metric's)."""
    wanted = value.casefold()
    hits = {t.key for t in types if t.key.casefold() == wanted or t.label.casefold() == wanted}
    if len(hits) == 1:
        return next(iter(hits)), None
    return None, "ambiguous_license_type" if hits else "unknown_license_type"


async def plan_import(db: AsyncSession, user: User, rows: list[ImportRow]) -> ImportPlan:
    sm = await get_fiscal_year_start(db)
    cur = current_fiscal_year(sm)
    read_scope = await CardReadScope.load(db, user)
    found = (
        await db.execute(
            select(Card.id, Card.name).where(
                Card.type.in_(LICENSE_TYPES),
                Card.status == "ACTIVE",
                *read_scope.where(Card, mode="module"),
            )
        )
    ).all()
    by_name: dict[str, list[Row[Any]]] = {}
    for card in found:
        by_name.setdefault(card.name.strip().casefold(), []).append(card)
    catalogue = await load_catalogue(db)

    plan = ImportPlan()

    def skip(r: ImportRow, reason: str, detail: str = "") -> None:
        plan.skipped.append(RowIssue(r.row, r.component, reason, detail))

    # 1. who and where: the cell each row names
    resolved: list[tuple[ImportRow, Row[Any], int, str, str]] = []
    for r in rows:
        hits = by_name.get(r.component.strip().casefold(), [])
        if not hits:
            skip(r, "card_not_found")
            continue
        if len(hits) > 1:
            skip(r, "ambiguous_card")
            continue
        found_metric = _match_metric(r.metric, catalogue)
        if found_metric is None:
            skip(r, "invalid_metric", r.metric)
            continue
        metric = found_metric.key
        key, reason = _match_type(r.license_type, found_metric.types)
        if key is None:
            if reason == "unknown_license_type" and any(
                _match_type(r.license_type, m.types)[0] for m in catalogue.metrics
            ):
                reason = "type_not_in_metric"
            skip(r, reason or "unknown_license_type", r.license_type)
            continue
        year = _whole(r.year)
        if year is None or not yearly_rows.in_window(year, sm):
            skip(r, "invalid_year", _text(r.year))
            continue
        resolved.append((r, hits[0], year, metric, key))

    # 2. the same cell twice in the file: every occurrence is refused
    seen: dict[tuple, int] = {}
    for r, card, year, metric, key in resolved:
        seen[(card.id, year, metric, key)] = seen.get((card.id, year, metric, key), 0) + 1

    # 3. values, and the rules merge_cell would refuse on
    existing = await items_by_card(
        db,
        list({c.id for _, c, *_ in resolved}),
        sorted({y for _, _, y, *_ in resolved}) or [cur],
        sm,
    )
    for r, card, year, metric, key in resolved:
        if seen[(card.id, year, metric, key)] > 1:
            skip(r, "duplicate_cell")
            continue
        values: dict[str, object] = {}
        bad = None
        for name, raw in (("licensed", r.licensed), ("actual", r.actual)):
            if _empty(raw):
                values[name] = UNSET
            elif (count := _count(raw)) is None:
                bad = name
                break
            else:
                values[name] = count
        if bad:
            skip(r, "invalid_number", bad)
            continue
        if values["licensed"] is UNSET and values["actual"] is UNSET:
            skip(r, "nothing_to_write")
            continue
        if values["actual"] is not UNSET and year == cur + FISCAL_YEAR_LOOKAHEAD:
            skip(r, "forecast_actual")
            continue
        has_cell = key in (existing[card.id][year][0].get(metric) or {})
        if catalogue.metric(metric).archived and not has_cell:
            skip(r, "archived_license_metric", metric)
            continue
        if catalogue.type(metric, key).archived and not has_cell:
            skip(r, "archived_license_type", key)
            continue
        plan.cells.setdefault((card.id, year), []).append(
            (metric, key, values["licensed"], values["actual"])
        )
        plan.matched += 1
    plan.skipped.sort(key=lambda i: i.row)
    return plan


async def apply_import(db: AsyncSession, user_id: uuid.UUID, plan: ImportPlan) -> int:
    """Write the plan: ``merge_cell`` per cell, one event per card-year. Returns the cell count.
    Flushes only; a ``LicenseError`` (the catalogue changed since the plan) propagates."""
    sm = await get_fiscal_year_start(db)
    catalogue = await load_catalogue(db)
    ids = {card_id for card_id, _ in plan.cells}
    cards = (
        {c.id: c for c in (await db.execute(select(Card).where(Card.id.in_(ids)))).scalars()}
        if ids
        else {}
    )
    written = 0
    for (card_id, year), cells in plan.cells.items():
        card = cards[card_id]
        old = await get_year(db, card, year, sm, catalogue)
        for metric, key, licensed, actual in cells:
            await merge_cell(
                db,
                card_id,
                year,
                metric,
                key,
                licensed=licensed,
                actual=actual,
                catalogue=catalogue,
                start_month=sm,
            )
            written += 1
        await publish_change(db, card, user_id, year, old, start_month=sm, catalogue=catalogue)
    return written
