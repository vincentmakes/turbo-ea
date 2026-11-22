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
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
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
from app.services.card_read_scope import (
    CardReadScope,
    event_read_filters,
    require_card_readable,
    scrub_event_payloads,
)
from app.services.cost_event_redaction import redact_cost_events
from app.services.document_event_scope import document_event_read_filters
from app.services.event_bus import request_origin
from app.services.event_cost_scrub import scrub_summary_costs
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
from app.services.rollback_service import execute_rollback, plan_ops, plan_rollback

router = APIRouter(prefix="/mutation-batches", tags=["mutation-batches"])


def _origin() -> str:
    raw = request_origin.get()
    return raw if raw else "api"


def _actor_name_for(batch: MutationBatch, users_by_id: dict) -> str | None:
    if not batch.actor_user_id:
        return None
    user = users_by_id.get(batch.actor_user_id)
    return user.display_name if user else None


async def _batch_event_read_filters(db: AsyncSession, user: User, scope: CardReadScope):
    """Apply document and card visibility to historical rollback events as well."""
    filters = list(event_read_filters(scope))
    document_filters = await document_event_read_filters(db, user)
    filters.extend(document_filters)
    if document_filters:
        if not await PermissionService.has_app_permission(db, user, "adr.view"):
            filters.append(Event.event_type != "rollback.delete_adr")
    card_clause = scope.clause(Card, mode="module")
    if card_clause is not None:
        payload_card = Event.data["card_id"].astext
        readable = (
            select(Card.id).where(cast(Card.id, String) == payload_card, card_clause).exists()
        )
        filters.append(
            or_(
                ~Event.event_type.startswith("rollback.", autoescape=True),
                payload_card.is_(None),
                readable,
            )
        )
    return tuple(filters)


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
    batch = await get_batch(db, batch_id, for_update=True)
    if batch is None:
        raise HTTPException(status_code=404, detail="Mutation batch not found")
    if batch.committed_at is not None:
        raise HTTPException(status_code=409, detail="Mutation batch already committed")
    if batch.actor_user_id != user.id:
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

    read_scope = await CardReadScope.load(db, user)
    document_filters = await document_event_read_filters(db, user)

    # A rollback batch's summary lists the values it restored: an auditor
    # without cost access reads it as they would the batch itself.
    items = []
    for b in batches:
        out = batch_to_dict(b, actor_display_name=_actor_name_for(b, users_by_id))
        if read_scope.is_unrestricted(mode="module") and not document_filters:
            out["summary"] = await scrub_summary_costs(db, user, out["summary"])
        else:
            out["summary"] = None
        items.append(MutationBatchOut(**out))
    return MutationBatchListPage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


async def _batch_out(
    db: AsyncSession, user: User, batch: MutationBatch, actor: User | None
) -> dict:
    """``batch_to_dict`` for one reader: a rollback batch's summary lists the
    values it restored, so its cost values go the way of a card's own."""
    out = batch_to_dict(batch, actor_display_name=actor.display_name if actor else None)
    scope = await CardReadScope.load(db, user)
    document_filters = await document_event_read_filters(db, user)
    if scope.is_unrestricted(mode="module") and not document_filters:
        out["summary"] = await scrub_summary_costs(db, user, out["summary"])
    else:
        out["summary"] = None
    return out


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
    return MutationBatchOut(**await _batch_out(db, user, batch, actor))


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

    scope = await CardReadScope.load(db, user)
    q = (
        select(Event)
        .options(selectinload(Event.user))
        .where(Event.batch_id == batch_id)
        .where(*await _batch_event_read_filters(db, user, scope))
        .order_by(Event.created_at.asc())
    )
    events = list((await db.execute(q)).scalars().all())
    payloads = await scrub_event_payloads(db, scope, [e.data for e in events])
    payloads = await redact_cost_events(db, user, events, payloads)

    return MutationBatchHistory(
        batch=MutationBatchOut(**await _batch_out(db, user, batch, actor)),
        events=[
            MutationBatchEvent(
                id=e.id,
                event_type=e.event_type,
                data=data,
                card_id=e.card_id,
                entity_type=e.entity_type,
                entity_id=e.entity_id,
                user_id=e.user_id,
                user_display_name=e.user.display_name if e.user else None,
                created_at=e.created_at,
            )
            for e, data in zip(events, payloads)
        ],
    )


async def _require_rollback_permissions(
    db: AsyncSession, user: User, operations: list[dict]
) -> None:
    """Check every inverse before any operation changes data."""
    from app.models.architecture_decision import ArchitectureDecision
    from app.models.card import Card
    from app.models.card_type import CardType
    from app.models.diagram import Diagram
    from app.models.relation import Relation
    from app.models.todo import Todo
    from app.services.cost_field_filter import (
        cost_field_keys_from_card_schema,
        keep_stored_cost_values,
    )
    from app.services.tag_service import can_tag_card

    card_permissions = {
        "delete_card": ("inventory.delete", "card.delete"),
        "archive_card": ("inventory.archive", "card.archive"),
        "restore_card": ("inventory.archive", "card.archive"),
        "restore_card_fields": ("inventory.edit", "card.edit"),
        "remove_stakeholder": ("stakeholders.manage", "card.manage_stakeholders"),
        "assign_stakeholder": ("stakeholders.manage", "card.manage_stakeholders"),
        "restore_stakeholder_role": ("stakeholders.manage", "card.manage_stakeholders"),
    }
    app_permissions = {
        "delete_risk": "risks.manage",
        "unlink_risk_card": "risks.manage",
        "restore_risk_fields": "risks.manage",
        "delete_relation": "relations.manage",
        "close_survey": "surveys.manage",
    }
    planned_deletions = set()
    for op in operations:
        if op.get("op") == "delete_card":
            try:
                planned_deletions.add(uuid.UUID(str(op.get("card_id"))))
            except ValueError:
                raise HTTPException(403, "Cannot authorize rollback operation") from None
    for op in operations:
        kind = op.get("op")
        if kind == "unsupported":
            continue
        if kind in {"remove_card_tag", "add_card_tag"}:
            try:
                card_id = uuid.UUID(str(op.get("card_id")))
            except ValueError:
                raise HTTPException(403, "Cannot authorize rollback operation") from None
            await require_card_readable(db, user, card_id, mode="module")
            if not await can_tag_card(db, user, card_id):
                raise HTTPException(403, "Cannot authorize rollback operation")
            continue
        if kind in card_permissions:
            try:
                card_id = uuid.UUID(str(op.get("card_id")))
            except ValueError:
                raise HTTPException(403, "Cannot authorize rollback operation") from None
            await require_card_readable(db, user, card_id, mode="module")
            app_permission, card_permission = card_permissions[kind]
            await PermissionService.require_permission(
                db, user, app_permission, card_id, card_permission
            )
            if kind == "restore_card_fields":
                parent_id = (op.get("fields") or {}).get("parent_id")
                if parent_id:
                    try:
                        parent_id = uuid.UUID(str(parent_id))
                    except ValueError:
                        raise HTTPException(403, "Cannot authorize rollback operation") from None
                    card = await db.get(Card, card_id, populate_existing=True)
                    if card is None:
                        raise HTTPException(404, "Card not found")
                    if parent_id != card.parent_id:
                        await require_card_readable(db, user, parent_id, mode="module")
            if kind == "restore_card_fields" and not await PermissionService.can_view_costs(
                db, user, card_id
            ):
                card = await db.get(Card, card_id, populate_existing=True)
                if card is None:
                    raise HTTPException(404, "Card not found")
                schema = await db.scalar(
                    select(CardType.fields_schema).where(CardType.key == card.type)
                )
                cost_keys = cost_field_keys_from_card_schema(schema)
                fields = dict(op.get("fields") or {})
                if "attributes" in fields:
                    fields["attributes"] = keep_stored_cost_values(
                        card.attributes, dict(fields["attributes"] or {}), cost_keys
                    )
                for key in cost_keys:
                    fields.pop(f"attr_{key}", None)
                op["fields"] = fields
            if kind == "delete_card":
                child = await db.scalar(
                    select(Card.id)
                    .where(Card.parent_id == card_id, Card.id.not_in(planned_deletions))
                    .limit(1)
                )
                if child is not None:
                    raise HTTPException(409, "Cannot roll back a card with children")
        elif kind in app_permissions:
            await PermissionService.require_permission(db, user, app_permissions[kind])
            if kind == "delete_relation":
                try:
                    relation_id = uuid.UUID(str(op.get("relation_id")))
                except ValueError:
                    raise HTTPException(403, "Cannot authorize rollback operation") from None
                relation = await db.get(Relation, relation_id)
                if relation is not None:
                    await require_card_readable(db, user, relation.source_id, mode="module")
                    await require_card_readable(db, user, relation.target_id, mode="module")
            if kind == "unlink_risk_card":
                try:
                    card_id = uuid.UUID(str(op.get("card_id")))
                except ValueError:
                    raise HTTPException(403, "Cannot authorize rollback operation") from None
                await require_card_readable(db, user, card_id, mode="module")
        elif kind == "delete_adr":
            try:
                adr_id = uuid.UUID(str(op.get("adr_id")))
            except ValueError:
                raise HTTPException(403, "Cannot authorize rollback operation") from None
            adr = await db.get(ArchitectureDecision, adr_id)
            if not await PermissionService.has_app_permission(db, user, "adr.delete"):
                if adr is None or adr.created_by != user.id:
                    raise HTTPException(403, "Cannot authorize rollback operation")
                await PermissionService.require_permission(db, user, "adr.manage")
        elif kind == "delete_diagram":
            try:
                diagram_id = uuid.UUID(str(op.get("diagram_id")))
            except ValueError:
                raise HTTPException(403, "Cannot authorize rollback operation") from None
            diagram = await db.get(Diagram, diagram_id)
            if diagram is None:
                raise HTTPException(403, "Cannot authorize rollback operation")
            if diagram.kind == "archimate":
                from app.api.v1.diagrams import require_archimate_permission

                await require_archimate_permission(db, user, diagram.viewpoint_key, "manage")
            else:
                await PermissionService.require_permission(db, user, "diagrams.manage")
        elif kind == "delete_todo":
            try:
                todo_id = uuid.UUID(str(op.get("todo_id")))
            except ValueError:
                raise HTTPException(403, "Cannot authorize rollback operation") from None
            todo = await db.get(Todo, todo_id)
            if todo is None:
                raise HTTPException(403, "Cannot authorize rollback operation")
            if user.id not in (todo.assigned_to, todo.created_by):
                await PermissionService.require_permission(db, user, "admin.todos")
            if todo.card_id:
                await require_card_readable(db, user, todo.card_id, mode="module")
        else:
            raise HTTPException(403, "Cannot authorize rollback operation")


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
    batch = await get_batch(db, batch_id, for_update=True)
    if batch is None:
        raise HTTPException(status_code=404, detail="Mutation batch not found")
    cross_actor = batch.actor_user_id != user.id
    if cross_actor or body.force:
        await PermissionService.require_permission(db, user, "admin.events")
    scope = await CardReadScope.load(db, user)
    all_events = list(
        (
            await db.execute(
                select(Event).where(Event.batch_id == batch_id).order_by(Event.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    visible_count = await db.scalar(
        select(func.count(Event.id))
        .where(Event.batch_id == batch_id)
        .where(*await _batch_event_read_filters(db, user, scope))
    )
    if visible_count != len(all_events):
        raise HTTPException(404, "Batch not found")
    payloads = await scrub_event_payloads(db, scope, [event.data for event in all_events])
    if any(payload != event.data for payload, event in zip(payloads, all_events)):
        raise HTTPException(404, "Batch not found")
    if body.dry_run:
        plan = await plan_rollback(db, batch, events=all_events)
        plan["dry_run"] = True
        plan["batch"] = await _batch_out(db, user, batch, None)
        return await scrub_summary_costs(db, user, plan)
    operations = plan_ops(all_events)

    async def authorize(ops: list[dict]) -> None:
        await _require_rollback_permissions(db, user, ops)

    result = await execute_rollback(
        db,
        batch,
        user_id=user.id,
        force=body.force,
        events=all_events,
        operations=operations,
        authorize=authorize,
    )
    await db.commit()
    # The stored summary keeps the restored values; the answer does not show
    # the ones this caller may not see.
    return await scrub_summary_costs(db, user, result)
