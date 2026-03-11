"""PPM — Per-initiative status reports, tasks, cost lines, and risks."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.card import Card
from app.models.card_type import CardType
from app.models.ppm_cost_line import PpmBudgetLine, PpmCostLine
from app.models.ppm_risk import PpmRisk
from app.models.ppm_status_report import PpmStatusReport
from app.models.ppm_task import PpmTask
from app.models.ppm_task_comment import PpmTaskComment
from app.models.ppm_wbs import PpmWbs
from app.models.todo import Todo
from app.models.user import User
from app.schemas.ppm import (
    PpmBudgetLineCreate,
    PpmBudgetLineOut,
    PpmBudgetLineUpdate,
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
    PpmWbsCreate,
    PpmWbsOut,
    PpmWbsUpdate,
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


async def _sync_initiative_costs(db: AsyncSession, initiative_id: str) -> None:
    """Roll up PPM budget/cost line totals into the Initiative card attributes."""
    result = await db.execute(
        select(Card).where(Card.id == initiative_id, Card.type == "Initiative")
    )
    card = result.scalar_one_or_none()
    if not card:
        return

    # Sum budget lines
    budget_result = await db.execute(
        select(func.coalesce(func.sum(PpmBudgetLine.amount), 0)).where(
            PpmBudgetLine.initiative_id == initiative_id
        )
    )
    total_budget = float(budget_result.scalar() or 0)

    # Sum cost line actuals
    cost_result = await db.execute(
        select(func.coalesce(func.sum(PpmCostLine.actual), 0)).where(
            PpmCostLine.initiative_id == initiative_id
        )
    )
    total_actual = float(cost_result.scalar() or 0)

    # Update card attributes
    attrs = dict(card.attributes or {})
    attrs["costBudget"] = total_budget if total_budget else None
    attrs["costActual"] = total_actual if total_actual else None
    card.attributes = attrs

    # Recalculate data quality
    ct_result = await db.execute(
        select(CardType.fields_schema, CardType.subtypes).where(CardType.key == card.type)
    )
    ct_row = ct_result.one_or_none()
    if ct_row:
        schema, subtypes = ct_row
        hidden_keys: set[str] = set()
        if card.subtype and subtypes:
            for st in subtypes:
                if st.get("key") == card.subtype:
                    hidden_keys = set(st.get("hidden_fields", []))
                    break
        total_w = 0.0
        filled_w = 0.0
        for section in schema:
            for field in section.get("fields", []):
                if field["key"] in hidden_keys:
                    continue
                weight = field.get("weight", 1)
                if weight <= 0:
                    continue
                total_w += weight
                val = attrs.get(field["key"])
                if val is not None and val != "" and val is not False:
                    filled_w += weight
        total_w += 1  # description
        if card.description and card.description.strip():
            filled_w += 1
        total_w += 1  # lifecycle
        lc = card.lifecycle or {}
        if any(lc.get(k) for k in ("plan", "phaseIn", "active", "phaseOut", "endOfLife")):
            filled_w += 1
        card.data_quality = round((filled_w / total_w * 100) if total_w > 0 else 0, 1)

    await db.commit()


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


def _cost_line_out(cl: PpmCostLine) -> PpmCostLineOut:
    return PpmCostLineOut(
        id=str(cl.id),
        initiative_id=str(cl.initiative_id),
        description=cl.description,
        category=cl.category,
        planned=cl.planned,
        actual=cl.actual,
        date=cl.date,
        created_at=cl.created_at,
        updated_at=cl.updated_at,
    )


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
    return [_cost_line_out(cl) for cl in result.scalars().all()]


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
        date=body.date,
    )
    db.add(cl)
    await db.commit()
    await db.refresh(cl)
    await _sync_initiative_costs(db, initiative_id)
    return _cost_line_out(cl)


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
    initiative_id = str(cl.initiative_id)
    for key, val in body.model_dump(exclude_unset=True).items():
        setattr(cl, key, val)
    await db.commit()
    await db.refresh(cl)
    await _sync_initiative_costs(db, initiative_id)
    return _cost_line_out(cl)


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
    initiative_id = str(cl.initiative_id)
    await db.delete(cl)
    await db.commit()
    await _sync_initiative_costs(db, initiative_id)


# ── Budget Lines ──────────────────────────────────────────────────


def _budget_line_out(bl: PpmBudgetLine) -> PpmBudgetLineOut:
    return PpmBudgetLineOut(
        id=str(bl.id),
        initiative_id=str(bl.initiative_id),
        fiscal_year=bl.fiscal_year,
        category=bl.category,
        amount=bl.amount,
        created_at=bl.created_at,
        updated_at=bl.updated_at,
    )


@router.get(
    "/initiatives/{initiative_id}/budgets",
    response_model=list[PpmBudgetLineOut],
)
async def list_budget_lines(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.view")
    await _get_initiative_or_404(db, initiative_id)
    result = await db.execute(
        select(PpmBudgetLine)
        .where(PpmBudgetLine.initiative_id == initiative_id)
        .order_by(PpmBudgetLine.fiscal_year, PpmBudgetLine.category)
    )
    return [_budget_line_out(bl) for bl in result.scalars().all()]


@router.post(
    "/initiatives/{initiative_id}/budgets",
    response_model=PpmBudgetLineOut,
)
async def create_budget_line(
    initiative_id: str,
    body: PpmBudgetLineCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    await _get_initiative_or_404(db, initiative_id)
    bl = PpmBudgetLine(
        id=uuid.uuid4(),
        initiative_id=initiative_id,
        fiscal_year=body.fiscal_year,
        category=body.category,
        amount=body.amount,
    )
    db.add(bl)
    await db.commit()
    await db.refresh(bl)
    await _sync_initiative_costs(db, initiative_id)
    return _budget_line_out(bl)


@router.patch("/budgets/{budget_id}", response_model=PpmBudgetLineOut)
async def update_budget_line(
    budget_id: str,
    body: PpmBudgetLineUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    result = await db.execute(select(PpmBudgetLine).where(PpmBudgetLine.id == budget_id))
    bl = result.scalar_one_or_none()
    if not bl:
        raise HTTPException(status_code=404, detail="Budget line not found")
    initiative_id = str(bl.initiative_id)
    for key, val in body.model_dump(exclude_unset=True).items():
        setattr(bl, key, val)
    await db.commit()
    await db.refresh(bl)
    await _sync_initiative_costs(db, initiative_id)
    return _budget_line_out(bl)


@router.delete("/budgets/{budget_id}", status_code=204)
async def delete_budget_line(
    budget_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    result = await db.execute(select(PpmBudgetLine).where(PpmBudgetLine.id == budget_id))
    bl = result.scalar_one_or_none()
    if not bl:
        raise HTTPException(status_code=404, detail="Budget line not found")
    initiative_id = str(bl.initiative_id)
    await db.delete(bl)
    await db.commit()
    await _sync_initiative_costs(db, initiative_id)


# ── Has Costs (lightweight check for frontend auto-field logic) ──


@router.get("/initiatives/{initiative_id}/has-costs")
async def has_costs(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.view")
    await _get_initiative_or_404(db, initiative_id)
    budget_result = await db.execute(
        select(func.count())
        .select_from(PpmBudgetLine)
        .where(PpmBudgetLine.initiative_id == initiative_id)
    )
    cost_result = await db.execute(
        select(func.count())
        .select_from(PpmCostLine)
        .where(PpmCostLine.initiative_id == initiative_id)
    )
    return {
        "has_budget_lines": (budget_result.scalar() or 0) > 0,
        "has_cost_lines": (cost_result.scalar() or 0) > 0,
    }


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
        start_date=task.start_date,
        due_date=task.due_date,
        sort_order=task.sort_order,
        tags=task.tags or [],
        wbs_id=str(task.wbs_id) if task.wbs_id else None,
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
        start_date=body.start_date,
        due_date=body.due_date,
        sort_order=body.sort_order,
        tags=body.tags,
        wbs_id=body.wbs_id,
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
    # Recalculate WBS completion when a new task is added
    if task.wbs_id:
        await _rollup_wbs_from_tasks(db, initiative_id)
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
    old_assignee_id = str(task.assignee_id) if task.assignee_id else None
    data = body.model_dump(exclude_unset=True)
    for key, val in data.items():
        setattr(task, key, val)
    card = await _get_initiative_or_404(db, str(task.initiative_id))
    await _sync_task_todo(db, task, card, user.id)
    # Notify new assignee when assignee changes
    new_assignee_id = task.assignee_id
    new_assignee_str = str(new_assignee_id) if new_assignee_id else None
    if "assignee_id" in data and new_assignee_id and new_assignee_str != old_assignee_id:
        await notification_service.create_notification(
            db,
            user_id=new_assignee_id,
            notif_type="task_assigned",
            title="Task Assigned",
            message=(
                f'{user.display_name} assigned you a task: "{task.title[:80]}" on {card.name}'
            ),
            link=f"/ppm/{task.initiative_id}?tab=tasks",
            card_id=task.initiative_id,
            actor_id=user.id,
        )
    # Recalculate WBS completion when task status changes
    if "status" in data:
        await _rollup_wbs_from_tasks(db, str(task.initiative_id))
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
    initiative_id = str(task.initiative_id)
    had_wbs = task.wbs_id is not None
    await db.delete(task)
    # Recalculate WBS completion after removing a task
    if had_wbs:
        await _rollup_wbs_from_tasks(db, initiative_id)
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


# ── WBS (Work Breakdown Structure) ────────────────────────────────


async def _wbs_to_out(db: AsyncSession, wbs: PpmWbs) -> PpmWbsOut:
    total = (await db.scalar(select(func.count(PpmTask.id)).where(PpmTask.wbs_id == wbs.id))) or 0
    done = (
        await db.scalar(
            select(func.count(PpmTask.id)).where(PpmTask.wbs_id == wbs.id, PpmTask.status == "done")
        )
    ) or 0
    progress = round((done / total) * 100, 1) if total else 0
    assignee_name = None
    if wbs.assignee_id:
        u_result = await db.execute(select(User).where(User.id == wbs.assignee_id))
        u = u_result.scalar_one_or_none()
        if u:
            assignee_name = u.display_name or u.email
    return PpmWbsOut(
        id=str(wbs.id),
        initiative_id=str(wbs.initiative_id),
        parent_id=str(wbs.parent_id) if wbs.parent_id else None,
        title=wbs.title,
        description=wbs.description,
        start_date=wbs.start_date,
        end_date=wbs.end_date,
        sort_order=wbs.sort_order,
        is_milestone=wbs.is_milestone,
        completion=wbs.completion,
        assignee_id=str(wbs.assignee_id) if wbs.assignee_id else None,
        assignee_name=assignee_name,
        progress=progress,
        task_count=total,
        created_at=wbs.created_at,
        updated_at=wbs.updated_at,
    )


async def _rollup_wbs_from_tasks(db: AsyncSession, initiative_id: str) -> None:
    """Recalculate leaf WBS completion from their tasks' done/total ratio, then rollup."""
    result = await db.execute(select(PpmWbs).where(PpmWbs.initiative_id == initiative_id))
    all_wbs = result.scalars().all()
    for wbs in all_wbs:
        total = (
            await db.scalar(select(func.count(PpmTask.id)).where(PpmTask.wbs_id == wbs.id))
        ) or 0
        if total > 0:
            done = (
                await db.scalar(
                    select(func.count(PpmTask.id)).where(
                        PpmTask.wbs_id == wbs.id, PpmTask.status == "done"
                    )
                )
            ) or 0
            wbs.completion = round((done / total) * 100, 1)
    await _rollup_completion(db, initiative_id)


async def _rollup_completion(db: AsyncSession, initiative_id: str) -> None:
    """Recalculate completion for parent WBS items by averaging their children."""
    result = await db.execute(
        select(PpmWbs)
        .where(PpmWbs.initiative_id == initiative_id)
        .order_by(PpmWbs.sort_order, PpmWbs.created_at)
    )
    all_wbs = result.scalars().all()
    by_id: dict[str, PpmWbs] = {str(w.id): w for w in all_wbs}
    children_map: dict[str, list[str]] = {}
    for w in all_wbs:
        pid = str(w.parent_id) if w.parent_id else None
        if pid:
            children_map.setdefault(pid, []).append(str(w.id))

    # Bottom-up: process leaves first, then parents
    def compute(wid: str) -> float:
        kids = children_map.get(wid, [])
        if not kids:
            return by_id[wid].completion
        child_vals = [compute(c) for c in kids]
        avg = sum(child_vals) / len(child_vals) if child_vals else 0
        parent = by_id[wid]
        parent.completion = round(avg, 1)
        return avg

    for w in all_wbs:
        if not w.parent_id:
            compute(str(w.id))


@router.get("/initiatives/{initiative_id}/wbs", response_model=list[PpmWbsOut])
async def list_wbs(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.view")
    await _get_initiative_or_404(db, initiative_id)
    result = await db.execute(
        select(PpmWbs)
        .where(PpmWbs.initiative_id == initiative_id)
        .order_by(PpmWbs.sort_order, PpmWbs.created_at)
    )
    return [await _wbs_to_out(db, w) for w in result.scalars().all()]


@router.post("/initiatives/{initiative_id}/wbs", response_model=PpmWbsOut)
async def create_wbs(
    initiative_id: str,
    body: PpmWbsCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    await _get_initiative_or_404(db, initiative_id)
    if body.parent_id:
        parent_result = await db.execute(
            select(PpmWbs).where(
                PpmWbs.id == body.parent_id,
                PpmWbs.initiative_id == initiative_id,
            )
        )
        if not parent_result.scalar_one_or_none():
            raise HTTPException(
                status_code=400,
                detail="Parent WBS item not found in this initiative",
            )
    wbs = PpmWbs(
        id=uuid.uuid4(),
        initiative_id=initiative_id,
        parent_id=body.parent_id,
        title=body.title,
        description=body.description,
        start_date=body.start_date,
        end_date=body.end_date,
        sort_order=body.sort_order,
        is_milestone=body.is_milestone,
        completion=body.completion,
        assignee_id=body.assignee_id,
    )
    db.add(wbs)
    await db.commit()
    await db.refresh(wbs)
    return await _wbs_to_out(db, wbs)


@router.patch("/wbs/{wbs_id}", response_model=PpmWbsOut)
async def update_wbs(
    wbs_id: str,
    body: PpmWbsUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    result = await db.execute(select(PpmWbs).where(PpmWbs.id == wbs_id))
    wbs = result.scalar_one_or_none()
    if not wbs:
        raise HTTPException(status_code=404, detail="WBS item not found")
    data = body.model_dump(exclude_unset=True)
    # Validate parent_id to prevent cycles
    if "parent_id" in data and data["parent_id"]:
        new_parent_id = data["parent_id"]
        if new_parent_id == wbs_id:
            raise HTTPException(status_code=400, detail="WBS item cannot be its own parent")
        parent_result = await db.execute(
            select(PpmWbs).where(
                PpmWbs.id == new_parent_id,
                PpmWbs.initiative_id == wbs.initiative_id,
            )
        )
        if not parent_result.scalar_one_or_none():
            raise HTTPException(
                status_code=400,
                detail="Parent WBS item not found in this initiative",
            )
        # Walk ancestors to detect cycle
        cursor = new_parent_id
        while cursor:
            if cursor == wbs_id:
                raise HTTPException(
                    status_code=400,
                    detail="Circular parent reference detected",
                )
            anc = await db.execute(select(PpmWbs.parent_id).where(PpmWbs.id == cursor))
            row = anc.first()
            cursor = str(row[0]) if row and row[0] else None
    for key, val in data.items():
        setattr(wbs, key, val)
    # Rollup completion to parents if completion changed
    if "completion" in data:
        await _rollup_completion(db, str(wbs.initiative_id))
    await db.commit()
    await db.refresh(wbs)
    return await _wbs_to_out(db, wbs)


@router.delete("/wbs/{wbs_id}", status_code=204)
async def delete_wbs(
    wbs_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    result = await db.execute(select(PpmWbs).where(PpmWbs.id == wbs_id))
    wbs = result.scalar_one_or_none()
    if not wbs:
        raise HTTPException(status_code=404, detail="WBS item not found")
    await db.delete(wbs)
    await db.commit()


@router.get("/initiatives/{initiative_id}/completion")
async def get_initiative_completion(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return overall completion % for an initiative (average of root WBS items)."""
    await PermissionService.require_permission(db, user, "ppm.view")
    await _get_initiative_or_404(db, initiative_id)
    result = await db.execute(
        select(PpmWbs).where(
            PpmWbs.initiative_id == initiative_id,
            PpmWbs.parent_id.is_(None),
        )
    )
    roots = result.scalars().all()
    if not roots:
        return {"completion": 0}
    avg = sum(w.completion for w in roots) / len(roots)
    return {"completion": round(avg, 1)}
