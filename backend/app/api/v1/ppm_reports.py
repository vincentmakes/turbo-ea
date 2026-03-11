"""PPM — Portfolio-level dashboard KPIs, Gantt chart data, and grouping options."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.card import Card
from app.models.ppm_cost_line import PpmBudgetLine, PpmCostLine
from app.models.ppm_status_report import PpmStatusReport
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.stakeholder import Stakeholder
from app.models.user import User
from app.schemas.ppm import (
    PpmGanttItem,
    PpmGanttStakeholder,
    PpmGroupOption,
    PpmStatusReportOut,
    ReporterOut,
)
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


@router.get("/group-options", response_model=list[PpmGroupOption])
async def ppm_group_options(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return card types that Initiative has relation types to (for grouping dropdown)."""
    await PermissionService.require_permission(db, user, "ppm.view")
    result = await db.execute(
        select(RelationType).where(
            RelationType.is_hidden.is_(False),
            or_(
                RelationType.source_type_key == "Initiative",
                RelationType.target_type_key == "Initiative",
            ),
        )
    )
    rel_types = result.scalars().all()
    seen: set[str] = set()
    options: list[PpmGroupOption] = []
    for rt in rel_types:
        # The "other" type is the one that isn't Initiative
        other_key = rt.target_type_key if rt.source_type_key == "Initiative" else rt.source_type_key
        if other_key == "Initiative" or other_key in seen:
            continue
        seen.add(other_key)
        options.append(PpmGroupOption(type_key=other_key, type_label=other_key))
    return sorted(options, key=lambda o: o.type_label)


@router.get("/dashboard")
async def ppm_dashboard(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.view")

    q = select(Card).where(Card.type == "Initiative", Card.status == "ACTIVE")
    result = await db.execute(q)
    initiatives = result.scalars().all()

    latest = await _latest_reports(db)

    total = len(initiatives)
    by_subtype: dict[str, int] = {}
    by_status: dict[str, int] = {}
    health_schedule = {"onTrack": 0, "atRisk": 0, "offTrack": 0, "noReport": 0}
    health_cost = {"onTrack": 0, "atRisk": 0, "offTrack": 0, "noReport": 0}
    health_scope = {"onTrack": 0, "atRisk": 0, "offTrack": 0, "noReport": 0}

    init_ids = [c.id for c in initiatives]

    for card in initiatives:
        sub = card.subtype or "Other"
        by_subtype[sub] = by_subtype.get(sub, 0) + 1

        attrs = card.attributes or {}
        init_status = attrs.get("initiativeStatus", "Unknown")
        by_status[init_status] = by_status.get(init_status, 0) + 1

        report = latest.get(card.id)
        if report:
            health_schedule[report.schedule_health] += 1
            health_cost[report.cost_health] += 1
            health_scope[report.scope_health] += 1
        else:
            health_schedule["noReport"] += 1
            health_cost["noReport"] += 1
            health_scope["noReport"] += 1

    # Aggregate budget (planned) and cost (actual) from dedicated tables
    total_budget = 0.0
    total_actual = 0.0
    if init_ids:
        budget_sum = await db.execute(
            select(func.coalesce(func.sum(PpmBudgetLine.amount), 0)).where(
                PpmBudgetLine.initiative_id.in_(init_ids)
            )
        )
        total_budget = float(budget_sum.scalar() or 0)

        actual_sum = await db.execute(
            select(func.coalesce(func.sum(PpmCostLine.actual), 0)).where(
                PpmCostLine.initiative_id.in_(init_ids)
            )
        )
        total_actual = float(actual_sum.scalar() or 0)

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


async def _build_group_map(db: AsyncSession, initiative_ids: list, group_by: str) -> dict:
    """Map initiative_id → (group_card_id, group_card_name)."""
    # Find relation types where Initiative connects to the group_by type
    rt_result = await db.execute(
        select(RelationType).where(
            RelationType.is_hidden.is_(False),
            or_(
                (RelationType.source_type_key == "Initiative")
                & (RelationType.target_type_key == group_by),
                (RelationType.source_type_key == group_by)
                & (RelationType.target_type_key == "Initiative"),
            ),
        )
    )
    rel_types = rt_result.scalars().all()
    if not rel_types:
        return {}

    rt_keys = [rt.key for rt in rel_types]

    # Find relations for these initiatives and relation types
    rel_result = await db.execute(
        select(Relation).where(
            Relation.type.in_(rt_keys),
            or_(
                Relation.source_id.in_(initiative_ids),
                Relation.target_id.in_(initiative_ids),
            ),
        )
    )
    relations = rel_result.scalars().all()

    # Determine which side is the initiative and which is the group card
    # Build a set of group card IDs to batch-load
    init_to_group_id: dict = {}
    group_card_ids: set = set()
    source_is_initiative = {rt.key: rt.source_type_key == "Initiative" for rt in rel_types}

    for rel in relations:
        is_src_init = source_is_initiative.get(rel.type, True)
        if is_src_init:
            init_id = rel.source_id
            group_id = rel.target_id
        else:
            init_id = rel.target_id
            group_id = rel.source_id

        if init_id not in init_to_group_id:
            init_to_group_id[init_id] = group_id
            group_card_ids.add(group_id)

    # Load group card names
    if not group_card_ids:
        return {}
    gc_result = await db.execute(select(Card.id, Card.name).where(Card.id.in_(group_card_ids)))
    group_names = {row[0]: row[1] for row in gc_result.all()}

    return {
        init_id: (gid, group_names.get(gid, "Unknown")) for init_id, gid in init_to_group_id.items()
    }


@router.get("/gantt", response_model=list[PpmGanttItem])
async def ppm_gantt(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    group_by: str | None = Query(None, description="Card type key to group by"),
):
    await PermissionService.require_permission(db, user, "ppm.view")

    q = select(Card).where(Card.type == "Initiative", Card.status == "ACTIVE")
    result = await db.execute(q)
    initiatives = result.scalars().all()

    latest = await _latest_reports(db)

    # Build group map if group_by is specified
    group_map: dict = {}
    if group_by and initiatives:
        init_ids = [c.id for c in initiatives]
        group_map = await _build_group_map(db, init_ids, group_by)

    # Batch-load cost line actuals per initiative
    init_ids = [c.id for c in initiatives]
    cost_agg: dict = {}
    if init_ids:
        cost_result = await db.execute(
            select(
                PpmCostLine.initiative_id,
                PpmCostLine.category,
                func.coalesce(func.sum(PpmCostLine.actual), 0).label("actual"),
            )
            .where(PpmCostLine.initiative_id.in_(init_ids))
            .group_by(PpmCostLine.initiative_id, PpmCostLine.category)
        )
        for row in cost_result.all():
            key = row[0]
            if key not in cost_agg:
                cost_agg[key] = {
                    "capex_planned": 0,
                    "capex_actual": 0,
                    "opex_planned": 0,
                    "opex_actual": 0,
                }
            cat = row[1]
            cost_agg[key][f"{cat}_actual"] = float(row[2])

        # Batch-load budget line planned amounts per initiative
        budget_result = await db.execute(
            select(
                PpmBudgetLine.initiative_id,
                PpmBudgetLine.category,
                func.coalesce(func.sum(PpmBudgetLine.amount), 0).label("amount"),
            )
            .where(PpmBudgetLine.initiative_id.in_(init_ids))
            .group_by(PpmBudgetLine.initiative_id, PpmBudgetLine.category)
        )
        for row in budget_result.all():
            key = row[0]
            if key not in cost_agg:
                cost_agg[key] = {
                    "capex_planned": 0,
                    "capex_actual": 0,
                    "opex_planned": 0,
                    "opex_actual": 0,
                }
            cat = row[1]
            cost_agg[key][f"{cat}_planned"] = float(row[2])

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
                summary=report.summary,
                accomplishments=report.accomplishments,
                next_steps=report.next_steps,
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

        # Grouping
        group_info = group_map.get(card.id)
        group_id = str(group_info[0]) if group_info else None
        group_name = group_info[1] if group_info else None

        # Cost line aggregations
        costs = cost_agg.get(card.id, {})

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
                capex_planned=costs.get("capex_planned", 0),
                capex_actual=costs.get("capex_actual", 0),
                opex_planned=costs.get("opex_planned", 0),
                opex_actual=costs.get("opex_actual", 0),
                group_id=group_id,
                group_name=group_name,
                latest_report=report_out,
                latest_report_id=str(report.id) if report else None,
                stakeholders=stakeholders,
            )
        )

    return items
