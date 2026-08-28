"""PPM — Portfolio-level dashboard KPIs, Gantt chart data, and grouping options.

These handlers are thin: everything they return is built by
``app.services.ppm_portfolio_service``, which the account-less portfolio portal
(``/web-portals/public/{slug}/ppm/portfolio``) shares. Keeping one builder is
what stops the authenticated and public boards drifting apart.

Authorization stays here, in the route layer — the service knows nothing about
users or permissions.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.ppm import PpmGanttItem, PpmGroupOption
from app.services import ppm_portfolio_service as portfolio
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/reports/ppm", tags=["ppm-reports"])


@router.get("/group-options", response_model=list[PpmGroupOption])
async def ppm_group_options(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return card types that Initiative has relation types to (for grouping dropdown)."""
    await PermissionService.require_permission(db, user, "ppm.view")
    return await portfolio.build_group_options(db)


@router.get("/dashboard")
async def ppm_dashboard(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.view")

    initiatives = await portfolio.load_initiatives(db, portfolio.PortfolioScope())
    init_ids = [c.id for c in initiatives]
    latest = await portfolio.latest_reports(db, init_ids)
    totals = await portfolio.sum_budget_actual(db, init_ids)
    return portfolio.build_dashboard(initiatives, latest, totals)


@router.get("/gantt", response_model=list[PpmGanttItem])
async def ppm_gantt(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    group_by: str | None = Query(None, description="Card type key to group by"),
):
    await PermissionService.require_permission(db, user, "ppm.view")

    initiatives = await portfolio.load_initiatives(db, portfolio.PortfolioScope())
    latest = await portfolio.latest_reports(db, [c.id for c in initiatives])
    return await portfolio.build_gantt_items(db, initiatives, latest, group_by=group_by)
