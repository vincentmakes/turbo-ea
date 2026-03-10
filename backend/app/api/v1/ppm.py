"""PPM — Per-initiative status reports, tasks, cost lines, and risks."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.card import Card
from app.models.ppm_cost_line import PpmCostLine
from app.models.ppm_risk import PpmRisk
from app.models.ppm_status_report import PpmStatusReport
from app.models.ppm_task import PpmTask
from app.models.ppm_task_comment import PpmTaskComment
from app.models.todo import Todo
from app.models.user import User
from app.schemas.ppm import (
    PpmCostLineCreate,
    PpmCostLineOut,
    PpmCostLineUpdate,
    PpmRiskCreate,
    PpmRiskOut,
    PpmRiskUpdate,
    PpmStatusReportCreate,
    PpmStatusReportOut,
    PpmStatusReportUpdate,
    PpmTaskCommentCreate,
    PpmTaskCommentOut,
    PpmTaskCommentUpdate,
    PpmTaskCreate,
    PpmTaskOut,
    PpmTaskUpdate,
    ReporterOut,
)
from app.services import notification_service
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/ppm", tags=["ppm"])


async def _get_initiative_or_404(db: AsyncSession, initiative_id: str) -> Card:
    result = await db.execute(
        select(Card).where(Card.id == initiative_id, Card.type == "Initiative")
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Initiative not found")
    return card


def _report_to_out(report: PpmStatusReport, reporter: ReporterOut | None) -> PpmStatusReportOut:
    return PpmStatusReportOut(
        id=str(report.id),
        initiative_id=str(report.initiative_id),
        reporter_id=str(report.reporter_id),
        reporter=reporter,
        report_date=report.report_date,
        schedule_health=report.schedule_health,
        cost_health=report.cost_health,
        scope_health=report.scope_health,
        summary=report.summary,
        accomplishments=report.accomplishments,
        next_steps=report.next_steps,
        created_at=report.created_at,
        updated_at=report.updated_at,
    )


async def _get_reporter(db: AsyncSession, reporter_id: uuid.UUID) -> ReporterOut | None:
    u_result = await db.execute(select(User).where(User.id == reporter_id))
    u = u_result.scalar_one_or_none()
    if u:
        return ReporterOut(id=str(u.id), display_name=u.display_name or u.email)
    return None


# ── Status Reports ──────────────────────────────────────────────────


@router.get("/initiatives/{initiative_id}/reports", response_model=list[PpmStatusReportOut])
async def list_reports(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.view")
    await _get_initiative_or_404(db, initiative_id)
    result = await db.execute(
        select(PpmStatusReport)
        .where(PpmStatusReport.initiative_id == initiative_id)
        .order_by(PpmStatusReport.report_date.desc())
    )
    reports = result.scalars().all()
    out = []
    for r in reports:
        reporter = await _get_reporter(db, r.reporter_id)
        out.append(_report_to_out(r, reporter))
    return out


@router.post("/initiatives/{initiative_id}/reports", response_model=PpmStatusReportOut)
async def create_report(
    initiative_id: str,
    body: PpmStatusReportCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    await _get_initiative_or_404(db, initiative_id)
    report = PpmStatusReport(
        id=uuid.uuid4(),
        initiative_id=initiative_id,
        reporter_id=user.id,
        report_date=body.report_date,
        schedule_health=body.schedule_health,
        cost_health=body.cost_health,
        scope_health=body.scope_health,
        summary=body.summary,
        accomplishments=body.accomplishments,
        next_steps=body.next_steps,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    reporter = ReporterOut(id=str(user.id), display_name=user.display_name or user.email)
    return _report_to_out(report, reporter)


@router.patch("/reports/{report_id}", response_model=PpmStatusReportOut)
async def update_report(
    report_id: str,
    body: PpmStatusReportUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    result = await db.execute(select(PpmStatusReport).where(PpmStatusReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    for key, val in body.model_dump(exclude_unset=True).items():
        setattr(report, key, val)
    await db.commit()
    await db.refresh(report)
    reporter = await _get_reporter(db, report.reporter_id)
    return _report_to_out(report, reporter)


@router.delete("/reports/{report_id}", status_code=204)
async def delete_report(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    result = await db.execute(select(PpmStatusReport).where(PpmStatusReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    await db.delete(report)
    await db.commit()


# ── Cost Lines ─────────────────────────────────────────────────────


@router.get("/initiatives/{initiative_id}/costs", response_model=list[PpmCostLineOut])
async def list_cost_lines(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.view")
    await _get_initiative_or_404(db, initiative_id)
    result = await db.execute(
        select(PpmCostLine)
        .where(PpmCostLine.initiative_id == initiative_id)
        .order_by(PpmCostLine.created_at)
    )
    return [
        PpmCostLineOut(
            id=str(cl.id),
            initiative_id=str(cl.initiative_id),
            description=cl.description,
            category=cl.category,
            planned=cl.planned,
            actual=cl.actual,
            created_at=cl.created_at,
            updated_at=cl.updated_at,
        )
        for cl in result.scalars().all()
    ]


@router.post("/initiatives/{initiative_id}/costs", response_model=PpmCostLineOut)
async def create_cost_line(
    initiative_id: str,
    body: PpmCostLineCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    await _get_initiative_or_404(db, initiative_id)
    cl = PpmCostLine(
        id=uuid.uuid4(),
        initiative_id=initiative_id,
        description=body.description,
        category=body.category,
        planned=body.planned,
        actual=body.actual,
    )
    db.add(cl)
    await db.commit()
    await db.refresh(cl)
    return PpmCostLineOut(
        id=str(cl.id),
        initiative_id=str(cl.initiative_id),
        description=cl.description,
        category=cl.category,
        planned=cl.planned,
        actual=cl.actual,
        created_at=cl.created_at,
        updated_at=cl.updated_at,
    )


@router.patch("/costs/{cost_id}", response_model=PpmCostLineOut)
async def update_cost_line(
    cost_id: str,
    body: PpmCostLineUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    result = await db.execute(select(PpmCostLine).where(PpmCostLine.id == cost_id))
    cl = result.scalar_one_or_none()
    if not cl:
        raise HTTPException(status_code=404, detail="Cost line not found")
    for key, val in body.model_dump(exclude_unset=True).items():
        setattr(cl, key, val)
    await db.commit()
    await db.refresh(cl)
    return PpmCostLineOut(
        id=str(cl.id),
        initiative_id=str(cl.initiative_id),
        description=cl.description,
        category=cl.category,
        planned=cl.planned,
        actual=cl.actual,
        created_at=cl.created_at,
        updated_at=cl.updated_at,
    )


@router.delete("/costs/{cost_id}", status_code=204)
async def delete_cost_line(
    cost_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    result = await db.execute(select(PpmCostLine).where(PpmCostLine.id == cost_id))
    cl = result.scalar_one_or_none()
    if not cl:
        raise HTTPException(status_code=404, detail="Cost line not found")
    await db.delete(cl)
    await db.commit()


# ── Risks ──────────────────────────────────────────────────────────


async def _risk_to_out(db: AsyncSession, risk: PpmRisk) -> PpmRiskOut:
    owner_name = None
    if risk.owner_id:
        u_result = await db.execute(select(User).where(User.id == risk.owner_id))
        u = u_result.scalar_one_or_none()
        if u:
            owner_name = u.display_name or u.email
    return PpmRiskOut(
        id=str(risk.id),
        initiative_id=str(risk.initiative_id),
        title=risk.title,
        description=risk.description,
        probability=risk.probability,
        impact=risk.impact,
        risk_score=risk.risk_score,
        mitigation=risk.mitigation,
        owner_id=str(risk.owner_id) if risk.owner_id else None,
        owner_name=owner_name,
        status=risk.status,
        created_at=risk.created_at,
        updated_at=risk.updated_at,
    )


@router.get("/initiatives/{initiative_id}/risks", response_model=list[PpmRiskOut])
async def list_risks(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.view")
    await _get_initiative_or_404(db, initiative_id)
    result = await db.execute(
        select(PpmRisk)
        .where(PpmRisk.initiative_id == initiative_id)
        .order_by(PpmRisk.risk_score.desc(), PpmRisk.created_at)
    )
    return [await _risk_to_out(db, r) for r in result.scalars().all()]


@router.post("/initiatives/{initiative_id}/risks", response_model=PpmRiskOut)
async def create_risk(
    initiative_id: str,
    body: PpmRiskCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    await _get_initiative_or_404(db, initiative_id)
    risk = PpmRisk(
        id=uuid.uuid4(),
        initiative_id=initiative_id,
        title=body.title,
        description=body.description,
        probability=body.probability,
        impact=body.impact,
        risk_score=body.probability * body.impact,
        mitigation=body.mitigation,
        owner_id=body.owner_id,
        status=body.status,
    )
    db.add(risk)
    await db.commit()
    await db.refresh(risk)
    return await _risk_to_out(db, risk)


@router.patch("/risks/{risk_id}", response_model=PpmRiskOut)
async def update_risk(
    risk_id: str,
    body: PpmRiskUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    result = await db.execute(select(PpmRisk).where(PpmRisk.id == risk_id))
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")
    data = body.model_dump(exclude_unset=True)
    for key, val in data.items():
        setattr(risk, key, val)
    # Recompute risk_score if probability or impact changed
    if "probability" in data or "impact" in data:
        risk.risk_score = risk.probability * risk.impact
    await db.commit()
    await db.refresh(risk)
    return await _risk_to_out(db, risk)


@router.delete("/risks/{risk_id}", status_code=204)
async def delete_risk(
    risk_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    result = await db.execute(select(PpmRisk).where(PpmRisk.id == risk_id))
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")
    await db.delete(risk)
    await db.commit()


# ── Tasks ───────────────────────────────────────────────────────────


async def _sync_task_todo(
    db: AsyncSession, task: PpmTask, card: Card, created_by: uuid.UUID
) -> None:
    """Create or update a Todo for the assigned user when a PPM task is assigned."""
    # Find existing system todo for this PPM task (link contains task id)
    link = f"/ppm/{task.initiative_id}?tab=tasks#task-{task.id}"
    result = await db.execute(select(Todo).where(Todo.link == link, Todo.is_system.is_(True)))
    existing = result.scalar_one_or_none()

    if not task.assignee_id:
        # Remove todo if assignee cleared
        if existing:
            await db.delete(existing)
        return

    desc = f"[PPM] {card.name}: {task.title}"
    if existing:
        existing.assigned_to = task.assignee_id
        existing.description = desc
        existing.due_date = task.due_date
        existing.status = "done" if task.status == "done" else "open"
    else:
        db.add(
            Todo(
                id=uuid.uuid4(),
                card_id=task.initiative_id,
                description=desc,
                status="open",
                link=link,
                is_system=True,
                assigned_to=task.assignee_id,
                created_by=created_by,
                due_date=task.due_date,
            )
        )


async def _task_to_out(db: AsyncSession, task: PpmTask) -> PpmTaskOut:
    assignee_name = None
    if task.assignee_id:
        u_result = await db.execute(select(User).where(User.id == task.assignee_id))
        u = u_result.scalar_one_or_none()
        if u:
            assignee_name = u.display_name or u.email
    cnt_result = await db.execute(
        select(func.count(PpmTaskComment.id)).where(PpmTaskComment.task_id == task.id)
    )
    comment_count = cnt_result.scalar() or 0
    return PpmTaskOut(
        id=str(task.id),
        initiative_id=str(task.initiative_id),
        title=task.title,
        description=task.description,
        status=task.status,
        priority=task.priority,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        assignee_name=assignee_name,
        due_date=task.due_date,
        sort_order=task.sort_order,
        tags=task.tags or [],
        comment_count=comment_count,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


@router.get("/initiatives/{initiative_id}/tasks", response_model=list[PpmTaskOut])
async def list_tasks(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.view")
    await _get_initiative_or_404(db, initiative_id)
    result = await db.execute(
        select(PpmTask)
        .where(PpmTask.initiative_id == initiative_id)
        .order_by(PpmTask.sort_order, PpmTask.created_at)
    )
    return [await _task_to_out(db, t) for t in result.scalars().all()]


@router.post("/initiatives/{initiative_id}/tasks", response_model=PpmTaskOut)
async def create_task(
    initiative_id: str,
    body: PpmTaskCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    card = await _get_initiative_or_404(db, initiative_id)
    task = PpmTask(
        id=uuid.uuid4(),
        initiative_id=initiative_id,
        title=body.title,
        description=body.description,
        status=body.status,
        priority=body.priority,
        assignee_id=body.assignee_id,
        due_date=body.due_date,
        sort_order=body.sort_order,
        tags=body.tags,
    )
    db.add(task)
    await db.flush()
    await _sync_task_todo(db, task, card, user.id)
    if task.assignee_id:
        await notification_service.create_notification(
            db,
            user_id=task.assignee_id,
            notif_type="task_assigned",
            title="Task Assigned",
            message=(
                f'{user.display_name} assigned you a task: "{task.title[:80]}" on {card.name}'
            ),
            link=f"/ppm/{task.initiative_id}?tab=tasks",
            card_id=task.initiative_id,
            actor_id=user.id,
        )
    await db.commit()
    await db.refresh(task)
    return await _task_to_out(db, task)


@router.patch("/tasks/{task_id}", response_model=PpmTaskOut)
async def update_task(
    task_id: str,
    body: PpmTaskUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    result = await db.execute(select(PpmTask).where(PpmTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    old_assignee_id = task.assignee_id
    data = body.model_dump(exclude_unset=True)
    for key, val in data.items():
        setattr(task, key, val)
    card = await _get_initiative_or_404(db, str(task.initiative_id))
    await _sync_task_todo(db, task, card, user.id)
    # Notify new assignee when assignee changes
    new_assignee = task.assignee_id
    if "assignee_id" in data and new_assignee and new_assignee != old_assignee_id:
        await notification_service.create_notification(
            db,
            user_id=new_assignee,
            notif_type="task_assigned",
            title="Task Assigned",
            message=(
                f'{user.display_name} assigned you a task: "{task.title[:80]}" on {card.name}'
            ),
            link=f"/ppm/{task.initiative_id}?tab=tasks",
            card_id=task.initiative_id,
            actor_id=user.id,
        )
    await db.commit()
    await db.refresh(task)
    return await _task_to_out(db, task)


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    result = await db.execute(select(PpmTask).where(PpmTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    # Clean up linked todo
    link = f"/ppm/{task.initiative_id}?tab=tasks#task-{task.id}"
    todo_result = await db.execute(select(Todo).where(Todo.link == link, Todo.is_system.is_(True)))
    todo = todo_result.scalar_one_or_none()
    if todo:
        await db.delete(todo)
    await db.delete(task)
    await db.commit()


# ── Task Comments ──────────────────────────────────────────────────


def _comment_to_out(c: PpmTaskComment) -> PpmTaskCommentOut:
    return PpmTaskCommentOut(
        id=str(c.id),
        task_id=str(c.task_id),
        user_id=str(c.user_id),
        user_display_name=c.user.display_name if c.user else "",
        content=c.content,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


@router.get("/tasks/{task_id}/comments", response_model=list[PpmTaskCommentOut])
async def list_task_comments(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.view")
    result = await db.execute(
        select(PpmTaskComment)
        .where(PpmTaskComment.task_id == task_id)
        .order_by(PpmTaskComment.created_at)
    )
    return [_comment_to_out(c) for c in result.scalars().all()]


@router.post("/tasks/{task_id}/comments", response_model=PpmTaskCommentOut)
async def create_task_comment(
    task_id: str,
    body: PpmTaskCommentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    # Verify task exists
    t_result = await db.execute(select(PpmTask).where(PpmTask.id == task_id))
    task = t_result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    comment = PpmTaskComment(
        id=uuid.uuid4(),
        task_id=task_id,
        user_id=user.id,
        content=body.content,
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return _comment_to_out(comment)


@router.patch("/task-comments/{comment_id}", response_model=PpmTaskCommentOut)
async def update_task_comment(
    comment_id: str,
    body: PpmTaskCommentUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(PpmTaskComment).where(PpmTaskComment.id == comment_id))
    comment = result.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    # Only author or ppm.manage can edit
    has_manage = await PermissionService.check_permission(db, user, "ppm.manage")
    if comment.user_id != user.id and not has_manage:
        raise HTTPException(status_code=403, detail="Not allowed")
    comment.content = body.content
    await db.commit()
    await db.refresh(comment)
    return _comment_to_out(comment)


@router.delete("/task-comments/{comment_id}", status_code=204)
async def delete_task_comment(
    comment_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(PpmTaskComment).where(PpmTaskComment.id == comment_id))
    comment = result.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    has_manage = await PermissionService.check_permission(db, user, "ppm.manage")
    if comment.user_id != user.id and not has_manage:
        raise HTTPException(status_code=403, detail="Not allowed")
    await db.delete(comment)
    await db.commit()
