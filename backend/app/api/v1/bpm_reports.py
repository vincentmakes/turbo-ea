"""BPM-specific report endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.fact_sheet import FactSheet
from app.models.process_diagram import ProcessDiagram
from app.models.process_element import ProcessElement
from app.models.relation import Relation

router = APIRouter(prefix="/reports/bpm", tags=["reports"])


@router.get("/dashboard")
async def bpm_dashboard(db: AsyncSession = Depends(get_db)):
    """BPM KPIs: counts, maturity distribution, automation levels, risk."""
    # All active BusinessProcess fact sheets
    result = await db.execute(
        select(FactSheet).where(
            FactSheet.type == "BusinessProcess",
            FactSheet.status == "ACTIVE",
        )
    )
    processes = result.scalars().all()
    total = len(processes)

    by_process_type: dict[str, int] = {}
    by_maturity: dict[str, int] = {}
    by_automation: dict[str, int] = {}
    by_risk: dict[str, int] = {}
    top_risk: list[dict] = []

    for p in processes:
        attrs = p.attributes or {}
        pt = attrs.get("processType", "unknown")
        by_process_type[pt] = by_process_type.get(pt, 0) + 1
        mat = attrs.get("maturity", "unknown")
        by_maturity[mat] = by_maturity.get(mat, 0) + 1
        auto = attrs.get("automationLevel", "unknown")
        by_automation[auto] = by_automation.get(auto, 0) + 1
        risk = attrs.get("riskLevel", "unknown")
        by_risk[risk] = by_risk.get(risk, 0) + 1
        if risk in ("high", "critical"):
            top_risk.append(
                {
                    "id": str(p.id),
                    "name": p.name,
                    "risk": risk,
                    "maturity": mat,
                }
            )

    def _risk_order(x: dict) -> int:
        order = {"critical": 0, "high": 1}
        return order.get(x["risk"], 99)

    top_risk.sort(key=_risk_order)

    # Diagram coverage
    diag_result = await db.execute(select(ProcessDiagram.process_id).distinct())
    processes_with_diagrams = len(diag_result.all())

    return {
        "total_processes": total,
        "by_process_type": by_process_type,
        "by_maturity": by_maturity,
        "by_automation": by_automation,
        "by_risk": by_risk,
        "top_risk_processes": top_risk[:10],
        "diagram_coverage": {
            "with_diagram": processes_with_diagrams,
            "total": total,
            "percentage": round(processes_with_diagrams / total * 100, 1) if total else 0,
        },
    }


@router.get("/capability-process-matrix")
async def capability_process_matrix(db: AsyncSession = Depends(get_db)):
    """Capability × Process cross-reference grid."""
    # Get all relProcessToBC relations
    result = await db.execute(select(Relation).where(Relation.type == "relProcessToBC"))
    rels = result.scalars().all()

    # Load the related fact sheets
    process_ids = {r.source_id for r in rels}
    cap_ids = {r.target_id for r in rels}
    all_ids = process_ids | cap_ids

    if not all_ids:
        return {"rows": [], "columns": [], "cells": []}

    fs_result = await db.execute(select(FactSheet).where(FactSheet.id.in_(all_ids)))
    fs_map = {fs.id: fs for fs in fs_result.scalars().all()}

    rows = [{"id": str(pid), "name": fs_map[pid].name} for pid in process_ids if pid in fs_map]
    columns = [{"id": str(cid), "name": fs_map[cid].name} for cid in cap_ids if cid in fs_map]
    cells = [
        {
            "process_id": str(r.source_id),
            "capability_id": str(r.target_id),
            "attributes": r.attributes or {},
        }
        for r in rels
    ]

    return {"rows": rows, "columns": columns, "cells": cells}


@router.get("/process-application-matrix")
async def process_application_matrix(db: AsyncSession = Depends(get_db)):
    """Process × Application cross-reference grid (process-level + element-level links)."""
    # Process-level relations
    rel_result = await db.execute(select(Relation).where(Relation.type == "relProcessToApp"))
    rels = rel_result.scalars().all()

    # Element-level application links
    elem_result = await db.execute(
        select(ProcessElement).where(ProcessElement.application_id.isnot(None))
    )
    elem_links = elem_result.scalars().all()

    # Collect unique ids
    process_ids: set = set()
    app_ids: set = set()
    cells: list[dict] = []

    for r in rels:
        process_ids.add(r.source_id)
        app_ids.add(r.target_id)
        cells.append(
            {
                "process_id": str(r.source_id),
                "application_id": str(r.target_id),
                "source": "relation",
                "attributes": r.attributes or {},
            }
        )

    for e in elem_links:
        process_ids.add(e.process_id)
        app_ids.add(e.application_id)
        cells.append(
            {
                "process_id": str(e.process_id),
                "application_id": str(e.application_id),
                "source": "element",
                "element_name": e.name,
                "element_type": e.element_type,
            }
        )

    all_ids = process_ids | app_ids
    if not all_ids:
        return {"rows": [], "columns": [], "cells": []}

    fs_result = await db.execute(select(FactSheet).where(FactSheet.id.in_(all_ids)))
    fs_map = {fs.id: fs for fs in fs_result.scalars().all()}

    rows = [{"id": str(pid), "name": fs_map[pid].name} for pid in process_ids if pid in fs_map]
    columns = [{"id": str(aid), "name": fs_map[aid].name} for aid in app_ids if aid in fs_map]

    return {"rows": rows, "columns": columns, "cells": cells}


@router.get("/process-dependencies")
async def process_dependencies(db: AsyncSession = Depends(get_db)):
    """Dependency graph data: nodes + edges for force-directed visualization."""
    result = await db.execute(select(Relation).where(Relation.type == "relProcessDependency"))
    rels = result.scalars().all()

    node_ids = set()
    edges = []
    for r in rels:
        node_ids.add(r.source_id)
        node_ids.add(r.target_id)
        edges.append(
            {
                "source": str(r.source_id),
                "target": str(r.target_id),
                "id": str(r.id),
            }
        )

    if not node_ids:
        return {"nodes": [], "edges": []}

    fs_result = await db.execute(select(FactSheet).where(FactSheet.id.in_(node_ids)))
    nodes = [
        {
            "id": str(fs.id),
            "name": fs.name,
            "subtype": fs.subtype,
            "attributes": fs.attributes or {},
        }
        for fs in fs_result.scalars().all()
    ]

    return {"nodes": nodes, "edges": edges}


@router.get("/capability-heatmap")
async def capability_heatmap(
    metric: str = Query(
        "process_count",
        description="Metric: process_count, maturity, strategicImportance",
    ),
    db: AsyncSession = Depends(get_db),
):
    """Capability tree colored by a chosen metric."""
    # Load capabilities
    cap_result = await db.execute(
        select(FactSheet).where(
            FactSheet.type == "BusinessCapability",
            FactSheet.status == "ACTIVE",
        )
    )
    capabilities = cap_result.scalars().all()

    # Load process→capability relations
    rel_result = await db.execute(select(Relation).where(Relation.type == "relProcessToBC"))
    rels = rel_result.scalars().all()

    # Count processes per capability
    process_count: dict = {}
    for r in rels:
        cid = r.target_id
        process_count[cid] = process_count.get(cid, 0) + 1

    items = []
    for cap in capabilities:
        attrs = cap.attributes or {}
        value = None
        if metric == "process_count":
            value = process_count.get(cap.id, 0)
        elif metric == "maturity":
            mat_key = attrs.get("maturity")
            mat_map = {"initial": 1, "managed": 2, "defined": 3, "measured": 4, "optimized": 5}
            value = mat_map.get(mat_key, 0)
        elif metric == "strategicImportance":
            si_key = attrs.get("strategicImportance")
            si_map = {"low": 1, "medium": 2, "high": 3, "critical": 4}
            value = si_map.get(si_key, 0)

        items.append(
            {
                "id": str(cap.id),
                "name": cap.name,
                "parent_id": str(cap.parent_id) if cap.parent_id else None,
                "level": (attrs.get("capabilityLevel") or "L1"),
                "metric_value": value,
                "attributes": attrs,
            }
        )

    return {"metric": metric, "items": items}


@router.get("/element-application-map")
async def element_application_map(db: AsyncSession = Depends(get_db)):
    """Which BPMN elements use which applications — grouped by application."""
    result = await db.execute(
        select(ProcessElement)
        .where(ProcessElement.application_id.isnot(None))
        .order_by(ProcessElement.application_id)
    )
    elements = result.scalars().all()

    # Group by application
    grouped: dict[str, list[dict]] = {}
    process_ids = set()
    for e in elements:
        app_id = str(e.application_id)
        process_ids.add(e.process_id)
        grouped.setdefault(app_id, []).append(
            {
                "element_id": str(e.id),
                "element_name": e.name,
                "element_type": e.element_type,
                "lane_name": e.lane_name,
                "process_id": str(e.process_id),
            }
        )

    # Resolve names
    all_ids = {uuid.UUID(aid) for aid in grouped} | process_ids
    if not all_ids:
        return []

    fs_result = await db.execute(select(FactSheet).where(FactSheet.id.in_(all_ids)))
    fs_map = {str(fs.id): fs.name for fs in fs_result.scalars().all()}

    result_list = []
    for app_id, elems in grouped.items():
        for elem in elems:
            elem["process_name"] = fs_map.get(elem["process_id"], "")
        result_list.append(
            {
                "application_id": app_id,
                "application_name": fs_map.get(app_id, ""),
                "elements": elems,
            }
        )

    return result_list
