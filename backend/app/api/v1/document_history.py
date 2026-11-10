"""The timeline of a decision or a SoAW.

Everyone who can open the document reads its timeline — what happened, by
whom and when, without content (``adr.view`` / ``soaw.view``; an unknown
document is 404). ``can_view_versions`` says whether the reader may open the
saved versions: the document's edit permission, or being its signatory.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.user import User
from app.services import document_collab as collab
from app.services.permission_service import PermissionService

router = APIRouter(tags=["document-collaboration"])


@router.get("/adr/{adr_id}/history")
async def list_adr_history(
    adr_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The decision's timeline: ``{can_view_versions, entries}`` in order."""
    await PermissionService.require_permission(db, user, "adr.view")
    adr = await collab.load_document(db, collab.ADR, adr_id)
    can_view = await PermissionService.check_permission(
        db, user, "adr.manage"
    ) or collab.is_signatory(adr.signatories, user.id)
    entries = await collab.history_entries(db, collab.ADR, adr.id)
    return collab.history_payload(entries, can_view_versions=can_view)


@router.get("/soaw/{soaw_id}/history")
async def list_soaw_history(
    soaw_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The SoAW's timeline: ``{can_view_versions, entries}`` in order."""
    await PermissionService.require_permission(db, user, "soaw.view")
    soaw = await collab.load_document(db, collab.SOAW, soaw_id)
    can_view = await PermissionService.check_permission(
        db, user, "soaw.manage"
    ) or collab.is_signatory(soaw.signatories, user.id)
    entries = await collab.history_entries(db, collab.SOAW, soaw.id)
    return collab.history_payload(entries, can_view_versions=can_view)
