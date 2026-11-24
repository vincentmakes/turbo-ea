"""Validation of PML budget and cost amounts and partial updates."""

from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.schemas.ppm import (
    PpmBudgetLineCreate,
    PpmBudgetLineUpdate,
    PpmCostLineCreate,
    PpmCostLineUpdate,
)
from app.services.ppm_financials import _sum_precision


@pytest.mark.parametrize("field", ["description", "category", "planned", "actual"])
def test_cost_patch_rejects_null_required_fields(field):
    with pytest.raises(ValidationError):
        PpmCostLineUpdate.model_validate({field: None})


@pytest.mark.parametrize("field", ["fiscal_year", "category", "amount"])
def test_budget_patch_rejects_null_required_fields(field):
    with pytest.raises(ValidationError):
        PpmBudgetLineUpdate.model_validate({field: None})


def test_optional_patch_values_and_omissions_are_preserved():
    cost = PpmCostLineUpdate.model_validate({"date": None, "provider_child_id": None})
    assert cost.model_dump(exclude_unset=True) == {"date": None, "provider_child_id": None}
    budget = PpmBudgetLineUpdate.model_validate({"description": None})
    assert budget.model_dump(exclude_unset=True) == {"description": None}


@pytest.mark.parametrize(
    ("model", "data", "field"),
    [
        (PpmBudgetLineCreate, {"fiscal_year": 2026, "category": "capex"}, "amount"),
        (PpmBudgetLineUpdate, {}, "amount"),
        (
            PpmCostLineCreate,
            {"budget_line_id": uuid4(), "category": "opex", "description": "Cost"},
            "planned",
        ),
        (
            PpmCostLineCreate,
            {"budget_line_id": uuid4(), "category": "opex", "description": "Cost"},
            "actual",
        ),
        (PpmCostLineUpdate, {}, "planned"),
        (PpmCostLineUpdate, {}, "actual"),
    ],
)
@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_amount_is_rejected(model, data, field, value):
    with pytest.raises(ValidationError):
        model.model_validate({**data, field: value})


def test_invalid_historical_amount_returns_conflict():
    with pytest.raises(HTTPException) as error:
        _sum_precision([Decimal("10.13"), Decimal("NaN")])
    assert error.value.status_code == 409
    assert "non-finite" in error.value.detail.lower()
