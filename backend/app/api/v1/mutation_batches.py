"""Mutation batch CRUD + change-history endpoints.

Used by the MCP server's standardised mutation wrapper to give every
write operation a stable audit handle (S1, S6) and to enforce the
dry-run → confirm-token → commit flow (S2, S3).

Routes:

- ``POST /mutation-batches`` — open a new batch. Returns the id and,
  for dry-run batches above the per-call confirmation threshold, a
  ``confirm_token``. A real (non-dry-run) batch above the threshold is
  refused unless its body carries the token a dry-run of the same tool by
  the same user issued within the last 15 minutes and that has not
  authorised a commit yet (``resolve_confirm_token``).
- ``POST /mutation-batches/{id}/commit`` — close the batch with a
  per-row summary. Dry-run batches are closed the same way; the token is
  not checked here (it is checked when the real batch opens).
- ``GET /mutation-batches`` — list batches (filters by actor / tool /
  origin / since). Permission: ``admin.events``.
- ``GET /mutation-batches/{id}`` — single batch metadata.
- ``GET /mutation-batches/{id}/events`` — every event emitted under the
  batch, in chronological order. Powers the MCP
  ``get_change_history`` tool (S6).

The batch wrapper does not persist a session contextvar across the
two HTTP calls (open + commit) — the MCP server explicitly threads the
``batch_id`` through every intermediate call by setting the
``X-Turbo-EA-Batch`` header, which the ``capture_request_batch_id``
middleware in ``app.main`` mirrors into ``request_batch_id`` so
``event_bus.publish`` stamps it onto every emitted event.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.models.user import User
from app.schemas.mutation_batch import (
    MutationBatchCommit,
    MutationBatchEvent,
    MutationBatchHistory,
    MutationBatchListPage,
    MutationBatchOpen,
    MutationBatchOut,
)
from app.services.event_bus import request_origin
from app.services.mutation_batch_service import (
    CONFIRM_TOKEN_THRESHOLD,
    batch_to_dict,
    commit_batch,
    create_batch,
    get_batch,
    issue_confirm_token,
    issues_token,
    mark_token_used,
    needs_confirmation,
    resolve_confirm_token,
)
from app.services.permission_service import PermissionService
from app.services.rollback_service import execute_rollback, plan_rollback

router = APIRouter(prefix="/mutation-batches", tags=["mutation-batches"])


def _origin() -> str:
    raw = request_origin.get()
    return raw if raw else "api"


def _actor_name_for(batch: MutationBatch, users_by_id: dict) -> str | None:
    if not batch.actor_user_id:
        return None
    user = users_by_id.get(batch.actor_user_id)
    return user.display_name if user else None


_TOKEN_REASON_TEXT = {
    "unknown": "no dry-run issued this token",
    "already_used": "this token has already authorised a commit",
    "wrong_actor": "this token was issued to another user",
    "wrong_tool": "this token was issued by a dry-run of another tool",
    "expired": "this token is older than 15 minutes",
}


def _confirm_token_error(reason: str) -> HTTPException:
    if reason == "missing":
        detail = (
            f"confirm_token_required: a commit above {CONFIRM_TOKEN_THRESHOLD} rows needs "
            "the confirm_token returned by a dry-run of the same tool. Re-run with "
            "dry_run=True, show the preview, then pass its confirm_token."
        )
    else:
        detail = (
            f"confirm_token_invalid: {reason} ({_TOKEN_REASON_TEXT[reason]}). "
            "Re-run the dry-run to obtain a fresh token (tokens are single-use and "
            "expire 15 minutes after issue)."
        )
    return HTTPException(status_code=400, detail=detail)


@router.post("", response_model=MutationBatchOut, status_code=201)
async def open_batch(
    body: MutationBatchOpen,
    row_count: int = Query(0, ge=0, description="Number of rows the wrapper intends to write"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MutationBatchOut:
    """Open a mutation batch. Returns the batch id and, when the row
    count exceeds the confirmation threshold on a dry-run, a one-shot
    ``confirm_token``. A real batch above the threshold must present that
    token, or the open is refused before any write happens."""
    token: str | None = None
    issuing: MutationBatch | None = None
    if issues_token(body.dry_run, row_count):
        token = issue_confirm_token()
    elif needs_confirmation(body.dry_run, row_count):
        candidates: list[MutationBatch] = []
        if body.confirm_token:
            # Row lock: a second open presenting the same token waits here,
            # then re-reads the stamped dry-run row and is refused.
            res = await db.execute(
                select(MutationBatch)
                .where(MutationBatch.confirm_token == body.confirm_token)
                .with_for_update()
            )
            candidates = list(res.scalars().all())
        issuing, reason = resolve_confirm_token(
            candidates,
            body.confirm_token or "",
            actor_id=user.id,
            tool_name=body.tool_name,
        )
        if reason is not None:
            raise _confirm_token_error(reason)
        token = body.confirm_token
    batch = await create_batch(
        db,
        tool_name=body.tool_name,
        actor=user,
        origin=_origin(),
        dry_run=body.dry_run,
        confirm_token=token,
    )
    if issuing is not None:
        mark_token_used(issuing, batch.id)
    await db.commit()
    return MutationBatchOut(**batch_to_dict(batch, actor_display_name=user.display_name))


@router.post("/{batch_id}/commit", response_model=MutationBatchOut)
async def close_batch(
    batch_id: uuid.UUID,
    body: MutationBatchCommit,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MutationBatchOut:
    batch = await get_batch(db, batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Mutation batch not found")
    if batch.committed_at is not None:
        raise HTTPException(status_code=409, detail="Mutation batch already committed")
    if batch.actor_user_id and batch.actor_user_id != user.id:
        # Cross-actor commit would let a second user finalise a batch
        # opened by someone else and confuse the audit trail. Reject.
        raise HTTPException(status_code=403, detail="Mutation batch belongs to another user")
    # The confirm token is not checked here: a dry-run batch is closed like
    # any other, and the real batch's token was verified when it opened.
    await commit_batch(db, batch, summary=body.summary)
    await db.commit()
    return MutationBatchOut(**batch_to_dict(batch, actor_display_name=user.display_name))


@router.get("", response_model=MutationBatchListPage)
async def list_batches(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    actor_user_id: uuid.UUID | None = Query(None),
    tool_name: str | None = Query(None),
    origin: str | None = Query(None),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> MutationBatchListPage:
    """List mutation batches with filtering + pagination.

    Returns a ``{items, total, page, page_size}`` envelope (mirrors the
    rest of the read endpoints, e.g. ``GET /cards``). The audit-log UI
    uses the ``total`` to drive AG Grid's pagination footer; the
    background purge keeps ``mutation_batches`` bounded by
    ``MUTATION_BATCH_RETENTION_DAYS`` so this never has to scan an
    unbounded table.
    """
    from sqlalchemy import func

    await PermissionService.require_permission(db, user, "admin.events")
    filters = []
    if actor_user_id:
        filters.append(MutationBatch.actor_user_id == actor_user_id)
    if tool_name:
        filters.append(MutationBatch.tool_name == tool_name)
    if origin:
        filters.append(MutationBatch.origin == origin)
    if since:
        filters.append(MutationBatch.created_at >= since)
    if until:
        # Inclusive end of the user-picked range — pair `until` with `since`
        # to filter "everything that happened between X and Y".
        filters.append(MutationBatch.created_at <= until)

    base = select(MutationBatch)
    count_q = select(func.count()).select_from(MutationBatch)
    for f in filters:
        base = base.where(f)
        count_q = count_q.where(f)

    total = int((await db.execute(count_q)).scalar_one() or 0)

    offset = (page - 1) * page_size
    q = base.order_by(MutationBatch.created_at.desc()).offset(offset).limit(page_size)
    batches = list((await db.execute(q)).scalars().all())

    actor_ids = {b.actor_user_id for b in batches if b.actor_user_id is not None}
    users_by_id: dict = {}
    if actor_ids:
        rows = await db.execute(select(User).where(User.id.in_(actor_ids)))
        users_by_id = {u.id: u for u in rows.scalars().all()}

    items = [
        MutationBatchOut(**batch_to_dict(b, actor_display_name=_actor_name_for(b, users_by_id)))
        for b in batches
    ]
    return MutationBatchListPage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{batch_id}", response_model=MutationBatchOut)
async def get_batch_meta(
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MutationBatchOut:
    batch = await get_batch(db, batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Mutation batch not found")
    # Owner sees their own batch metadata without admin.events; everyone
    # else needs the audit-log permission.
    if not (batch.actor_user_id and batch.actor_user_id == user.id):
        await PermissionService.require_permission(db, user, "admin.events")
    actor = None
    if batch.actor_user_id:
        actor = (
            await db.execute(select(User).where(User.id == batch.actor_user_id))
        ).scalar_one_or_none()
    return MutationBatchOut(
        **batch_to_dict(batch, actor_display_name=actor.display_name if actor else None)
    )


@router.get("/{batch_id}/events", response_model=MutationBatchHistory)
async def get_batch_history(
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MutationBatchHistory:
    batch = await get_batch(db, batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Mutation batch not found")
    if not (batch.actor_user_id and batch.actor_user_id == user.id):
        await PermissionService.require_permission(db, user, "admin.events")

    actor = None
    if batch.actor_user_id:
        actor = (
            await db.execute(select(User).where(User.id == batch.actor_user_id))
        ).scalar_one_or_none()

    q = (
        select(Event)
        .options(selectinload(Event.user))
        .where(Event.batch_id == batch_id)
        .order_by(Event.created_at.asc())
    )
    events = list((await db.execute(q)).scalars().all())

    return MutationBatchHistory(
        batch=MutationBatchOut(
            **batch_to_dict(batch, actor_display_name=actor.display_name if actor else None)
        ),
        events=[
            MutationBatchEvent(
                id=e.id,
                event_type=e.event_type,
                data=e.data,
                card_id=e.card_id,
                user_id=e.user_id,
                user_display_name=e.user.display_name if e.user else None,
                created_at=e.created_at,
            )
            for e in events
        ],
    )


class RollbackBody(BaseModel):
    dry_run: bool = True
    force: bool = False


@router.post("/{batch_id}/rollback")
async def rollback(
    batch_id: uuid.UUID,
    body: RollbackBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Reverse the writes performed under a mutation batch.

    Permission rules: the batch owner can roll back their own batch
    without ``admin.events``; reverting another user's batch needs
    ``admin.events``. ``force=True`` requires ``admin.events``
    regardless, since it accepts overwriting later writes by other
    users.
    """
    batch = await get_batch(db, batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Mutation batch not found")
    cross_actor = bool(batch.actor_user_id and batch.actor_user_id != user.id)
    if cross_actor or body.force:
        await PermissionService.require_permission(db, user, "admin.events")
    if body.dry_run:
        plan = await plan_rollback(db, batch)
        plan["dry_run"] = True
        return plan
    result = await execute_rollback(db, batch, user_id=user.id, force=body.force)
    await db.commit()
    return result
