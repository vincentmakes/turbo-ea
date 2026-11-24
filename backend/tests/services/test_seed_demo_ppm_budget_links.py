"""Demo financial rows associate costs with the correct initiative budget."""

from collections import defaultdict
from datetime import date
from uuid import uuid4

from sqlalchemy import select

from app.models.ppm_cost_line import PpmBudgetLine, PpmCostLine
from app.services.seed_demo_ppm import (
    REFERENCED_INITIATIVE_NAMES,
    _budget_lines,
    _cost_lines,
    _select_cost_budget,
    seed_ppm_demo_data,
)
from tests.conftest import create_card, create_card_type, create_user


def test_demo_cost_budget_prefers_category_and_nearest_year():
    initiative = uuid4()
    other = uuid4()
    budgets = [
        {"id": uuid4(), "initiative_id": other, "category": "opex", "fiscal_year": 2026},
        {"id": uuid4(), "initiative_id": initiative, "category": "capex", "fiscal_year": 2026},
        {"id": uuid4(), "initiative_id": initiative, "category": "opex", "fiscal_year": 2024},
        {"id": uuid4(), "initiative_id": initiative, "category": "opex", "fiscal_year": 2026},
    ]
    cost = {"initiative_id": initiative, "category": "opex", "date": date(2026, 4, 1)}
    assert _select_cost_budget(cost, budgets) == budgets[3]["id"]


def test_demo_cost_budget_falls_back_within_the_same_initiative():
    initiative = uuid4()
    budget = {"id": uuid4(), "initiative_id": initiative, "category": "capex", "fiscal_year": 2025}
    cost = {"initiative_id": initiative, "category": "opex", "date": None}
    assert _select_cost_budget(cost, [budget]) == budget["id"]


def test_every_demo_cost_has_a_budget_from_its_initiative():
    ids = {name: uuid4() for name in REFERENCED_INITIATIVE_NAMES}
    budgets = [{**budget, "id": uuid4()} for budget in _budget_lines(ids)]
    budget_by_id = {budget["id"]: budget for budget in budgets}
    costs = _cost_lines(ids)

    for cost in costs:
        budget_id = _select_cost_budget(cost, budgets)
        assert budget_by_id[budget_id]["initiative_id"] == cost["initiative_id"]


async def test_seed_persists_linked_costs_without_changing_demo_totals(db):
    await create_card_type(db, key="Initiative", label="Initiative")
    admin = await create_user(db, role="admin")
    ids = {}
    for name in REFERENCED_INITIATIVE_NAMES:
        card = await create_card(db, card_type="Initiative", name=name, user_id=admin.id)
        ids[name] = card.id

    expected_costs = _cost_lines(ids)
    expected_budgets = _budget_lines(ids)
    result = await seed_ppm_demo_data(db)

    budgets = list((await db.scalars(select(PpmBudgetLine))).all())
    costs = list((await db.scalars(select(PpmCostLine))).all())
    budget_by_id = {budget.id: budget for budget in budgets}

    assert result["cost_lines"] == len(expected_costs) == len(costs)
    assert result["budget_lines"] == len(expected_budgets) == len(budgets)
    actual_totals = defaultdict(float)
    expected_totals = defaultdict(float)
    for cost in costs:
        assert cost.budget_line_id in budget_by_id
        assert budget_by_id[cost.budget_line_id].initiative_id == cost.initiative_id
        actual_totals[(cost.initiative_id, cost.category)] += cost.actual
    for cost in expected_costs:
        expected_totals[(cost["initiative_id"], cost["category"])] += cost["actual"]
    assert dict(actual_totals) == dict(expected_totals)

    actual_budget_totals = defaultdict(float)
    expected_budget_totals = defaultdict(float)
    for budget in budgets:
        actual_budget_totals[(budget.initiative_id, budget.fiscal_year, budget.category)] += (
            budget.amount
        )
    for budget in expected_budgets:
        key = (budget["initiative_id"], budget["fiscal_year"], budget["category"])
        expected_budget_totals[key] += budget["amount"]
    assert dict(actual_budget_totals) == dict(expected_budget_totals)
