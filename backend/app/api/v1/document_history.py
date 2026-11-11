"""The timeline and the saved versions of a decision or a SoAW.

Everyone who can open the document reads its timeline — what happened, by
whom and when, without content (``adr.view`` / ``soaw.view``; an unknown
document is 404), newest first and paged like a card's history. A saved
version's content is for the document's editors (``adr.manage`` /
``soaw.manage``) and its signatories, past review rounds included
(``document_discussion_service.signatory_of``); ``can_view_versions`` in the
timeline says the same. An editor restores a version into a draft (409
``not_draft`` otherwise); the reply is the document's detail.
"""

from __future__ import annotations

from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1 import adr as adr_routes
from app.api.v1 import soaw as soaw_routes
from app.database import get_db
from app.models.architecture_decision import ArchitectureDecision
from app.models.soaw import SoAW
from app.models.user import User
from app.services import document_collab as collab
from app.services import document_discussion_service as discussion
from app.services import document_history_service as history
from app.services.card_read_scope import CardReadScope
from app.services.permission_service import PermissionService

router = APIRouter(tags=["document-collaboration"])

VERSIONS_REFUSED = "You may not view the versions of this document"


async def _rights(db: AsyncSession, doc_kind: str, doc: Any, user: User) -> tuple[bool, bool]:
    """``(holds the edit permission, may view versions)``: versions are for
    editors and the document's signatories."""
    holds_manage = await PermissionService.check_permission(
        db, user, discussion.PERMISSIONS[doc_kind].manage
    )
    if holds_manage:
        return True, True
    return False, await discussion.signatory_of(db, doc_kind, doc, user.id)


async def _timeline(
    db: AsyncSession, doc_kind: str, doc_id: str, user: User, page: int, page_size: int
) -> dict:
    await PermissionService.require_permission(db, user, discussion.PERMISSIONS[doc_kind].view)
    doc = await collab.load_document(db, doc_kind, doc_id)
    holds_manage, can_view = await _rights(db, doc_kind, doc, user)
    total, entries = await history.timeline(db, doc_kind, doc.id, page=page, page_size=page_size)
    return {
        "can_view_versions": can_view,
        "can_restore": holds_manage and history.restore_refusal(doc_kind, doc.status) is None,
        "total": total,
        "entries": entries,
    }


async def _version(db: AsyncSession, doc_kind: str, doc_id: str, entry_id: str, user: User):
    await PermissionService.require_permission(db, user, discussion.PERMISSIONS[doc_kind].view)
    doc = await collab.load_document(db, doc_kind, doc_id)
    _, can_view = await _rights(db, doc_kind, doc, user)
    if not can_view:
        raise HTTPException(403, VERSIONS_REFUSED)
    entry = await history.load_version(db, doc_kind, doc, entry_id)
    read_scope = await CardReadScope.load(db, user) if doc_kind == collab.ADR else None
    return await history.version_payload(db, doc_kind, doc, entry, user=user, read_scope=read_scope)


@router.get("/adr/{adr_id}/history")
async def list_adr_history(
    adr_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The decision's timeline, newest first:
    ``{can_view_versions, can_restore, total, entries}``."""
    return await _timeline(db, collab.ADR, adr_id, user, page, page_size)


@router.get("/adr/{adr_id}/history/{entry_id}")
async def get_adr_version(
    adr_id: str,
    entry_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """One saved version of the decision: ``{entry, content}``."""
    return await _version(db, collab.ADR, adr_id, entry_id, user)


@router.post("/adr/{adr_id}/history/{entry_id}/restore")
async def restore_adr_version(
    adr_id: str,
    entry_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Restore a saved version into the draft decision; the decision's detail."""
    await PermissionService.require_permission(db, user, "adr.manage")
    adr = cast(ArchitectureDecision, await collab.load_document(db, collab.ADR, adr_id))
    read_scope = await CardReadScope.load(db, user)
    await history.restore(db, collab.ADR, adr, entry_id, user=user, read_scope=read_scope)
    await db.commit()
    await db.refresh(adr)
    return await adr_routes._detail(db, adr, user, read_scope)


@router.get("/soaw/{soaw_id}/history")
async def list_soaw_history(
    soaw_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The SoAW's timeline, newest first:
    ``{can_view_versions, can_restore, total, entries}``."""
    return await _timeline(db, collab.SOAW, soaw_id, user, page, page_size)


@router.get("/soaw/{soaw_id}/history/{entry_id}")
async def get_soaw_version(
    soaw_id: str,
    entry_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """One saved version of the SoAW: ``{entry, content}``."""
    return await _version(db, collab.SOAW, soaw_id, entry_id, user)


@router.post("/soaw/{soaw_id}/history/{entry_id}/restore")
async def restore_soaw_version(
    soaw_id: str,
    entry_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Restore a saved version into the draft SoAW; the SoAW's detail."""
    await PermissionService.require_permission(db, user, "soaw.manage")
    soaw = cast(SoAW, await collab.load_document(db, collab.SOAW, soaw_id))
    await history.restore(db, collab.SOAW, soaw, entry_id, user=user, read_scope=None)
    await db.commit()
    await db.refresh(soaw)
    return await soaw_routes._detail(db, soaw, user)
