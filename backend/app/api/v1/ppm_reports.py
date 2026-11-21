"""PPM — Portfolio-level dashboard KPIs, Gantt chart data, grouping options and
the data the board's Filters section matches on.

These handlers are thin: the board's rows, KPIs and groups are built by
``app.services.ppm_portfolio_service``, which the account-less portfolio portal
(``/web-portals/public/{slug}/ppm/portfolio``) shares. Keeping one builder is
what stops the authenticated and public boards drifting apart. The filter data
(``/filter-data``, authenticated only) is the reports' portfolio payload
(``app.services.portfolio_payload``) for the Initiative type, cost-redacted and
projected by ``ppm_portfolio_service.card_filter_payload``.

Authorization stays here, in the route layer — the service knows nothing about
users or permissions.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.card_type import CardType
from app.models.user import User
from app.schemas.ppm import PpmGanttItem, PpmGroupOption
from app.services import ppm_portfolio_service as portfolio
from app.services.card_read_scope import CardReadScope
from app.services.cost_redaction import redact_portfolio_costs
from app.services.permission_service import PermissionService
from app.services.portfolio_payload import build_portfolio_payload

router = APIRouter(prefix="/reports/ppm", tags=["ppm-reports"])


@router.get("/group-options", response_model=list[PpmGroupOption])
async def ppm_group_options(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return card types that Initiative has relation types to (for grouping dropdown)."""
    await PermissionService.require_permission(db, user, "ppm.view")
    return await portfolio.build_group_options(db, read_scope=await CardReadScope.load(db, user))


@router.get("/dashboard")
async def ppm_dashboard(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.view")

    initiatives = await portfolio.load_initiatives(
        db, portfolio.PortfolioScope(), read_scope=await CardReadScope.load(db, user)
    )
    init_ids = [c.id for c in initiatives]
    latest = await portfolio.latest_reports(db, init_ids)
    totals = await portfolio.sum_budget_actual(db, init_ids)
    return portfolio.build_dashboard(initiatives, latest, totals)


@router.get("/gantt", response_model=list[PpmGanttItem])
async def ppm_gantt(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    group_by: str | None = Query(
        None,
        description=(
            "Card type key to group by, or subtype:<key> to group every initiative "
            "under the top-most initiative of that Initiative subtype above it"
        ),
    ),
):
    await PermissionService.require_permission(db, user, "ppm.view")

    read_scope = await CardReadScope.load(db, user)
    initiatives = await portfolio.load_initiatives(
        db, portfolio.PortfolioScope(), read_scope=read_scope
    )
    latest = await portfolio.latest_reports(db, [c.id for c in initiatives])
    return await portfolio.build_gantt_items(
        db, initiatives, latest, group_by=group_by, read_scope=read_scope
    )


@router.get("/filter-data")
async def ppm_filter_data(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """What the board's Filters section matches initiatives on: every initiative
    ``/gantt`` returns, with its relations, tags, subtype and attributes, plus the
    relation types, related cards and tag groups the filter options list.

    The same initiatives as ``/gantt``: ``build_portfolio_payload`` selects the
    ACTIVE cards of the type inside the reader's module read scope, as
    ``load_initiatives`` does, and neither consults the type's ``is_hidden``.
    Cost attributes go only to a reader who may see them. An install without an
    Initiative type gets the empty payload, never a 404.
    """
    await PermissionService.require_permission(db, user, "ppm.view")
    read_scope = await CardReadScope.load(db, user)

    all_types = (await db.execute(select(CardType))).scalars().all()
    initiative_type = next((t for t in all_types if t.key == portfolio.INITIATIVE_TYPE), None)
    if initiative_type is None:
        return portfolio.empty_filter_payload()

    payload = await build_portfolio_payload(db, read_scope, initiative_type, all_types)
    payload = await redact_portfolio_costs(db, user, payload, initiative_type)
    return portfolio.card_filter_payload(payload)
