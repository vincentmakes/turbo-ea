"""BPM Workflow — draft / published / archived process flow management with approval."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.services.permission_service import PermissionService
from app.models.fact_sheet import FactSheet
from app.models.process_element import ProcessElement
from app.models.process_flow_version import ProcessFlowVersion
from app.models.subscription import Subscription
from app.models.todo import Todo
from app.models.user import User
from app.schemas.bpm import ProcessFlowVersionCreate, ProcessFlowVersionUpdate
from app.services import notification_service
from app.services.bpmn_parser import parse_bpmn_xml
from app.services.element_relation_sync import sync_element_relations
from app.services.event_bus import event_bus

router = APIRouter(prefix="/bpm", tags=["bpm-workflow"])


# ── Helpers ─────────────────────────────────────────────────────────────


async def _get_process_or_404(db: AsyncSession, process_id: uuid.UUID) -> FactSheet:
    result = await db.execute(
        select(FactSheet).where(
            FactSheet.id == process_id,
            FactSheet.type == "BusinessProcess",
            FactSheet.status == "ACTIVE",
        )
    )
    fs = result.scalar_one_or_none()
    if not fs:
        raise HTTPException(404, "Business process not found")
    return fs


async def _user_subscription_roles(
    db: AsyncSession, process_id: uuid.UUID, user_id: uuid.UUID
) -> set[str]:
    """Return the set of subscription roles a user holds on a fact sheet."""
    result = await db.execute(
        select(Subscription.role).where(
            Subscription.fact_sheet_id == process_id,
            Subscription.user_id == user_id,
        )
    )
    return {r for (r,) in result.all()}


async def _can_view_drafts(db: AsyncSession, user: User, process_id: uuid.UUID) -> bool:
    """Check if a user can see draft / archived tabs via PermissionService."""
    return await PermissionService.check_permission(
        db, user, "bpm.view", process_id, "fs.view"
    )


async def _can_edit_draft(db: AsyncSession, user: User, process_id: uuid.UUID) -> bool:
    """Check if a user can create / edit drafts via PermissionService."""
    return await PermissionService.check_permission(
        db, user, "bpm.edit", process_id, "fs.edit"
    )


async def _is_process_owner(db: AsyncSession, user: User, process_id: uuid.UUID) -> bool:
    """Check if user can approve (process owner) via PermissionService."""
    return await PermissionService.check_permission(
        db, user, "bpm.edit", process_id, "fs.quality_seal"
    )


def _version_response(v: ProcessFlowVersion) -> dict:
    return {
        "id": str(v.id),
        "process_id": str(v.process_id),
        "status": v.status,
        "revision": v.revision,
        "bpmn_xml": v.bpmn_xml,
        "svg_thumbnail": v.svg_thumbnail,
        "created_by": str(v.created_by) if v.created_by else None,
        "created_by_name": v.creator.display_name if v.creator else None,
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "submitted_by": str(v.submitted_by) if v.submitted_by else None,
        "submitted_by_name": v.submitter.display_name if v.submitter else None,
        "submitted_at": v.submitted_at.isoformat() if v.submitted_at else None,
        "approved_by": str(v.approved_by) if v.approved_by else None,
        "approved_by_name": v.approver.display_name if v.approver else None,
        "approved_at": v.approved_at.isoformat() if v.approved_at else None,
        "archived_at": v.archived_at.isoformat() if v.archived_at else None,
        "based_on_id": str(v.based_on_id) if v.based_on_id else None,
        "draft_element_links": v.draft_element_links,
    }


def _version_summary(v: ProcessFlowVersion) -> dict:
    """Lightweight version info without bpmn_xml for list endpoints."""
    resp = _version_response(v)
    resp.pop("bpmn_xml", None)
    return resp


def _apply_draft_link(
    elem: ProcessElement, link: dict, valid_fs_ids: set[str]
) -> None:
    """Apply draft element link data to a ProcessElement, skipping stale references."""
    for attr, key in (
        ("application_id", "application_id"),
        ("data_object_id", "data_object_id"),
        ("it_component_id", "it_component_id"),
    ):
        val = link.get(key)
        if val and val in valid_fs_ids:
            setattr(elem, attr, uuid.UUID(val))
        elif val:
            # Fact sheet no longer valid — leave empty
            setattr(elem, attr, None)
    if "custom_fields" in link:
        elem.custom_fields = {**(elem.custom_fields or {}), **link["custom_fields"]}


# ── Published (latest) ──────────────────────────────────────────────────


@router.get("/processes/{process_id}/flow/published")
async def get_published_flow(
    process_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get the currently published process flow (visible to all authenticated users)."""
    await PermissionService.require_permission(db, user, "bpm.view")
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)
    result = await db.execute(
        select(ProcessFlowVersion)
        .where(
            ProcessFlowVersion.process_id == pid,
            ProcessFlowVersion.status == "published",
        )
        .order_by(ProcessFlowVersion.revision.desc())
        .limit(1)
    )
    version = result.scalar_one_or_none()
    if not version:
        return None
    return _version_response(version)


# ── Drafts ──────────────────────────────────────────────────────────────


@router.get("/processes/{process_id}/flow/drafts")
async def list_drafts(
    process_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List draft (and pending) flow versions for a process."""
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)
    if not await _can_view_drafts(db, user, pid):
        raise HTTPException(403, "Insufficient permissions to view drafts")

    result = await db.execute(
        select(ProcessFlowVersion)
        .where(
            ProcessFlowVersion.process_id == pid,
            ProcessFlowVersion.status.in_(["draft", "pending"]),
        )
        .order_by(ProcessFlowVersion.created_at.desc())
    )
    return [_version_summary(v) for v in result.scalars().all()]


@router.post("/processes/{process_id}/flow/drafts", status_code=201)
async def create_draft(
    process_id: str,
    body: ProcessFlowVersionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new draft process flow, optionally cloned from an existing version."""
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)
    if not await _can_edit_draft(db, user, pid):
        raise HTTPException(403, "Insufficient permissions to create drafts")

    bpmn_xml = body.bpmn_xml
    svg_thumbnail = body.svg_thumbnail
    based_on_id = None
    draft_links_clone = None

    if body.based_on_id:
        based_on_id = uuid.UUID(body.based_on_id)
        base = await db.execute(
            select(ProcessFlowVersion).where(
                ProcessFlowVersion.id == based_on_id,
                ProcessFlowVersion.process_id == pid,
            )
        )
        base_version = base.scalar_one_or_none()
        if not base_version:
            raise HTTPException(404, "Base version not found")
        # Clone XML and draft links if not provided
        if not bpmn_xml:
            bpmn_xml = base_version.bpmn_xml
            svg_thumbnail = svg_thumbnail or base_version.svg_thumbnail
        # Clone draft element links from base version.
        # If the base is published/archived, its draft_element_links is likely empty
        # because links were consumed on publish. In that case, pull from the
        # actual ProcessElement records (the published element table).
        draft_links_clone = base_version.draft_element_links
        if not draft_links_clone:
            existing_elems = await db.execute(
                select(ProcessElement).where(ProcessElement.process_id == pid)
            )
            links_from_elements: dict = {}
            for elem in existing_elems.scalars().all():
                link: dict = {}
                if elem.application_id:
                    link["application_id"] = str(elem.application_id)
                if elem.data_object_id:
                    link["data_object_id"] = str(elem.data_object_id)
                if elem.it_component_id:
                    link["it_component_id"] = str(elem.it_component_id)
                if elem.custom_fields:
                    link["custom_fields"] = elem.custom_fields
                if link:
                    links_from_elements[elem.bpmn_element_id] = link
            if links_from_elements:
                draft_links_clone = links_from_elements

    # Determine next revision number
    latest = await db.execute(
        select(ProcessFlowVersion.revision)
        .where(ProcessFlowVersion.process_id == pid)
        .order_by(ProcessFlowVersion.revision.desc())
        .limit(1)
    )
    latest_rev = latest.scalar_one_or_none()
    next_rev = (latest_rev or 0) + 1

    version = ProcessFlowVersion(
        process_id=pid,
        status="draft",
        revision=next_rev,
        bpmn_xml=bpmn_xml,
        svg_thumbnail=svg_thumbnail,
        created_by=user.id,
        based_on_id=based_on_id,
        draft_element_links=draft_links_clone,
    )
    db.add(version)
    await db.commit()
    await db.refresh(version)
    return _version_response(version)


@router.get("/processes/{process_id}/flow/versions/{version_id}")
async def get_version(
    process_id: str,
    version_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get a specific process flow version by ID."""
    pid = uuid.UUID(process_id)
    vid = uuid.UUID(version_id)
    await _get_process_or_404(db, pid)

    result = await db.execute(
        select(ProcessFlowVersion).where(
            ProcessFlowVersion.id == vid,
            ProcessFlowVersion.process_id == pid,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(404, "Version not found")

    # Published versions are visible to all; drafts/pending/archived need perms
    if version.status in ("draft", "pending", "archived"):
        if not await _can_view_drafts(db, user, pid):
            raise HTTPException(403, "Insufficient permissions")

    return _version_response(version)


@router.patch("/processes/{process_id}/flow/versions/{version_id}")
async def update_draft(
    process_id: str,
    version_id: str,
    body: ProcessFlowVersionUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update a draft process flow. Only drafts can be edited."""
    pid = uuid.UUID(process_id)
    vid = uuid.UUID(version_id)
    await _get_process_or_404(db, pid)
    if not await _can_edit_draft(db, user, pid):
        raise HTTPException(403, "Insufficient permissions")

    result = await db.execute(
        select(ProcessFlowVersion).where(
            ProcessFlowVersion.id == vid,
            ProcessFlowVersion.process_id == pid,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(404, "Version not found")
    if version.status != "draft":
        raise HTTPException(400, "Only draft versions can be edited")

    if body.bpmn_xml is not None:
        version.bpmn_xml = body.bpmn_xml
    if body.svg_thumbnail is not None:
        version.svg_thumbnail = body.svg_thumbnail

    await db.commit()
    await db.refresh(version)
    return _version_response(version)


@router.delete("/processes/{process_id}/flow/versions/{version_id}", status_code=204)
async def delete_draft(
    process_id: str,
    version_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a draft process flow. Only drafts can be deleted."""
    pid = uuid.UUID(process_id)
    vid = uuid.UUID(version_id)
    await _get_process_or_404(db, pid)
    if not await _can_edit_draft(db, user, pid):
        raise HTTPException(403, "Insufficient permissions")

    result = await db.execute(
        select(ProcessFlowVersion).where(
            ProcessFlowVersion.id == vid,
            ProcessFlowVersion.process_id == pid,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(404, "Version not found")
    if version.status != "draft":
        raise HTTPException(400, "Only draft versions can be deleted")

    await db.delete(version)
    await db.commit()


# ── Submit for approval ─────────────────────────────────────────────────


@router.post("/processes/{process_id}/flow/versions/{version_id}/submit")
async def submit_for_approval(
    process_id: str,
    version_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Submit a draft for approval by the business process owner."""
    pid = uuid.UUID(process_id)
    vid = uuid.UUID(version_id)
    process = await _get_process_or_404(db, pid)
    if not await _can_edit_draft(db, user, pid):
        raise HTTPException(403, "Insufficient permissions")

    result = await db.execute(
        select(ProcessFlowVersion).where(
            ProcessFlowVersion.id == vid,
            ProcessFlowVersion.process_id == pid,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(404, "Version not found")
    if version.status != "draft":
        raise HTTPException(400, "Only draft versions can be submitted for approval")

    version.status = "pending"
    version.submitted_by = user.id
    version.submitted_at = datetime.now(timezone.utc)

    # Notify process owners and create approval todos
    owner_subs = await db.execute(
        select(Subscription).where(
            Subscription.fact_sheet_id == pid,
            Subscription.role == "process_owner",
        )
    )
    for sub in owner_subs.scalars().all():
        await notification_service.create_notification(
            db,
            user_id=sub.user_id,
            notif_type="process_flow_approval_requested",
            title=f"Process flow approval requested for {process.name}",
            message=f"{user.display_name} submitted revision {version.revision} for approval.",
            link=f"/fact-sheets/{process_id}?tab=process-flow&subtab=drafts",
            fact_sheet_id=pid,
            actor_id=user.id,
        )
        # Create a system todo for the process owner to review
        todo = Todo(
            fact_sheet_id=pid,
            description=f"Review and approve process flow revision {version.revision} for {process.name}",
            status="open",
            link=f"/fact-sheets/{process_id}?tab=process-flow&subtab=drafts",
            is_system=True,
            assigned_to=sub.user_id,
            created_by=user.id,
        )
        db.add(todo)

    await event_bus.publish(
        "process_flow.submitted",
        {
            "process_name": process.name,
            "revision": version.revision,
            "submitted_by": user.display_name,
        },
        db=db,
        fact_sheet_id=pid,
        user_id=user.id,
    )

    await db.commit()
    await db.refresh(version)
    return _version_response(version)


# ── Approve / Reject ────────────────────────────────────────────────────


@router.post("/processes/{process_id}/flow/versions/{version_id}/approve")
async def approve_version(
    process_id: str,
    version_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Approve a pending process flow. The approved version becomes published;
    the previous published version becomes archived."""
    pid = uuid.UUID(process_id)
    vid = uuid.UUID(version_id)
    process = await _get_process_or_404(db, pid)
    if not await _is_process_owner(db, user, pid):
        raise HTTPException(403, "Only process owners, admins, or BPM admins can approve")

    result = await db.execute(
        select(ProcessFlowVersion).where(
            ProcessFlowVersion.id == vid,
            ProcessFlowVersion.process_id == pid,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(404, "Version not found")
    if version.status != "pending":
        raise HTTPException(400, "Only pending versions can be approved")

    now = datetime.now(timezone.utc)

    # Archive the current published version
    current_published = await db.execute(
        select(ProcessFlowVersion).where(
            ProcessFlowVersion.process_id == pid,
            ProcessFlowVersion.status == "published",
        )
    )
    for pub in current_published.scalars().all():
        pub.status = "archived"
        pub.archived_at = now

    # Publish the approved version
    version.status = "published"
    version.approved_by = user.id
    version.approved_at = now

    # Extract process elements from BPMN XML for the elements table
    stale_link_warnings: list[str] = []
    if version.bpmn_xml:
        extracted = parse_bpmn_xml(version.bpmn_xml)
        draft_links = version.draft_element_links or {}

        # Validate draft-linked fact sheets still exist
        linked_fs_ids: set[str] = set()
        for link_data in draft_links.values():
            for key in ("application_id", "data_object_id", "it_component_id"):
                val = link_data.get(key)
                if val:
                    linked_fs_ids.add(val)

        valid_fs_ids: set[str] = set()
        if linked_fs_ids:
            fs_result = await db.execute(
                select(FactSheet.id, FactSheet.name, FactSheet.status).where(
                    FactSheet.id.in_([uuid.UUID(fid) for fid in linked_fs_ids])
                )
            )
            fs_name_map: dict[str, str] = {}
            for row in fs_result.all():
                fid_str = str(row[0])
                fs_name_map[fid_str] = row[1]
                if row[2] == "ACTIVE":
                    valid_fs_ids.add(fid_str)
                else:
                    stale_link_warnings.append(
                        f"{row[1]} ({fid_str[:8]}...) is no longer active"
                    )
            # Check for deleted (not found) fact sheets
            for fid in linked_fs_ids:
                if fid not in fs_name_map:
                    stale_link_warnings.append(
                        f"Linked fact sheet {fid[:8]}... no longer exists"
                    )

        # Load existing elements to preserve EA links (application, data_object, it_component)
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
            draft_link = draft_links.get(ext.bpmn_element_id, {})
            if ext.bpmn_element_id in old_by_bpmn_id:
                old = old_by_bpmn_id[ext.bpmn_element_id]
                old.element_type = ext.element_type
                old.name = ext.name
                old.documentation = ext.documentation
                old.lane_name = ext.lane_name
                old.is_automated = ext.is_automated
                old.sequence_order = ext.sequence_order
                # Apply draft links (only if the linked FS is still valid)
                if draft_link:
                    _apply_draft_link(old, draft_link, valid_fs_ids)
            else:
                elem = ProcessElement(
                    process_id=pid,
                    bpmn_element_id=ext.bpmn_element_id,
                    element_type=ext.element_type,
                    name=ext.name,
                    documentation=ext.documentation,
                    lane_name=ext.lane_name,
                    is_automated=ext.is_automated,
                    sequence_order=ext.sequence_order,
                )
                # Apply draft links for new elements
                if draft_link:
                    _apply_draft_link(elem, draft_link, valid_fs_ids)
                db.add(elem)

        # Sync element EA links → relations table (additive only)
        await db.flush()  # ensure new ProcessElements get their FK values
        all_elements = await db.execute(
            select(ProcessElement).where(ProcessElement.process_id == pid)
        )
        link_ids: dict[str, set[uuid.UUID]] = {
            "application_id": set(),
            "data_object_id": set(),
            "it_component_id": set(),
        }
        for el in all_elements.scalars().all():
            if el.application_id:
                link_ids["application_id"].add(el.application_id)
            if el.data_object_id:
                link_ids["data_object_id"].add(el.data_object_id)
            if el.it_component_id:
                link_ids["it_component_id"].add(el.it_component_id)
        await sync_element_relations(db, pid, link_ids)

    # Auto-complete system approval todos for this process
    approval_todos = await db.execute(
        select(Todo).where(
            Todo.fact_sheet_id == pid,
            Todo.is_system == True,  # noqa: E712
            Todo.status == "open",
            Todo.description.like(f"Review and approve process flow revision {version.revision}%"),
        )
    )
    for t in approval_todos.scalars().all():
        t.status = "done"

    # Notify the submitter
    if version.submitted_by:
        msg = f"{user.display_name} approved revision {version.revision}."
        if stale_link_warnings:
            msg += (
                " Warning: some pre-linked elements were skipped because they no longer exist or are inactive: "
                + "; ".join(stale_link_warnings[:5])
            )
        await notification_service.create_notification(
            db,
            user_id=version.submitted_by,
            notif_type="process_flow_approved",
            title=f"Process flow approved for {process.name}",
            message=msg,
            link=f"/fact-sheets/{process_id}?tab=process-flow&subtab=published",
            fact_sheet_id=pid,
            actor_id=user.id,
        )

    await event_bus.publish(
        "process_flow.approved",
        {
            "process_name": process.name,
            "revision": version.revision,
            "approved_by": user.display_name,
        },
        db=db,
        fact_sheet_id=pid,
        user_id=user.id,
    )

    await db.commit()
    await db.refresh(version)
    return _version_response(version)


@router.post("/processes/{process_id}/flow/versions/{version_id}/reject")
async def reject_version(
    process_id: str,
    version_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Reject a pending process flow, returning it to draft status."""
    pid = uuid.UUID(process_id)
    vid = uuid.UUID(version_id)
    process = await _get_process_or_404(db, pid)
    if not await _is_process_owner(db, user, pid):
        raise HTTPException(403, "Only process owners, admins, or BPM admins can reject")

    result = await db.execute(
        select(ProcessFlowVersion).where(
            ProcessFlowVersion.id == vid,
            ProcessFlowVersion.process_id == pid,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(404, "Version not found")
    if version.status != "pending":
        raise HTTPException(400, "Only pending versions can be rejected")

    version.status = "draft"
    version.submitted_by = None
    version.submitted_at = None

    # Auto-complete system approval todos for this process
    approval_todos = await db.execute(
        select(Todo).where(
            Todo.fact_sheet_id == pid,
            Todo.is_system == True,  # noqa: E712
            Todo.status == "open",
            Todo.description.like(f"Review and approve process flow revision {version.revision}%"),
        )
    )
    for t in approval_todos.scalars().all():
        t.status = "done"

    # Notify the original creator
    if version.created_by:
        await notification_service.create_notification(
            db,
            user_id=version.created_by,
            notif_type="process_flow_rejected",
            title=f"Process flow rejected for {process.name}",
            message=f"{user.display_name} rejected revision {version.revision}. Please revise.",
            link=f"/fact-sheets/{process_id}?tab=process-flow&subtab=drafts",
            fact_sheet_id=pid,
            actor_id=user.id,
        )

    await event_bus.publish(
        "process_flow.rejected",
        {
            "process_name": process.name,
            "revision": version.revision,
            "rejected_by": user.display_name,
        },
        db=db,
        fact_sheet_id=pid,
        user_id=user.id,
    )

    await db.commit()
    await db.refresh(version)
    return _version_response(version)


# ── Archived ────────────────────────────────────────────────────────────


@router.get("/processes/{process_id}/flow/archived")
async def list_archived(
    process_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List archived process flow versions (most recent first)."""
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)
    if not await _can_view_drafts(db, user, pid):
        raise HTTPException(403, "Insufficient permissions to view archives")

    result = await db.execute(
        select(ProcessFlowVersion)
        .where(
            ProcessFlowVersion.process_id == pid,
            ProcessFlowVersion.status == "archived",
        )
        .order_by(ProcessFlowVersion.revision.desc())
    )
    return [_version_summary(v) for v in result.scalars().all()]


# ── Draft element pre-linking ─────────────────────────────────────────


@router.get("/processes/{process_id}/flow/versions/{version_id}/draft-elements")
async def get_draft_elements(
    process_id: str,
    version_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Parse BPMN XML from a draft/pending version and return extracted elements
    merged with any saved draft_element_links (pre-linked EA references)."""
    pid = uuid.UUID(process_id)
    vid = uuid.UUID(version_id)
    await _get_process_or_404(db, pid)
    if not await _can_view_drafts(db, user, pid):
        raise HTTPException(403, "Insufficient permissions")

    result = await db.execute(
        select(ProcessFlowVersion).where(
            ProcessFlowVersion.id == vid,
            ProcessFlowVersion.process_id == pid,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(404, "Version not found")

    if not version.bpmn_xml:
        return []

    extracted = parse_bpmn_xml(version.bpmn_xml)
    links = version.draft_element_links or {}

    # Collect all linked fact sheet IDs to resolve names in one query
    fs_ids: set[str] = set()
    for link_data in links.values():
        for key in ("application_id", "data_object_id", "it_component_id"):
            val = link_data.get(key)
            if val:
                fs_ids.add(val)

    # Resolve names
    name_map: dict[str, str] = {}
    if fs_ids:
        fs_result = await db.execute(
            select(FactSheet.id, FactSheet.name).where(
                FactSheet.id.in_([uuid.UUID(fid) for fid in fs_ids])
            )
        )
        for row in fs_result.all():
            name_map[str(row[0])] = row[1]

    elements = []
    for ext in extracted:
        link = links.get(ext.bpmn_element_id, {})
        app_id = link.get("application_id")
        do_id = link.get("data_object_id")
        itc_id = link.get("it_component_id")
        elements.append({
            "bpmn_element_id": ext.bpmn_element_id,
            "element_type": ext.element_type,
            "name": ext.name,
            "documentation": ext.documentation,
            "lane_name": ext.lane_name,
            "is_automated": ext.is_automated,
            "sequence_order": ext.sequence_order,
            "application_id": app_id,
            "application_name": name_map.get(app_id, "") if app_id else None,
            "data_object_id": do_id,
            "data_object_name": name_map.get(do_id, "") if do_id else None,
            "it_component_id": itc_id,
            "it_component_name": name_map.get(itc_id, "") if itc_id else None,
            "custom_fields": link.get("custom_fields"),
        })
    return elements


@router.put("/processes/{process_id}/flow/versions/{version_id}/draft-elements/{bpmn_element_id}")
async def update_draft_element_link(
    process_id: str,
    version_id: str,
    bpmn_element_id: str,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update a single draft element link (pre-link EA references before publishing)."""
    pid = uuid.UUID(process_id)
    vid = uuid.UUID(version_id)
    await _get_process_or_404(db, pid)
    if not await _can_edit_draft(db, user, pid):
        raise HTTPException(403, "Insufficient permissions")

    result = await db.execute(
        select(ProcessFlowVersion).where(
            ProcessFlowVersion.id == vid,
            ProcessFlowVersion.process_id == pid,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(404, "Version not found")
    if version.status not in ("draft", "pending"):
        raise HTTPException(400, "Element links can only be edited on draft or pending versions")

    links = dict(version.draft_element_links or {})
    existing = links.get(bpmn_element_id, {})

    # Merge updates into existing link
    for key in ("application_id", "data_object_id", "it_component_id", "custom_fields"):
        if key in body:
            val = body[key]
            if val == "" or val is None:
                existing.pop(key, None)
            else:
                existing[key] = val

    if existing:
        links[bpmn_element_id] = existing
    else:
        links.pop(bpmn_element_id, None)

    version.draft_element_links = links
    # Force SQLAlchemy to detect the JSONB change
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(version, "draft_element_links")

    await db.commit()
    return {"status": "updated", "bpmn_element_id": bpmn_element_id}


# ── Permission check endpoint (for frontend) ───────────────────────────


@router.get("/processes/{process_id}/flow/permissions")
async def get_flow_permissions(
    process_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return the current user's permissions on the process flow."""
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)
    return {
        "can_view_drafts": await _can_view_drafts(db, user, pid),
        "can_edit_draft": await _can_edit_draft(db, user, pid),
        "can_approve": await _is_process_owner(db, user, pid),
    }
