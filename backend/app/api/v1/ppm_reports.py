"""PPM — Portfolio-level dashboard KPIs and Gantt chart data."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.card import Card
from app.models.ppm_status_report import PpmStatusReport
from app.models.stakeholder import Stakeholder
from app.models.user import User
from app.schemas.ppm import PpmGanttItem, PpmGanttStakeholder, PpmStatusReportOut, ReporterOut
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/reports/ppm", tags=["ppm-reports"])


async def _latest_reports(db: AsyncSession) -> dict:
    """Return the most recent PpmStatusReport per initiative."""
    sub = (
        select(
            PpmStatusReport.initiative_id,
            func.max(PpmStatusReport.report_date).label("max_date"),
        )
        .group_by(PpmStatusReport.initiative_id)
        .subquery()
    )
    result = await db.execute(
        select(PpmStatusReport).join(
            sub,
            (PpmStatusReport.initiative_id == sub.c.initiative_id)
            & (PpmStatusReport.report_date == sub.c.max_date),
        )
    )
    reports = result.scalars().all()
    return {r.initiative_id: r for r in reports}


@router.get("/dashboard")
async def ppm_dashboard(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.view")

    # Get all active initiatives
    q = select(Card).where(Card.type == "Initiative", Card.status == "ACTIVE")
    result = await db.execute(q)
    initiatives = result.scalars().all()

    latest = await _latest_reports(db)

    total = len(initiatives)
    by_subtype: dict[str, int] = {}
    by_status: dict[str, int] = {}
    total_budget = 0.0
    total_actual = 0.0
    health_schedule = {"onTrack": 0, "atRisk": 0, "offTrack": 0, "noReport": 0}
    health_cost = {"onTrack": 0, "atRisk": 0, "offTrack": 0, "noReport": 0}
    health_scope = {"onTrack": 0, "atRisk": 0, "offTrack": 0, "noReport": 0}

    for card in initiatives:
        sub = card.subtype or "Other"
        by_subtype[sub] = by_subtype.get(sub, 0) + 1

        attrs = card.attributes or {}
        init_status = attrs.get("initiativeStatus", "Unknown")
        by_status[init_status] = by_status.get(init_status, 0) + 1

        total_budget += float(attrs.get("costBudget") or 0)
        total_actual += float(attrs.get("costActual") or 0)

        report = latest.get(card.id)
        if report:
            health_schedule[report.schedule_health] += 1
            health_cost[report.cost_health] += 1
            health_scope[report.scope_health] += 1
        else:
            health_schedule["noReport"] += 1
            health_cost["noReport"] += 1
            health_scope["noReport"] += 1

    return {
        "total_initiatives": total,
        "by_subtype": by_subtype,
        "by_status": by_status,
        "total_budget": total_budget,
        "total_actual": total_actual,
        "health_schedule": health_schedule,
        "health_cost": health_cost,
        "health_scope": health_scope,
    }


@router.get("/gantt", response_model=list[PpmGanttItem])
async def ppm_gantt(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.view")

    q = select(Card).where(Card.type == "Initiative", Card.status == "ACTIVE")
    result = await db.execute(q)
    initiatives = result.scalars().all()

    latest = await _latest_reports(db)

    items: list[PpmGanttItem] = []
    for card in initiatives:
        attrs = card.attributes or {}
        report = latest.get(card.id)
        report_out = None
        if report:
            u_result = await db.execute(select(User).where(User.id == report.reporter_id))
            u = u_result.scalar_one_or_none()
            reporter = (
                ReporterOut(id=str(u.id), display_name=u.display_name or u.email) if u else None
            )
            report_out = PpmStatusReportOut(
                id=str(report.id),
                initiative_id=str(report.initiative_id),
                reporter_id=str(report.reporter_id),
                reporter=reporter,
                report_date=report.report_date,
                schedule_health=report.schedule_health,
                cost_health=report.cost_health,
                scope_health=report.scope_health,
                percent_complete=report.percent_complete,
                cost_lines=report.cost_lines or [],
                summary=report.summary,
                risks=report.risks or [],
                created_at=report.created_at,
                updated_at=report.updated_at,
            )

        # Stakeholders
        sh_result = await db.execute(
            select(Stakeholder, User)
            .join(User, Stakeholder.user_id == User.id)
            .where(Stakeholder.card_id == card.id)
        )
        stakeholders = [
            PpmGanttStakeholder(
                user_id=str(sh.user_id),
                display_name=u.display_name or u.email,
                role_key=sh.role,
            )
            for sh, u in sh_result.all()
        ]

        items.append(
            PpmGanttItem(
                id=str(card.id),
                name=card.name,
                subtype=card.subtype,
                status=attrs.get("initiativeStatus"),
                parent_id=str(card.parent_id) if card.parent_id else None,
                start_date=attrs.get("startDate"),
                end_date=attrs.get("endDate"),
                cost_budget=float(attrs.get("costBudget") or 0) or None,
                cost_actual=float(attrs.get("costActual") or 0) or None,
                latest_report=report_out,
                stakeholders=stakeholders,
            )
        )

    return items
