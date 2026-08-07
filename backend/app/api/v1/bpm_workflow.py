"""BPM Workflow — draft / published / archived process flow management with approval."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.app_settings import AppSettings
from app.models.card import Card
from app.models.process_element import ProcessElement, ProcessElementOrganization
from app.models.process_flow_version import ProcessFlowVersion
from app.models.stakeholder import Stakeholder
from app.models.todo import Todo
from app.models.user import User
from app.schemas.bpm import (
    ProcessFlowVersionCreate,
    ProcessFlowVersionUpdate,
    ProcessFlowVersionWithdraw,
)
from app.services import notification_service
from app.services.bpmn_parser import parse_bpmn_xml
from app.services.element_relation_sync import sync_element_relations
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/bpm", tags=["bpm-workflow"])


# ── Helpers ─────────────────────────────────────────────────────────────


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


async def _user_stakeholder_roles(
    db: AsyncSession, process_id: uuid.UUID, user_id: uuid.UUID
) -> set[str]:
    """Return the set of stakeholder roles a user holds on a card."""
    result = await db.execute(
        select(Stakeholder.role).where(
            Stakeholder.card_id == process_id,
            Stakeholder.user_id == user_id,
        )
    )
    return {r for (r,) in result.all()}


async def _can_view_drafts(db: AsyncSession, user: User, process_id: uuid.UUID) -> bool:
    """Check if a user can see draft / archived tabs via PermissionService."""
    return await PermissionService.check_permission(db, user, "bpm.view", process_id, "card.view")


async def _can_edit_draft(db: AsyncSession, user: User, process_id: uuid.UUID) -> bool:
    """Check if a user can create / edit drafts via PermissionService."""
    return await PermissionService.check_permission(db, user, "bpm.edit", process_id, "card.edit")


async def _can_approve_flow(db: AsyncSession, user: User, process_id: uuid.UUID) -> bool:
    """Check if a user may approve or reject a submitted flow version.

    Approval authority is deliberately narrower than edit authority: the
    purpose-built ``bpm.approve_flows`` / ``card.bpm_approve`` keys are what
    grant it, so out of the box only admins, BPM Admins, and a ``processOwner``
    stakeholder can sign a revision off — which is what the 403 message and the
    seeded roles have always promised.
    """
    return await PermissionService.check_permission(
        db, user, "bpm.approve_flows", process_id, "card.bpm_approve"
    )


async def _can_withdraw_flow(db: AsyncSession, user: User, process_id: uuid.UUID) -> bool:
    """Check if a user may withdraw (unpublish) a published flow version.

    Withdrawal is gated on this permission alone (discussion #916). No seeded
    role and no seeded stakeholder role holds it, so out of the box only an
    admin — via the ``{"*": True}`` wildcard — can withdraw, and a process owner
    only once an administrator grants it deliberately.

    There is deliberately no instance-level "allow withdrawal" setting on top of
    this. Offering withdrawal is not what GxP or ISO 9001 require; what they
    require is that the change be *recorded*, and that recording is
    unconditional — see ``withdraw_version``.
    """
    return await PermissionService.check_permission(
        db, user, "bpm.withdraw_flows", process_id, "card.bpm_withdraw"
    )


async def _require_separate_approver(db: AsyncSession) -> bool:
    """Whether a revision's submitter is barred from approving it themselves.

    Segregation of duties, off by default: turning it on is an explicit
    organisational choice made in Admin → Settings → General, inside the BPM
    module block. Defaulting it on would silently break every team where one
    person both submits and approves.
    """
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    return bool(general.get("bpmRequireSeparateApprover", False))


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
        "withdrawn_by": str(v.withdrawn_by) if v.withdrawn_by else None,
        "withdrawn_by_name": v.withdrawer.display_name if v.withdrawer else None,
        "withdrawn_at": v.withdrawn_at.isoformat() if v.withdrawn_at else None,
        "withdrawal_reason": v.withdrawal_reason,
        "based_on_id": str(v.based_on_id) if v.based_on_id else None,
        "draft_element_links": v.draft_element_links,
    }


def _version_summary(v: ProcessFlowVersion) -> dict:
    """Lightweight version info without bpmn_xml for list endpoints."""
    resp = _version_response(v)
    resp.pop("bpmn_xml", None)
    return resp


async def _links_from_live_elements(db: AsyncSession, process_id: uuid.UUID) -> dict | None:
    """Rebuild a ``draft_element_links`` map from the live ``ProcessElement`` rows.

    A published or archived version's own ``draft_element_links`` is typically
    empty because the links were consumed when it was published, so cloning it
    would silently drop every EA reference. Pulling from the element table
    instead gives the new draft the links the process actually has today.
    """
    result = await db.execute(
        select(ProcessElement)
        .options(selectinload(ProcessElement.organizations))
        .where(ProcessElement.process_id == process_id)
    )
    links: dict = {}
    for elem in result.scalars().all():
        link: dict = {}
        if elem.application_id:
            link["application_id"] = str(elem.application_id)
        if elem.data_object_id:
            link["data_object_id"] = str(elem.data_object_id)
        if elem.it_component_id:
            link["it_component_id"] = str(elem.it_component_id)
        if elem.organizations:
            link["organization_ids"] = [str(o.id) for o in elem.organizations]
        if elem.custom_fields:
            link["custom_fields"] = elem.custom_fields
        if link:
            links[elem.bpmn_element_id] = link
    return links or None


async def _next_revision(db: AsyncSession, process_id: uuid.UUID) -> int:
    """Next revision number for a process — monotonic across every status."""
    result = await db.execute(
        select(ProcessFlowVersion.revision)
        .where(ProcessFlowVersion.process_id == process_id)
        .order_by(ProcessFlowVersion.revision.desc())
        .limit(1)
    )
    return (result.scalar_one_or_none() or 0) + 1


def _apply_draft_link(elem: ProcessElement, link: dict, valid_card_ids: set[str]) -> None:
    """Apply draft element link data to a ProcessElement, skipping stale references.

    The M:N ``organization_ids`` list is applied separately after flush (the
    junction rows need the element's PK) — see the publish path.
    """
    for attr, key in (
        ("application_id", "application_id"),
        ("data_object_id", "data_object_id"),
        ("it_component_id", "it_component_id"),
    ):
        val = link.get(key)
        if val and val in valid_card_ids:
            setattr(elem, attr, uuid.UUID(val))
        elif val:
            # Card no longer valid — leave empty
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
        .options(
            selectinload(ProcessFlowVersion.creator),
            selectinload(ProcessFlowVersion.submitter),
            selectinload(ProcessFlowVersion.approver),
            selectinload(ProcessFlowVersion.withdrawer),
        )
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
        .options(
            selectinload(ProcessFlowVersion.creator),
            selectinload(ProcessFlowVersion.submitter),
            selectinload(ProcessFlowVersion.approver),
            selectinload(ProcessFlowVersion.withdrawer),
        )
        .where(
            ProcessFlowVersion.process_id == pid,
            ProcessFlowVersion.status.in_(["draft", "pending"]),
        )
        .order_by(ProcessFlowVersion.created_at.desc())
    )
    drafts = list(result.scalars().all())

    # A draft spawned by a withdrawal carries its provenance so the UI can badge
    # it, rather than inferring "this looks like a withdrawal" from the shape of
    # the data. Resolved in one query over the bases, not per draft.
    base_ids = {v.based_on_id for v in drafts if v.based_on_id}
    withdrawn_bases: dict[uuid.UUID, int] = {}
    if base_ids:
        bases = await db.execute(
            select(ProcessFlowVersion.id, ProcessFlowVersion.revision).where(
                ProcessFlowVersion.id.in_(base_ids),
                ProcessFlowVersion.status == "withdrawn",
            )
        )
        withdrawn_bases = {bid: rev for bid, rev in bases.all()}

    summaries = []
    for v in drafts:
        summary = _version_summary(v)
        summary["from_withdrawn_revision"] = withdrawn_bases.get(v.based_on_id)
        summaries.append(summary)
    return summaries


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
            draft_links_clone = await _links_from_live_elements(db, pid)

    next_rev = await _next_revision(db, pid)

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
    result = await db.execute(
        select(ProcessFlowVersion)
        .options(
            selectinload(ProcessFlowVersion.creator),
            selectinload(ProcessFlowVersion.submitter),
            selectinload(ProcessFlowVersion.approver),
            selectinload(ProcessFlowVersion.withdrawer),
        )
        .where(ProcessFlowVersion.id == version.id)
    )
    version = result.scalar_one()
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
        select(ProcessFlowVersion)
        .options(
            selectinload(ProcessFlowVersion.creator),
            selectinload(ProcessFlowVersion.submitter),
            selectinload(ProcessFlowVersion.approver),
            selectinload(ProcessFlowVersion.withdrawer),
        )
        .where(
            ProcessFlowVersion.id == vid,
            ProcessFlowVersion.process_id == pid,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(404, "Version not found")

    # Published versions are visible to all; drafts/pending/archived need perms
    if version.status in ("draft", "pending", "archived", "withdrawn"):
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
    result = await db.execute(
        select(ProcessFlowVersion)
        .options(
            selectinload(ProcessFlowVersion.creator),
            selectinload(ProcessFlowVersion.submitter),
            selectinload(ProcessFlowVersion.approver),
            selectinload(ProcessFlowVersion.withdrawer),
        )
        .where(ProcessFlowVersion.id == version.id)
    )
    version = result.scalar_one()
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
    version_id_for_reload = version.id

    # Notify process owners and create approval todos
    owner_subs = await db.execute(
        select(Stakeholder).where(
            Stakeholder.card_id == pid,
            Stakeholder.role == "processOwner",
        )
    )
    for sub in owner_subs.scalars().all():
        await notification_service.create_notification(
            db,
            user_id=sub.user_id,
            notif_type="process_flow_approval_requested",
            title=f"Process flow approval requested for {process.name}",
            message=f"{user.display_name} submitted revision {version.revision} for approval.",
            link=f"/cards/{process_id}?tab=process-flow&subtab=drafts",
            card_id=pid,
            actor_id=user.id,
        )
        # Create a system todo for the process owner to review
        todo = Todo(
            card_id=pid,
            description=(
                f"Review and approve process flow revision {version.revision} for {process.name}"
            ),
            status="open",
            link=f"/cards/{process_id}?tab=process-flow&subtab=drafts",
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
        card_id=pid,
        user_id=user.id,
    )

    await db.commit()
    result = await db.execute(
        select(ProcessFlowVersion)
        .options(
            selectinload(ProcessFlowVersion.creator),
            selectinload(ProcessFlowVersion.submitter),
            selectinload(ProcessFlowVersion.approver),
            selectinload(ProcessFlowVersion.withdrawer),
        )
        .where(ProcessFlowVersion.id == version_id_for_reload)
    )
    version = result.scalar_one()
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
    if not await _can_approve_flow(db, user, pid):
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

    # Segregation of duties (GxP / EU GMP Annex 11), opt-in per instance: the
    # person who submitted a revision may not be the one who signs it off.
    if await _require_separate_approver(db) and version.submitted_by == user.id:
        raise HTTPException(
            403,
            "A different user must approve this revision — "
            "this instance requires a separate approver",
        )

    version_id_for_reload = version.id

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

        # Validate draft-linked cards still exist
        linked_card_ids: set[str] = set()
        for link_data in draft_links.values():
            for key in ("application_id", "data_object_id", "it_component_id"):
                val = link_data.get(key)
                if val:
                    linked_card_ids.add(val)
            linked_card_ids.update(link_data.get("organization_ids") or [])

        valid_card_ids: set[str] = set()
        if linked_card_ids:
            card_result = await db.execute(
                select(Card.id, Card.name, Card.status).where(
                    Card.id.in_([uuid.UUID(cid) for cid in linked_card_ids])
                )
            )
            card_name_map: dict[str, str] = {}
            for row in card_result.all():
                cid_str = str(row[0])
                card_name_map[cid_str] = row[1]
                if row[2] == "ACTIVE":
                    valid_card_ids.add(cid_str)
                else:
                    stale_link_warnings.append(f"{row[1]} ({cid_str[:8]}...) is no longer active")
            # Check for deleted (not found) cards
            for cid in linked_card_ids:
                if cid not in card_name_map:
                    stale_link_warnings.append(f"Linked card {cid[:8]}... no longer exists")

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
                # Apply draft links (only if the linked card is still valid)
                if draft_link:
                    _apply_draft_link(old, draft_link, valid_card_ids)
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
                    _apply_draft_link(elem, draft_link, valid_card_ids)
                db.add(elem)

        # Sync element EA links → relations table (additive only)
        await db.flush()  # ensure new ProcessElements get their FK values
        all_elements = await db.execute(
            select(ProcessElement).where(ProcessElement.process_id == pid)
        )
        elements_list = all_elements.scalars().all()

        # Apply the drafts' M:N organization links (junction rows need the
        # element PKs, hence after the flush above). Informative only — no
        # card-to-card relation is created for organizations.
        for el in elements_list:
            draft_link = draft_links.get(el.bpmn_element_id, {})
            if "organization_ids" not in draft_link:
                continue
            valid_orgs = [
                oid for oid in (draft_link.get("organization_ids") or []) if oid in valid_card_ids
            ]
            await db.execute(
                delete(ProcessElementOrganization).where(
                    ProcessElementOrganization.element_id == el.id
                )
            )
            for oid in valid_orgs:
                db.add(ProcessElementOrganization(element_id=el.id, organization_id=uuid.UUID(oid)))

        link_ids: dict[str, set[uuid.UUID]] = {
            "application_id": set(),
            "data_object_id": set(),
            "it_component_id": set(),
        }
        for el in elements_list:
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
            Todo.card_id == pid,
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
                " Warning: some pre-linked elements were skipped"
                " because they no longer exist or are inactive: "
                + "; ".join(stale_link_warnings[:5])
            )
        await notification_service.create_notification(
            db,
            user_id=version.submitted_by,
            notif_type="process_flow_approved",
            title=f"Process flow approved for {process.name}",
            message=msg,
            link=f"/cards/{process_id}?tab=process-flow&subtab=published",
            card_id=pid,
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
        card_id=pid,
        user_id=user.id,
    )

    await db.commit()
    result = await db.execute(
        select(ProcessFlowVersion)
        .options(
            selectinload(ProcessFlowVersion.creator),
            selectinload(ProcessFlowVersion.submitter),
            selectinload(ProcessFlowVersion.approver),
            selectinload(ProcessFlowVersion.withdrawer),
        )
        .where(ProcessFlowVersion.id == version_id_for_reload)
    )
    version = result.scalar_one()
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
    if not await _can_approve_flow(db, user, pid):
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
    version_id_for_reload = version.id

    version.status = "draft"
    version.submitted_by = None
    version.submitted_at = None

    # Auto-complete system approval todos for this process
    approval_todos = await db.execute(
        select(Todo).where(
            Todo.card_id == pid,
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
            link=f"/cards/{process_id}?tab=process-flow&subtab=drafts",
            card_id=pid,
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
        card_id=pid,
        user_id=user.id,
    )

    await db.commit()
    result = await db.execute(
        select(ProcessFlowVersion)
        .options(
            selectinload(ProcessFlowVersion.creator),
            selectinload(ProcessFlowVersion.submitter),
            selectinload(ProcessFlowVersion.approver),
            selectinload(ProcessFlowVersion.withdrawer),
        )
        .where(ProcessFlowVersion.id == version_id_for_reload)
    )
    version = result.scalar_one()
    return _version_response(version)


# ── Withdrawal (unpublish) ──────────────────────────────────────────────


@router.post("/processes/{process_id}/flow/versions/{version_id}/withdraw")
async def withdraw_version(
    process_id: str,
    version_id: str,
    body: ProcessFlowVersionWithdraw,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Withdraw (unpublish) the published process flow — discussion #916.

    Forward-only. The version moves ``published`` → ``withdrawn``; it is never
    rewound to ``draft`` and never deleted, and ``revision`` / ``bpmn_xml`` /
    ``approved_by`` / ``approved_at`` are all left exactly as they were. What is
    added is the withdrawal itself: who, when, and a mandatory written reason.
    That is what keeps this compliant with 21 CFR 11.10(e) ("record changes
    shall not obscure previously recorded information") and what ISO 9001:2015
    §7.5.3.2 asks for when documented information becomes obsolete.

    The extracted ``process_elements``, their organization links, and the
    element-derived card relations are deliberately **left untouched**, matching
    the additive-only contract ``sync_element_relations`` already has. A
    withdrawal must not become a covert delete. BPM reports already filter on
    ``status == "published"``, so diagram-coverage figures self-correct.

    The process is left with no *published* flow, but not empty-handed: the
    withdrawn content is cloned into a fresh draft at the next revision so the
    owner can correct it and put it back through submit → approve. The withdrawn
    row itself is untouched and stays in the Archived tab, which is what keeps
    the approved artefact retrievable — mutating it into the draft instead would
    let the very BPMN an approver signed off be edited away.

    Previously-archived versions are still not auto-reinstated: re-publishing an
    older revision is itself an approval and goes through the same cycle.

    Gated on the ``bpm.withdraw_flows`` / ``card.bpm_withdraw`` permission
    alone. There is no instance-level switch for this: whether withdrawal is
    *offered* is a permission question, while the part the standards actually
    care about — recording who withdrew what, when and why — happens
    unconditionally below.
    """
    pid = uuid.UUID(process_id)
    vid = uuid.UUID(version_id)
    process = await _get_process_or_404(db, pid)

    if not await _can_withdraw_flow(db, user, pid):
        raise HTTPException(403, "Insufficient permissions to withdraw a published process flow")

    result = await db.execute(
        select(ProcessFlowVersion).where(
            ProcessFlowVersion.id == vid,
            ProcessFlowVersion.process_id == pid,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(404, "Version not found")
    if version.status != "published":
        raise HTTPException(400, "Only the published version can be withdrawn")

    # Whitespace-only is not a reason — same guard as risk acceptance rationale.
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(400, "A reason is required to withdraw a published process flow")

    version_id_for_reload = version.id
    revision = version.revision
    previously_approved_by = version.approved_by
    previously_submitted_by = version.submitted_by

    version.status = "withdrawn"
    version.withdrawn_at = datetime.now(timezone.utc)
    version.withdrawn_by = user.id
    version.withdrawal_reason = reason

    # Clone the withdrawn content into a fresh draft so the process owner can
    # correct and re-publish it, rather than being left with nothing and having
    # to hunt for the archived version. The withdrawn row is kept intact
    # alongside — that copy is the approved artefact the standards require be
    # retained, and it is what the Archived tab shows.
    new_draft = ProcessFlowVersion(
        process_id=pid,
        status="draft",
        revision=await _next_revision(db, pid),
        bpmn_xml=version.bpmn_xml,
        svg_thumbnail=version.svg_thumbnail,
        created_by=user.id,
        based_on_id=version.id,
        draft_element_links=(
            version.draft_element_links or await _links_from_live_elements(db, pid)
        ),
    )
    db.add(new_draft)
    await db.flush()
    new_draft_id = str(new_draft.id)
    new_draft_revision = new_draft.revision

    # Notify the people who own the approval that is being undone.
    for recipient in {previously_approved_by, previously_submitted_by} - {None}:
        await notification_service.create_notification(
            db,
            user_id=recipient,
            notif_type="process_flow_withdrawn",
            title=f"Process flow withdrawn for {process.name}",
            message=(
                f"{user.display_name} withdrew revision {revision}. "
                f"Reason: {reason} — revision {new_draft_revision} has been opened "
                f"as a draft so {process.name} can be corrected and re-published."
            ),
            link=f"/cards/{process_id}?tab=process-flow&subtab=drafts",
            card_id=pid,
            actor_id=user.id,
        )

    await event_bus.publish(
        "process_flow.withdrawn",
        {
            "process_name": process.name,
            "revision": revision,
            "withdrawn_by": user.display_name,
            "reason": reason,
            "new_draft_revision": new_draft_revision,
        },
        db=db,
        card_id=pid,
        user_id=user.id,
    )

    await db.commit()
    result = await db.execute(
        select(ProcessFlowVersion)
        .options(
            selectinload(ProcessFlowVersion.creator),
            selectinload(ProcessFlowVersion.submitter),
            selectinload(ProcessFlowVersion.approver),
            selectinload(ProcessFlowVersion.withdrawer),
        )
        .where(ProcessFlowVersion.id == version_id_for_reload)
    )
    version = result.scalar_one()
    return {
        **_version_response(version),
        # So the UI can point the user straight at the draft it just opened.
        "new_draft_id": new_draft_id,
        "new_draft_revision": new_draft_revision,
    }


# ── Archived ────────────────────────────────────────────────────────────


@router.get("/processes/{process_id}/flow/archived")
async def list_archived(
    process_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List superseded and withdrawn process flow versions (most recent first).

    Withdrawn versions live here too — they are history, and hiding them would
    defeat the point of recording the withdrawal.
    """
    pid = uuid.UUID(process_id)
    await _get_process_or_404(db, pid)
    if not await _can_view_drafts(db, user, pid):
        raise HTTPException(403, "Insufficient permissions to view archives")

    result = await db.execute(
        select(ProcessFlowVersion)
        .options(
            selectinload(ProcessFlowVersion.creator),
            selectinload(ProcessFlowVersion.submitter),
            selectinload(ProcessFlowVersion.approver),
            selectinload(ProcessFlowVersion.withdrawer),
        )
        .where(
            ProcessFlowVersion.process_id == pid,
            ProcessFlowVersion.status.in_(("archived", "withdrawn")),
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

    # Collect all linked card IDs to resolve names in one query
    card_ids: set[str] = set()
    for link_data in links.values():
        for key in ("application_id", "data_object_id", "it_component_id"):
            val = link_data.get(key)
            if val:
                card_ids.add(val)
        card_ids.update(link_data.get("organization_ids") or [])

    # Resolve names
    name_map: dict[str, str] = {}
    if card_ids:
        card_result = await db.execute(
            select(Card.id, Card.name).where(Card.id.in_([uuid.UUID(cid) for cid in card_ids]))
        )
        for row in card_result.all():
            name_map[str(row[0])] = row[1]

    elements = []
    for ext in extracted:
        link = links.get(ext.bpmn_element_id, {})
        app_id = link.get("application_id")
        do_id = link.get("data_object_id")
        itc_id = link.get("it_component_id")
        org_ids = link.get("organization_ids") or []
        elements.append(
            {
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
                "organizations": [{"id": oid, "name": name_map.get(oid, "")} for oid in org_ids],
                "custom_fields": link.get("custom_fields"),
            }
        )
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

    from sqlalchemy.orm.attributes import flag_modified

    # Merge updates into existing link. `organization_ids` is a list (M:N);
    # an empty list clears the step's organizations, like "" for the FKs.
    for key in (
        "application_id",
        "data_object_id",
        "it_component_id",
        "organization_ids",
        "custom_fields",
    ):
        if key in body:
            val = body[key]
            if val == "" or val is None or val == []:
                existing.pop(key, None)
            else:
                existing[key] = val

    if existing:
        links[bpmn_element_id] = existing
    else:
        links.pop(bpmn_element_id, None)

    version.draft_element_links = links
    # Force SQLAlchemy to detect the JSONB change
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
        "can_approve": await _can_approve_flow(db, user, pid),
        "can_withdraw": await _can_withdraw_flow(db, user, pid),
    }
