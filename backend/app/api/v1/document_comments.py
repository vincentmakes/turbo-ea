"""The discussion of a decision or a SoAW.

Reading follows who can open the document (``adr.view`` / ``soaw.view``); an
unknown document is 404. ``can`` tells the panel what the reader may do:
comment (the comment permission, or being a signatory) and moderate (the
document's edit permission). Threads arrive with the discussion service.
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


@router.get("/adr/{adr_id}/comments")
async def list_adr_comments(
    adr_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The decision's discussion: ``{can: {comment, moderate}, open_count, threads}``."""
    await PermissionService.require_permission(db, user, "adr.view")
    adr = await collab.load_document(db, collab.ADR, adr_id)
    can = collab.comment_capabilities(
        may_comment=await PermissionService.check_permission(db, user, "adr.comment"),
        may_moderate=await PermissionService.check_permission(db, user, "adr.manage"),
        signatory=collab.is_signatory(adr.signatories, user.id),
    )
    return collab.discussion_payload(can)


@router.get("/soaw/{soaw_id}/comments")
async def list_soaw_comments(
    soaw_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The SoAW's discussion: ``{can: {comment, moderate}, open_count, threads}``."""
    await PermissionService.require_permission(db, user, "soaw.view")
    soaw = await collab.load_document(db, collab.SOAW, soaw_id)
    can = collab.comment_capabilities(
        may_comment=await PermissionService.check_permission(db, user, "soaw.comment"),
        may_moderate=await PermissionService.check_permission(db, user, "soaw.manage"),
        signatory=collab.is_signatory(soaw.signatories, user.id),
    )
    return collab.discussion_payload(can)
