"""Validate and apply cost workbook rows using the normal cost writer."""

from __future__ import annotations

import io
import uuid
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from functools import partial

import openpyxl
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_cost import CardCost
from app.models.user import User
from app.schemas.cost_items import CostImportIssueOut, CostItemWrite
from app.services import card_costs, yearly_rows
from app.services.card_read_scope import CardReadScope
from app.services.cost_import_template import COST_IMPORT_HEADERS
from app.services.fiscal_year import current_fiscal_year, get_fiscal_year_start
from app.services.license_import import (
    MAX_ROWS,
    MAX_XLSX_MEMBER_BYTES,
    MAX_XLSX_UNCOMPRESSED_BYTES,
    ImportFileError,
    _whole,
)
from app.services.permission_service import PermissionService
from app.services.workspace_io.bundle import _check_declared_sizes

HEADERS = tuple(header.lower() for header in COST_IMPORT_HEADERS)
MAX_INPUT_COLUMN = 1024


@dataclass
class ImportRow:
    row: int
    card_id: object
    year: object
    key: object
    amount: object
    renewal: object
    formula_reason: str | None = None


@dataclass
class ImportPlan:
    writes: dict[tuple[uuid.UUID, int], list[tuple[str, CostItemWrite]]] = field(
        default_factory=dict
    )
    cards: dict[uuid.UUID, Card] = field(default_factory=dict)
    skipped: list[CostImportIssueOut] = field(default_factory=list)
    clears_renewal_count: int = 0

    @property
    def matched(self) -> int:
        return sum(map(len, self.writes.values()))


def _text(value: object) -> str:
    return "" if value is None else str(value).strip()


def _header_indexes(sheet):
    header = next(sheet.iter_rows(min_row=1, max_row=1, max_col=16384, values_only=True), ())
    names = [_text(value).lower() for value in header]
    if any(names.count(name) > 1 for name in HEADERS):
        raise ImportFileError("Duplicate input columns")
    if any(name not in names for name in HEADERS[:4]):
        raise ImportFileError("Missing required columns")
    indexes = [names.index(name) if name in names else None for name in HEADERS]
    last = max(index for index in indexes if index is not None) + 1
    if last > MAX_INPUT_COLUMN:
        raise ImportFileError(f"Input columns must be within the first {MAX_INPUT_COLUMN} columns")
    return indexes, last


def parse_workbook(data: bytes) -> list[ImportRow]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            _check_declared_sizes(
                archive,
                max_member=MAX_XLSX_MEMBER_BYTES,
                max_total=MAX_XLSX_UNCOMPRESSED_BYTES,
                error=ImportFileError,
            )
        book = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=False)
    except ImportFileError:
        raise
    except Exception as exc:
        raise ImportFileError("The file could not be read as an .xlsx workbook") from exc
    try:
        sheet = book.worksheets[0]
        sheet.reset_dimensions()
        indexes, last = _header_indexes(sheet)
        rows = []
        for number, line in enumerate(
            sheet.iter_rows(min_row=2, max_row=MAX_ROWS + 2, max_col=last),
            start=2,
        ):
            if number > MAX_ROWS + 1:
                raise ImportFileError(f"The file has more than {MAX_ROWS} rows")
            cells = [line[index] if index is not None else None for index in indexes]
            formula_reasons = (
                "invalid_card_id",
                "invalid_year",
                "unknown_cost_item",
                "invalid_amount",
                "invalid_renewal_date",
            )
            reason = next(
                (
                    reason
                    for cell, reason in zip(cells, formula_reasons, strict=True)
                    if cell is not None and cell.data_type == "f"
                ),
                None,
            )
            values = [cell.value if cell is not None else None for cell in cells]
            if any(_text(value) for value in values):
                rows.append(
                    ImportRow(number, values[0], values[1], values[2], values[3], values[4], reason)
                )
        if not rows:
            raise ImportFileError("The file has no data rows")
        return rows
    except ImportFileError:
        raise
    except Exception as exc:
        raise ImportFileError("The file could not be read as an .xlsx workbook") from exc
    finally:
        book.close()


def _parse_identifiers(rows):
    parsed = []
    for row in rows:
        reason = row.formula_reason
        if any(not _text(value) for value in (row.card_id, row.year, row.key, row.amount)):
            reason = "missing_required_value"
        try:
            card_id = uuid.UUID(_text(row.card_id))
        except ValueError:
            card_id = None
            reason = reason or "invalid_card_id"
        year = _whole(row.year)
        parsed.append((row, card_id, year, _text(row.key), reason))
    return parsed


def _validate_values(row):
    try:
        renewal = None if not _text(row.renewal) else row.renewal
        body = CostItemWrite(amount=row.amount, renewal_date=renewal)
    except ValidationError as exc:
        reason = (
            "invalid_amount"
            if any(e["loc"][0] == "amount" for e in exc.errors())
            else "invalid_renewal_date"
        )
        return None, reason
    if isinstance(row.amount, bool):
        return None, "invalid_amount"
    if isinstance(row.renewal, (int, float, bool)):
        return None, "invalid_renewal_date"
    return body, None


def _validate_candidates(parsed, plan, editable, catalogue, start):
    counts = Counter((cid, year, key) for _, cid, year, key, _ in parsed if cid and year and key)
    candidates = []
    for row, cid, year, key, reason in parsed:
        if cid and year and key and counts[(cid, year, key)] > 1:
            reason = "duplicate_item"
        elif not reason and cid not in plan.cards:
            reason = "card_not_found"
        elif not reason and not editable[cid]:
            reason = "edit_forbidden"
        elif not reason and key not in catalogue:
            reason = "unknown_cost_item"
        elif not reason and (year is None or not yearly_rows.in_window(year, start)):
            reason = "invalid_year"
        body = None
        if not reason:
            body, reason = _validate_values(row)
        if reason:
            plan.skipped.append(CostImportIssueOut(row=row.row, reason=reason))
        else:
            candidates.append((cid, year, key, row.row, body))
    return candidates


async def plan_import(
    db: AsyncSession, user: User, rows: list[ImportRow], *, for_apply: bool = False
) -> ImportPlan:
    plan = ImportPlan()
    parsed = _parse_identifiers(rows)
    ids = {cid for _, cid, _, _, _ in parsed if cid}
    scope = await CardReadScope.load(db, user)
    cards = (
        (
            await db.execute(
                select(Card)
                .where(Card.id.in_(ids), *scope.where(Card, mode="module"))
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    plan.cards = {
        card.id: card
        for card in cards
        if card.type in card_costs.COST_ITEM_TYPES
        and scope.readable(card.id, card.type, subtype=card.subtype, mode="module")
    }
    editable = {cid: await PermissionService.can_edit_costs(db, user, cid) for cid in plan.cards}
    if for_apply:
        ids_to_lock = [cid for cid, allowed in editable.items() if allowed]
        locked = (
            (
                await db.execute(
                    select(Card)
                    .where(Card.id.in_(ids_to_lock))
                    .order_by(Card.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .all()
        )
        for cid in set(ids_to_lock) - {card.id for card in locked}:
            plan.cards.pop(cid, None)
            editable.pop(cid, None)
        scope = await CardReadScope.load(db, user)
        for card in locked:
            if card.type not in card_costs.COST_ITEM_TYPES or not scope.readable(
                card.id, card.type, subtype=card.subtype, mode="module"
            ):
                plan.cards.pop(card.id, None)
                editable.pop(card.id, None)
            else:
                plan.cards[card.id] = card
                editable[card.id] = await PermissionService.can_edit_costs(db, user, card.id)
    catalogue = await card_costs.archived_keys(db)
    start = await get_fiscal_year_start(db)
    current = current_fiscal_year(start)
    history: dict[uuid.UUID, dict[int, dict]] = defaultdict(dict)
    editable_ids = [cid for cid, allowed in editable.items() if allowed]
    if editable_ids:
        records = (
            (
                await db.execute(
                    select(CardCost)
                    .where(CardCost.card_id.in_(editable_ids))
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .all()
        )
        for record in records:
            history[record.card_id][record.fiscal_year] = dict(record.items or {})
    candidates = _validate_candidates(parsed, plan, editable, catalogue, start)
    for cid, year, key, number, body in sorted(candidates, key=lambda r: (str(r[0]), r[1], r[3])):
        years = history[cid]
        earlier = [y for y in years if y < year]
        prev_year = max(earlier) if earlier else None
        prev = (prev_year, years[prev_year]) if prev_year is not None else None
        effective, _, _ = card_costs.resolve_year(years.get(year), prev, year, current)
        if catalogue[key] and key not in effective:
            plan.skipped.append(CostImportIssueOut(row=number, reason="archived_cost_item"))
            continue
        if effective.get(key, {}).get("renewal_date") and body.renewal_date is None:
            plan.clears_renewal_count += 1
        years[year] = {
            **effective,
            key: {
                "amount": body.amount,
                "renewal_date": body.renewal_date.isoformat() if body.renewal_date else None,
            },
        }
        plan.writes.setdefault((cid, year), []).append((key, body))
    plan.skipped.sort(key=lambda issue: issue.row)
    return plan


async def _write_lines(db, cid, year, lines):
    for key, body in lines:
        await card_costs.upsert_item(db, cid, year, key, body.amount, body.renewal_date)


async def apply_import(
    db: AsyncSession, user_id: uuid.UUID, plan: ImportPlan, deferred_messages: list[dict]
) -> int:
    for (cid, year), lines in sorted(
        plan.writes.items(), key=lambda item: (str(item[0][0]), item[0][1])
    ):
        await card_costs.apply_write(
            db,
            plan.cards[cid],
            user_id,
            year,
            partial(_write_lines, db, cid, year, lines),
            deferred_messages=deferred_messages,
        )
    return plan.matched
