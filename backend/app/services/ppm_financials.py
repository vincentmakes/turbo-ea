"""Private financial projection and invoice operations for PPM."""

from __future__ import annotations

import uuid
from collections import defaultdict
from decimal import Decimal, getcontext, localcontext
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.ppm_cost_line import PpmBudgetLine, PpmCostLine
from app.models.ppm_invoice import PpmInvoice
from app.models.user import User
from app.schemas.ppm import PpmInvoiceCreate, PpmInvoiceOut, PpmInvoiceUpdate
from app.services.card_read_scope import CardReadScope, is_card_readable
from app.services.permission_service import PermissionService
from app.services.ppm_ancestors import active_initiative_ancestors
from app.services.ppm_rollup import descendants_within


def _sum_precision(values: list[Decimal]) -> int:
    """Keep every integer and fractional digit, including carries across rows."""
    if any(not value.is_finite() for value in values):
        raise HTTPException(409, "A financial row contains a non-finite amount")

    integer_digits = max((max(value.adjusted() + 1, 0) for value in values), default=0)
    fractional_digits = max(
        (max(-int(value.as_tuple().exponent), 0) for value in values), default=0
    )
    carry_digits = len(str(len(values) + 1)) + 2
    return max(getcontext().prec, integer_digits + fractional_digits + carry_digits)


async def lock_initiative(db: AsyncSession, initiative_id: uuid.UUID) -> None:
    card = await db.get(Card, initiative_id)
    if card is None:
        raise HTTPException(404, "Initiative not found")
    ancestors = await active_initiative_ancestors(db, card)
    ids = [initiative_id, *(ancestor.id for ancestor in ancestors)]
    locked_cards = list(
        (
            await db.scalars(
                select(Card)
                .where(Card.id.in_(ids))
                .order_by(Card.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).all()
    )
    locked = {item.id for item in locked_cards}
    refreshed = await db.scalar(
        select(Card).where(Card.id == initiative_id).execution_options(populate_existing=True)
    )
    if refreshed is None:
        raise HTTPException(404, "Initiative not found")
    refreshed_ancestors = await active_initiative_ancestors(db, refreshed)
    if any(ancestor.id not in locked for ancestor in refreshed_ancestors):
        raise HTTPException(409, "Initiative hierarchy changed; retry")


async def invoice_for_user(db: AsyncSession, user: User, invoice_id: str) -> PpmInvoice:
    try:
        ident = uuid.UUID(invoice_id)
    except ValueError as exc:
        raise HTTPException(404, "Invoice not found") from exc
    invoice = await db.scalar(
        select(PpmInvoice).where(PpmInvoice.id == ident).execution_options(populate_existing=True)
    )
    if invoice is None:
        raise HTTPException(404, "Invoice not found")
    if not await is_card_readable(
        db, user, invoice.initiative_id, mode="module", type_key="Initiative"
    ):
        raise HTTPException(404, "Invoice not found")
    if not await PermissionService.can_view_costs(db, user, invoice.initiative_id):
        raise HTTPException(404, "Invoice not found")
    return invoice


async def cost_for_initiative(
    db: AsyncSession, cost_id: uuid.UUID, initiative_id: uuid.UUID
) -> PpmCostLine:
    cost = await db.scalar(
        select(PpmCostLine)
        .where(PpmCostLine.id == cost_id)
        .execution_options(populate_existing=True)
    )
    if cost is None or cost.initiative_id != initiative_id:
        raise HTTPException(404, "Cost line not found")
    return cost


async def create_invoice(
    db: AsyncSession, initiative_id: uuid.UUID, body: PpmInvoiceCreate
) -> PpmInvoice:
    await lock_initiative(db, initiative_id)
    await cost_for_initiative(db, body.cost_item_id, initiative_id)
    row = PpmInvoice(initiative_id=initiative_id, **body.model_dump())
    db.add(row)
    await db.flush()
    return row


async def update_invoice(db: AsyncSession, row: PpmInvoice, body: PpmInvoiceUpdate) -> None:
    await lock_initiative(db, row.initiative_id)
    current = await db.scalar(
        select(PpmInvoice).where(PpmInvoice.id == row.id).execution_options(populate_existing=True)
    )
    if current is None:
        raise HTTPException(404, "Invoice not found")
    row = current
    changes = body.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise HTTPException(422, "Invoice fields cannot be null")
    if "cost_item_id" in changes:
        await cost_for_initiative(db, changes["cost_item_id"], row.initiative_id)
    for key, value in changes.items():
        setattr(row, key, value)
    await db.flush()


async def card_comparison(db: AsyncSession, card: Card, user: User) -> dict:
    scope = await CardReadScope.load(db, user)
    own_budget = await db.scalar(
        select(PpmBudgetLine.id).where(PpmBudgetLine.initiative_id == card.id).limit(1)
    )
    own_cost = await db.scalar(
        select(PpmCostLine.id).where(PpmCostLine.initiative_id == card.id).limit(1)
    )
    parents = {card.id: None}
    frontier = [] if own_budget is not None and own_cost is not None else [card.id]
    while frontier:
        card_rows = await db.execute(
            select(Card.id, Card.parent_id).where(
                Card.parent_id.in_(frontier),
                Card.type == "Initiative",
                Card.status == "ACTIVE",
                *scope.where(Card, mode="module"),
            )
        )
        frontier = []
        for row in card_rows:
            if row.id not in parents:
                parents[row.id] = row.parent_id
                frontier.append(row.id)
    descendants = descendants_within(parents, card.id)
    allowed = await PermissionService.card_ids_with_cost_access(db, user, descendants)
    visible = [item for item in descendants if item in allowed]
    budget_rows = list(
        (
            await db.scalars(
                select(PpmBudgetLine).where(PpmBudgetLine.initiative_id.in_([card.id, *visible]))
            )
        ).all()
    )
    cost_rows = list(
        (
            await db.scalars(
                select(PpmCostLine).where(PpmCostLine.initiative_id.in_([card.id, *visible]))
            )
        ).all()
    )
    amounts = [Decimal(str(row.amount)) for row in budget_rows]
    amounts.extend(Decimal(str(row.actual)) for row in cost_rows)
    amounts.extend(Decimal(str(row.planned)) for row in cost_rows)
    with localcontext() as context:
        context.prec = _sum_precision(amounts)
        comparison = {}
        for name, rows, value_key in (
            ("budget", budget_rows, "amount"),
            ("actual", cost_rows, "actual"),
        ):
            own_rows = [row for row in rows if row.initiative_id == card.id]
            selected = (
                own_rows if own_rows else [row for row in rows if row.initiative_id in allowed]
            )
            capex = sum(
                (
                    Decimal(str(getattr(row, value_key)))
                    for row in selected
                    if row.category == "capex"
                ),
                Decimal(0),
            )
            opex = sum(
                (
                    Decimal(str(getattr(row, value_key)))
                    for row in selected
                    if row.category == "opex"
                ),
                Decimal(0),
            )
            comparison[name] = {
                "capex": str(capex),
                "opex": str(opex),
                "total": str(capex + opex),
                "derived": not bool(own_rows) and bool(selected),
            }
        return comparison


async def load_financials(db: AsyncSession, card: Card, user: User) -> tuple[dict, dict]:
    await db.execute(select(Card.id).where(Card.id == card.id).with_for_update(read=True))
    budgets = list(
        (
            await db.scalars(
                select(PpmBudgetLine)
                .where(PpmBudgetLine.initiative_id == card.id)
                .order_by(PpmBudgetLine.fiscal_year, PpmBudgetLine.category, PpmBudgetLine.id)
            )
        ).all()
    )
    costs = list(
        (
            await db.scalars(
                select(PpmCostLine)
                .where(PpmCostLine.initiative_id == card.id)
                .order_by(PpmCostLine.id)
            )
        ).all()
    )
    can_view = await PermissionService.can_view_costs(db, user, card.id)
    invoices = []
    if can_view:
        invoices = list(
            (
                await db.scalars(
                    select(PpmInvoice)
                    .where(PpmInvoice.initiative_id == card.id)
                    .order_by(PpmInvoice.id)
                )
            ).all()
        )
    amounts = [Decimal(str(budget.amount)) for budget in budgets]
    amounts.extend(Decimal(str(cost.actual)) for cost in costs)
    amounts.extend(Decimal(str(cost.planned)) for cost in costs)
    amounts.extend(invoice.amount for invoice in invoices)
    with localcontext() as context:
        context.prec = _sum_precision(amounts)
        invoiced: dict[uuid.UUID, Decimal] = defaultdict(Decimal)
        for invoice in invoices:
            invoiced[invoice.cost_item_id] += invoice.amount
        totals: dict[tuple[int, str], dict[str, Decimal]] = defaultdict(
            lambda: {
                "amount": Decimal(0),
                "total_cost_items": Decimal(0),
                "total_invoiced": Decimal(0),
                "remaining_to_invoice": Decimal(0),
            }
        )
        budget_values = {}
        for budget in budgets:
            key = (budget.fiscal_year, budget.category)
            budget_values[budget.id] = {
                "total_cost_items": Decimal(0),
                "total_invoiced": Decimal(0),
                "remaining_to_invoice": Decimal(0),
            }
            totals[key]["amount"] += Decimal(str(budget.amount))
        cost_rows = []
        for cost in costs:
            amount = Decimal(str(cost.actual))
            row: dict[str, Any] = {
                "id": str(cost.id),
                "budget_line_id": str(cost.budget_line_id) if cost.budget_line_id else None,
                "description": cost.description,
                "category": cost.category,
                "planned": str(cost.planned),
                "date": cost.date,
                "actual": str(amount),
            }
            if cost.budget_line_id in budget_values:
                dest = budget_values[cost.budget_line_id]
                dest["total_cost_items"] += amount
                dest["total_invoiced"] += invoiced[cost.id]
                dest["remaining_to_invoice"] += amount - invoiced[cost.id]
            if can_view:
                row["total_invoiced"] = str(invoiced[cost.id])
                row["remaining_to_invoice"] = str(amount - invoiced[cost.id])
            cost_rows.append(row)
        budget_rows = []
        for budget in budgets:
            vals = budget_values[budget.id]
            subtotal = totals[(budget.fiscal_year, budget.category)]
            for k, v in vals.items():
                subtotal[k] += v
            budget_row: dict[str, Any] = {
                "id": str(budget.id),
                "fiscal_year": budget.fiscal_year,
                "category": budget.category,
                "description": budget.description,
                "amount": str(budget.amount),
            }
            budget_row["total_cost_items"] = str(vals["total_cost_items"])
            budget_row["remaining_budget"] = str(
                Decimal(str(budget.amount)) - vals["total_cost_items"]
            )
            if can_view:
                budget_row.update(
                    {k: str(vals[k]) for k in ("total_invoiced", "remaining_to_invoice")}
                )
            budget_rows.append(budget_row)
        grand: dict[str, Decimal] = defaultdict(Decimal)
        subtotals = []
        for (year, category), values in totals.items():
            for field_name, value in values.items():
                grand[field_name] += value
            subtotal_result: dict[str, Any] = {
                "fiscal_year": year,
                "category": category,
                "amount": str(values["amount"]),
                "total_cost_items": str(values["total_cost_items"]),
                "remaining_budget": str(values["amount"] - values["total_cost_items"]),
            }
            if can_view:
                subtotal_result.update(
                    {k: str(values[k]) for k in ("total_invoiced", "remaining_to_invoice")}
                )
            subtotals.append(subtotal_result)
        grand_result = {
            "amount": str(grand["amount"]),
            "total_cost_items": str(grand["total_cost_items"]),
            "remaining_budget": str(grand["amount"] - grand["total_cost_items"]),
        }
        result: dict[str, Any] = {
            "initiative_id": str(card.id),
            "budget_lines": budget_rows,
            "budget_subtotals": subtotals,
            "budget_totals": grand_result,
            "cost_items": cost_rows,
            "invoice_access": can_view,
        }
        if can_view:
            grand_result.update(
                {k: str(grand[k]) for k in ("total_invoiced", "remaining_to_invoice")}
            )
            result["invoices"] = [
                PpmInvoiceOut.model_validate(i).model_dump(mode="json") for i in invoices
            ]
            result["actual_invoiced"] = str(sum((i.amount for i in invoices), Decimal(0)))
            result["card_comparison"] = await card_comparison(db, card, user)
        return result, {"budget": budgets, "cost_item": costs, "invoice": invoices}
