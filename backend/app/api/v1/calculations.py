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
    validate_formula,
)
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


class CalculationUpdate(BaseModel):
    name: str | None = Field(None, max_length=300)
    description: str | None = None
    target_type_key: str | None = Field(None, max_length=100)
    target_field_key: str | None = Field(None, max_length=200)
    formula: str | None = Field(None, max_length=MAX_FORMULA_LENGTH)
    execution_order: int | None = None


class CalculationResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    target_type_key: str
    target_field_key: str
    formula: str
    is_active: bool
    execution_order: int
    last_error: str | None = None
    last_run_at: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


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
    _user: User = Depends(get_current_user),
    type_key: str | None = Query(None),
):
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
    _user: User = Depends(get_current_user),
):
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
    calc = Calculation(
        name=body.name,
        description=body.description,
        target_type_key=body.target_type_key,
        target_field_key=body.target_field_key,
        formula=body.formula,
        execution_order=body.execution_order,
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


@router.post("/recalculate/{type_key}")
async def recalculate_type(
    type_key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Bulk recalculate all cards of a type."""
    await PermissionService.require_permission(db, user, "admin.metamodel")
    return await run_calculations_for_type(db, type_key)
