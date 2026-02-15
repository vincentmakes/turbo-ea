"""BPM Workflow — draft / published / archived process flow management with approval."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.fact_sheet import FactSheet
from app.models.process_flow_version import ProcessFlowVersion
from app.models.subscription import Subscription
from app.models.user import User
from app.schemas.bpm import ProcessFlowVersionCreate, ProcessFlowVersionUpdate
from app.services import notification_service
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


def _can_view_drafts(user: User, sub_roles: set[str]) -> bool:
    """Check if a user can see draft / archived tabs.

    Allowed for: admin, bpm_admin, member, and fact-sheet subscribers
    with roles responsible, process_owner, or observer.
    """
    if user.role in ("admin", "bpm_admin", "member"):
        return True
    privileged = {"responsible", "process_owner", "observer"}
    return bool(sub_roles & privileged)


def _can_edit_draft(user: User, sub_roles: set[str]) -> bool:
    """Check if a user can create / edit drafts."""
    if user.role in ("admin", "bpm_admin", "member"):
        return True
    privileged = {"responsible", "process_owner"}
    return bool(sub_roles & privileged)


def _is_process_owner(user: User, sub_roles: set[str]) -> bool:
    """Check if user is a process owner (can approve)."""
    if user.role in ("admin", "bpm_admin"):
        return True
    return "process_owner" in sub_roles


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
    }


def _version_summary(v: ProcessFlowVersion) -> dict:
    """Lightweight version info without bpmn_xml for list endpoints."""
    resp = _version_response(v)
    resp.pop("bpmn_xml", None)
    return resp


# ── Published (latest) ──────────────────────────────────────────────────


@router.get("/processes/{process_id}/flow/published")
async def get_published_flow(
    process_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get the currently published process flow (visible to all authenticated users)."""
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
    sub_roles = await _user_subscription_roles(db, pid, user.id)
    if not _can_view_drafts(user, sub_roles):
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
    sub_roles = await _user_subscription_roles(db, pid, user.id)
    if not _can_edit_draft(user, sub_roles):
        raise HTTPException(403, "Insufficient permissions to create drafts")

    bpmn_xml = body.bpmn_xml
    svg_thumbnail = body.svg_thumbnail
    based_on_id = None

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
        # Clone XML if not provided
        if not bpmn_xml:
            bpmn_xml = base_version.bpmn_xml
            svg_thumbnail = svg_thumbnail or base_version.svg_thumbnail

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
        sub_roles = await _user_subscription_roles(db, pid, user.id)
        if not _can_view_drafts(user, sub_roles):
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
    sub_roles = await _user_subscription_roles(db, pid, user.id)
    if not _can_edit_draft(user, sub_roles):
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
    sub_roles = await _user_subscription_roles(db, pid, user.id)
    if not _can_edit_draft(user, sub_roles):
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
    sub_roles = await _user_subscription_roles(db, pid, user.id)
    if not _can_edit_draft(user, sub_roles):
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

    # Notify process owners
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
    sub_roles = await _user_subscription_roles(db, pid, user.id)
    if not _is_process_owner(user, sub_roles):
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

    # Notify the submitter
    if version.submitted_by:
        await notification_service.create_notification(
            db,
            user_id=version.submitted_by,
            notif_type="process_flow_approved",
            title=f"Process flow approved for {process.name}",
            message=f"{user.display_name} approved revision {version.revision}.",
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
    sub_roles = await _user_subscription_roles(db, pid, user.id)
    if not _is_process_owner(user, sub_roles):
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
    sub_roles = await _user_subscription_roles(db, pid, user.id)
    if not _can_view_drafts(user, sub_roles):
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
    sub_roles = await _user_subscription_roles(db, pid, user.id)
    return {
        "can_view_drafts": _can_view_drafts(user, sub_roles),
        "can_edit_draft": _can_edit_draft(user, sub_roles),
        "can_approve": _is_process_owner(user, sub_roles),
    }
