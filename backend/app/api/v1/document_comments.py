"""The discussion of a decision or a SoAW: threads, replies, resolve.

Reading follows who can open the document (``adr.view`` / ``soaw.view``; 403
without it, then 404 for an unknown document). Posting, replying, resolving
and reopening take the comment permission (``adr.comment`` / ``soaw.comment``)
or being a signatory of the revision; editing is the author's; deleting is
the author's, or an editor's (``adr.manage`` / ``soaw.manage``) for a plain
comment. A comment of another document is 404 on every mutating route.

The handlers are thin: the rules live in
:mod:`app.services.document_discussion_service`, which flushes, publishes the
persisted ``*.comment_added`` event and sends the notifications; the handler
commits last.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.user import User
from app.services import document_collab as collab
from app.services import document_discussion_service as discussion

router = APIRouter(tags=["document-collaboration"])

#: Generous on the way in: labels inside mention spans are stripped before the
#: stored body is held to its own 20,000-character cap.
_RAW_BODY_MAX = 100_000


class CommentCreate(BaseModel):
    body: str = Field(max_length=_RAW_BODY_MAX)
    section: str | None = Field(default=None, max_length=64)
    parent_id: str | None = None

    model_config = {"extra": "forbid"}


class CommentUpdate(BaseModel):
    body: str = Field(max_length=_RAW_BODY_MAX)

    model_config = {"extra": "forbid"}


Scope = Literal["document", "chain"]


# --- shared bodies of the twin routes ---------------------------------------------


async def _list(db: AsyncSession, user: User, kind: str, doc_id: str, scope: str) -> dict:
    doc, acc = await discussion.open_document(db, kind, doc_id, user)
    return await discussion.list_threads(db, kind, doc, user=user, acc=acc, scope=scope)


async def _create(db: AsyncSession, user: User, kind: str, doc_id: str, body: CommentCreate):
    doc, acc = await discussion.open_document(db, kind, doc_id, user)
    written = await discussion.add_comment(
        db,
        kind,
        doc,
        user=user,
        acc=acc,
        body=body.body,
        section=body.section,
        parent_id=body.parent_id,
    )
    thread = await discussion.thread_payload(db, kind, doc, written.top, user=user, acc=acc)
    await db.commit()
    return {**thread, "unnotified_mentions": written.unnotified}


async def _update(
    db: AsyncSession, user: User, kind: str, doc_id: str, comment_id: str, body: CommentUpdate
):
    doc, acc = await discussion.open_document(db, kind, doc_id, user)
    comment = await discussion.load_comment(db, kind, doc, comment_id)
    written = await discussion.edit_comment(
        db, kind, doc, comment, user=user, acc=acc, body=body.body
    )
    thread = await discussion.thread_payload(db, kind, doc, written.top, user=user, acc=acc)
    await db.commit()
    return {**thread, "unnotified_mentions": written.unnotified}


async def _delete(db: AsyncSession, user: User, kind: str, doc_id: str, comment_id: str) -> None:
    doc, acc = await discussion.open_document(db, kind, doc_id, user)
    comment = await discussion.load_comment(db, kind, doc, comment_id)
    await discussion.delete_comment(db, comment, user=user, acc=acc)
    await db.commit()


async def _resolve(
    db: AsyncSession, user: User, kind: str, doc_id: str, comment_id: str, *, resolved: bool
) -> dict:
    doc, acc = await discussion.open_document(db, kind, doc_id, user)
    comment = await discussion.load_comment(db, kind, doc, comment_id)
    if resolved:
        await discussion.resolve_thread(db, comment, user=user, acc=acc)
    else:
        await discussion.reopen_thread(db, comment, user=user, acc=acc)
    thread = await discussion.thread_payload(db, kind, doc, comment, user=user, acc=acc)
    await db.commit()
    return thread


# --- decisions --------------------------------------------------------------------


@router.get("/adr/{adr_id}/comments")
async def list_adr_comments(
    adr_id: str,
    scope: Scope = Query("document"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The decision's discussion: ``{can: {comment, moderate}, open_count, threads}``;
    ``scope=chain`` adds the threads of every revision of its chain."""
    return await _list(db, user, collab.ADR, adr_id, scope)


@router.post("/adr/{adr_id}/comments", status_code=201)
async def create_adr_comment(
    adr_id: str,
    body: CommentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Start a thread or reply to one; the thread comes back with
    ``unnotified_mentions``."""
    return await _create(db, user, collab.ADR, adr_id, body)


@router.patch("/adr/{adr_id}/comments/{comment_id}")
async def update_adr_comment(
    adr_id: str,
    comment_id: str,
    body: CommentUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Edit your own comment; the thread comes back with ``unnotified_mentions``."""
    return await _update(db, user, collab.ADR, adr_id, comment_id, body)


@router.delete("/adr/{adr_id}/comments/{comment_id}", status_code=204)
async def delete_adr_comment(
    adr_id: str,
    comment_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a comment (it stays as a placeholder)."""
    await _delete(db, user, collab.ADR, adr_id, comment_id)


@router.post("/adr/{adr_id}/comments/{comment_id}/resolve")
async def resolve_adr_thread(
    adr_id: str,
    comment_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Resolve a thread; the thread comes back."""
    return await _resolve(db, user, collab.ADR, adr_id, comment_id, resolved=True)


@router.post("/adr/{adr_id}/comments/{comment_id}/reopen")
async def reopen_adr_thread(
    adr_id: str,
    comment_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Reopen a thread; the thread comes back."""
    return await _resolve(db, user, collab.ADR, adr_id, comment_id, resolved=False)


# --- SoAWs ------------------------------------------------------------------------


@router.get("/soaw/{soaw_id}/comments")
async def list_soaw_comments(
    soaw_id: str,
    scope: Scope = Query("document"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The SoAW's discussion: ``{can: {comment, moderate}, open_count, threads}``;
    ``scope=chain`` adds the threads of every revision of its chain."""
    return await _list(db, user, collab.SOAW, soaw_id, scope)


@router.post("/soaw/{soaw_id}/comments", status_code=201)
async def create_soaw_comment(
    soaw_id: str,
    body: CommentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Start a thread or reply to one; the thread comes back with
    ``unnotified_mentions``."""
    return await _create(db, user, collab.SOAW, soaw_id, body)


@router.patch("/soaw/{soaw_id}/comments/{comment_id}")
async def update_soaw_comment(
    soaw_id: str,
    comment_id: str,
    body: CommentUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Edit your own comment; the thread comes back with ``unnotified_mentions``."""
    return await _update(db, user, collab.SOAW, soaw_id, comment_id, body)


@router.delete("/soaw/{soaw_id}/comments/{comment_id}", status_code=204)
async def delete_soaw_comment(
    soaw_id: str,
    comment_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a comment (it stays as a placeholder)."""
    await _delete(db, user, collab.SOAW, soaw_id, comment_id)


@router.post("/soaw/{soaw_id}/comments/{comment_id}/resolve")
async def resolve_soaw_thread(
    soaw_id: str,
    comment_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Resolve a thread; the thread comes back."""
    return await _resolve(db, user, collab.SOAW, soaw_id, comment_id, resolved=True)


@router.post("/soaw/{soaw_id}/comments/{comment_id}/reopen")
async def reopen_soaw_thread(
    soaw_id: str,
    comment_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Reopen a thread; the thread comes back."""
    return await _resolve(db, user, collab.SOAW, soaw_id, comment_id, resolved=False)
