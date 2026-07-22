"""BPM — BPMN 2.0 diagram CRUD, element extraction, and EA linking."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.process_diagram import ProcessDiagram
from app.models.process_element import ProcessElement
from app.models.process_lane_link import ProcessLaneLink
from app.models.user import User
from app.schemas.bpm import DiagramSave, ElementUpdate, LaneLinkUpdate
from app.services.bpmn_parser import parse_bpmn_xml
from app.services.element_relation_sync import sync_element_relations
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/bpm", tags=["bpm"])

# ── BPMN starter templates ──────────────────────────────────────────────

TEMPLATES = [
    {
        "key": "blank",
        "name": "Blank Diagram",
        "description": "Empty diagram with a start and end event.",
        "category": "General",
    },
    {
        "key": "simple-approval",
        "name": "Simple Approval",
        "description": "Submit → Review → Approve/Reject flow with two lanes.",
        "category": "General",
    },
    {
        "key": "order-to-cash",
        "name": "Order to Cash",
        "description": "Receive Order → Check Credit → Ship → Invoice → Payment.",
        "category": "Enterprise",
    },
    {
        "key": "procure-to-pay",
        "name": "Procure to Pay",
        "description": "Requisition → Approve → PO → Receive Goods → Payment.",
        "category": "Enterprise",
    },
    {
        "key": "hire-to-retire",
        "name": "Hire to Retire",
        "description": "Post Position → Screen → Interview → Offer → Onboard.",
        "category": "HR",
    },
    {
        "key": "incident-management",
        "name": "Incident Management",
        "description": "Log → Classify → Investigate → Resolve → Close.",
        "category": "ITIL",
    },
]


async def _get_process_or_404(db: AsyncSession, process_id: uuid.UUID) -> Card:
    result = await db.execute(
        select(Card).where(
            Card.id == process_id,
            Card.type == "BusinessProcess",
            Card.status == "ACTIVE",
        )
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Business process not found")
    return card


# ── Diagram endpoints ────────────────────────────────────────────────────


@router.get("/processes/{process_id}/diagram")
async def get_diagram(
    process_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "bpm.view")
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)
    result = await db.execute(
        select(ProcessDiagram)
        .where(ProcessDiagram.process_id == pid)
        .order_by(ProcessDiagram.version.desc())
        .limit(1)
    )
    diagram = result.scalar_one_or_none()
    if not diagram:
        return None
    return {
        "id": str(diagram.id),
        "process_id": str(diagram.process_id),
        "bpmn_xml": diagram.bpmn_xml,
        "svg_thumbnail": diagram.svg_thumbnail,
        "version": diagram.version,
        "created_by": str(diagram.created_by) if diagram.created_by else None,
        "created_at": diagram.created_at.isoformat() if diagram.created_at else None,
    }


@router.put("/processes/{process_id}/diagram")
async def save_diagram(
    process_id: str,
    body: DiagramSave,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, current_user, "bpm.edit")
    pid = uuid.UUID(process_id)
    process = await _get_process_or_404(db, pid)

    # Dry-run isolation — see the matching comment in `cards.py` bulk-create.
    dry_run_savepoint = await db.begin_nested() if body.dry_run else None

    # Get current version
    existing = await db.execute(
        select(ProcessDiagram)
        .where(ProcessDiagram.process_id == pid)
        .order_by(ProcessDiagram.version.desc())
        .limit(1)
    )
    current = existing.scalar_one_or_none()
    new_version = (current.version + 1) if current else 1

    diagram = ProcessDiagram(
        process_id=pid,
        bpmn_xml=body.bpmn_xml,
        svg_thumbnail=body.svg_thumbnail,
        version=new_version,
        created_by=current_user.id,
    )
    db.add(diagram)

    # Parse XML and extract elements
    extracted = parse_bpmn_xml(body.bpmn_xml)

    # Load existing elements to preserve EA links
    existing_elements = await db.execute(
        select(ProcessElement).where(ProcessElement.process_id == pid)
    )
    old_by_bpmn_id = {e.bpmn_element_id: e for e in existing_elements.scalars().all()}

    # Upsert: keep EA links for elements that still exist, remove deleted ones
    new_bpmn_ids = {e.bpmn_element_id for e in extracted}
    for old_id, old_elem in old_by_bpmn_id.items():
        if old_id not in new_bpmn_ids:
            await db.delete(old_elem)

    for ext in extracted:
        if ext.bpmn_element_id in old_by_bpmn_id:
            old = old_by_bpmn_id[ext.bpmn_element_id]
            old.element_type = ext.element_type
            old.name = ext.name
            old.documentation = ext.documentation
            old.lane_name = ext.lane_name
            old.is_automated = ext.is_automated
            old.sequence_order = ext.sequence_order
        else:
            db.add(
                ProcessElement(
                    process_id=pid,
                    bpmn_element_id=ext.bpmn_element_id,
                    element_type=ext.element_type,
                    name=ext.name,
                    documentation=ext.documentation,
                    lane_name=ext.lane_name,
                    is_automated=ext.is_automated,
                    sequence_order=ext.sequence_order,
                )
            )

    # Prune lane → Organization bindings whose lane no longer exists in the
    # XML (matches the element-deletion behaviour above).
    current_lanes = {ext.lane_name for ext in extracted if ext.lane_name}
    stale_links = await db.execute(select(ProcessLaneLink).where(ProcessLaneLink.process_id == pid))
    for lane_link in stale_links.scalars().all():
        if lane_link.lane_name not in current_lanes:
            await db.delete(lane_link)

    # Publish event — skipped in dry-run mode since nothing is persisted.
    if not body.dry_run:
        await event_bus.publish(
            "process_diagram.saved",
            {
                "process_name": process.name,
                "version": new_version,
                "element_count": len(extracted),
            },
            db=db,
            card_id=pid,
            user_id=current_user.id,
        )

    # Capture identifiers before potential rollback — these are stable
    # within the savepoint and surfacing them in the response gives the
    # MCP client direct evidence that the row was created vs. inferring
    # from version/element_count.
    diagram_id = str(diagram.id)
    bpmn_xml_bytes = len(body.bpmn_xml)
    flow_nodes_extracted = len(extracted)
    if body.dry_run:
        assert dry_run_savepoint is not None
        await dry_run_savepoint.rollback()
    else:
        await db.commit()
    return {
        # Stable ProcessDiagram row id. Allows a GET round-trip to verify
        # the XML was stored intact.
        "diagram_id": diagram_id if not body.dry_run else None,
        "version": new_version,
        # `element_count` is the count of *flow nodes* (tasks, gateways,
        # events) extracted into the ProcessElement table for the EA
        # cross-reference UI. Sequence flows, lanes, BPMNDI elements and
        # pool/collaboration metadata are NOT in this count — they live
        # inside `bpmn_xml` and round-trip verbatim. Use
        # `bpmn_xml_bytes` below to confirm the full payload was stored.
        "element_count": flow_nodes_extracted,
        "flow_nodes_extracted": flow_nodes_extracted,
        "bpmn_xml_bytes": bpmn_xml_bytes,
        "dry_run": body.dry_run,
    }


@router.delete("/processes/{process_id}/diagram")
async def delete_diagram(
    process_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete all diagram versions and extracted elements for a process."""
    await PermissionService.require_permission(db, current_user, "bpm.edit")

    pid = uuid.UUID(process_id)
    process = await _get_process_or_404(db, pid)

    # Delete all extracted elements
    elements = await db.execute(select(ProcessElement).where(ProcessElement.process_id == pid))
    for elem in elements.scalars().all():
        await db.delete(elem)

    # Delete all diagram versions
    diagrams = await db.execute(select(ProcessDiagram).where(ProcessDiagram.process_id == pid))
    for diag in diagrams.scalars().all():
        await db.delete(diag)

    await event_bus.publish(
        "process_diagram.deleted",
        {"process_name": process.name},
        db=db,
        card_id=pid,
        user_id=current_user.id,
    )

    await db.commit()
    return {"ok": True}


@router.get("/processes/{process_id}/diagram/versions")
async def list_diagram_versions(
    process_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "bpm.view")
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)
    result = await db.execute(
        select(ProcessDiagram)
        .where(ProcessDiagram.process_id == pid)
        .order_by(ProcessDiagram.version.desc())
    )
    return [
        {
            "id": str(d.id),
            "version": d.version,
            "created_by": str(d.created_by) if d.created_by else None,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }
        for d in result.scalars().all()
    ]


@router.get("/processes/{process_id}/diagram/export/bpmn")
async def export_bpmn(
    process_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "bpm.view")
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)
    result = await db.execute(
        select(ProcessDiagram)
        .where(ProcessDiagram.process_id == pid)
        .order_by(ProcessDiagram.version.desc())
        .limit(1)
    )
    diagram = result.scalar_one_or_none()
    if not diagram:
        raise HTTPException(404, "No diagram found")
    from fastapi.responses import Response

    return Response(
        content=diagram.bpmn_xml,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="process-{process_id}.bpmn"'},
    )


@router.get("/processes/{process_id}/diagram/export/svg")
async def export_svg(
    process_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "bpm.view")
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)
    result = await db.execute(
        select(ProcessDiagram)
        .where(ProcessDiagram.process_id == pid)
        .order_by(ProcessDiagram.version.desc())
        .limit(1)
    )
    diagram = result.scalar_one_or_none()
    if not diagram or not diagram.svg_thumbnail:
        raise HTTPException(404, "No SVG thumbnail available")
    from fastapi.responses import Response

    return Response(
        content=diagram.svg_thumbnail,
        media_type="image/svg+xml",
        headers={"Content-Disposition": f'attachment; filename="process-{process_id}.svg"'},
    )


@router.post("/processes/{process_id}/diagram/import")
async def import_bpmn(
    process_id: str,
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, current_user, "bpm.edit")
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)
    content = await file.read()
    bpmn_xml = content.decode("utf-8")
    # Validate it's parseable BPMN
    try:
        parse_bpmn_xml(bpmn_xml)
    except Exception:
        raise HTTPException(400, "Invalid BPMN 2.0 XML file")
    # Save via the same logic as PUT
    body = DiagramSave(bpmn_xml=bpmn_xml)
    return await save_diagram(process_id, body, db, current_user)


# ── Element endpoints ────────────────────────────────────────────────────


@router.get("/processes/{process_id}/elements")
async def list_elements(
    process_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "bpm.view")
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)
    result = await db.execute(
        select(ProcessElement)
        .options(
            selectinload(ProcessElement.application),
            selectinload(ProcessElement.data_object),
            selectinload(ProcessElement.it_component),
            selectinload(ProcessElement.organization),
        )
        .where(ProcessElement.process_id == pid)
        .order_by(ProcessElement.sequence_order)
    )
    elements = result.scalars().all()
    return [
        {
            "id": str(e.id),
            "process_id": str(e.process_id),
            "bpmn_element_id": e.bpmn_element_id,
            "element_type": e.element_type,
            "name": e.name,
            "documentation": e.documentation,
            "lane_name": e.lane_name,
            "is_automated": e.is_automated,
            "sequence_order": e.sequence_order,
            "application_id": str(e.application_id) if e.application_id else None,
            "application_name": e.application.name if e.application else None,
            "data_object_id": str(e.data_object_id) if e.data_object_id else None,
            "data_object_name": e.data_object.name if e.data_object else None,
            "it_component_id": str(e.it_component_id) if e.it_component_id else None,
            "it_component_name": e.it_component.name if e.it_component else None,
            "organization_id": str(e.organization_id) if e.organization_id else None,
            "organization_name": e.organization.name if e.organization else None,
            "custom_fields": e.custom_fields,
        }
        for e in elements
    ]


@router.put("/processes/{process_id}/elements/{element_id}")
async def update_element(
    process_id: str,
    element_id: str,
    body: ElementUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, current_user, "bpm.edit")
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)
    result = await db.execute(
        select(ProcessElement).where(
            ProcessElement.id == uuid.UUID(element_id),
            ProcessElement.process_id == pid,
        )
    )
    elem = result.scalar_one_or_none()
    if not elem:
        raise HTTPException(404, "Element not found")

    if body.application_id is not None:
        elem.application_id = uuid.UUID(body.application_id) if body.application_id else None
    if body.data_object_id is not None:
        elem.data_object_id = uuid.UUID(body.data_object_id) if body.data_object_id else None
    if body.it_component_id is not None:
        elem.it_component_id = uuid.UUID(body.it_component_id) if body.it_component_id else None
    if body.organization_id is not None:
        new_org = uuid.UUID(body.organization_id) if body.organization_id else None
        # Normalize: an explicit org identical to the lane's binding is stored
        # as NULL (inherited), so lane re-binding keeps working for this step.
        if new_org and elem.lane_name:
            lane_link = await db.execute(
                select(ProcessLaneLink.organization_id).where(
                    ProcessLaneLink.process_id == pid,
                    ProcessLaneLink.lane_name == elem.lane_name,
                )
            )
            if lane_link.scalar_one_or_none() == new_org:
                new_org = None
        elem.organization_id = new_org
    if body.custom_fields is not None:
        elem.custom_fields = body.custom_fields

    # Sync newly linked cards → relations table (additive only)
    link_ids: dict[str, set[uuid.UUID]] = {
        "application_id": set(),
        "data_object_id": set(),
        "it_component_id": set(),
        "organization_id": set(),
    }
    if elem.application_id:
        link_ids["application_id"].add(elem.application_id)
    if elem.data_object_id:
        link_ids["data_object_id"].add(elem.data_object_id)
    if elem.it_component_id:
        link_ids["it_component_id"].add(elem.it_component_id)
    if elem.organization_id:
        link_ids["organization_id"].add(elem.organization_id)
    elif body.organization_id:
        # Normalized to inherited — still make sure the relation exists.
        link_ids["organization_id"].add(uuid.UUID(body.organization_id))
    await sync_element_relations(db, pid, link_ids)

    await db.commit()
    await db.refresh(elem)
    return {"id": str(elem.id), "status": "updated"}


# ── Lane endpoints ───────────────────────────────────────────────────────


@router.get("/processes/{process_id}/lanes")
async def list_lanes(
    process_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Distinct BPMN lanes of the process with their Organization bindings.

    Lane names come from the extracted elements (free text from the diagram);
    a lane appears here whether or not it is bound to an Organization card.
    """
    await PermissionService.require_permission(db, user, "bpm.view")
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)

    lanes_result = await db.execute(
        select(ProcessElement.lane_name)
        .where(ProcessElement.process_id == pid, ProcessElement.lane_name.is_not(None))
        .distinct()
        .order_by(ProcessElement.lane_name)
    )
    lane_names = [row[0] for row in lanes_result.all() if row[0]]

    links_result = await db.execute(
        select(ProcessLaneLink)
        .options(selectinload(ProcessLaneLink.organization))
        .where(ProcessLaneLink.process_id == pid)
    )
    links_by_lane = {link.lane_name: link for link in links_result.scalars().all()}

    lanes = []
    for lane_name in lane_names:
        link = links_by_lane.get(lane_name)
        lanes.append(
            {
                "lane_name": lane_name,
                "organization_id": (
                    str(link.organization_id) if link and link.organization_id else None
                ),
                "organization_name": (
                    link.organization.name if link and link.organization else None
                ),
            }
        )
    return lanes


@router.put("/processes/{process_id}/lane-links")
async def update_lane_link(
    process_id: str,
    body: LaneLinkUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bind a lane to an Organization card, or clear the binding.

    Steps in the lane without an explicit per-step organization inherit this
    binding. Binding additively syncs a BusinessProcess → Organization
    relation (same convention as element links — never auto-deleted).
    """
    await PermissionService.require_permission(db, current_user, "bpm.edit")
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)

    lane_exists = await db.execute(
        select(ProcessElement.id)
        .where(
            ProcessElement.process_id == pid,
            ProcessElement.lane_name == body.lane_name,
        )
        .limit(1)
    )
    if lane_exists.scalar_one_or_none() is None:
        raise HTTPException(404, "Lane not found on this process")

    existing = await db.execute(
        select(ProcessLaneLink).where(
            ProcessLaneLink.process_id == pid,
            ProcessLaneLink.lane_name == body.lane_name,
        )
    )
    link = existing.scalar_one_or_none()

    org_id = uuid.UUID(body.organization_id) if body.organization_id else None
    if org_id is None:
        if link:
            await db.delete(link)
        await db.commit()
        return {"lane_name": body.lane_name, "organization_id": None}

    org_result = await db.execute(
        select(Card).where(
            Card.id == org_id,
            Card.type == "Organization",
            Card.status == "ACTIVE",
        )
    )
    if org_result.scalar_one_or_none() is None:
        raise HTTPException(404, "Organization card not found")

    if link:
        link.organization_id = org_id
    else:
        db.add(ProcessLaneLink(process_id=pid, lane_name=body.lane_name, organization_id=org_id))

    # Steps that explicitly carry the newly bound org are redundant overrides
    # now — normalize them back to inherited so future re-binds flow through.
    override_elems = await db.execute(
        select(ProcessElement).where(
            ProcessElement.process_id == pid,
            ProcessElement.lane_name == body.lane_name,
            ProcessElement.organization_id == org_id,
        )
    )
    for elem in override_elems.scalars().all():
        elem.organization_id = None

    await sync_element_relations(db, pid, {"organization_id": {org_id}})
    await db.commit()
    return {"lane_name": body.lane_name, "organization_id": str(org_id)}


# ── Template endpoints ───────────────────────────────────────────────────


@router.get("/templates")
async def list_templates(
    user: User = Depends(get_current_user),
):
    return TEMPLATES


@router.get("/templates/{template_key}")
async def get_template(
    template_key: str,
    user: User = Depends(get_current_user),
):
    tmpl = next((t for t in TEMPLATES if t["key"] == template_key), None)
    if not tmpl:
        raise HTTPException(404, "Template not found")

    # Return BPMN XML from bundled templates
    import pathlib

    # Use the validated key from the hardcoded TEMPLATES constant (not the
    # raw user input) so the path is never controlled by external data.
    safe_key = tmpl["key"]
    template_dir = pathlib.Path(__file__).resolve().parent.parent.parent.parent / "bpmn_templates"
    template_file = template_dir / f"{safe_key}.bpmn"
    if template_file.exists():
        bpmn_xml = template_file.read_text()
    else:
        # Fallback: return a minimal blank BPMN
        bpmn_xml = _blank_bpmn()

    return {**tmpl, "bpmn_xml": bpmn_xml}


def _blank_bpmn() -> str:
    return """<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="Start" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="_BPMNShape_StartEvent_1" bpmnElement="StartEvent_1">
        <dc:Bounds x="180" y="160" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="186" y="203" width="24" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>"""
