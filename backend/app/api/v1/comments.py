from __future__ import annotations

import uuid
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import lazyload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.comment import Comment
from app.models.event import Event
from app.models.notification import Notification
from app.models.user import User
from app.schemas.common import CommentCreate, CommentUpdate
from app.services import notification_service
from app.services.card_read_scope import require_card_readable
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(tags=["comments"])


@router.get("/cards/{card_id}/comments")
async def list_comments(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card_uuid = _parse_card_id(card_id)
    await PermissionService.require_permission(db, user, "comments.view")
    await require_card_readable(db, user, card_uuid, mode="module")
    children = _children_by_parent(await _card_comments(db, card_uuid))
    can_manage = await _can_manage(db, user, card_uuid)
    # Newest thread first; a reply whose parent is not on this card is no thread.
    roots = sorted(children.get(None, []), key=_posted_order, reverse=True)
    return [_comment_to_dict(c, user, can_manage, children) for c in roots]


async def _card_comments(db: AsyncSession, card_id: uuid.UUID) -> list[Comment]:
    """Every comment on the card, in one flat query.

    ``Comment.replies`` is eager-loaded only ``join_depth`` levels down, so the
    nesting is built from ``parent_id`` instead (``_children_by_parent``) and
    the relationship is not loaded here at all.
    """
    result = await db.execute(
        select(Comment).where(Comment.card_id == card_id).options(lazyload(Comment.replies))
    )
    return list(result.scalars().all())


def _posted_order(c: Comment) -> tuple:
    return (c.created_at, str(c.id))


def _children_by_parent(rows: list[Comment]) -> dict[uuid.UUID | None, list[Comment]]:
    """The card's comments grouped by ``parent_id``, each group oldest first.

    Only rows of one card go in, so a reply nests under its parent only when
    both are on this card; a reply whose parent is elsewhere is under no key a
    walk from the top level reaches, and is not listed.
    """
    children: dict[uuid.UUID | None, list[Comment]] = defaultdict(list)
    for c in rows:
        children[c.parent_id].append(c)
    for siblings in children.values():
        siblings.sort(key=_posted_order)
    return children


def _parse_card_id(card_id: str) -> uuid.UUID:
    """A malformed id names no card: 404, like an unknown one."""
    try:
        return uuid.UUID(card_id)
    except ValueError as exc:
        raise HTTPException(404, "Card not found") from exc


async def _reply_parent_id(
    db: AsyncSession, card_id: uuid.UUID, parent_id: str | None
) -> uuid.UUID | None:
    """The parent a new reply hangs off, which must be a comment on the same
    card. A malformed or unknown id and a comment on another card all answer
    the same 404, so the answer says nothing about comments on a card the
    caller did not name."""
    if not parent_id:
        return None
    try:
        parent_uuid = uuid.UUID(parent_id)
    except ValueError as exc:
        raise HTTPException(404, "Parent comment not found") from exc
    parent = await db.get(Comment, parent_uuid)
    if parent is None or parent.card_id != card_id:
        raise HTTPException(404, "Parent comment not found")
    return parent_uuid


async def _can_manage(db: AsyncSession, user: User, card_id: uuid.UUID) -> bool:
    """Whether ``user`` may edit or delete anyone's comment on the card."""
    return await PermissionService.check_permission(
        db, user, "comments.manage", card_id, "card.manage_comments"
    )


def _comment_to_dict(
    c: Comment,
    user: User,
    can_manage: bool,
    children: dict[uuid.UUID | None, list[Comment]],
) -> dict:
    """The comment as the caller sees it, its replies nested from ``children``
    (never from the ``replies`` relationship): ``can.delete`` says whether this
    caller may delete it (its author, or anyone who manages comments)."""
    return {
        "id": str(c.id),
        "card_id": str(c.card_id),
        "user_id": str(c.user_id),
        "user_display_name": c.user.display_name if c.user else None,
        "content": c.content,
        "parent_id": str(c.parent_id) if c.parent_id else None,
        "created_via": c.created_via,
        "updated_via": c.updated_via,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        "can": {"delete": can_manage or c.user_id == user.id},
        "replies": [
            _comment_to_dict(r, user, can_manage, children) for r in children.get(c.id, [])
        ],
    }


@router.post("/cards/{card_id}/comments", status_code=201)
async def create_comment(
    card_id: str,
    body: CommentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card_uuid = _parse_card_id(card_id)
    # Readability first: a hidden card is 404 (a View deny also takes away
    # ``comments.create``, which would otherwise answer 403 and confirm it).
    await require_card_readable(db, user, card_uuid, mode="module")
    if not await PermissionService.check_permission(
        db, user, "comments.create", card_uuid, "card.create_comments"
    ):
        raise HTTPException(403, "Not enough permissions")
    comment = Comment(
        card_id=card_uuid,
        user_id=user.id,
        content=body.content,
        parent_id=await _reply_parent_id(db, card_uuid, body.parent_id),
    )
    db.add(comment)
    await db.flush()
    await event_bus.publish(
        "comment.created",
        {"id": str(comment.id), "content": comment.content[:100]},
        db=db,
        card_id=card_uuid,
        user_id=user.id,
    )

    # Notify subscribers of the card
    card_result = await db.execute(select(Card).where(Card.id == card_uuid))
    card = card_result.scalar_one_or_none()
    card_name = card.name if card else "Unknown"
    await notification_service.create_notifications_for_subscribers(
        db,
        card_id=card_uuid,
        notif_type="comment_added",
        title="New Comment",
        message=f'{user.display_name} commented on "{card_name}": {comment.content[:80]}',
        link=f"/cards/{card_id}",
        data={"comment_id": str(comment.id)},
        actor_id=user.id,
    )

    await db.commit()
    await db.refresh(comment)
    # The author may always delete what they just posted: no permission query.
    return _comment_to_dict(comment, user, True, {})  # a new comment has no replies


def _parse_comment_id(comment_id: str) -> uuid.UUID:
    """A malformed id names no comment: 404, like an unknown one."""
    try:
        return uuid.UUID(comment_id)
    except ValueError as exc:
        raise HTTPException(404, "Comment not found") from exc


async def _load_comment_for_write(db: AsyncSession, user: User, comment_id: str) -> Comment:
    """The comment ``user`` may edit or delete, else 404 / 403.

    404 when it does not exist or its card is hidden from the caller (a 403
    would confirm the comment exists); 403 when the card is readable but the
    caller is neither the author nor allowed to manage comments on it.
    """
    comment = await db.get(Comment, _parse_comment_id(comment_id))
    if comment is None:
        raise HTTPException(404, "Comment not found")
    try:
        await require_card_readable(db, user, comment.card_id, mode="module")
    except HTTPException as exc:
        # The same answer as an unknown id, so it says nothing about the card.
        raise HTTPException(404, "Comment not found") from exc
    if comment.user_id != user.id and not await _can_manage(db, user, comment.card_id):
        raise HTTPException(403, "Not enough permissions")
    return comment


async def _thread(db: AsyncSession, comment: Comment) -> tuple[list[uuid.UUID], set[uuid.UUID]]:
    """The ids of the comment and every reply under it, at any depth, and the
    cards they sit on.

    Queried level by level rather than walked through ``Comment.replies``,
    which is only eager-loaded ``join_depth`` levels down. A reply sits on its
    parent's card, but older data may hold a reply on another card, so the
    card ids are collected rather than assumed.
    """
    ids = [comment.id]
    card_ids = {comment.card_id}
    frontier = [comment.id]
    while frontier:
        result = await db.execute(
            select(Comment.id, Comment.card_id).where(Comment.parent_id.in_(frontier))
        )
        frontier = []
        for reply_id, reply_card_id in result.all():
            if reply_id not in ids:
                frontier.append(reply_id)
                card_ids.add(reply_card_id)
        ids.extend(frontier)
    return ids, card_ids


async def _erase_comment_copies(
    db: AsyncSession, comment_ids: list[uuid.UUID], card_ids: set[uuid.UUID]
) -> None:
    """Remove every stored copy of these comments' text, in the caller's
    transaction (never commits): the in-app ``comment_added`` notifications,
    whose message quotes the text, and the ``content`` of their
    ``comment.created`` events. The events themselves stay — the history keeps
    that a comment was posted, not what it said. Both lookups are scoped to the
    comments' cards (``card_id`` is indexed on both tables)."""
    id_strings = [str(i) for i in comment_ids]
    await db.execute(
        delete(Notification).where(
            Notification.card_id.in_(card_ids),
            Notification.type == "comment_added",
            Notification.data["comment_id"].astext.in_(id_strings),
        )
    )
    events = await db.execute(
        select(Event).where(
            Event.card_id.in_(card_ids),
            Event.event_type == "comment.created",
            Event.data["id"].astext.in_(id_strings),
        )
    )
    for event in events.scalars().all():
        if event.data and "content" in event.data:
            event.data = {k: v for k, v in event.data.items() if k != "content"}


@router.patch("/comments/{comment_id}")
async def update_comment(
    comment_id: str,
    body: CommentUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    comment = await _load_comment_for_write(db, user, comment_id)
    comment.content = body.content
    await db.commit()
    await db.refresh(comment)
    children = _children_by_parent(await _card_comments(db, comment.card_id))
    return _comment_to_dict(comment, user, await _can_manage(db, user, comment.card_id), children)


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    comment = await _load_comment_for_write(db, user, comment_id)
    card_id = comment.card_id
    await _erase_comment_copies(db, *await _thread(db, comment))
    # The replies go with it (``Comment.replies`` cascades the delete).
    await db.delete(comment)
    await event_bus.publish(
        "comment.deleted",
        {"id": str(comment.id)},
        db=db,
        card_id=card_id,
        user_id=user.id,
    )
    await db.commit()
