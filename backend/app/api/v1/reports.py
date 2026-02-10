from __future__ import annotations

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

    # Build intersection set
    intersections = set()
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        intersections.add((sid, tid))
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
