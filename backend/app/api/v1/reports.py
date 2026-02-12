from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.fact_sheet import FactSheet
from app.models.relation import Relation
from app.models.event import Event

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/dashboard")
async def dashboard(db: AsyncSession = Depends(get_db)):
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
        "recent_events": recent_events,
    }


@router.get("/landscape")
async def landscape(
    db: AsyncSession = Depends(get_db),
    type: str = Query("Application"),
    group_by: str = Query("BusinessCapability"),
):
    """Landscape report: fact sheets grouped by a related type."""
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
    type: str = Query("Application"),
    x_axis: str = Query("functionalFit"),
    y_axis: str = Query("technicalFit"),
    size_field: str = Query("totalAnnualCost"),
    color_field: str = Query("businessCriticality"),
):
    """Portfolio scatter/bubble chart data."""
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
    row_type: str = Query("Application"),
    col_type: str = Query("BusinessCapability"),
):
    """Matrix report: cross-reference grid."""
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
    type: str | None = Query(None),
):
    """Roadmap: lifecycle timeline data."""
    q = select(FactSheet).where(FactSheet.status == "ACTIVE")
    if type:
        q = q.where(FactSheet.type == type)
    result = await db.execute(q)
    sheets = result.scalars().all()
    items = []
    for fs in sheets:
        lc = fs.lifecycle or {}
        if any(lc.values()):
            items.append({
                "id": str(fs.id),
                "name": fs.name,
                "type": fs.type,
                "lifecycle": lc,
            })
    return {"items": items}


@router.get("/cost")
async def cost_report(
    db: AsyncSession = Depends(get_db),
    type: str = Query("Application"),
):
    """Cost aggregation report."""
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
    type: str = Query("Application"),
    cost_field: str = Query("totalAnnualCost"),
    group_by: str | None = Query(None),
):
    """Cost treemap: items with cost, optionally grouped by a related type."""
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
    metric: str = Query("app_count"),
):
    """Business capability heatmap data with hierarchy."""
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

    rels_result = await db.execute(
        select(Relation).where(
            ((Relation.source_id.in_(cap_ids)) | (Relation.target_id.in_(cap_ids)))
        )
    )
    rels = rels_result.scalars().all()

    # Build cap_id -> [app_fact_sheet] mapping
    cap_apps: dict[str, list] = {str(c.id): [] for c in caps}
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        if sid in cap_apps and tid in app_map:
            cap_apps[sid].append(app_map[tid])
        elif tid in cap_apps and sid in app_map:
            cap_apps[tid].append(app_map[sid])

    # Build hierarchy-aware data
    items = []
    for c in caps:
        cid = str(c.id)
        linked_apps = cap_apps.get(cid, [])
        app_count = len(linked_apps)

        # Aggregate cost
        total_cost = sum(
            (a.attributes or {}).get("totalAnnualCost", 0) or 0
            for a in linked_apps
        )

        # Count end-of-life risk (apps with endOfLife lifecycle phase set)
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
            "apps": [
                {
                    "id": str(a.id),
                    "name": a.name,
                    "attributes": a.attributes,
                    "lifecycle": a.lifecycle,
                }
                for a in linked_apps[:10]  # limit to top 10 for performance
            ],
        })

    return {"items": items, "metric": metric}


@router.get("/dependencies")
async def dependencies(
    db: AsyncSession = Depends(get_db),
    center_id: str | None = Query(None),
    depth: int = Query(2, ge=1, le=3),
    type: str | None = Query(None),
):
    """Dependency / interface map: nodes + edges for graph rendering."""
    # Get fact sheets
    q = select(FactSheet).where(FactSheet.status == "ACTIVE")
    if type:
        q = q.where(FactSheet.type == type)
    result = await db.execute(q)
    sheets = result.scalars().all()
    sheet_map = {str(fs.id): fs for fs in sheets}

    # Get all relations
    all_ids = list(sheet_map.keys())
    rels_result = await db.execute(select(Relation))
    rels = rels_result.scalars().all()

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
                edges.append({
                    "source": sid,
                    "target": tid,
                    "type": r.type,
                    "description": r.description,
                })

    return {"nodes": nodes, "edges": edges}


@router.get("/data-quality")
async def data_quality(db: AsyncSession = Depends(get_db)):
    """Data quality & completeness dashboard."""
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
