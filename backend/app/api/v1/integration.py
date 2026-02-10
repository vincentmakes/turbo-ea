"""Integration architecture endpoints: data flow graph, CRUD matrix, interface statistics."""

import uuid
from dataclasses import dataclass

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.fact_sheet import FactSheet, FactSheetStatus, FactSheetType
from app.models.relation import Relation, RelationType

router = APIRouter()


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class DataFlowNode(BaseModel):
    id: str
    name: str
    type: str  # "application" or "interface"
    interface_count: int = 0


class DataFlowEdge(BaseModel):
    source: str
    target: str
    interface_id: str
    interface_name: str
    role: str  # "provides" or "consumes"
    data_objects: list[str] = []


class DataFlowGraph(BaseModel):
    nodes: list[DataFlowNode]
    edges: list[DataFlowEdge]
    stats: dict


class CrudMatrixRow(BaseModel):
    data_object_id: str
    data_object_name: str
    apps: dict[str, str]  # app_id -> CRUD flags string


class CrudMatrixResponse(BaseModel):
    rows: list[CrudMatrixRow]
    columns: list[dict]  # [{id, name}]


class InterfaceDetail(BaseModel):
    id: str
    name: str
    description: str | None
    frequency: str | None
    data_format: str | None
    transport_protocol: str | None
    provider_app: dict | None  # {id, name}
    consumer_apps: list[dict]  # [{id, name}]
    data_objects: list[dict]  # [{id, name}]


class IntegrationStats(BaseModel):
    total_interfaces: int
    total_data_objects: int
    apps_with_interfaces: int
    avg_interfaces_per_app: float
    most_connected_apps: list[dict]


# ---------------------------------------------------------------------------
# Data flow graph
# ---------------------------------------------------------------------------


@router.get("/data-flow", response_model=DataFlowGraph)
async def get_data_flow_graph(
    app_id: uuid.UUID | None = Query(None, description="Center graph on specific app"),
    db: AsyncSession = Depends(get_db),
):
    """Build a data flow graph showing applications connected via interfaces."""
    # Get all interface relations
    iface_rels_q = (
        select(Relation)
        .where(
            Relation.type.in_([
                RelationType.APPLICATION_PROVIDES_INTERFACE,
                RelationType.APPLICATION_CONSUMES_INTERFACE,
            ])
        )
    )
    iface_rels = list((await db.execute(iface_rels_q)).scalars().all())

    if not iface_rels:
        return DataFlowGraph(nodes=[], edges=[], stats={"total_interfaces": 0, "total_apps": 0})

    # Collect all referenced IDs
    app_ids: set[uuid.UUID] = set()
    iface_ids: set[uuid.UUID] = set()

    for rel in iface_rels:
        if rel.type == RelationType.APPLICATION_PROVIDES_INTERFACE:
            app_ids.add(rel.from_fact_sheet_id)
            iface_ids.add(rel.to_fact_sheet_id)
        elif rel.type == RelationType.APPLICATION_CONSUMES_INTERFACE:
            app_ids.add(rel.from_fact_sheet_id)
            iface_ids.add(rel.to_fact_sheet_id)

    # If filtering to specific app, only include its neighborhood
    if app_id:
        relevant_ifaces: set[uuid.UUID] = set()
        for rel in iface_rels:
            if rel.from_fact_sheet_id == app_id:
                relevant_ifaces.add(rel.to_fact_sheet_id)
        # Now find all apps connected to those interfaces
        filtered_app_ids: set[uuid.UUID] = {app_id}
        filtered_iface_ids: set[uuid.UUID] = relevant_ifaces
        for rel in iface_rels:
            if rel.to_fact_sheet_id in relevant_ifaces:
                filtered_app_ids.add(rel.from_fact_sheet_id)
        app_ids = filtered_app_ids
        iface_ids = filtered_iface_ids

    # Load fact sheet names
    all_ids = list(app_ids | iface_ids)
    if not all_ids:
        return DataFlowGraph(nodes=[], edges=[], stats={"total_interfaces": 0, "total_apps": 0})

    fs_q = select(FactSheet).where(FactSheet.id.in_(all_ids))
    fs_map: dict[uuid.UUID, FactSheet] = {
        fs.id: fs for fs in (await db.execute(fs_q)).scalars().all()
    }

    # Get interface → data object relations
    iface_do_q = (
        select(Relation)
        .where(
            Relation.type == RelationType.INTERFACE_TO_DATA_OBJECT,
            Relation.from_fact_sheet_id.in_(list(iface_ids)),
        )
    )
    iface_do_rels = list((await db.execute(iface_do_q)).scalars().all())

    # Load data object names
    do_ids = list({r.to_fact_sheet_id for r in iface_do_rels})
    do_map: dict[uuid.UUID, str] = {}
    if do_ids:
        do_q = select(FactSheet.id, FactSheet.name).where(FactSheet.id.in_(do_ids))
        for did, dname in (await db.execute(do_q)).all():
            do_map[did] = dname

    # Map interface → data object names
    iface_data_objects: dict[uuid.UUID, list[str]] = {}
    for rel in iface_do_rels:
        iface_data_objects.setdefault(rel.from_fact_sheet_id, []).append(
            do_map.get(rel.to_fact_sheet_id, "Unknown")
        )

    # Build nodes
    nodes: list[DataFlowNode] = []
    for aid in app_ids:
        fs = fs_map.get(aid)
        if fs:
            nodes.append(DataFlowNode(id=str(aid), name=fs.name, type="application"))
    for iid in iface_ids:
        fs = fs_map.get(iid)
        if fs:
            nodes.append(DataFlowNode(
                id=str(iid),
                name=fs.name,
                type="interface",
                interface_count=len(iface_data_objects.get(iid, [])),
            ))

    # Build edges
    edges: list[DataFlowEdge] = []
    for rel in iface_rels:
        if rel.from_fact_sheet_id not in app_ids or rel.to_fact_sheet_id not in iface_ids:
            continue
        iface_fs = fs_map.get(rel.to_fact_sheet_id)
        role = "provides" if rel.type == RelationType.APPLICATION_PROVIDES_INTERFACE else "consumes"
        edges.append(DataFlowEdge(
            source=str(rel.from_fact_sheet_id),
            target=str(rel.to_fact_sheet_id),
            interface_id=str(rel.to_fact_sheet_id),
            interface_name=iface_fs.name if iface_fs else "Unknown",
            role=role,
            data_objects=iface_data_objects.get(rel.to_fact_sheet_id, []),
        ))

    stats = {
        "total_interfaces": len(iface_ids),
        "total_apps": len(app_ids),
        "total_edges": len(edges),
        "total_data_objects": len(do_ids),
    }

    return DataFlowGraph(nodes=nodes, edges=edges, stats=stats)


# ---------------------------------------------------------------------------
# CRUD matrix
# ---------------------------------------------------------------------------


@router.get("/crud-matrix", response_model=CrudMatrixResponse)
async def get_crud_matrix(
    db: AsyncSession = Depends(get_db),
):
    """Build a CRUD matrix: Data Objects (rows) × Applications (columns).

    CRUD flags are stored in relation attributes as {"usage": "CRUD"} or
    {"create": true, "read": true, "update": false, "delete": false}.
    """
    # Get all app → data object relations
    rels_q = (
        select(Relation)
        .where(Relation.type == RelationType.APPLICATION_TO_DATA_OBJECT)
    )
    rels = list((await db.execute(rels_q)).scalars().all())

    if not rels:
        return CrudMatrixResponse(rows=[], columns=[])

    app_ids = list({r.from_fact_sheet_id for r in rels})
    do_ids = list({r.to_fact_sheet_id for r in rels})

    # Load names
    all_ids = list(set(app_ids) | set(do_ids))
    fs_q = select(FactSheet.id, FactSheet.name).where(FactSheet.id.in_(all_ids))
    name_map = {fid: fname for fid, fname in (await db.execute(fs_q)).all()}

    # Build matrix
    matrix: dict[uuid.UUID, dict[str, str]] = {}  # do_id -> {app_id_str: flags}
    for rel in rels:
        attrs = rel.attributes or {}
        # Support both formats
        if "usage" in attrs:
            flags = str(attrs["usage"]).upper()
        else:
            parts = []
            if attrs.get("create"):
                parts.append("C")
            if attrs.get("read"):
                parts.append("R")
            if attrs.get("update"):
                parts.append("U")
            if attrs.get("delete"):
                parts.append("D")
            flags = "".join(parts) if parts else "R"  # default to Read

        matrix.setdefault(rel.to_fact_sheet_id, {})[str(rel.from_fact_sheet_id)] = flags

    # Build response
    columns = [{"id": str(aid), "name": name_map.get(aid, "Unknown")} for aid in app_ids]
    columns.sort(key=lambda c: c["name"])

    rows = []
    for do_id in do_ids:
        rows.append(CrudMatrixRow(
            data_object_id=str(do_id),
            data_object_name=name_map.get(do_id, "Unknown"),
            apps=matrix.get(do_id, {}),
        ))
    rows.sort(key=lambda r: r.data_object_name)

    return CrudMatrixResponse(rows=rows, columns=columns)


# ---------------------------------------------------------------------------
# Interface details (enriched)
# ---------------------------------------------------------------------------


@router.get("/interfaces", response_model=list[InterfaceDetail])
async def list_interfaces_enriched(
    db: AsyncSession = Depends(get_db),
):
    """Get all interfaces with their provider/consumer apps and data objects."""
    ifaces_q = (
        select(FactSheet)
        .where(FactSheet.type == FactSheetType.INTERFACE, FactSheet.status == FactSheetStatus.ACTIVE)
        .order_by(FactSheet.name)
    )
    ifaces = list((await db.execute(ifaces_q)).scalars().all())
    if not ifaces:
        return []

    iface_ids = [i.id for i in ifaces]

    # Get all relations involving these interfaces
    rels_q = (
        select(Relation)
        .where(
            Relation.type.in_([
                RelationType.APPLICATION_PROVIDES_INTERFACE,
                RelationType.APPLICATION_CONSUMES_INTERFACE,
                RelationType.INTERFACE_TO_DATA_OBJECT,
            ]),
        )
        .where(
            (Relation.to_fact_sheet_id.in_(iface_ids)) | (Relation.from_fact_sheet_id.in_(iface_ids))
        )
    )
    rels = list((await db.execute(rels_q)).scalars().all())

    # Collect referenced IDs
    ref_ids: set[uuid.UUID] = set()
    for rel in rels:
        ref_ids.add(rel.from_fact_sheet_id)
        ref_ids.add(rel.to_fact_sheet_id)
    ref_ids -= set(iface_ids)

    name_map: dict[uuid.UUID, dict] = {}
    if ref_ids:
        ref_q = select(FactSheet.id, FactSheet.name, FactSheet.type).where(FactSheet.id.in_(list(ref_ids)))
        for fid, fname, ftype in (await db.execute(ref_q)).all():
            name_map[fid] = {"id": str(fid), "name": fname, "type": ftype.value if hasattr(ftype, 'value') else str(ftype)}

    # Build per-interface data
    results: list[InterfaceDetail] = []
    for iface in ifaces:
        attrs = iface.attributes or {}
        provider_app = None
        consumer_apps: list[dict] = []
        data_objects: list[dict] = []

        for rel in rels:
            if rel.type == RelationType.APPLICATION_PROVIDES_INTERFACE and rel.to_fact_sheet_id == iface.id:
                provider_app = name_map.get(rel.from_fact_sheet_id)
            elif rel.type == RelationType.APPLICATION_CONSUMES_INTERFACE and rel.to_fact_sheet_id == iface.id:
                app_info = name_map.get(rel.from_fact_sheet_id)
                if app_info:
                    consumer_apps.append(app_info)
            elif rel.type == RelationType.INTERFACE_TO_DATA_OBJECT and rel.from_fact_sheet_id == iface.id:
                do_info = name_map.get(rel.to_fact_sheet_id)
                if do_info:
                    data_objects.append(do_info)

        results.append(InterfaceDetail(
            id=str(iface.id),
            name=iface.name,
            description=iface.description,
            frequency=attrs.get("frequency"),
            data_format=attrs.get("data_format"),
            transport_protocol=attrs.get("transport_protocol"),
            provider_app=provider_app,
            consumer_apps=consumer_apps,
            data_objects=data_objects,
        ))

    return results


# ---------------------------------------------------------------------------
# Integration statistics
# ---------------------------------------------------------------------------


@router.get("/stats", response_model=IntegrationStats)
async def get_integration_stats(
    db: AsyncSession = Depends(get_db),
):
    """Get integration architecture statistics."""
    # Count interfaces
    iface_count = (await db.execute(
        select(func.count(FactSheet.id))
        .where(FactSheet.type == FactSheetType.INTERFACE, FactSheet.status == FactSheetStatus.ACTIVE)
    )).scalar_one()

    # Count data objects
    do_count = (await db.execute(
        select(func.count(FactSheet.id))
        .where(FactSheet.type == FactSheetType.DATA_OBJECT, FactSheet.status == FactSheetStatus.ACTIVE)
    )).scalar_one()

    # Apps with interfaces
    app_iface_q = (
        select(func.count(func.distinct(Relation.from_fact_sheet_id)))
        .where(Relation.type.in_([
            RelationType.APPLICATION_PROVIDES_INTERFACE,
            RelationType.APPLICATION_CONSUMES_INTERFACE,
        ]))
    )
    apps_with_ifaces = (await db.execute(app_iface_q)).scalar_one()

    # Average interfaces per app
    avg_ifaces = 0.0
    if apps_with_ifaces > 0:
        total_iface_rels = (await db.execute(
            select(func.count(Relation.id))
            .where(Relation.type.in_([
                RelationType.APPLICATION_PROVIDES_INTERFACE,
                RelationType.APPLICATION_CONSUMES_INTERFACE,
            ]))
        )).scalar_one()
        avg_ifaces = round(total_iface_rels / apps_with_ifaces, 1)

    # Most connected apps (by interface count)
    connected_q = (
        select(Relation.from_fact_sheet_id, func.count(Relation.id).label("cnt"))
        .where(Relation.type.in_([
            RelationType.APPLICATION_PROVIDES_INTERFACE,
            RelationType.APPLICATION_CONSUMES_INTERFACE,
        ]))
        .group_by(Relation.from_fact_sheet_id)
        .order_by(func.count(Relation.id).desc())
        .limit(10)
    )
    top_apps_raw = (await db.execute(connected_q)).all()

    most_connected = []
    if top_apps_raw:
        top_ids = [r[0] for r in top_apps_raw]
        names_q = select(FactSheet.id, FactSheet.name).where(FactSheet.id.in_(top_ids))
        name_map = {fid: fname for fid, fname in (await db.execute(names_q)).all()}
        for app_id, cnt in top_apps_raw:
            most_connected.append({
                "id": str(app_id),
                "name": name_map.get(app_id, "Unknown"),
                "interface_count": cnt,
            })

    return IntegrationStats(
        total_interfaces=iface_count,
        total_data_objects=do_count,
        apps_with_interfaces=apps_with_ifaces,
        avg_interfaces_per_app=avg_ifaces,
        most_connected_apps=most_connected,
    )
