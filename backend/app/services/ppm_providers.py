"""Provider inheritance and scoped child choices for PML financial rows."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType
from app.models.ppm_cost_line import PpmBudgetLine, PpmCostLine
from app.models.user import User
from app.schemas.ppm_fields import PmlSectionConfig
from app.services.card_read_scope import CardReadScope, is_card_readable
from app.services.card_search import card_search_filter, card_search_rank
from app.services.permission_service import PermissionService
from app.services.ppm_fields import UNAVAILABLE


def _budget_provider(budget: PpmBudgetLine | None, config: PmlSectionConfig) -> uuid.UUID | None:
    if budget is None or config.provider_source is None:
        return None
    value = (budget.field_values or {}).get(config.provider_source.budget_field_key)
    return uuid.UUID(str(value)) if value else None


def resolve_effective_provider(
    budget: PpmBudgetLine | None, cost: PpmCostLine, config: PmlSectionConfig
) -> uuid.UUID | None:
    if config.provider_source is None:
        return None
    return cost.provider_child_id or _budget_provider(budget, config)


async def _hierarchy_enabled(db: AsyncSession, config: PmlSectionConfig) -> bool:
    if config.provider_source is None or not config.provider_source.allow_child_selection:
        return False
    enabled = await db.scalar(select(CardType.has_hierarchy).where(CardType.key == "Provider"))
    return bool(enabled)


async def _readable_parent(
    db: AsyncSession, user: User, budget: PpmBudgetLine, config: PmlSectionConfig
) -> Card | None:
    parent_id = _budget_provider(budget, config)
    if parent_id is None:
        return None
    parent = await db.scalar(
        select(Card).where(Card.id == parent_id).execution_options(populate_existing=True)
    )
    if parent is None or parent.type != "Provider" or parent.status != "ACTIVE":
        return None
    if not await is_card_readable(db, user, parent.id, mode="module", type_key=parent.type):
        return None
    return parent


async def validate_provider_child(
    db: AsyncSession,
    user: User,
    budget: PpmBudgetLine,
    child_id: uuid.UUID,
    config: PmlSectionConfig,
) -> Card:
    if not await _hierarchy_enabled(db, config):
        raise HTTPException(404, "Provider unavailable")
    parent = await _readable_parent(db, user, budget, config)
    if parent is None:
        raise HTTPException(404, "Provider unavailable")
    child = await db.scalar(
        select(Card).where(Card.id == child_id).execution_options(populate_existing=True)
    )
    if (
        child is None
        or child.status != "ACTIVE"
        or child.type != "Provider"
        or child.parent_id != parent.id
        or not await is_card_readable(db, user, child.id, mode="module", type_key=child.type)
    ):
        raise HTTPException(404, "Provider unavailable")
    return child


async def load_provider_choices(
    db: AsyncSession,
    user: User,
    initiative_id: uuid.UUID,
    budget_line_id: uuid.UUID,
    config: PmlSectionConfig,
    *,
    search: str,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    budget = await db.get(PpmBudgetLine, budget_line_id)
    if budget is None or budget.initiative_id != initiative_id:
        raise HTTPException(404, "Budget line not found")
    if not await _hierarchy_enabled(db, config):
        return {"items": [], "total": 0}
    parent = await _readable_parent(db, user, budget, config)
    if parent is None:
        return {"items": [], "total": 0}
    scope = await CardReadScope.load(db, user, include_subtype_denials=True)
    conditions = [
        Card.type == "Provider",
        Card.parent_id == parent.id,
        Card.status == "ACTIVE",
        *scope.where(Card, mode="module"),
    ]
    search = search.strip()
    if search:
        conditions.append(card_search_filter(search, in_description=False))
    total = await db.scalar(select(func.count()).select_from(Card).where(*conditions))
    query = select(Card).where(*conditions)
    if search:
        query = query.order_by(card_search_rank(search).asc())
    query = query.order_by(Card.name.asc(), Card.id.asc()).offset((page - 1) * page_size)
    rows = (await db.scalars(query.limit(page_size))).all()
    return {
        "items": [
            {
                "id": str(card.id),
                "name": card.name,
                "type": card.type,
                "parent_id": str(card.parent_id),
                "alias": card.alias,
            }
            for card in rows
        ],
        "total": int(total or 0),
    }


async def validate_budget_provider_change(
    db: AsyncSession,
    user: User,
    budget: PpmBudgetLine,
    new_provider_id: uuid.UUID | None,
    config: PmlSectionConfig,
) -> None:
    if config.provider_source is None or _budget_provider(budget, config) == new_provider_id:
        return
    rows = (
        await db.execute(
            select(PpmCostLine.id, Card.parent_id, Card.type, Card.status)
            .outerjoin(Card, Card.id == PpmCostLine.provider_child_id)
            .where(
                PpmCostLine.budget_line_id == budget.id,
                PpmCostLine.initiative_id == budget.initiative_id,
                PpmCostLine.provider_child_id.is_not(None),
            )
        )
    ).all()
    hierarchy = await _hierarchy_enabled(db, config)
    invalid = sorted(
        str(cost_id)
        for cost_id, parent_id, card_type, status in rows
        if (
            new_provider_id is None
            or parent_id != new_provider_id
            or card_type != "Provider"
            or status != "ACTIVE"
            or not hierarchy
        )
    )
    if invalid:
        detail: dict[str, Any] = {"code": "provider_children_incompatible"}
        if await PermissionService.can_view_costs(db, user, budget.initiative_id):
            detail["cost_ids"] = invalid
        raise HTTPException(409, detail=detail)


async def project_providers(
    db: AsyncSession,
    user: User,
    config: PmlSectionConfig,
    budgets: list[PpmBudgetLine],
    costs: list[PpmCostLine],
    *,
    budget_projection: dict[uuid.UUID, dict[str, Any]] | None = None,
) -> dict[uuid.UUID, dict[str, Any]]:
    if config.provider_source is None:
        if budget_projection is not None:
            budget_projection.update(
                {
                    budget.id: {"provider": None, "provider_child_enabled": False}
                    for budget in budgets
                }
            )
        return {
            cost.id: {
                "provider": None,
                "provider_child_id": None,
                "provider_child_enabled": False,
                "budget_provider_context": None,
                "effective_provider_context": None,
            }
            for cost in costs
        }
    budget_map = {budget.id: budget for budget in budgets}
    parent_ids = {budget.id: _budget_provider(budget, config) for budget in budgets}
    ids = {value for value in parent_ids.values() if value is not None}
    ids.update(cost.provider_child_id for cost in costs if cost.provider_child_id is not None)
    cards: dict[uuid.UUID, Card] = {}
    if ids:
        scope = await CardReadScope.load(db, user, include_subtype_denials=True)
        cards = {
            card.id: card
            for card in (
                await db.scalars(
                    select(Card).where(Card.id.in_(ids), *scope.where(Card, mode="module"))
                )
            ).all()
            if card.type == "Provider"
        }
    hierarchy = await _hierarchy_enabled(db, config)
    if budget_projection is not None:
        for budget in budgets:
            parent_id = parent_ids[budget.id]
            parent = cards.get(parent_id) if parent_id else None
            display = (
                {"id": str(parent.id), "name": parent.name, "status": parent.status}
                if parent
                else ({"status": "UNAVAILABLE"} if parent_id else None)
            )
            budget_projection[budget.id] = {
                "provider": display,
                "provider_child_enabled": bool(hierarchy and parent and parent.status == "ACTIVE"),
            }
    result = {}
    for cost in costs:
        cost_budget = budget_map.get(cost.budget_line_id) if cost.budget_line_id else None
        parent_id = parent_ids.get(cost_budget.id) if cost_budget else None
        parent = cards.get(parent_id) if parent_id else None
        child = cards.get(cost.provider_child_id) if cost.provider_child_id else None
        parent_context: Any = str(parent.id) if parent else (UNAVAILABLE if parent_id else None)
        effective_id = resolve_effective_provider(cost_budget, cost, config)
        effective = child if cost.provider_child_id else parent
        if parent_id and parent is None:
            effective = None
        effective_context: Any = (
            str(effective.id) if effective else (UNAVAILABLE if effective_id else None)
        )
        display = None
        if effective_id:
            display = (
                {"id": str(effective.id), "name": effective.name, "status": effective.status}
                if effective is not None
                else {"status": "UNAVAILABLE"}
            )
        result[cost.id] = {
            "provider": display,
            "provider_child_id": str(child.id) if child and parent else None,
            "provider_child_enabled": bool(hierarchy and parent and parent.status == "ACTIVE"),
            "budget_provider_context": parent_context,
            "effective_provider_context": effective_context,
        }
    return result
