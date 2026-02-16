"""BPM-specific report endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.services.permission_service import PermissionService
from app.models.fact_sheet import FactSheet
from app.models.process_diagram import ProcessDiagram
from app.models.process_element import ProcessElement
from app.models.relation import Relation
from app.models.user import User

router = APIRouter(prefix="/reports/bpm", tags=["reports"])


@router.get("/dashboard")
async def bpm_dashboard(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """BPM KPIs: counts, maturity distribution, automation levels, risk."""
    await PermissionService.require_permission(db, user, "reports.bpm_dashboard")
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
async def capability_process_matrix(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Capability × Process cross-reference grid."""
    await PermissionService.require_permission(db, user, "reports.bpm_dashboard")
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
async def process_application_matrix(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Process × Application cross-reference grid (process-level + element-level links)."""
    await PermissionService.require_permission(db, user, "reports.bpm_dashboard")
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
async def process_dependencies(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Dependency graph data: nodes + edges for force-directed visualization."""
    await PermissionService.require_permission(db, user, "reports.bpm_dashboard")
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
    user: User = Depends(get_current_user),
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
async def element_application_map(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
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


@router.get("/process-map")
async def process_map(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Process landscape map: hierarchy + related apps, data objects, orgs, contexts."""
    # All active BusinessProcess fact sheets
    proc_result = await db.execute(
        select(FactSheet).where(
            FactSheet.type == "BusinessProcess",
            FactSheet.status == "ACTIVE",
        ).order_by(FactSheet.name)
    )
    processes = proc_result.scalars().all()
    proc_ids = [p.id for p in processes]

    if not proc_ids:
        return {"items": [], "organizations": [], "business_contexts": []}

    # All Applications
    app_result = await db.execute(
        select(FactSheet).where(FactSheet.type == "Application", FactSheet.status == "ACTIVE")
    )
    apps = app_result.scalars().all()
    app_map = {a.id: a for a in apps}

    # All DataObjects
    do_result = await db.execute(
        select(FactSheet).where(FactSheet.type == "DataObject", FactSheet.status == "ACTIVE")
    )
    data_objects = do_result.scalars().all()
    do_map = {d.id: d for d in data_objects}

    # All Organizations (for filtering)
    org_result = await db.execute(
        select(FactSheet).where(
            FactSheet.type == "Organization", FactSheet.status == "ACTIVE",
        ).order_by(FactSheet.name)
    )
    orgs = org_result.scalars().all()
    org_map = {o.id: o for o in orgs}

    # All BusinessContexts (for filtering)
    ctx_result = await db.execute(
        select(FactSheet).where(
            FactSheet.type == "BusinessContext", FactSheet.status == "ACTIVE",
        ).order_by(FactSheet.name)
    )
    contexts = ctx_result.scalars().all()
    ctx_map = {c.id: c for c in contexts}

    # Fetch all relations touching process ids, org ids, or context ids
    all_entity_ids = proc_ids + list(org_map.keys()) + list(ctx_map.keys())
    rels_result = await db.execute(
        select(Relation).where(
            (Relation.source_id.in_(all_entity_ids))
            | (Relation.target_id.in_(all_entity_ids))
        )
    )
    rels = rels_result.scalars().all()

    # Build mappings: process -> [apps], process -> [data objects],
    # process -> [org_ids], process -> [ctx_ids]
    proc_id_set = set(str(p.id) for p in processes)
    app_id_set = set(str(a.id) for a in apps)
    do_id_set = set(str(d.id) for d in data_objects)
    org_id_set = set(str(o.id) for o in orgs)
    ctx_id_set = set(str(c.id) for c in contexts)

    proc_apps: dict[str, list] = {pid: [] for pid in proc_id_set}
    proc_data: dict[str, list] = {pid: [] for pid in proc_id_set}
    proc_orgs: dict[str, set[str]] = {pid: set() for pid in proc_id_set}
    proc_ctxs: dict[str, set[str]] = {pid: set() for pid in proc_id_set}

    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        rtype = r.type or ""

        # Process -> Application (relProcessToApp)
        if rtype == "relProcessToApp":
            if sid in proc_id_set and tid in app_id_set:
                proc_apps[sid].append({
                    "id": tid,
                    "name": app_map[r.target_id].name,
                    "subtype": app_map[r.target_id].subtype,
                    "attributes": app_map[r.target_id].attributes or {},
                    "lifecycle": app_map[r.target_id].lifecycle or {},
                    "rel_attributes": r.attributes or {},
                })
            elif tid in proc_id_set and sid in app_id_set:
                proc_apps[tid].append({
                    "id": sid,
                    "name": app_map[r.source_id].name,
                    "subtype": app_map[r.source_id].subtype,
                    "attributes": app_map[r.source_id].attributes or {},
                    "lifecycle": app_map[r.source_id].lifecycle or {},
                    "rel_attributes": r.attributes or {},
                })

        # Process -> DataObject (relProcessToDataObj)
        elif rtype == "relProcessToDataObj":
            if sid in proc_id_set and tid in do_id_set:
                proc_data[sid].append({
                    "id": tid,
                    "name": do_map[r.target_id].name,
                })
            elif tid in proc_id_set and sid in do_id_set:
                proc_data[tid].append({
                    "id": sid,
                    "name": do_map[r.source_id].name,
                })

        # Process -> Organization (relProcessToOrg)
        elif rtype == "relProcessToOrg":
            if sid in proc_id_set and tid in org_id_set:
                proc_orgs[sid].add(tid)
            elif tid in proc_id_set and sid in org_id_set:
                proc_orgs[tid].add(sid)

        # Process -> BusinessContext (relProcessToBizCtx)
        elif rtype == "relProcessToBizCtx":
            if sid in proc_id_set and tid in ctx_id_set:
                proc_ctxs[sid].add(tid)
            elif tid in proc_id_set and sid in ctx_id_set:
                proc_ctxs[tid].add(sid)

    # Fetch diagram coverage and element counts per process
    from sqlalchemy import func as sa_func

    diag_result = await db.execute(
        select(
            ProcessDiagram.process_id,
            sa_func.max(ProcessDiagram.version).label("latest_version"),
        ).group_by(ProcessDiagram.process_id)
    )
    diag_map = {str(row.process_id): row.latest_version for row in diag_result}

    elem_result = await db.execute(
        select(
            ProcessElement.process_id,
            sa_func.count(ProcessElement.id).label("cnt"),
        ).group_by(ProcessElement.process_id)
    )
    elem_count_map = {str(row.process_id): row.cnt for row in elem_result}

    items = []
    for p in processes:
        pid = str(p.id)
        linked_apps = proc_apps.get(pid, [])
        attrs = p.attributes or {}

        total_cost = sum(
            (a.get("attributes", {}).get("costTotalAnnual", 0)
             or a.get("attributes", {}).get("totalAnnualCost", 0)
             or 0)
            for a in linked_apps
        )

        items.append({
            "id": pid,
            "name": p.name,
            "subtype": p.subtype,
            "parent_id": str(p.parent_id) if p.parent_id else None,
            "attributes": attrs,
            "lifecycle": p.lifecycle or {},
            "app_count": len(linked_apps),
            "total_cost": total_cost,
            "apps": linked_apps,
            "data_objects": proc_data.get(pid, []),
            "org_ids": sorted(proc_orgs.get(pid, set())),
            "ctx_ids": sorted(proc_ctxs.get(pid, set())),
            "has_diagram": pid in diag_map,
            "element_count": elem_count_map.get(pid, 0),
        })

    organizations = [{"id": str(o.id), "name": o.name} for o in orgs]
    business_contexts = [{"id": str(c.id), "name": c.name} for c in contexts]

    return {
        "items": items,
        "organizations": organizations,
        "business_contexts": business_contexts,
    }


@router.get("/value-stream-matrix")
async def value_stream_matrix(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Value-stream × Organization matrix with processes at intersections.

    Only shows BusinessContext items with subtype 'valueStream' as columns.
    Includes related apps and parent_id for nested process display.
    """
    # All active BusinessProcesses
    proc_result = await db.execute(
        select(FactSheet).where(
            FactSheet.type == "BusinessProcess",
            FactSheet.status == "ACTIVE",
        ).order_by(FactSheet.name)
    )
    processes = proc_result.scalars().all()
    proc_map = {p.id: p for p in processes}

    if not proc_map:
        return {"contexts": [], "organizations": [], "cells": {}, "unassigned": []}

    # All Organizations (rows) — with hierarchy data
    org_result = await db.execute(
        select(FactSheet).where(
            FactSheet.type == "Organization",
            FactSheet.status == "ACTIVE",
        ).order_by(FactSheet.name)
    )
    orgs = org_result.scalars().all()

    # Value Stream contexts only (columns)
    ctx_result = await db.execute(
        select(FactSheet).where(
            FactSheet.type == "BusinessContext",
            FactSheet.subtype == "valueStream",
            FactSheet.status == "ACTIVE",
        ).order_by(FactSheet.name)
    )
    contexts = ctx_result.scalars().all()

    # All Applications for linking
    app_result = await db.execute(
        select(FactSheet).where(
            FactSheet.type == "Application",
            FactSheet.status == "ACTIVE",
        )
    )
    apps = app_result.scalars().all()
    app_map = {a.id: a for a in apps}

    # Fetch relevant relations
    proc_ids = list(proc_map.keys())
    rels_result = await db.execute(
        select(Relation).where(
            Relation.type.in_([
                "relProcessToOrg",
                "relProcessToBizCtx",
                "relProcessToApp",
            ]),
            (Relation.source_id.in_(proc_ids)) | (Relation.target_id.in_(proc_ids)),
        )
    )
    rels = rels_result.scalars().all()

    proc_id_set = set(str(p) for p in proc_ids)
    org_id_set = set(str(o.id) for o in orgs)
    ctx_id_set = set(str(c.id) for c in contexts)
    app_id_set = set(str(a.id) for a in apps)

    # Map process → set of org ids, ctx ids, and app list
    p_orgs: dict[str, set[str]] = {}
    p_ctxs: dict[str, set[str]] = {}
    p_apps: dict[str, list] = {}

    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        rtype = r.type or ""

        if rtype == "relProcessToOrg":
            if sid in proc_id_set and tid in org_id_set:
                p_orgs.setdefault(sid, set()).add(tid)
            elif tid in proc_id_set and sid in org_id_set:
                p_orgs.setdefault(tid, set()).add(sid)

        elif rtype == "relProcessToBizCtx":
            if sid in proc_id_set and tid in ctx_id_set:
                p_ctxs.setdefault(sid, set()).add(tid)
            elif tid in proc_id_set and sid in ctx_id_set:
                p_ctxs.setdefault(tid, set()).add(sid)

        elif rtype == "relProcessToApp":
            if sid in proc_id_set and tid in app_id_set:
                a = app_map.get(r.target_id)
                if a:
                    p_apps.setdefault(sid, []).append(
                        {"id": tid, "name": a.name, "subtype": a.subtype}
                    )
            elif tid in proc_id_set and sid in app_id_set:
                a = app_map.get(r.source_id)
                if a:
                    p_apps.setdefault(tid, []).append(
                        {"id": sid, "name": a.name, "subtype": a.subtype}
                    )

    # Build cells: { org_id: { ctx_id: [process_dicts] } }
    cells: dict[str, dict[str, list]] = {}
    assigned_ids: set[str] = set()

    # Pre-build proc_dict for every process so children can be inserted later
    proc_dicts: dict[str, dict] = {}
    for p in processes:
        pid = str(p.id)
        proc_dicts[pid] = {
            "id": pid,
            "name": p.name,
            "subtype": p.subtype,
            "parent_id": str(p.parent_id) if p.parent_id else None,
            "attributes": p.attributes or {},
            "lifecycle": p.lifecycle or {},
            "apps": p_apps.get(pid, []),
        }

    # Build parent→children map for hierarchy propagation
    children_of: dict[str | None, list[str]] = {}
    for p in processes:
        pid = str(p.id)
        parent = str(p.parent_id) if p.parent_id else None
        children_of.setdefault(parent, []).append(pid)

    # Phase 1: Assign processes to cells based on their own direct relations
    # Track which (org, ctx) pairs each process is assigned to
    proc_cells: dict[str, set[tuple[str, str]]] = {}

    for p in processes:
        pid = str(p.id)
        my_orgs = p_orgs.get(pid, set())
        my_ctxs = p_ctxs.get(pid, set())

        if my_orgs and my_ctxs:
            assigned_ids.add(pid)
            for oid in my_orgs:
                for cid in my_ctxs:
                    cells.setdefault(oid, {}).setdefault(cid, []).append(proc_dicts[pid])
                    proc_cells.setdefault(pid, set()).add((oid, cid))
        elif my_orgs and not my_ctxs:
            assigned_ids.add(pid)
            for oid in my_orgs:
                cells.setdefault(oid, {}).setdefault("__none__", []).append(proc_dicts[pid])
                proc_cells.setdefault(pid, set()).add((oid, "__none__"))
        elif my_ctxs and not my_orgs:
            assigned_ids.add(pid)
            for cid in my_ctxs:
                cells.setdefault("__none__", {}).setdefault(cid, []).append(proc_dicts[pid])
                proc_cells.setdefault(pid, set()).add(("__none__", cid))

    # Phase 2: Propagate children into their parent's cells
    # Walk the hierarchy top-down; children inherit parent cell assignments
    # if they don't have their own direct relations placing them elsewhere.
    def propagate_children(parent_pid: str):
        parent_cell_set = proc_cells.get(parent_pid, set())
        if not parent_cell_set:
            return
        for child_pid in children_of.get(parent_pid, []):
            child_dict = proc_dicts.get(child_pid)
            if not child_dict:
                continue
            child_own_cells = proc_cells.get(child_pid, set())
            # Add child to parent's cells where child isn't already present
            for oid, cid in parent_cell_set:
                if (oid, cid) not in child_own_cells:
                    cells.setdefault(oid, {}).setdefault(cid, []).append(child_dict)
                    proc_cells.setdefault(child_pid, set()).add((oid, cid))
                    assigned_ids.add(child_pid)
            # Recurse to propagate to grandchildren
            propagate_children(child_pid)

    # Start propagation from root processes (those without a parent)
    for root_pid in children_of.get(None, []):
        propagate_children(root_pid)

    unassigned = [
        {
            "id": str(p.id),
            "name": p.name,
            "subtype": p.subtype,
            "attributes": p.attributes or {},
        }
        for p in processes
        if str(p.id) not in assigned_ids
    ]

    def _org_dict(o):
        return {
            "id": str(o.id),
            "name": o.name,
            "subtype": o.subtype,
            "parent_id": str(o.parent_id) if o.parent_id else None,
        }

    def _ctx_dict(c):
        attrs = c.attributes or {}
        return {
            "id": str(c.id),
            "name": c.name,
            "subtype": c.subtype,
            "parent_id": str(c.parent_id) if c.parent_id else None,
            "attributes": attrs,
            "sort_order": attrs.get("sortOrder"),
            "column_width": attrs.get("columnWidth"),
        }

    return {
        "organizations": [_org_dict(o) for o in orgs],
        "contexts": [_ctx_dict(c) for c in contexts],
        "cells": cells,
        "unassigned": unassigned,
    }
