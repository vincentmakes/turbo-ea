"""Admin-editable homepage dashboards (``/dashboards``).

Reads: the list of dashboards the caller sees, and the generic aggregation the
Chart / KPI widgets draw from (``/query``, ``/kpi``, ``/kpi-history``) — every
count through the caller's ``CardReadScope`` in module mode. Writes need
``admin.dashboards`` and each records one Security & admin log row.

The rules live in ``services/dashboard_service.py`` (visibility, validation,
copies, audit diff), ``services/dashboard_query.py`` (the aggregation) and
``services/dashboard_kpi_service.py`` (snapshots and trends); the handlers here
only wire them together, so the logic carries a mutation score.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.dashboard import Dashboard
from app.models.user import User
from app.schemas.dashboard import DashboardCreate, DashboardDuplicate, DashboardUpdate
from app.services import audit_log
from app.services import dashboard_kpi_service as kpis
from app.services import dashboard_service as svc
from app.services.card_read_scope import CardReadScope
from app.services.dashboard_defaults import DEFAULT_DASHBOARDS, default_widgets
from app.services.dashboard_query import (
    DashboardQuery,
    DashboardQueryError,
    ResolvedQuery,
    fiscal_year_keys,
    resolve_query,
    run_query,
)
from app.services.permission_service import PermissionService, effective_role_key

router = APIRouter(prefix="/dashboards", tags=["dashboards"])

MANAGE_PERMISSION = "admin.dashboards"
READ_DATA = "reports.ea_dashboard"
# Columns a PATCH may not clear: an explicit ``null`` for one is ignored.
_NOT_NULLABLE = frozenset({"name", "is_hidden", "sort_order", "allowed_roles", "widgets"})


def _query_params(
    card_type: str | None = Query(None, max_length=100),
    group_by: str | None = Query(None, max_length=120),
    group_by_2: str | None = Query(None, max_length=120),
    metric: str = Query("count", max_length=10),
    metric_field: str | None = Query(None, max_length=100),
    approval_status: str | None = Query(None, max_length=20),
    lifecycle_phase: str | None = Query(None, max_length=20),
    subtype: str | None = Query(None, max_length=100),
    relation_type: str | None = Query(None, max_length=200),
    flags: str | None = Query(None, max_length=300),
) -> DashboardQuery:
    return DashboardQuery(
        card_type=card_type,
        group_by=group_by,
        group_by_2=group_by_2,
        metric=metric,
        metric_field=metric_field,
        approval_status=approval_status,
        lifecycle_phase=lifecycle_phase,
        subtype=subtype,
        relation_type=relation_type,
        flags=flags,
    )


async def _prepare(
    db: AsyncSession, user: User, query: DashboardQuery
) -> tuple[ResolvedQuery, CardReadScope]:
    """Gate, resolve and scope a data query. A sum or average of a cost field
    also needs ``costs.view`` — the figure is landscape-wide, so a per-card
    stakeholder grant cannot stand in for it (the portfolio-axes precedent)."""
    await PermissionService.require_permission(db, user, READ_DATA)
    try:
        resolved = await resolve_query(db, query)
    except DashboardQueryError as exc:
        raise HTTPException(400, exc.code) from exc
    if resolved.metric_is_cost:
        await PermissionService.require_permission(db, user, "costs.view")
    return resolved, await CardReadScope.load(db, user)


async def _load(db: AsyncSession, dashboard_id: uuid.UUID) -> Dashboard:
    dashboard = (
        await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
    ).scalar_one_or_none()
    if dashboard is None:
        raise HTTPException(404, "Dashboard not found")
    return dashboard


async def _checked_roles(db: AsyncSession, keys: list[str]) -> list[str]:
    try:
        return await svc.check_allowed_roles(db, keys)
    except svc.DashboardError as exc:
        raise HTTPException(exc.status, exc.code) from exc


async def _audit(
    db: AsyncSession,
    user: User,
    action: str,
    dashboard: Dashboard,
    *,
    changes: dict | None = None,
    items: list | None = None,
    context: dict | None = None,
) -> None:
    await audit_log.record(
        db,
        action=f"admin.dashboard.{action}",
        category="admin",
        actor=user,
        target=("dashboard", str(dashboard.id), dashboard.name),
        changes=changes,
        items=items,
        context={"key": dashboard.key, "built_in": bool(dashboard.built_in), **(context or {})},
    )


async def _capture_kpis(db: AsyncSession, widgets: Any) -> None:
    """A baseline snapshot for every KPI query the dashboard now carries, so
    its trend starts today rather than at the next nightly capture."""
    await kpis.capture_for_queries(db, kpis.kpi_queries(widgets))


# ── Reads ────────────────────────────────────────────────────────────────


@router.get("")
async def list_dashboards(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The dashboards the caller sees as homepage tabs, in tab order."""
    can_manage = await PermissionService.check_permission(db, user, MANAGE_PERMISSION)
    role_key = effective_role_key(user)
    role = await PermissionService.load_role(db, role_key)
    wildcard = bool(((role or {}).get("permissions") or {}).get("*"))
    rows = (await db.execute(select(Dashboard))).scalars().all()
    visible = [
        d
        for d in svc.sort_dashboards(rows)
        if svc.can_see(d, role_key=role_key, wildcard=wildcard, can_manage=can_manage)
    ]
    return [svc.dashboard_payload(d, can_manage=can_manage) for d in visible]


@router.get("/query")
async def dashboard_query(
    query: DashboardQuery = Depends(_query_params),
    top: int = Query(20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Rows for a chart widget: ``{dimension, dimension_2, rows, total}``, plus
    ``labels`` (card id → name) for a card-keyed dimension — whose ``top``
    largest cards are kept and the rest folded into ``__other__``, or dropped
    for an average or a share; ``folded`` (``{top, cards}``, only when a card
    was not kept) says how many — and ``fiscal_year`` / ``fiscal_year_start``
    for a cost."""
    resolved, read_scope = await _prepare(db, user, query)
    return await run_query(db, resolved, read_scope, top=top)


@router.get("/kpi")
async def dashboard_kpi(
    query: DashboardQuery = Depends(_query_params),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """One KPI value and, for an unrestricted reader, its trend; ``base`` for
    a narrowed count, the fiscal year for a cost."""
    resolved, read_scope = await _prepare(db, user, query)
    return await kpis.kpi_with_trend(db, resolved, read_scope)


@router.get("/kpi-history")
async def dashboard_kpi_history(
    query: DashboardQuery = Depends(_query_params),
    days: int = Query(90, ge=1, le=kpis.MAX_HISTORY_DAYS),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """A KPI's daily snapshots (empty for a restricted reader), and the fiscal
    year for a cost."""
    resolved, read_scope = await _prepare(db, user, query)
    points = await kpis.kpi_history(db, resolved, read_scope, days=days)
    return {"points": points, **await fiscal_year_keys(db, resolved)}


# ── Writes ───────────────────────────────────────────────────────────────


@router.post("", status_code=201)
async def create_dashboard(
    body: DashboardCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, MANAGE_PERMISSION)
    roles = await _checked_roles(db, body.allowed_roles)
    existing = set((await db.execute(select(Dashboard.key))).scalars().all())
    dashboard = Dashboard(
        id=uuid.uuid4(),
        key=svc.new_key(body.name, existing),
        name=body.name,
        translations={},
        description=body.description,
        icon=body.icon,
        built_in=False,
        is_hidden=False,
        sort_order=await svc.next_sort_order(db),
        allowed_roles=roles,
        widgets=[svc.normalize_widget(w.model_dump()) for w in body.widgets],
    )
    db.add(dashboard)
    await db.flush()
    labels = await svc.role_labels(db, roles)
    await _audit(
        db,
        user,
        "created",
        dashboard,
        context={
            "widget_count": len(dashboard.widgets),
            "allowed_roles": [labels.get(k, k) for k in roles],
        },
    )
    await _capture_kpis(db, dashboard.widgets)
    await db.commit()
    return svc.dashboard_payload(dashboard, can_manage=True)


@router.patch("/{dashboard_id}")
async def update_dashboard(
    dashboard_id: uuid.UUID,
    body: DashboardUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, MANAGE_PERMISSION)
    dashboard = await _load(db, dashboard_id)
    updates = {
        k: v
        for k, v in body.model_dump(exclude_unset=True).items()
        if not (k in _NOT_NULLABLE and v is None)
    }
    if "allowed_roles" in updates:
        updates["allowed_roles"] = await _checked_roles(db, updates["allowed_roles"])
    if "widgets" in updates:
        updates["widgets"] = [svc.normalize_widget(w) for w in updates["widgets"]]
    # The translations name the old name; a renamed dashboard reads as typed.
    if "name" in updates and updates["name"] != dashboard.name:
        updates["translations"] = {}

    before = svc.audit_snapshot(dashboard)
    for name, value in updates.items():
        setattr(dashboard, name, value)
    after = svc.audit_snapshot(dashboard)
    labels = await svc.role_labels(db, before["allowed_roles"], after["allowed_roles"])
    changes, items = svc.audit_changes_for(before, after, labels)
    if changes or items:
        await _audit(db, user, "updated", dashboard, changes=changes, items=items)
    if "widgets" in updates:
        await _capture_kpis(db, dashboard.widgets)
    await db.commit()
    return svc.dashboard_payload(dashboard, can_manage=True)


@router.delete("/{dashboard_id}", status_code=204)
async def delete_dashboard(
    dashboard_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, MANAGE_PERMISSION)
    dashboard = await _load(db, dashboard_id)
    if dashboard.built_in:
        # A built-in dashboard is hidden, never deleted: Reset needs its row.
        raise HTTPException(409, "built_in")
    await _audit(db, user, "deleted", dashboard, context={"widget_count": len(dashboard.widgets)})
    await db.delete(dashboard)
    await db.commit()


@router.post("/{dashboard_id}/duplicate", status_code=201)
async def duplicate_dashboard(
    dashboard_id: uuid.UUID,
    body: DashboardDuplicate | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, MANAGE_PERMISSION)
    source = await _load(db, dashboard_id)
    name = svc.copy_name(source.name, body.name if body else None)
    existing = set((await db.execute(select(Dashboard.key))).scalars().all())
    copy = Dashboard(
        id=uuid.uuid4(),
        key=svc.new_key(name, existing),
        name=name,
        translations={},
        description=source.description,
        icon=source.icon,
        built_in=False,
        is_hidden=False,
        sort_order=source.sort_order + 1,
        allowed_roles=list(source.allowed_roles or []),
        widgets=svc.copy_widgets(source.widgets or []),
    )
    db.add(copy)
    await db.flush()
    await _audit(
        db,
        user,
        "duplicated",
        copy,
        context={"source": source.name, "widget_count": len(copy.widgets)},
    )
    await db.commit()
    return svc.dashboard_payload(copy, can_manage=True)


@router.post("/{dashboard_id}/reset")
async def reset_dashboard(
    dashboard_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, MANAGE_PERMISSION)
    dashboard = await _load(db, dashboard_id)
    widgets = default_widgets(dashboard.key) if dashboard.built_in else None
    if widgets is None:
        raise HTTPException(409, "not_built_in")
    before = svc.audit_snapshot(dashboard)
    dashboard.widgets = widgets
    # Reset means the whole default: a built-in that states its access (the
    # Admin dashboard) gets the seeded roles back too.
    spec = DEFAULT_DASHBOARDS[dashboard.key]
    if spec.get("access_permission"):
        dashboard.allowed_roles = await svc.seeded_access(db, spec)
    after = svc.audit_snapshot(dashboard)
    labels = await svc.role_labels(db, before["allowed_roles"], after["allowed_roles"])
    changes, items = svc.audit_changes_for(before, after, labels)
    await _audit(db, user, "reset", dashboard, changes=changes, items=items)
    await db.commit()
    return svc.dashboard_payload(dashboard, can_manage=True)
