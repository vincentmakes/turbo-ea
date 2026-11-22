"""Per-card cost items by fiscal year: TCO, current-year fallback, confirm, copy to Forecast.

Reads and writes ``card_costs``. Flushes, never commits; the route handler commits.
A fiscal year with a row (even an empty one) is confirmed. Only the *current* year
with no row falls back to the most recent earlier row; never the Forecast or a past year.
"""

from __future__ import annotations

import math
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_cost import CardCost
from app.models.card_type import CardType
from app.models.cost_item_type import CostItemType
from app.services import item_catalogue, yearly_rows
from app.services.cost_value import cost_value
from app.services.event_bus import event_bus
from app.services.fiscal_year import (
    FISCAL_YEAR_LOOKAHEAD,
    FISCAL_YEAR_LOOKBACK,  # noqa: F401 (re-exported, the cost tests read it here)
    current_fiscal_year,
    get_fiscal_year_start,
)

COST_ITEM_TYPES: frozenset[str] = frozenset({"Application", "ITComponent"})
# The card section shows current-4 .. current+1; writes accept FISCAL_YEAR_LOOKBACK (5) back,
# and current-5 is readable only through GET /costs/{fy}.
WINDOW_PAST = yearly_rows.WINDOW_PAST
DERIVED_KEY = "costTotalAnnual"
# Not "card.updated": rollback would replay its changes as card fields and no-op.
COST_EVENT = "card.costs_updated"


class CostError(Exception):
    """``code``: archived_item, unknown_item, invalid_amount, year_out_of_range."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


@dataclass
class CostLine:
    key: str
    amount: float
    renewal_date: date | None
    archived: bool


@dataclass
class YearCosts:
    fiscal_year: int
    is_current: bool
    is_forecast: bool
    confirmed: bool
    fallback_from: int | None
    items: list[CostLine] = field(default_factory=list)
    tco: float = 0.0


def _shift(iso: str | None, years: int) -> str | None:
    if not iso:
        return None
    d = date.fromisoformat(iso)
    try:
        return d.replace(year=d.year + years).isoformat()
    except ValueError:  # Feb 29 into a non-leap year
        pass
    try:
        return d.replace(year=d.year + years, day=28).isoformat()
    except ValueError:  # shifted past year 1 / 9999: keep the stored date
        return iso


def _shifted(items: dict, years: int) -> dict:
    return {
        k: {"amount": v["amount"], "renewal_date": _shift(v.get("renewal_date"), years)}
        for k, v in items.items()
    }


async def _row(
    db: AsyncSession, card_id: uuid.UUID, fy: int, lock: bool = False
) -> CardCost | None:
    return await yearly_rows.row(db, CardCost, card_id, fy, lock)


async def _fallback_row(db: AsyncSession, card_id: uuid.UUID, fy: int) -> CardCost | None:
    return await yearly_rows.fallback_row(db, CardCost, card_id, fy)


async def archived_keys(db: AsyncSession) -> dict[str, bool]:
    return await item_catalogue.archived_keys(db, CostItemType)


def _lines(items: dict, archived: dict[str, bool]) -> list[CostLine]:
    return [
        CostLine(
            key=k,
            amount=float(cost_value(v.get("amount"))),
            renewal_date=date.fromisoformat(v["renewal_date"]) if v.get("renewal_date") else None,
            archived=archived.get(k, False),
        )
        for k, v in items.items()
    ]


def resolve_year(
    row_items: dict | None, prev: tuple[int, dict] | None, fy: int, cur: int
) -> tuple[dict, bool, int | None]:
    """``(items, confirmed, fallback_from)``; see ``yearly_rows.resolve_year``."""
    return yearly_rows.resolve_year(row_items, prev, fy, cur, _shifted)


def year_costs(
    items: dict,
    confirmed: bool,
    fallback_from: int | None,
    fy: int,
    cur: int,
    archived: dict[str, bool],
) -> YearCosts:
    lines = _lines(items, archived)
    return YearCosts(
        fiscal_year=fy,
        is_current=fy == cur,
        is_forecast=fy == cur + FISCAL_YEAR_LOOKAHEAD,
        confirmed=confirmed,
        fallback_from=fallback_from,
        items=lines,
        tco=sum(i.amount for i in lines),
    )


async def _resolve(
    db: AsyncSession, card_id: uuid.UUID, fy: int, start_month: int
) -> tuple[dict, bool, int | None]:
    """``(items, confirmed, fallback_from)`` for one year."""
    # The hooks go through this module's ``_row`` / ``_fallback_row`` names.
    return await yearly_rows.resolve(
        db, CardCost, card_id, fy, start_month, _shifted, row_fn=_row, fallback_fn=_fallback_row
    )


async def get_year_row(
    db: AsyncSession, card_id: uuid.UUID, fiscal_year: int, start_month: int
) -> YearCosts:
    """Any single year, no window limit."""
    items, confirmed, fb = await _resolve(db, card_id, fiscal_year, start_month)
    return year_costs(
        items,
        confirmed,
        fb,
        fiscal_year,
        current_fiscal_year(start_month),
        await archived_keys(db),
    )


async def get_window(db: AsyncSession, card_id: uuid.UUID, start_month: int) -> list[YearCosts]:
    cur = current_fiscal_year(start_month)
    return [await get_year_row(db, card_id, y, start_month) for y in yearly_rows.window_years(cur)]


def _check_window(fy: int, start_month: int) -> None:
    if not yearly_rows.in_window(fy, start_month):
        raise CostError("year_out_of_range", f"Fiscal year {fy} is outside the editable window")


async def _editable(db: AsyncSession, card_id: uuid.UUID, fy: int, start_month: int) -> CardCost:
    """The year's row, locked FOR UPDATE; created (fallback set materialised) if missing."""
    return await yearly_rows.editable(
        db, CardCost, card_id, fy, start_month, _shifted, row_fn=_row, fallback_fn=_fallback_row
    )


async def upsert_item(
    db: AsyncSession,
    card_id: uuid.UUID,
    fiscal_year: int,
    key: str,
    amount: float,
    renewal_date: date | None,
) -> None:
    sm = await get_fiscal_year_start(db)
    _check_window(fiscal_year, sm)
    if (
        isinstance(amount, bool)
        or not isinstance(amount, (int, float))
        or not math.isfinite(amount)
        or amount < 0
    ):
        raise CostError("invalid_amount", "Amount must be a non-negative number")
    archived = await archived_keys(db)
    if key not in archived:
        raise CostError("unknown_item", f"Unknown cost item '{key}'")
    current, _, _ = await _resolve(db, card_id, fiscal_year, sm)
    if key not in current and archived[key]:
        raise CostError("archived_item", f"Cost item '{key}' is archived")
    row = await _editable(db, card_id, fiscal_year, sm)
    if archived[key] and key not in (row.items or {}):
        raise CostError("archived_item", f"Cost item '{key}' is archived")
    row.items = {
        **(row.items or {}),
        key: {"amount": amount, "renewal_date": renewal_date.isoformat() if renewal_date else None},
    }
    await db.flush()


async def delete_item(db: AsyncSession, card_id: uuid.UUID, fiscal_year: int, key: str) -> bool:
    """``False`` (nothing written) when the year does not hold the key; idempotent by design."""
    sm = await get_fiscal_year_start(db)
    items, _, _ = await _resolve(db, card_id, fiscal_year, sm)
    if key not in items:
        return False
    row = await _editable(db, card_id, fiscal_year, sm)
    row.items = {k: v for k, v in (row.items or {}).items() if k != key}
    await db.flush()
    return True


async def confirm_year(db: AsyncSession, card_id: uuid.UUID, fiscal_year: int) -> None:
    sm = await get_fiscal_year_start(db)
    _check_window(fiscal_year, sm)
    await _editable(db, card_id, fiscal_year, sm)


async def copy_to_forecast(db: AsyncSession, card_id: uuid.UUID, from_year: int, key: str) -> None:
    sm = await get_fiscal_year_start(db)
    forecast = current_fiscal_year(sm) + FISCAL_YEAR_LOOKAHEAD
    if from_year >= forecast:
        raise CostError("year_out_of_range", "Source year must be before the Forecast year")
    items, _, _ = await _resolve(db, card_id, from_year, sm)
    src = items.get(key)
    if src is None:  # an archived item is fine here: it already has an amount, not a new addition
        raise CostError("unknown_item", f"'{key}' has no amount in FY{from_year}")
    row = await _editable(db, card_id, forecast, sm)
    row.items = {**(row.items or {}), key: _shifted({key: src}, forecast - from_year)[key]}
    await db.flush()


async def _declaring_types(db: AsyncSession) -> set[str]:
    """Cost-item types whose schema declares the derived field (otherwise nothing is written)."""
    rows = (
        await db.execute(
            select(CardType.key, CardType.fields_schema).where(CardType.key.in_(COST_ITEM_TYPES))
        )
    ).all()
    return {
        k
        for k, schema in rows
        if any(
            f.get("key") == DERIVED_KEY
            for sec in schema or []
            for f in (sec.get("fields") or [] if isinstance(sec, dict) else [])
        )
    }


async def _target_total(db: AsyncSession, card_id: uuid.UUID, fy: int, sm: int) -> float | None:
    """The derived value for a year: ``None`` (key absent) when the year has no lines."""
    yc = await get_year_row(db, card_id, fy, sm)
    return yc.tco if yc.items else None


def _with_total(attrs: dict | None, total: float | None) -> dict:
    out = {k: v for k, v in (attrs or {}).items() if k != DERIVED_KEY}
    if total is not None:
        out[DERIVED_KEY] = total
    return out


async def recompute_derived(db: AsyncSession, card: Card) -> None:
    """Write the current-year TCO (fallback included) into ``attributes.costTotalAnnual``.

    No cost lines: the key is removed (an empty field, not a zero). A type whose schema does
    not declare the field is left untouched.
    """
    if card.type not in COST_ITEM_TYPES or card.type not in await _declaring_types(db):
        return
    sm = await get_fiscal_year_start(db)
    total = await _target_total(db, card.id, current_fiscal_year(sm), sm)
    fresh = _with_total(card.attributes, total)
    if fresh != (card.attributes or {}):
        card.attributes = fresh


async def stale_totals(db: AsyncSession) -> dict[uuid.UUID, float | None]:
    """Phase 1 of ``recompute_all``: ``{card id: target}`` for cards whose stored value differs.

    Reads only; nothing is mutated, so a concurrent edit cannot be overwritten from here.
    """
    sm = await get_fiscal_year_start(db)
    fy = current_fiscal_year(sm)
    declaring = await _declaring_types(db)
    rows = (
        await db.execute(select(Card.id, Card.attributes).where(Card.type.in_(declaring)))
    ).all()
    out: dict[uuid.UUID, float | None] = {}
    for card_id, attrs in rows:
        total = await _target_total(db, card_id, fy, sm)
        if _with_total(attrs, total) != (attrs or {}):
            out[card_id] = total
    return out


async def write_totals(db: AsyncSession, targets: dict[uuid.UUID, float | None]) -> int:
    """Phase 2: lock the stale cards and merge the key into their *fresh* attributes.

    shortcut: one lookup per card in phase 1, batch it past ~50k cards.
    """
    if not targets:
        return 0
    cards = (
        (
            await db.execute(
                select(Card)
                .where(Card.id.in_(targets))
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    changed = 0
    for card in cards:
        fresh = _with_total(card.attributes, targets[card.id])
        if fresh != (card.attributes or {}):
            card.attributes = fresh
            changed += 1
    await db.flush()
    return changed


async def recompute_all(db: AsyncSession) -> int:
    """Refresh the derived total of every cost-bearing card; returns how many changed.

    The caller wraps it in ``derived_maintenance`` and commits.
    """
    return await write_totals(db, await stale_totals(db))


async def apply_write(
    db: AsyncSession,
    card: Card,
    user_id: uuid.UUID,
    fiscal_year: int,
    op: Callable[[], Awaitable[object]],
    *,
    deferred_messages: list[dict] | None = None,
) -> YearCosts:
    """Run ``op``, refresh the derived total and publish the cost event. Flush only.

    The event carries item keys, never amounts or dates: it is readable without costs.view.
    """
    card = (
        await db.execute(
            select(Card)
            .where(Card.id == card.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    sm = await get_fiscal_year_start(db)
    old_total = (card.attributes or {}).get(DERIVED_KEY)
    old = await get_year_row(db, card.id, fiscal_year, sm)
    if await op() is False:  # a no-op write (delete of an absent key): no event, no refresh
        return old
    from app.services.card_write_service import recalculate_and_rescore  # import cycle

    await recalculate_and_rescore(db, card)
    new = await get_year_row(db, card.id, fiscal_year, sm)
    await event_bus.publish(
        COST_EVENT,
        {
            "id": str(card.id),
            "source": "card_costs",
            "changes": {
                DERIVED_KEY: {"old": old_total, "new": (card.attributes or {}).get(DERIVED_KEY)},
                "cost_items": {
                    "old": [i.key for i in old.items],
                    "new": [i.key for i in new.items],
                },
            },
        },
        db=db,
        card_id=card.id,
        user_id=user_id,
        deferred_messages=deferred_messages,
    )
    return new
