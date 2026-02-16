from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.services.permission_service import PermissionService
from app.models.event import Event
from app.models.fact_sheet import FactSheet
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.user import User

router = APIRouter(prefix="/reports", tags=["reports"])

log = logging.getLogger(__name__)


def _current_lifecycle_phase(lifecycle: dict | None) -> str | None:
    """Determine which lifecycle phase a fact sheet is currently in based on dates."""
    if not lifecycle:
        return None
    phases = ["endOfLife", "phaseOut", "active", "phaseIn", "plan"]
    today = datetime.now(timezone.utc).date()
    for phase in phases:
        date_str = lifecycle.get(phase)
        if date_str:
            try:
                d = datetime.fromisoformat(date_str).date() if "T" in str(date_str) else datetime.strptime(str(date_str), "%Y-%m-%d").date()
                if d <= today:
                    return phase
            except (ValueError, TypeError):
                continue
    # If all dates are in the future, return the earliest set phase
    for phase in ["plan", "phaseIn", "active", "phaseOut", "endOfLife"]:
        if lifecycle.get(phase):
            return phase
    return None


@router.get("/dashboard")
async def dashboard(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    # Count by type
    type_counts = await db.execute(
        select(FactSheet.type, func.count(FactSheet.id))
        .where(FactSheet.status == "ACTIVE")
        .group_by(FactSheet.type)
    )
    by_type = {row[0]: row[1] for row in type_counts.all()}

    # Total
    total = sum(by_type.values())

    # Average completion
    avg_result = await db.execute(
        select(func.avg(FactSheet.completion)).where(FactSheet.status == "ACTIVE")
    )
    avg_completion = avg_result.scalar() or 0

    # Quality seal distribution
    seal_counts = await db.execute(
        select(FactSheet.quality_seal, func.count(FactSheet.id))
        .where(FactSheet.status == "ACTIVE")
        .group_by(FactSheet.quality_seal)
    )
    seals = {row[0]: row[1] for row in seal_counts.all()}

    # Completion distribution (buckets)
    completion_dist = {"0-25": 0, "25-50": 0, "50-75": 0, "75-100": 0}
    comp_result = await db.execute(
        select(FactSheet.completion).where(FactSheet.status == "ACTIVE")
    )
    for (comp_val,) in comp_result.all():
        v = comp_val or 0
        if v < 25:
            completion_dist["0-25"] += 1
        elif v < 50:
            completion_dist["25-50"] += 1
        elif v < 75:
            completion_dist["50-75"] += 1
        else:
            completion_dist["75-100"] += 1

    # Lifecycle phase distribution
    lifecycle_result = await db.execute(
        select(FactSheet.lifecycle).where(FactSheet.status == "ACTIVE")
    )
    lifecycle_dist: dict[str, int] = {
        "plan": 0, "phaseIn": 0, "active": 0, "phaseOut": 0, "endOfLife": 0, "none": 0,
    }
    for (lc,) in lifecycle_result.all():
        phase = _current_lifecycle_phase(lc)
        if phase and phase in lifecycle_dist:
            lifecycle_dist[phase] += 1
        else:
            lifecycle_dist["none"] += 1

    # Recent events
    events_result = await db.execute(
        select(Event).order_by(Event.created_at.desc()).limit(20)
    )
    recent_events = [
        {
            "id": str(e.id),
            "event_type": e.event_type,
            "data": e.data,
            "user_display_name": e.user.display_name if e.user else None,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in events_result.scalars().all()
    ]

    return {
        "total_fact_sheets": total,
        "by_type": by_type,
        "avg_completion": round(avg_completion, 1),
        "quality_seals": seals,
        "completion_distribution": completion_dist,
        "lifecycle_distribution": lifecycle_dist,
        "recent_events": recent_events,
    }


@router.get("/landscape")
async def landscape(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str = Query("Application"),
    group_by: str = Query("BusinessCapability"),
):
    """Landscape report: fact sheets grouped by a related type."""
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    # Get all fact sheets of the target type
    result = await db.execute(
        select(FactSheet).where(FactSheet.type == type, FactSheet.status == "ACTIVE")
    )
    sheets = result.scalars().all()

    # Get relations connecting the type to the group_by type
    all_rels = await db.execute(select(Relation))
    rels = all_rels.scalars().all()

    # Get group fact sheets
    group_result = await db.execute(
        select(FactSheet).where(FactSheet.type == group_by, FactSheet.status == "ACTIVE")
    )
    groups = group_result.scalars().all()

    # Build mapping: group_id -> [fact_sheet]
    sheet_map = {str(fs.id): fs for fs in sheets}
    group_map = {}
    for g in groups:
        group_map[str(g.id)] = {"id": str(g.id), "name": g.name, "items": []}

    for rel in rels:
        sid, tid = str(rel.source_id), str(rel.target_id)
        if sid in sheet_map and tid in group_map:
            fs = sheet_map[sid]
            group_map[tid]["items"].append({
                "id": str(fs.id), "name": fs.name, "type": fs.type,
                "attributes": fs.attributes, "lifecycle": fs.lifecycle,
            })
        elif tid in sheet_map and sid in group_map:
            fs = sheet_map[tid]
            group_map[sid]["items"].append({
                "id": str(fs.id), "name": fs.name, "type": fs.type,
                "attributes": fs.attributes, "lifecycle": fs.lifecycle,
            })

    # Ungrouped
    grouped_ids = set()
    for g in group_map.values():
        for item in g["items"]:
            grouped_ids.add(item["id"])
    ungrouped = [
        {"id": str(fs.id), "name": fs.name, "type": fs.type, "attributes": fs.attributes}
        for fs in sheets if str(fs.id) not in grouped_ids
    ]

    return {
        "groups": list(group_map.values()),
        "ungrouped": ungrouped,
    }


@router.get("/portfolio")
async def portfolio(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str = Query("Application"),
    x_axis: str = Query("functionalFit"),
    y_axis: str = Query("technicalFit"),
    size_field: str = Query("totalAnnualCost"),
    color_field: str = Query("businessCriticality"),
):
    """Portfolio scatter/bubble chart data."""
    await PermissionService.require_permission(db, user, "reports.portfolio")
    result = await db.execute(
        select(FactSheet).where(FactSheet.type == type, FactSheet.status == "ACTIVE")
    )
    sheets = result.scalars().all()
    items = []
    for fs in sheets:
        attrs = fs.attributes or {}
        items.append({
            "id": str(fs.id),
            "name": fs.name,
            "x": attrs.get(x_axis),
            "y": attrs.get(y_axis),
            "size": attrs.get(size_field, 0),
            "color": attrs.get(color_field),
            "lifecycle": fs.lifecycle,
        })
    return {"items": items, "x_axis": x_axis, "y_axis": y_axis}


@router.get("/matrix")
async def matrix(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    row_type: str = Query("Application"),
    col_type: str = Query("BusinessCapability"),
):
    """Matrix report: cross-reference grid."""
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    rows_result = await db.execute(
        select(FactSheet).where(FactSheet.type == row_type, FactSheet.status == "ACTIVE").order_by(FactSheet.name)
    )
    rows = rows_result.scalars().all()

    cols_result = await db.execute(
        select(FactSheet).where(FactSheet.type == col_type, FactSheet.status == "ACTIVE").order_by(FactSheet.name)
    )
    cols = cols_result.scalars().all()

    # Get all relations between these types
    row_ids = [fs.id for fs in rows]
    col_ids = [fs.id for fs in cols]
    rels_result = await db.execute(
        select(Relation).where(
            ((Relation.source_id.in_(row_ids)) & (Relation.target_id.in_(col_ids)))
            | ((Relation.source_id.in_(col_ids)) & (Relation.target_id.in_(row_ids)))
        )
    )
    rels = rels_result.scalars().all()

    # Build intersection set – normalise to (row_id, col_id) direction
    row_id_set = {str(fs.id) for fs in rows}
    intersections = set()
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        if sid in row_id_set:
            intersections.add((sid, tid))
        else:
            intersections.add((tid, sid))

    return {
        "rows": [{"id": str(r.id), "name": r.name} for r in rows],
        "columns": [{"id": str(c.id), "name": c.name} for c in cols],
        "intersections": [{"row_id": r, "col_id": c} for r, c in intersections],
    }


@router.get("/roadmap")
async def roadmap(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str | None = Query(None),
):
    """Roadmap: lifecycle timeline data."""
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    q = select(FactSheet).where(FactSheet.status == "ACTIVE")
    if type:
        q = q.where(FactSheet.type == type)
    result = await db.execute(q)
    sheets = result.scalars().all()
    items = []
    for fs in sheets:
        lc = fs.lifecycle or {}
        attrs = fs.attributes or {}
        if any(lc.values()) or attrs.get("startDate") or attrs.get("endDate"):
            items.append({
                "id": str(fs.id),
                "name": fs.name,
                "type": fs.type,
                "subtype": fs.subtype,
                "lifecycle": lc,
                "attributes": attrs,
            })
    return {"items": items}


@router.get("/cost")
async def cost_report(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str = Query("Application"),
):
    """Cost aggregation report."""
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    result = await db.execute(
        select(FactSheet).where(FactSheet.type == type, FactSheet.status == "ACTIVE")
    )
    sheets = result.scalars().all()
    items = []
    total = 0
    for fs in sheets:
        cost = (fs.attributes or {}).get("totalAnnualCost", 0) or 0
        if cost:
            items.append({"id": str(fs.id), "name": fs.name, "cost": cost})
            total += cost
    items.sort(key=lambda x: x["cost"], reverse=True)
    return {"items": items, "total": total}


@router.get("/cost-treemap")
async def cost_treemap(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str = Query("Application"),
    cost_field: str = Query("totalAnnualCost"),
    group_by: str | None = Query(None),
):
    """Cost treemap: items with cost, optionally grouped by a related type."""
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    result = await db.execute(
        select(FactSheet).where(FactSheet.type == type, FactSheet.status == "ACTIVE")
    )
    sheets = result.scalars().all()

    items = []
    total = 0.0
    for fs in sheets:
        cost = (fs.attributes or {}).get(cost_field, 0) or 0
        if not cost:
            continue
        items.append({
            "id": str(fs.id),
            "name": fs.name,
            "cost": cost,
            "lifecycle": fs.lifecycle,
            "attributes": fs.attributes,
        })
        total += cost
    items.sort(key=lambda x: x["cost"], reverse=True)

    groups = None
    if group_by:
        # Get group fact sheets
        grp_result = await db.execute(
            select(FactSheet).where(FactSheet.type == group_by, FactSheet.status == "ACTIVE")
        )
        grp_sheets = grp_result.scalars().all()
        grp_map = {str(g.id): g.name for g in grp_sheets}

        # Get relations
        sheet_ids = [fs.id for fs in sheets]
        grp_ids = [g.id for g in grp_sheets]
        rels_result = await db.execute(
            select(Relation).where(
                ((Relation.source_id.in_(sheet_ids)) & (Relation.target_id.in_(grp_ids)))
                | ((Relation.source_id.in_(grp_ids)) & (Relation.target_id.in_(sheet_ids)))
            )
        )
        rels = rels_result.scalars().all()

        # Build item -> group name mapping
        item_group: dict[str, str] = {}
        for r in rels:
            sid, tid = str(r.source_id), str(r.target_id)
            if tid in grp_map:
                item_group[sid] = grp_map[tid]
            elif sid in grp_map:
                item_group[tid] = grp_map[sid]

        for item in items:
            item["group"] = item_group.get(item["id"], "Ungrouped")

        # Build group summaries
        groups_dict: dict[str, float] = {}
        for item in items:
            g = item["group"]
            groups_dict[g] = groups_dict.get(g, 0) + item["cost"]
        groups = [{"name": k, "cost": v} for k, v in sorted(groups_dict.items(), key=lambda x: -x[1])]

    return {"items": items, "total": total, "groups": groups}


@router.get("/capability-heatmap")
async def capability_heatmap(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    metric: str = Query("app_count"),
):
    """Business capability heatmap data with hierarchy."""
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    # Get all business capabilities
    caps_result = await db.execute(
        select(FactSheet).where(
            FactSheet.type == "BusinessCapability",
            FactSheet.status == "ACTIVE",
        ).order_by(FactSheet.name)
    )
    caps = caps_result.scalars().all()
    cap_ids = [c.id for c in caps]

    # Get related applications via relations
    apps_result = await db.execute(
        select(FactSheet).where(FactSheet.type == "Application", FactSheet.status == "ACTIVE")
    )
    apps = apps_result.scalars().all()
    app_map = {str(a.id): a for a in apps}

    # Get all organizations for filtering
    orgs_result = await db.execute(
        select(FactSheet).where(
            FactSheet.type == "Organization", FactSheet.status == "ACTIVE",
        ).order_by(FactSheet.name)
    )
    orgs = orgs_result.scalars().all()

    # Get relations linking caps↔apps and orgs↔apps
    all_ids = cap_ids + [o.id for o in orgs]
    rels_result = await db.execute(
        select(Relation).where(
            (Relation.source_id.in_(all_ids)) | (Relation.target_id.in_(all_ids))
        )
    )
    rels = rels_result.scalars().all()

    # Build cap_id -> [app_fact_sheet] and app_id -> [org_id] mappings
    cap_apps: dict[str, list] = {str(c.id): [] for c in caps}
    org_ids = {str(o.id) for o in orgs}
    app_orgs: dict[str, set[str]] = {}
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        if sid in cap_apps and tid in app_map:
            cap_apps[sid].append(app_map[tid])
        elif tid in cap_apps and sid in app_map:
            cap_apps[tid].append(app_map[sid])
        # org -> app relations
        if sid in org_ids and tid in app_map:
            app_orgs.setdefault(tid, set()).add(sid)
        elif tid in org_ids and sid in app_map:
            app_orgs.setdefault(sid, set()).add(tid)

    def _app_to_dict(a):
        return {
            "id": str(a.id),
            "name": a.name,
            "subtype": a.subtype,
            "attributes": a.attributes,
            "lifecycle": a.lifecycle,
            "org_ids": sorted(app_orgs.get(str(a.id), set())),
        }

    # Build hierarchy-aware data
    items = []
    for c in caps:
        cid = str(c.id)
        linked_apps = cap_apps.get(cid, [])
        app_count = len(linked_apps)

        total_cost = sum(
            (a.attributes or {}).get("costTotalAnnual", 0)
            or (a.attributes or {}).get("totalAnnualCost", 0)
            or 0
            for a in linked_apps
        )

        risk_count = sum(
            1 for a in linked_apps
            if (a.lifecycle or {}).get("endOfLife")
        )

        items.append({
            "id": cid,
            "name": c.name,
            "parent_id": str(c.parent_id) if c.parent_id else None,
            "app_count": app_count,
            "total_cost": total_cost,
            "risk_count": risk_count,
            "attributes": c.attributes,
            "apps": [_app_to_dict(a) for a in linked_apps],
        })

    organizations = [
        {"id": str(o.id), "name": o.name}
        for o in orgs
    ]

    return {"items": items, "metric": metric, "organizations": organizations}


@router.get("/dependencies")
async def dependencies(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    center_id: str | None = Query(None),
    depth: int = Query(2, ge=1, le=3),
    type: str | None = Query(None),
):
    """Dependency / interface map: nodes + edges for graph rendering."""
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    # Always load ALL active fact sheets for ancestor path resolution
    full_result = await db.execute(
        select(FactSheet).where(FactSheet.status == "ACTIVE")
    )
    all_sheets = full_result.scalars().all()
    full_map = {str(fs.id): fs for fs in all_sheets}

    # Apply optional type filter for the graph scope
    if type:
        sheet_map = {k: v for k, v in full_map.items() if v.type == type}
    else:
        sheet_map = dict(full_map)

    # Get all relations + relation type labels
    all_ids = list(sheet_map.keys())
    rels_result = await db.execute(select(Relation))
    rels = rels_result.scalars().all()

    rt_result = await db.execute(select(RelationType.key, RelationType.label, RelationType.reverse_label))
    rel_type_info = {row[0]: {"label": row[1], "reverse_label": row[2]} for row in rt_result.all()}

    # If center_id, do BFS to limited depth
    if center_id and center_id in sheet_map:
        # Build adjacency list
        adj: dict[str, list[tuple[str, str]]] = {}  # id -> [(neighbor_id, rel_type)]
        for r in rels:
            sid, tid = str(r.source_id), str(r.target_id)
            if sid in sheet_map and tid in sheet_map:
                adj.setdefault(sid, []).append((tid, r.type))
                adj.setdefault(tid, []).append((sid, r.type))

        # BFS
        visited: set[str] = {center_id}
        frontier: set[str] = {center_id}
        for _ in range(depth):
            next_frontier: set[str] = set()
            for nid in frontier:
                for neighbor, _ in adj.get(nid, []):
                    if neighbor not in visited:
                        visited.add(neighbor)
                        next_frontier.add(neighbor)
            frontier = next_frontier

        visible_ids = visited
    else:
        visible_ids = set(all_ids)

    # Helper: build ancestor path names (root-first) using full_map
    def _ancestor_path(fs_id: str) -> list[str]:
        path: list[str] = []
        cur = full_map.get(fs_id)
        seen: set[str] = set()
        while cur and cur.parent_id:
            pid = str(cur.parent_id)
            if pid in seen:
                break
            seen.add(pid)
            parent = full_map.get(pid)
            if not parent:
                break
            path.insert(0, parent.name)
            cur = parent
        return path

    # Build nodes
    nodes = []
    for nid in visible_ids:
        fs = sheet_map.get(nid)
        if not fs:
            continue
        nodes.append({
            "id": nid,
            "name": fs.name,
            "type": fs.type,
            "lifecycle": fs.lifecycle,
            "attributes": fs.attributes,
            "parent_id": str(fs.parent_id) if fs.parent_id else None,
            "path": _ancestor_path(nid),
        })

    # Build edges (only between visible nodes)
    edges = []
    seen_edges: set[str] = set()
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        if sid in visible_ids and tid in visible_ids:
            edge_key = f"{min(sid, tid)}:{max(sid, tid)}"
            if edge_key not in seen_edges:
                seen_edges.add(edge_key)
                rt_info = rel_type_info.get(r.type, {})
                edges.append({
                    "source": sid,
                    "target": tid,
                    "type": r.type,
                    "label": rt_info.get("label", r.type),
                    "reverse_label": rt_info.get("reverse_label"),
                    "description": r.description,
                })

    return {"nodes": nodes, "edges": edges}


@router.get("/data-quality")
async def data_quality(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Data quality & completeness dashboard."""
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    result = await db.execute(
        select(FactSheet).where(FactSheet.status == "ACTIVE")
    )
    sheets = result.scalars().all()

    # By-type stats
    type_stats: dict[str, dict] = {}
    all_completions = []
    for fs in sheets:
        t = fs.type
        if t not in type_stats:
            type_stats[t] = {"total": 0, "complete": 0, "partial": 0, "minimal": 0, "sum_completion": 0}
        ts = type_stats[t]
        ts["total"] += 1
        ts["sum_completion"] += fs.completion or 0
        all_completions.append(fs.completion or 0)
        if fs.completion >= 80:
            ts["complete"] += 1
        elif fs.completion >= 40:
            ts["partial"] += 1
        else:
            ts["minimal"] += 1

    # Overall completion
    overall = round(sum(all_completions) / len(all_completions), 1) if all_completions else 0

    # Lifecycle completeness
    with_lifecycle = sum(1 for fs in sheets if fs.lifecycle and any(fs.lifecycle.values()))

    # Orphaned items (no relations)
    all_ids = {str(fs.id) for fs in sheets}
    rels_result = await db.execute(select(Relation))
    rels = rels_result.scalars().all()
    connected = set()
    for r in rels:
        connected.add(str(r.source_id))
        connected.add(str(r.target_id))
    orphaned = len(all_ids - connected)

    # Stale items (not updated in 90+ days)
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    stale = sum(1 for fs in sheets if fs.updated_at and fs.updated_at < cutoff)

    # By-type breakdown
    by_type = []
    for t, ts in sorted(type_stats.items(), key=lambda x: x[1]["sum_completion"] / max(x[1]["total"], 1)):
        by_type.append({
            "type": t,
            "total": ts["total"],
            "complete": ts["complete"],
            "partial": ts["partial"],
            "minimal": ts["minimal"],
            "avg_completion": round(ts["sum_completion"] / max(ts["total"], 1), 1),
        })

    # Worst offenders (20 lowest completion)
    worst = sorted(sheets, key=lambda fs: fs.completion or 0)[:20]
    worst_items = [
        {
            "id": str(fs.id),
            "name": fs.name,
            "type": fs.type,
            "completion": fs.completion or 0,
            "updated_at": fs.updated_at.isoformat() if fs.updated_at else None,
        }
        for fs in worst
    ]

    return {
        "overall_completion": overall,
        "total_items": len(sheets),
        "with_lifecycle": with_lifecycle,
        "orphaned": orphaned,
        "stale": stale,
        "by_type": by_type,
        "worst_items": worst_items,
    }


# ---------------------------------------------------------------------------
#  EOL Risk & Impact report
# ---------------------------------------------------------------------------

_EOL_BASE = "https://endoflife.date/api"


def _eol_status(eol_val, support_val) -> str:
    """Classify a cycle as 'eol', 'approaching', 'supported', or 'unknown'."""
    now = datetime.now(timezone.utc).date()

    # Check EOL first
    if eol_val is True:
        return "eol"
    if isinstance(eol_val, str):
        try:
            eol_date = datetime.strptime(eol_val, "%Y-%m-%d").date()
            if eol_date <= now:
                return "eol"
            six_months = now + timedelta(days=182)
            if eol_date <= six_months:
                return "approaching"
        except ValueError:
            pass

    # If active support has ended
    if isinstance(support_val, str):
        try:
            sup_date = datetime.strptime(support_val, "%Y-%m-%d").date()
            if sup_date <= now:
                return "approaching"
        except ValueError:
            pass

    if eol_val is False:
        return "supported"

    return "supported" if eol_val is not None else "unknown"


async def _fetch_product_cycles(
    client: httpx.AsyncClient, product: str,
) -> list[dict] | None:
    """Fetch cycles for a single product, returning None on failure."""
    try:
        resp = await client.get(f"{_EOL_BASE}/{product}.json", timeout=10.0)
        if resp.status_code == 200:
            return resp.json()
    except httpx.HTTPError:
        log.warning("Failed to fetch EOL data for %s", product)
    return None


def _manual_eol_status(lifecycle: dict | None) -> str:
    """Classify a fact sheet with manually maintained lifecycle dates."""
    if not lifecycle:
        return "unknown"

    now = datetime.now(timezone.utc).date()
    eol_str = lifecycle.get("endOfLife")
    phase_out_str = lifecycle.get("phaseOut")

    # Check endOfLife date
    if isinstance(eol_str, str) and eol_str:
        try:
            eol_date = datetime.strptime(eol_str, "%Y-%m-%d").date()
            if eol_date <= now:
                return "eol"
            six_months = now + timedelta(days=182)
            if eol_date <= six_months:
                return "approaching"
        except ValueError:
            pass

    # Check phaseOut date (analogous to support ending)
    if isinstance(phase_out_str, str) and phase_out_str:
        try:
            po_date = datetime.strptime(phase_out_str, "%Y-%m-%d").date()
            if po_date <= now:
                return "approaching"
        except ValueError:
            pass

    return "supported"


@router.get("/eol")
async def eol_report(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """End-of-Life risk & impact report.

    Returns all Applications and IT Components with linked EOL data
    (from endoflife.date API) *or* manually maintained lifecycle dates,
    enriched with live cycle information and impact mapping
    (IT Component → related Applications).

    Each item includes a ``source`` field: ``"api"`` for items linked
    to endoflife.date, ``"manual"`` for items with only a hand-entered
    ``endOfLife`` lifecycle date.
    """
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    # 1. Fetch all active Applications and ITComponents
    result = await db.execute(
        select(FactSheet).where(
            FactSheet.status == "ACTIVE",
            FactSheet.type.in_(["Application", "ITComponent"]),
        )
    )
    all_sheets = result.scalars().all()

    # Split into API-linked and manually-maintained sets
    api_sheets = []
    manual_sheets = []
    seen_ids: set[str] = set()

    for fs in all_sheets:
        attrs = fs.attributes or {}
        has_api_link = bool(attrs.get("eol_product") and attrs.get("eol_cycle"))
        lifecycle = fs.lifecycle or {}
        has_manual_eol = bool(lifecycle.get("endOfLife"))

        if has_api_link:
            api_sheets.append(fs)
            seen_ids.add(str(fs.id))
        elif has_manual_eol:
            manual_sheets.append(fs)
            seen_ids.add(str(fs.id))

    if not api_sheets and not manual_sheets:
        return {
            "items": [],
            "summary": {
                "eol": 0, "approaching": 0, "supported": 0,
                "impacted_apps": 0, "manual": 0,
            },
        }

    # 2. Batch-fetch unique products from endoflife.date (for API-linked items)
    unique_products = {(fs.attributes or {})["eol_product"] for fs in api_sheets}
    product_cycles: dict[str, list[dict]] = {}

    if unique_products:
        async with httpx.AsyncClient(timeout=15.0) as client:
            tasks = {
                product: _fetch_product_cycles(client, product)
                for product in unique_products
            }
            results = await asyncio.gather(*tasks.values())
            for product, cycles in zip(tasks.keys(), results):
                if cycles is not None:
                    product_cycles[product] = cycles

    # 3. Get relations between ITComponent and Application for impact mapping
    all_eol_sheets = api_sheets + manual_sheets
    it_ids = [fs.id for fs in all_eol_sheets if fs.type == "ITComponent"]
    app_map = {str(fs.id): fs for fs in all_sheets if fs.type == "Application"}
    it_to_apps: dict[str, list[dict]] = {}

    if it_ids:
        rels_result = await db.execute(
            select(Relation).where(
                (Relation.source_id.in_(it_ids)) | (Relation.target_id.in_(it_ids))
            )
        )
        rels = rels_result.scalars().all()
        it_id_strs = {str(i) for i in it_ids}
        for r in rels:
            sid, tid = str(r.source_id), str(r.target_id)
            # ITComponent → Application relation in either direction
            if sid in it_id_strs and tid in app_map:
                it_to_apps.setdefault(sid, []).append({
                    "id": tid,
                    "name": app_map[tid].name,
                    "lifecycle": app_map[tid].lifecycle,
                })
            elif tid in it_id_strs and sid in app_map:
                it_to_apps.setdefault(tid, []).append({
                    "id": sid,
                    "name": app_map[sid].name,
                    "lifecycle": app_map[sid].lifecycle,
                })

    # 4. Build response items
    items = []
    counts = {"eol": 0, "approaching": 0, "supported": 0}
    manual_count = 0
    eol_impacted_app_ids: set[str] = set()
    approaching_impacted_app_ids: set[str] = set()

    # 4a. API-linked items
    for fs in api_sheets:
        attrs = fs.attributes or {}
        product = attrs["eol_product"]
        cycle_key = str(attrs["eol_cycle"])

        # Match cycle data
        cycle_data = None
        cycles = product_cycles.get(product, [])
        for c in cycles:
            if str(c.get("cycle")) == cycle_key:
                cycle_data = c
                break

        status = "unknown"
        if cycle_data:
            status = _eol_status(cycle_data.get("eol"), cycle_data.get("support"))

        if status in counts:
            counts[status] += 1

        # Impact: affected apps
        affected_apps = it_to_apps.get(str(fs.id), [])
        if fs.type == "ITComponent":
            for app in affected_apps:
                if status == "eol":
                    eol_impacted_app_ids.add(app["id"])
                elif status == "approaching":
                    approaching_impacted_app_ids.add(app["id"])

        items.append({
            "id": str(fs.id),
            "name": fs.name,
            "type": fs.type,
            "subtype": fs.subtype,
            "eol_product": product,
            "eol_cycle": cycle_key,
            "status": status,
            "source": "api",
            "cycle_data": cycle_data,
            "lifecycle": fs.lifecycle,
            "affected_apps": affected_apps,
        })

    # 4b. Manually maintained items (lifecycle.endOfLife set, no API link)
    for fs in manual_sheets:
        lifecycle = fs.lifecycle or {}
        status = _manual_eol_status(lifecycle)
        manual_count += 1

        if status in counts:
            counts[status] += 1

        # Impact: affected apps
        affected_apps = it_to_apps.get(str(fs.id), [])
        if fs.type == "ITComponent":
            for app in affected_apps:
                if status == "eol":
                    eol_impacted_app_ids.add(app["id"])
                elif status == "approaching":
                    approaching_impacted_app_ids.add(app["id"])

        # Build synthetic cycle_data from lifecycle dates for timeline display
        manual_cycle_data = {}
        if lifecycle.get("active"):
            manual_cycle_data["releaseDate"] = lifecycle["active"]
        if lifecycle.get("phaseOut"):
            manual_cycle_data["support"] = lifecycle["phaseOut"]
        if lifecycle.get("endOfLife"):
            manual_cycle_data["eol"] = lifecycle["endOfLife"]

        items.append({
            "id": str(fs.id),
            "name": fs.name,
            "type": fs.type,
            "subtype": fs.subtype,
            "eol_product": None,
            "eol_cycle": None,
            "status": status,
            "source": "manual",
            "cycle_data": manual_cycle_data if manual_cycle_data else None,
            "lifecycle": lifecycle,
            "affected_apps": affected_apps,
        })

    # Sort: EOL first, then approaching, then supported
    status_order = {"eol": 0, "approaching": 1, "unknown": 2, "supported": 3}
    items.sort(key=lambda x: (status_order.get(x["status"], 9), x["name"]))

    return {
        "items": items,
        "summary": {
            "eol": counts["eol"],
            "approaching": counts["approaching"],
            "supported": counts["supported"],
            "impacted_apps": len(eol_impacted_app_ids),
            "approaching_impacted_apps": len(approaching_impacted_app_ids - eol_impacted_app_ids),
            "manual": manual_count,
        },
    }
