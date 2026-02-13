from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.soaw import SoAW
from app.models.todo import Todo
from app.models.user import User
from app.services import notification_service
from app.services.event_bus import event_bus

router = APIRouter(prefix="/soaw", tags=["soaw"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SoAWCreate(BaseModel):
    name: str
    initiative_id: str | None = None
    status: str = "draft"
    document_info: dict | None = None
    version_history: list | None = None
    sections: dict | None = None


class SoAWUpdate(BaseModel):
    name: str | None = None
    initiative_id: str | None = None
    status: str | None = None
    document_info: dict | None = None
    version_history: list | None = None
    sections: dict | None = None


class SignatureRequest(BaseModel):
    user_ids: list[str]
    message: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row_to_dict(s: SoAW) -> dict:
    return {
        "id": str(s.id),
        "name": s.name,
        "initiative_id": str(s.initiative_id) if s.initiative_id else None,
        "status": s.status,
        "document_info": s.document_info or {},
        "version_history": s.version_history or [],
        "sections": s.sections or {},
        "created_by": str(s.created_by) if s.created_by else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        "revision_number": s.revision_number,
        "parent_id": str(s.parent_id) if s.parent_id else None,
        "signatories": s.signatories or [],
        "signed_at": s.signed_at.isoformat() if s.signed_at else None,
    }


async def _get_soaw(db: AsyncSession, soaw_id: str) -> SoAW:
    result = await db.execute(select(SoAW).where(SoAW.id == uuid.UUID(soaw_id)))
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Statement of Architecture Work not found")
    return s


# ---------------------------------------------------------------------------
# CRUD Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_soaws(
    initiative_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(SoAW).order_by(SoAW.updated_at.desc())
    if initiative_id:
        stmt = stmt.where(SoAW.initiative_id == uuid.UUID(initiative_id))
    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [_row_to_dict(s) for s in rows]


@router.post("", status_code=201)
async def create_soaw(
    body: SoAWCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    s = SoAW(
        name=body.name,
        initiative_id=uuid.UUID(body.initiative_id) if body.initiative_id else None,
        status=body.status,
        document_info=body.document_info or {},
        version_history=body.version_history or [],
        sections=body.sections or {},
        created_by=user.id,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return _row_to_dict(s)


@router.get("/{soaw_id}")
async def get_soaw(
    soaw_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    s = await _get_soaw(db, soaw_id)
    return _row_to_dict(s)


@router.patch("/{soaw_id}")
async def update_soaw(
    soaw_id: str,
    body: SoAWUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    s = await _get_soaw(db, soaw_id)

    # Prevent editing signed documents
    if s.status == "signed":
        raise HTTPException(403, "Cannot edit a signed document. Create a new revision instead.")

    if body.name is not None:
        s.name = body.name
    if body.initiative_id is not None:
        s.initiative_id = uuid.UUID(body.initiative_id) if body.initiative_id else None
    if body.status is not None:
        # Don't allow direct status change to 'signed' — use the sign endpoint
        if body.status == "signed":
            raise HTTPException(400, "Use the sign endpoint to sign a document")
        s.status = body.status
    if body.document_info is not None:
        s.document_info = body.document_info
    if body.version_history is not None:
        s.version_history = body.version_history
    if body.sections is not None:
        s.sections = body.sections
    await db.commit()
    await db.refresh(s)
    return _row_to_dict(s)


@router.delete("/{soaw_id}", status_code=204)
async def delete_soaw(
    soaw_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    s = await _get_soaw(db, soaw_id)
    await db.delete(s)
    await db.commit()


# ---------------------------------------------------------------------------
# Signing workflow
# ---------------------------------------------------------------------------

@router.post("/{soaw_id}/request-signatures")
async def request_signatures(
    soaw_id: str,
    body: SignatureRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Request signatures from specified users. Creates todos and notifications."""
    s = await _get_soaw(db, soaw_id)

    if s.status == "signed":
        raise HTTPException(400, "Document is already signed")

    # Resolve user names for the signatories list
    signatories = []
    for uid_str in body.user_ids:
        uid = uuid.UUID(uid_str)
        result = await db.execute(select(User).where(User.id == uid))
        u = result.scalar_one_or_none()
        if not u:
            raise HTTPException(404, f"User {uid_str} not found")
        signatories.append({
            "user_id": str(uid),
            "display_name": u.display_name,
            "status": "pending",
            "signed_at": None,
        })

    s.signatories = signatories
    s.status = "in_review"

    # Create a todo for each signatory
    for sig in signatories:
        todo = Todo(
            fact_sheet_id=s.initiative_id,
            description=f'Sign SoAW: "{s.name}"',
            assigned_to=uuid.UUID(sig["user_id"]),
            created_by=user.id,
        )
        db.add(todo)

        # Create notification
        await notification_service.create_notification(
            db,
            user_id=uuid.UUID(sig["user_id"]),
            notif_type="soaw_sign_requested",
            title="Signature Requested",
            message=f'{user.display_name} requested your signature on "{s.name}"',
            link=f"/ea-delivery/soaw/{soaw_id}",
            data={"soaw_id": soaw_id, "soaw_name": s.name},
            actor_id=user.id,
        )

    await db.commit()
    await db.refresh(s)

    await event_bus.publish(
        "soaw.signatures_requested",
        {"id": soaw_id, "name": s.name, "signatory_count": len(signatories)},
        db=db,
        user_id=user.id,
    )

    return _row_to_dict(s)


@router.post("/{soaw_id}/sign")
async def sign_soaw(
    soaw_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Sign the SoAW as the current user. When all signatories have signed,
    the document status changes to 'signed' and becomes readonly."""
    s = await _get_soaw(db, soaw_id)

    if s.status == "signed":
        raise HTTPException(400, "Document is already signed")

    signatories = list(s.signatories or [])
    if not signatories:
        raise HTTPException(400, "No signatures have been requested for this document")

    # Find the current user in the signatories list
    found = False
    for sig in signatories:
        if sig["user_id"] == str(user.id):
            if sig["status"] == "signed":
                raise HTTPException(400, "You have already signed this document")
            sig["status"] = "signed"
            sig["signed_at"] = datetime.now(timezone.utc).isoformat()
            found = True
            break

    if not found:
        raise HTTPException(403, "You are not a signatory of this document")

    s.signatories = signatories

    # Check if all signatories have signed
    all_signed = all(sig["status"] == "signed" for sig in signatories)
    if all_signed:
        s.status = "signed"
        s.signed_at = datetime.now(timezone.utc)

        # Notify creator that the document is fully signed
        if s.created_by:
            await notification_service.create_notification(
                db,
                user_id=s.created_by,
                notif_type="soaw_signed",
                title="SoAW Fully Signed",
                message=f'All signatories have signed "{s.name}"',
                link=f"/ea-delivery/soaw/{soaw_id}/preview",
                data={"soaw_id": soaw_id, "soaw_name": s.name},
                actor_id=user.id,
            )

    await db.commit()
    await db.refresh(s)

    await event_bus.publish(
        "soaw.signed",
        {"id": soaw_id, "name": s.name, "signer": user.display_name, "all_signed": all_signed},
        db=db,
        user_id=user.id,
    )

    return _row_to_dict(s)


@router.post("/{soaw_id}/revise")
async def revise_soaw(
    soaw_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new revision of a signed SoAW. Copies the document content
    into a new draft linked to the same initiative, with an incremented
    revision number and parent_id pointing to the original."""
    s = await _get_soaw(db, soaw_id)

    if s.status != "signed":
        raise HTTPException(400, "Only signed documents can be revised")

    new_revision = SoAW(
        name=s.name,
        initiative_id=s.initiative_id,
        status="draft",
        document_info=s.document_info,
        version_history=s.version_history,
        sections=s.sections,
        created_by=user.id,
        revision_number=s.revision_number + 1,
        parent_id=s.id,
    )
    db.add(new_revision)
    await db.commit()
    await db.refresh(new_revision)

    return _row_to_dict(new_revision)


# ---------------------------------------------------------------------------
# Revision history
# ---------------------------------------------------------------------------

@router.get("/{soaw_id}/revisions")
async def list_revisions(
    soaw_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all revisions in the chain for this SoAW (traverses parent_id)."""
    s = await _get_soaw(db, soaw_id)

    # Walk up to the root
    root = s
    while root.parent_id:
        result = await db.execute(select(SoAW).where(SoAW.id == root.parent_id))
        parent = result.scalar_one_or_none()
        if not parent:
            break
        root = parent

    # Now collect all revisions from root downward
    revisions = [_row_to_dict(root)]
    current_id = root.id
    while True:
        result = await db.execute(
            select(SoAW).where(SoAW.parent_id == current_id)
        )
        child = result.scalar_one_or_none()
        if not child:
            break
        revisions.append(_row_to_dict(child))
        current_id = child.id

    return revisions
