"""BPM — Process Assessments CRUD."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.process_assessment import ProcessAssessment
from app.models.user import User
from app.schemas.bpm import ProcessAssessmentCreate, ProcessAssessmentUpdate
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/bpm", tags=["bpm"])


async def _get_process_or_404(db: AsyncSession, process_id: uuid.UUID) -> Card:
    result = await db.execute(
        select(Card).where(
            Card.id == process_id,
            Card.type == "BusinessProcess",
            Card.status == "ACTIVE",
        )
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Business process not found")
    return card


def _clamp_score(v: int) -> int:
    return max(1, min(5, v))


@router.get("/processes/{process_id}/assessments")
async def list_assessments(
    process_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "bpm.assessments")
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)
    result = await db.execute(
        select(ProcessAssessment)
        .options(selectinload(ProcessAssessment.assessor))
        .where(ProcessAssessment.process_id == pid)
        .order_by(ProcessAssessment.assessment_date.desc())
    )
    return [
        {
            "id": str(a.id),
            "process_id": str(a.process_id),
            "assessor_id": str(a.assessor_id),
            "assessor_name": a.assessor.display_name if a.assessor else None,
            "assessment_date": a.assessment_date.isoformat(),
            "overall_score": a.overall_score,
            "efficiency": a.efficiency,
            "effectiveness": a.effectiveness,
            "compliance": a.compliance,
            "automation": a.automation,
            "notes": a.notes,
            "action_items": a.action_items or [],
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a in result.scalars().all()
    ]


@router.post("/processes/{process_id}/assessments", status_code=201)
async def create_assessment(
    process_id: str,
    body: ProcessAssessmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, current_user, "bpm.assessments")
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)

    assessment = ProcessAssessment(
        process_id=pid,
        assessor_id=current_user.id,
        assessment_date=body.assessment_date,
        overall_score=_clamp_score(body.overall_score),
        efficiency=_clamp_score(body.efficiency),
        effectiveness=_clamp_score(body.effectiveness),
        compliance=_clamp_score(body.compliance),
        automation=_clamp_score(body.automation),
        notes=body.notes,
        action_items=body.action_items or [],
    )
    db.add(assessment)
    await db.commit()
    await db.refresh(assessment)
    return {
        "id": str(assessment.id),
        "process_id": str(assessment.process_id),
        "assessment_date": assessment.assessment_date.isoformat(),
        "overall_score": assessment.overall_score,
    }


@router.put("/processes/{process_id}/assessments/{assessment_id}")
async def update_assessment(
    process_id: str,
    assessment_id: str,
    body: ProcessAssessmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, current_user, "bpm.assessments")
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)
    result = await db.execute(
        select(ProcessAssessment).where(
            ProcessAssessment.id == uuid.UUID(assessment_id),
            ProcessAssessment.process_id == pid,
        )
    )
    assessment = result.scalar_one_or_none()
    if not assessment:
        raise HTTPException(404, "Assessment not found")

    if body.overall_score is not None:
        assessment.overall_score = _clamp_score(body.overall_score)
    if body.efficiency is not None:
        assessment.efficiency = _clamp_score(body.efficiency)
    if body.effectiveness is not None:
        assessment.effectiveness = _clamp_score(body.effectiveness)
    if body.compliance is not None:
        assessment.compliance = _clamp_score(body.compliance)
    if body.automation is not None:
        assessment.automation = _clamp_score(body.automation)
    if body.notes is not None:
        assessment.notes = body.notes
    if body.action_items is not None:
        assessment.action_items = body.action_items

    await db.commit()
    return {"id": str(assessment.id), "status": "updated"}


@router.delete("/processes/{process_id}/assessments/{assessment_id}", status_code=204)
async def delete_assessment(
    process_id: str,
    assessment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, current_user, "bpm.assessments")
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)
    result = await db.execute(
        select(ProcessAssessment).where(
            ProcessAssessment.id == uuid.UUID(assessment_id),
            ProcessAssessment.process_id == pid,
        )
    )
    assessment = result.scalar_one_or_none()
    if not assessment:
        raise HTTPException(404, "Assessment not found")
    await db.delete(assessment)
    await db.commit()
