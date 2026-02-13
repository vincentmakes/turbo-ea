"""Transformations, Impacts & Templates API."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.fact_sheet import FactSheet
from app.models.impact import Impact
from app.models.transformation import Transformation
from app.models.transformation_template import TransformationTemplate
from app.models.user import User
from app.schemas.transformation import (
    ImpactCreate,
    ImpactResponse,
    ImpactUpdate,
    TransformationCreate,
    TransformationListResponse,
    TransformationResponse,
    TransformationTemplateResponse,
    TransformationUpdate,
)
from app.services.event_bus import event_bus
from app.services.transformation_engine import execute_transformation
from app.services.transformation_templates import (
    PREDEFINED_TEMPLATES,
    generate_implied_impacts,
)

router = APIRouter(prefix="/transformations", tags=["transformations"])


# ── Helpers ─────────────────────────────────────────────────────


def _tx_to_response(tx: Transformation) -> TransformationResponse:
    """Convert a Transformation ORM object to a response DTO."""
    template_ref = None
    if tx.template:
        template_ref = {
            "id": str(tx.template.id),
            "name": tx.template.name,
            "target_fact_sheet_type": tx.template.target_fact_sheet_type,
        }
    initiative_ref = None
    if tx.initiative:
        initiative_ref = {
            "id": str(tx.initiative.id),
            "type": tx.initiative.type,
            "name": tx.initiative.name,
        }
    creator_ref = None
    if tx.creator:
        creator_ref = {
            "id": str(tx.creator.id),
            "display_name": tx.creator.display_name,
        }

    impacts = []
    for imp in tx.impacts or []:
        src_ref = None
        if imp.source_fact_sheet:
            src_ref = {
                "id": str(imp.source_fact_sheet.id),
                "type": imp.source_fact_sheet.type,
                "name": imp.source_fact_sheet.name,
            }
        tgt_ref = None
        if imp.target_fact_sheet:
            tgt_ref = {
                "id": str(imp.target_fact_sheet.id),
                "type": imp.target_fact_sheet.type,
                "name": imp.target_fact_sheet.name,
            }
        impacts.append(
            ImpactResponse(
                id=str(imp.id),
                transformation_id=str(imp.transformation_id),
                impact_type=imp.impact_type,
                action=imp.action,
                source_fact_sheet_id=str(imp.source_fact_sheet_id)
                if imp.source_fact_sheet_id
                else None,
                target_fact_sheet_id=str(imp.target_fact_sheet_id)
                if imp.target_fact_sheet_id
                else None,
                source_fact_sheet=src_ref,
                target_fact_sheet=tgt_ref,
                field_name=imp.field_name,
                field_value=imp.field_value,
                relation_type=imp.relation_type,
                is_implied=imp.is_implied,
                is_disabled=imp.is_disabled,
                execution_order=imp.execution_order,
            )
        )

    return TransformationResponse(
        id=str(tx.id),
        name=tx.name,
        initiative_id=str(tx.initiative_id),
        initiative=initiative_ref,
        template_id=str(tx.template_id) if tx.template_id else None,
        template=template_ref,
        status=tx.status,
        completion_date=tx.completion_date,
        created_by=str(tx.created_by) if tx.created_by else None,
        updated_by=str(tx.updated_by) if tx.updated_by else None,
        creator=creator_ref,
        impacts=impacts,
        impact_count=len(impacts),
        created_at=tx.created_at,
        updated_at=tx.updated_at,
    )


# ── Templates ───────────────────────────────────────────────────


@router.get("/templates", response_model=list[TransformationTemplateResponse])
async def list_templates(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """List all transformation templates (predefined + custom)."""
    # Fetch custom templates from DB
    result = await db.execute(
        select(TransformationTemplate).where(TransformationTemplate.is_hidden.is_(False))
    )
    custom_templates = result.scalars().all()

    # Combine predefined templates (in-memory) with custom DB templates
    templates = []
    for pt in PREDEFINED_TEMPLATES:
        templates.append(
            TransformationTemplateResponse(
                id=f"predefined:{pt['name'].lower().replace(' ', '_')}",
                name=pt["name"],
                description=pt.get("description"),
                target_fact_sheet_type=pt["target_fact_sheet_type"],
                is_predefined=True,
                implied_impacts_schema=pt.get("implied_impacts_schema", []),
                required_fields=pt.get("required_fields", []),
            )
        )

    for ct in custom_templates:
        templates.append(
            TransformationTemplateResponse(
                id=str(ct.id),
                name=ct.name,
                description=ct.description,
                target_fact_sheet_type=ct.target_fact_sheet_type,
                is_predefined=ct.is_predefined,
                is_hidden=ct.is_hidden,
                implied_impacts_schema=ct.implied_impacts_schema or [],
                required_fields=ct.required_fields or [],
            )
        )

    return templates


# ── Transformations CRUD ────────────────────────────────────────


@router.get("", response_model=TransformationListResponse)
async def list_transformations(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
    initiative_id: str | None = Query(None),
    target_fact_sheet_id: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """List transformations with optional filters."""
    q = select(Transformation)

    if initiative_id:
        q = q.where(Transformation.initiative_id == uuid.UUID(initiative_id))
    if status:
        q = q.where(Transformation.status == status)
    if search:
        q = q.where(Transformation.name.ilike(f"%{search}%"))

    # If filtering by target fact sheet, join through impacts
    if target_fact_sheet_id:
        q = (
            q.join(Impact, Impact.transformation_id == Transformation.id)
            .where(Impact.target_fact_sheet_id == uuid.UUID(target_fact_sheet_id))
            .distinct()
        )

    # Count
    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # Paginate
    q = q.order_by(Transformation.created_at.desc())
    q = q.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(q)
    transformations = result.scalars().all()

    return TransformationListResponse(
        items=[_tx_to_response(tx) for tx in transformations],
        total=total,
    )


@router.post("", response_model=TransformationResponse, status_code=201)
async def create_transformation(
    body: TransformationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new transformation within an Initiative."""
    # Validate initiative exists and is an Initiative type
    result = await db.execute(
        select(FactSheet).where(FactSheet.id == uuid.UUID(body.initiative_id))
    )
    initiative = result.scalar_one_or_none()
    if not initiative:
        raise HTTPException(status_code=404, detail="Initiative not found")
    if initiative.type != "Initiative":
        raise HTTPException(
            status_code=400, detail="Transformations can only be added to Initiatives"
        )

    tx = Transformation(
        name=body.name,
        initiative_id=uuid.UUID(body.initiative_id),
        status=body.status or "draft",
        completion_date=body.completion_date,
        created_by=user.id,
        updated_by=user.id,
    )

    # Resolve template
    template_schema = None
    if body.template_id:
        if body.template_id.startswith("predefined:"):
            # Find predefined template by id
            template_key = body.template_id.replace("predefined:", "")
            for pt in PREDEFINED_TEMPLATES:
                if pt["name"].lower().replace(" ", "_") == template_key:
                    template_schema = pt
                    break
            if not template_schema:
                raise HTTPException(status_code=404, detail="Predefined template not found")
        else:
            # Custom template from DB
            tpl_result = await db.execute(
                select(TransformationTemplate).where(
                    TransformationTemplate.id == uuid.UUID(body.template_id)
                )
            )
            tpl = tpl_result.scalar_one_or_none()
            if not tpl:
                raise HTTPException(status_code=404, detail="Template not found")
            tx.template_id = tpl.id
            template_schema = {
                "implied_impacts_schema": tpl.implied_impacts_schema or [],
            }

    db.add(tx)
    await db.flush()

    # Generate implied impacts from template
    if template_schema and template_schema.get("implied_impacts_schema"):
        template_fields = body.template_fields or {}
        completion_str = str(body.completion_date) if body.completion_date else None
        impacts = generate_implied_impacts(
            transformation_id=tx.id,
            impacts_schema=template_schema["implied_impacts_schema"],
            template_fields=template_fields,
            completion_date=completion_str,
        )
        for imp in impacts:
            db.add(imp)

    await event_bus.publish(
        "transformation.created",
        {"id": str(tx.id), "name": tx.name, "initiative_id": str(tx.initiative_id)},
        db=db,
        fact_sheet_id=tx.initiative_id,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(tx)

    return _tx_to_response(tx)


@router.get("/{transformation_id}", response_model=TransformationResponse)
async def get_transformation(
    transformation_id: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Get a single transformation with its impacts."""
    result = await db.execute(
        select(Transformation).where(Transformation.id == uuid.UUID(transformation_id))
    )
    tx = result.scalar_one_or_none()
    if not tx:
        raise HTTPException(status_code=404, detail="Transformation not found")

    return _tx_to_response(tx)


@router.patch("/{transformation_id}", response_model=TransformationResponse)
async def update_transformation(
    transformation_id: str,
    body: TransformationUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update a transformation (only Draft or Planned status)."""
    result = await db.execute(
        select(Transformation).where(Transformation.id == uuid.UUID(transformation_id))
    )
    tx = result.scalar_one_or_none()
    if not tx:
        raise HTTPException(status_code=404, detail="Transformation not found")
    if tx.status == "executed":
        raise HTTPException(status_code=400, detail="Cannot edit an executed transformation")

    if body.name is not None:
        tx.name = body.name
    if body.status is not None:
        # Validate status transitions: draft -> planned -> executed
        valid_transitions = {
            "draft": ["planned"],
            "planned": ["draft", "executed"],
        }
        allowed = valid_transitions.get(tx.status, [])
        if body.status not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot transition from '{tx.status}' to '{body.status}'",
            )
        tx.status = body.status
    if body.completion_date is not None:
        tx.completion_date = body.completion_date

    tx.updated_by = user.id

    await event_bus.publish(
        "transformation.updated",
        {"id": str(tx.id), "name": tx.name},
        db=db,
        fact_sheet_id=tx.initiative_id,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(tx)

    return _tx_to_response(tx)


@router.delete("/{transformation_id}", status_code=204)
async def delete_transformation(
    transformation_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a transformation and all its impacts."""
    result = await db.execute(
        select(Transformation).where(Transformation.id == uuid.UUID(transformation_id))
    )
    tx = result.scalar_one_or_none()
    if not tx:
        raise HTTPException(status_code=404, detail="Transformation not found")
    if tx.status == "executed":
        raise HTTPException(status_code=400, detail="Cannot delete an executed transformation")

    await event_bus.publish(
        "transformation.deleted",
        {"id": str(tx.id), "name": tx.name, "initiative_id": str(tx.initiative_id)},
        db=db,
        fact_sheet_id=tx.initiative_id,
        user_id=user.id,
    )

    await db.delete(tx)
    await db.commit()


@router.post("/{transformation_id}/execute", response_model=TransformationResponse)
async def execute_transformation_endpoint(
    transformation_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Execute a planned transformation — applies all impacts to the live architecture."""
    result = await db.execute(
        select(Transformation).where(Transformation.id == uuid.UUID(transformation_id))
    )
    tx = result.scalar_one_or_none()
    if not tx:
        raise HTTPException(status_code=404, detail="Transformation not found")
    if tx.status != "planned":
        raise HTTPException(
            status_code=400,
            detail="Only transformations in 'planned' status can be executed",
        )

    # Check for conflicting transformations targeting same fact sheets
    target_ids = {
        imp.target_fact_sheet_id
        for imp in tx.impacts
        if imp.target_fact_sheet_id and not imp.is_disabled
    }
    if target_ids:
        conflict_q = (
            select(Transformation)
            .join(Impact, Impact.transformation_id == Transformation.id)
            .where(
                Transformation.id != tx.id,
                Transformation.status == "planned",
                Impact.target_fact_sheet_id.in_(target_ids),
            )
        )
        await db.execute(conflict_q)
        # For MVP, we allow concurrent planned transformations.
        # Phase 4 will add locking for conflicting targets.

    # Execute
    summary = await execute_transformation(db, tx.impacts, user_id=user.id)

    tx.status = "executed"
    tx.updated_by = user.id

    await event_bus.publish(
        "transformation.executed",
        {
            "id": str(tx.id),
            "name": tx.name,
            "initiative_id": str(tx.initiative_id),
            "summary": summary,
        },
        db=db,
        fact_sheet_id=tx.initiative_id,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(tx)

    return _tx_to_response(tx)


# ── Impacts CRUD ────────────────────────────────────────────────


@router.get("/{transformation_id}/impacts", response_model=list[ImpactResponse])
async def list_impacts(
    transformation_id: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """List all impacts for a transformation."""
    result = await db.execute(
        select(Impact)
        .where(Impact.transformation_id == uuid.UUID(transformation_id))
        .order_by(Impact.execution_order, Impact.created_at)
    )
    impacts = result.scalars().all()

    items = []
    for imp in impacts:
        src_ref = None
        if imp.source_fact_sheet:
            src_ref = {
                "id": str(imp.source_fact_sheet.id),
                "type": imp.source_fact_sheet.type,
                "name": imp.source_fact_sheet.name,
            }
        tgt_ref = None
        if imp.target_fact_sheet:
            tgt_ref = {
                "id": str(imp.target_fact_sheet.id),
                "type": imp.target_fact_sheet.type,
                "name": imp.target_fact_sheet.name,
            }
        items.append(
            ImpactResponse(
                id=str(imp.id),
                transformation_id=str(imp.transformation_id),
                impact_type=imp.impact_type,
                action=imp.action,
                source_fact_sheet_id=str(imp.source_fact_sheet_id)
                if imp.source_fact_sheet_id
                else None,
                target_fact_sheet_id=str(imp.target_fact_sheet_id)
                if imp.target_fact_sheet_id
                else None,
                source_fact_sheet=src_ref,
                target_fact_sheet=tgt_ref,
                field_name=imp.field_name,
                field_value=imp.field_value,
                relation_type=imp.relation_type,
                is_implied=imp.is_implied,
                is_disabled=imp.is_disabled,
                execution_order=imp.execution_order,
            )
        )
    return items


@router.post(
    "/{transformation_id}/impacts",
    response_model=ImpactResponse,
    status_code=201,
)
async def add_custom_impact(
    transformation_id: str,
    body: ImpactCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Add a custom impact to a transformation."""
    result = await db.execute(
        select(Transformation).where(Transformation.id == uuid.UUID(transformation_id))
    )
    tx = result.scalar_one_or_none()
    if not tx:
        raise HTTPException(status_code=404, detail="Transformation not found")
    if tx.status == "executed":
        raise HTTPException(status_code=400, detail="Cannot modify an executed transformation")

    from app.services.transformation_templates import ACTION_ORDER

    impact = Impact(
        transformation_id=tx.id,
        impact_type=body.impact_type,
        action=body.action,
        source_fact_sheet_id=uuid.UUID(body.source_fact_sheet_id)
        if body.source_fact_sheet_id
        else None,
        target_fact_sheet_id=uuid.UUID(body.target_fact_sheet_id)
        if body.target_fact_sheet_id
        else None,
        field_name=body.field_name,
        field_value=body.field_value,
        relation_type=body.relation_type,
        is_implied=False,
        execution_order=body.execution_order or ACTION_ORDER.get(body.action, 50),
    )
    db.add(impact)
    await db.commit()
    await db.refresh(impact)

    return ImpactResponse(
        id=str(impact.id),
        transformation_id=str(impact.transformation_id),
        impact_type=impact.impact_type,
        action=impact.action,
        source_fact_sheet_id=str(impact.source_fact_sheet_id)
        if impact.source_fact_sheet_id
        else None,
        target_fact_sheet_id=str(impact.target_fact_sheet_id)
        if impact.target_fact_sheet_id
        else None,
        field_name=impact.field_name,
        field_value=impact.field_value,
        relation_type=impact.relation_type,
        is_implied=impact.is_implied,
        is_disabled=impact.is_disabled,
        execution_order=impact.execution_order,
    )


@router.patch("/{transformation_id}/impacts/{impact_id}", response_model=ImpactResponse)
async def update_impact(
    transformation_id: str,
    impact_id: str,
    body: ImpactUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Update an impact (custom impacts can be fully edited; implied can be disabled)."""
    result = await db.execute(
        select(Impact).where(
            Impact.id == uuid.UUID(impact_id),
            Impact.transformation_id == uuid.UUID(transformation_id),
        )
    )
    impact = result.scalar_one_or_none()
    if not impact:
        raise HTTPException(status_code=404, detail="Impact not found")

    if impact.is_implied:
        # Implied impacts can only be disabled/enabled
        if body.is_disabled is not None:
            impact.is_disabled = body.is_disabled
    else:
        # Custom impacts can be fully edited
        if body.impact_type is not None:
            impact.impact_type = body.impact_type
        if body.action is not None:
            impact.action = body.action
        if body.source_fact_sheet_id is not None:
            impact.source_fact_sheet_id = uuid.UUID(body.source_fact_sheet_id)
        if body.target_fact_sheet_id is not None:
            impact.target_fact_sheet_id = uuid.UUID(body.target_fact_sheet_id)
        if body.field_name is not None:
            impact.field_name = body.field_name
        if body.field_value is not None:
            impact.field_value = body.field_value
        if body.relation_type is not None:
            impact.relation_type = body.relation_type
        if body.is_disabled is not None:
            impact.is_disabled = body.is_disabled
        if body.execution_order is not None:
            impact.execution_order = body.execution_order

    await db.commit()
    await db.refresh(impact)

    return ImpactResponse(
        id=str(impact.id),
        transformation_id=str(impact.transformation_id),
        impact_type=impact.impact_type,
        action=impact.action,
        source_fact_sheet_id=str(impact.source_fact_sheet_id)
        if impact.source_fact_sheet_id
        else None,
        target_fact_sheet_id=str(impact.target_fact_sheet_id)
        if impact.target_fact_sheet_id
        else None,
        field_name=impact.field_name,
        field_value=impact.field_value,
        relation_type=impact.relation_type,
        is_implied=impact.is_implied,
        is_disabled=impact.is_disabled,
        execution_order=impact.execution_order,
    )


@router.delete("/{transformation_id}/impacts/{impact_id}", status_code=204)
async def delete_impact(
    transformation_id: str,
    impact_id: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Delete a custom impact. Implied impacts cannot be deleted (only disabled)."""
    result = await db.execute(
        select(Impact).where(
            Impact.id == uuid.UUID(impact_id),
            Impact.transformation_id == uuid.UUID(transformation_id),
        )
    )
    impact = result.scalar_one_or_none()
    if not impact:
        raise HTTPException(status_code=404, detail="Impact not found")
    if impact.is_implied:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete implied impacts. Use PATCH to disable instead.",
        )

    await db.delete(impact)
    await db.commit()
