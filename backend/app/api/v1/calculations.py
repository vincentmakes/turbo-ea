from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.calculation import Calculation
from app.models.card import Card
from app.models.user import User
from app.services.calculation_engine import (
    MAX_FORMULA_LENGTH,
    detect_cycles,
    execute_calculation,
    run_calculations_for_type,
    unknown_fields_message,
    validate_formula,
)
from app.services.calculation_lint import lint_formula
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/calculations", tags=["calculations"])


# ── Schemas ───────────────────────────────────────────────────────────


class CalculationCreate(BaseModel):
    name: str = Field(..., max_length=300)
    description: str | None = None
    target_type_key: str = Field(..., max_length=100)
    target_field_key: str = Field(..., max_length=200)
    formula: str = Field(..., max_length=MAX_FORMULA_LENGTH)
    execution_order: int = 0
    blanks_as_zero: bool = False


class CalculationUpdate(BaseModel):
    name: str | None = Field(None, max_length=300)
    description: str | None = None
    target_type_key: str | None = Field(None, max_length=100)
    target_field_key: str | None = Field(None, max_length=200)
    formula: str | None = Field(None, max_length=MAX_FORMULA_LENGTH)
    execution_order: int | None = None
    blanks_as_zero: bool | None = None


class CalculationResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    target_type_key: str
    target_field_key: str
    formula: str
    is_active: bool
    execution_order: int
    blanks_as_zero: bool = False
    # Advisory only: things the formula will do that are probably not what the
    # author meant, and that produce no error at runtime. Computed from the
    # formula text alone (no DB), so it is cheap enough for the list endpoint.
    warnings: list[str] = Field(default_factory=list)
    last_error: str | None = None
    last_run_at: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class RecalcCardRef(BaseModel):
    id: str
    name: str


class RecalcFailureGroup(BaseModel):
    """One distinct error message, and the cards it was raised on.

    Grouped rather than one row per card: a formula that is wrong is wrong the
    same way on every card, and a list of twenty-one identical messages hides
    that it is a single fix.
    """

    error: str
    count: int
    cards: list[RecalcCardRef] = Field(default_factory=list)
    # True when more cards hit this error than are listed above, so the UI can
    # say "and N more" rather than implying the sample is the whole set.
    cards_truncated: bool = False


class RecalcCalculationReport(BaseModel):
    calculation_id: str
    name: str
    target_field: str
    succeeded: int
    failed: int
    failures: list[RecalcFailureGroup] = Field(default_factory=list)


class RecalcReport(BaseModel):
    cards_processed: int
    calculations_succeeded: int
    calculations_failed: int
    # Only calculations that actually ran, in execution order.
    calculations: list[RecalcCalculationReport] = Field(default_factory=list)


class ValidateRequest(BaseModel):
    formula: str = Field(..., max_length=MAX_FORMULA_LENGTH)
    target_type_key: str


class TestRequest(BaseModel):
    card_id: str


# ── Helpers ───────────────────────────────────────────────────────────


def _to_response(calc: Calculation) -> CalculationResponse:
    return CalculationResponse(
        id=str(calc.id),
        name=calc.name,
        description=calc.description,
        target_type_key=calc.target_type_key,
        target_field_key=calc.target_field_key,
        formula=calc.formula,
        is_active=calc.is_active,
        execution_order=calc.execution_order,
        blanks_as_zero=bool(calc.blanks_as_zero),
        warnings=list(lint_formula(calc.formula)),
        last_error=calc.last_error,
        last_run_at=calc.last_run_at.isoformat() if calc.last_run_at else None,
        created_by=str(calc.created_by) if calc.created_by else None,
        created_at=calc.created_at.isoformat() if calc.created_at else None,
        updated_at=calc.updated_at.isoformat() if calc.updated_at else None,
    )


# ── CRUD Endpoints ────────────────────────────────────────────────────


@router.get("", response_model=list[CalculationResponse])
async def list_calculations(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type_key: str | None = Query(None),
):
    # Formulas and their error text are admin-only configuration, and the error
    # text now names real field keys — authenticated is not authorized. The
    # non-admin surfaces that need to know *which* fields are calculated use
    # /calculations/calculated-fields, which stays open.
    await PermissionService.require_permission(db, user, "admin.metamodel")
    q = select(Calculation).order_by(Calculation.target_type_key, Calculation.execution_order)
    if type_key:
        q = q.where(Calculation.target_type_key == type_key)
    result = await db.execute(q)
    return [_to_response(c) for c in result.scalars().all()]


@router.get("/calculated-fields")
async def get_calculated_fields(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Return a map of type_key -> list of field keys that are targeted by active calculations."""
    result = await db.execute(
        select(Calculation.target_type_key, Calculation.target_field_key).where(
            Calculation.is_active == True,  # noqa: E712
        )
    )
    rows = result.all()
    fields_map: dict[str, list[str]] = {}
    for type_key, field_key in rows:
        fields_map.setdefault(type_key, [])
        if field_key not in fields_map[type_key]:
            fields_map[type_key].append(field_key)
    return fields_map


@router.get("/{calc_id}", response_model=CalculationResponse)
async def get_calculation(
    calc_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(Calculation).where(Calculation.id == uuid.UUID(calc_id)))
    calc = result.scalar_one_or_none()
    if not calc:
        raise HTTPException(404, "Calculation not found")
    return _to_response(calc)


@router.post("", response_model=CalculationResponse, status_code=201)
async def create_calculation(
    body: CalculationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")

    # Reject a formula that reads a field the target type does not have. This
    # is the check that would have caught #886's first formula outright, and it
    # is what makes `blanks_as_zero` safe: once a typo cannot be saved, an empty
    # value at evaluation time can only mean an empty field.
    problem = await unknown_fields_message(db, body.formula, body.target_type_key)
    if problem:
        raise HTTPException(400, problem)

    calc = Calculation(
        name=body.name,
        description=body.description,
        target_type_key=body.target_type_key,
        target_field_key=body.target_field_key,
        formula=body.formula,
        execution_order=body.execution_order,
        blanks_as_zero=body.blanks_as_zero,
        is_active=False,
        created_by=user.id,
    )
    db.add(calc)
    await db.commit()
    await db.refresh(calc)
    return _to_response(calc)


@router.patch("/{calc_id}", response_model=CalculationResponse)
async def update_calculation(
    calc_id: str,
    body: CalculationUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(Calculation).where(Calculation.id == uuid.UUID(calc_id)))
    calc = result.scalar_one_or_none()
    if not calc:
        raise HTTPException(404, "Calculation not found")

    updates = body.model_dump(exclude_unset=True)

    # Track whether formula or target actually changed (not just resent)
    formula_changed = "formula" in updates and updates["formula"] != calc.formula
    target_changed = (
        "target_field_key" in updates and updates["target_field_key"] != calc.target_field_key
    )
    type_changed = (
        "target_type_key" in updates and updates["target_type_key"] != calc.target_type_key
    )

    # Only re-validate field references when the formula or the type it runs
    # against actually changed. A calculation saved before this check existed
    # can still be renamed or reordered; it is only asked to be correct when
    # someone edits the part that determines correctness.
    if formula_changed or type_changed:
        problem = await unknown_fields_message(
            db,
            updates.get("formula", calc.formula),
            updates.get("target_type_key", calc.target_type_key),
        )
        if problem:
            raise HTTPException(400, problem)

    for field, value in updates.items():
        setattr(calc, field, value)

    # Only re-check cycles when formula or target field actually changed
    if calc.is_active and (formula_changed or target_changed):
        cycle = await detect_cycles(db, calc)
        if cycle:
            raise HTTPException(
                400,
                f"Formula update would create a dependency cycle: {' -> '.join(cycle)}",
            )

    await db.commit()
    await db.refresh(calc)
    return _to_response(calc)


@router.delete("/{calc_id}", status_code=204)
async def delete_calculation(
    calc_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(Calculation).where(Calculation.id == uuid.UUID(calc_id)))
    calc = result.scalar_one_or_none()
    if not calc:
        raise HTTPException(404, "Calculation not found")
    await db.delete(calc)
    await db.commit()


# ── Action Endpoints ──────────────────────────────────────────────────


@router.post("/{calc_id}/activate", response_model=CalculationResponse)
async def activate_calculation(
    calc_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(Calculation).where(Calculation.id == uuid.UUID(calc_id)))
    calc = result.scalar_one_or_none()
    if not calc:
        raise HTTPException(404, "Calculation not found")

    # Check for cycles before activating
    cycle = await detect_cycles(db, calc)
    if cycle:
        raise HTTPException(
            400,
            f"Cannot activate: dependency cycle detected: {' -> '.join(cycle)}",
        )

    calc.is_active = True
    await db.commit()
    await db.refresh(calc)
    return _to_response(calc)


@router.post("/{calc_id}/deactivate", response_model=CalculationResponse)
async def deactivate_calculation(
    calc_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(select(Calculation).where(Calculation.id == uuid.UUID(calc_id)))
    calc = result.scalar_one_or_none()
    if not calc:
        raise HTTPException(404, "Calculation not found")
    calc.is_active = False
    await db.commit()
    await db.refresh(calc)
    return _to_response(calc)


@router.post("/{calc_id}/test")
async def test_calculation(
    calc_id: str,
    body: TestRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Test a calculation with a specific card (dry run, no save)."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    calc_result = await db.execute(select(Calculation).where(Calculation.id == uuid.UUID(calc_id)))
    calc = calc_result.scalar_one_or_none()
    if not calc:
        raise HTTPException(404, "Calculation not found")

    card_result = await db.execute(select(Card).where(Card.id == uuid.UUID(body.card_id)))
    card = card_result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")
    if card.type != calc.target_type_key:
        raise HTTPException(
            400,
            f"Card type '{card.type}' does not match target '{calc.target_type_key}'",
        )

    # Save card name before rollback expires the ORM object
    card_name = card.name

    # Execute without saving
    success, error = await execute_calculation(db, calc, card)
    computed_value = (card.attributes or {}).get(calc.target_field_key)

    # Roll back changes (don't persist)
    await db.rollback()

    # The engine's message is already composed for an admin audience — passing
    # it through is the whole point of the Test dialog. Replacing it with
    # "Calculation failed" here is what made #886 impossible to diagnose.
    return {
        "success": success,
        "error": error,
        "computed_value": computed_value,
        "card_name": card_name,
    }


@router.post("/validate")
async def validate_formula_endpoint(
    body: ValidateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    return await validate_formula(body.formula, body.target_type_key, db)


@router.post("/recalculate/{type_key}", response_model=RecalcReport)
async def recalculate_type(
    type_key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Bulk recalculate all cards of a type.

    Reports per calculation how many cards succeeded and failed, and for each
    distinct error the cards it was raised on — so a failed run can be acted on
    without testing the formula against every card by hand.
    """
    await PermissionService.require_permission(db, user, "admin.metamodel")
    return await run_calculations_for_type(db, type_key)
