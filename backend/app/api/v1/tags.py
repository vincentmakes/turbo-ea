from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.card_type import CardType
from app.models.tag import CardTag, Tag, TagGroup
from app.models.user import User
from app.schemas.common import (
    CardTagBulkRequest,
    CardTagBulkResponse,
    CardTagBulkResult,
    CardTagOperation,
    TagCreate,
    TagGroupCreate,
    TagGroupUpdate,
    TagUpdate,
)
from app.services import audit_labels, audit_log, tag_service
from app.services.card_read_scope import CardReadScope
from app.services.data_quality import rescore_cards
from app.services.permission_service import PermissionService
from app.services.tag_service import publish_tag_event as _publish_tag_event


async def _type_labels(db: AsyncSession, keys: list[str] | None) -> list[str] | None:
    """A tag group's ``restrict_to_types`` as card-type labels, in order, for an
    audit row; a key with no type is kept as it is, and ``None`` (every type)
    stays ``None``."""
    if keys is None:
        return None
    labels = await audit_labels.card_type_labels(db, keys)
    return [labels.get(key, key) for key in keys]


async def _group_name(db: AsyncSession, group_id: uuid.UUID) -> str | None:
    """The name of the tag group ``group_id``, for an audit row."""
    return (
        await db.execute(select(TagGroup.name).where(TagGroup.id == group_id))
    ).scalar_one_or_none()


async def _check_restrict_types(
    db: AsyncSession, keys: list[str] | None, *, already_stored: list[str] | None = None
) -> None:
    """422 unless every card-type key in ``keys`` names an existing card type.

    A key the group already stores is let through, so a group whose type was
    since deleted can still be edited without first dropping that key.
    """
    if not keys:
        return
    stored = set(already_stored or [])
    to_check = sorted({k for k in keys if k not in stored})
    if not to_check:
        return
    existing = set(
        (await db.execute(select(CardType.key).where(CardType.key.in_(to_check)))).scalars().all()
    )
    unknown = [k for k in to_check if k not in existing]
    if unknown:
        raise HTTPException(422, "Unknown card type(s) in restrict_to_types: " + ", ".join(unknown))


def _parse_group_id(group_id: str) -> uuid.UUID:
    """The path's group id, or 404 — a malformed id names no group."""
    try:
        return uuid.UUID(group_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Tag group not found") from exc


router = APIRouter(tags=["tags"])


@router.get("/tag-groups")
async def list_tag_groups(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(TagGroup).options(selectinload(TagGroup.tags)))
    groups = result.scalars().all()
    return [
        {
            "id": str(g.id),
            "name": g.name,
            "description": g.description,
            "mode": g.mode,
            "mandatory": g.mandatory,
            "restrict_to_types": g.restrict_to_types,
            "tags": [
                {
                    "id": str(t.id),
                    "name": t.name,
                    "description": t.description,
                    "color": t.color,
                    "tag_group_id": str(t.tag_group_id),
                }
                # Deterministic order (sort_order, then name) so editing a tag —
                # e.g. adding a description — never reshuffles the list. The
                # relationship has no ORDER BY, so DB row order is otherwise
                # unstable after an UPDATE.
                for t in sorted(
                    g.tags or [],
                    key=lambda t: (t.sort_order or 0, (t.name or "").casefold()),
                )
            ],
        }
        for g in groups
    ]


@router.post("/tag-groups", status_code=201)
async def create_tag_group(
    body: TagGroupCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "tags.manage")
    await _check_restrict_types(db, body.restrict_to_types)
    if body.dry_run:
        # Every check has run; nothing is stored and no audit row is written.
        return {"id": None, "name": body.name, "dry_run": True}
    group = TagGroup(
        name=body.name,
        description=body.description,
        mode=body.mode,
        mandatory=body.mandatory,
        restrict_to_types=body.restrict_to_types,
    )
    db.add(group)
    await db.flush()
    await audit_log.record(
        db,
        action="admin.tag_group.created",
        category="admin",
        actor=user,
        target=("tag_group", str(group.id), group.name),
        context={
            "mode": group.mode,
            "mandatory": group.mandatory,
            "restrict_to_types": await _type_labels(db, group.restrict_to_types),
        },
    )
    await db.commit()
    await db.refresh(group)
    return {"id": str(group.id), "name": group.name}


@router.patch("/tag-groups/{group_id}")
async def update_tag_group(
    group_id: str,
    body: TagGroupUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "tags.manage")
    group = await db.get(TagGroup, uuid.UUID(group_id))
    if group is None:
        raise HTTPException(status_code=404, detail="Tag group not found")
    updates = body.model_dump(exclude_unset=True)
    if "restrict_to_types" in updates:
        await _check_restrict_types(
            db, updates["restrict_to_types"], already_stored=group.restrict_to_types
        )
    changes: dict[str, Any] = audit_log.diff(group, updates)
    if "restrict_to_types" in changes:
        # Named the way the tag-group editor lists them.
        changes["restrict_to_types"] = {
            side: await _type_labels(db, changes["restrict_to_types"][side])
            for side in ("old", "new")
        }
    for field, value in updates.items():
        setattr(group, field, value)
    if changes:  # a save that changed nothing is not an audit event
        await audit_log.record(
            db,
            action="admin.tag_group.updated",
            category="admin",
            actor=user,
            target=("tag_group", str(group.id), group.name),
            changes=changes,
        )
    await db.commit()
    await db.refresh(group)
    return {
        "id": str(group.id),
        "name": group.name,
        "description": group.description,
        "mode": group.mode,
        "mandatory": group.mandatory,
        "restrict_to_types": group.restrict_to_types,
    }


@router.delete("/tag-groups/{group_id}", status_code=204)
async def delete_tag_group(
    group_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "tags.manage")
    group = await db.get(TagGroup, uuid.UUID(group_id))
    if group is None:
        raise HTTPException(status_code=404, detail="Tag group not found")
    await audit_log.record(
        db,
        action="admin.tag_group.deleted",
        category="admin",
        actor=user,
        target=("tag_group", str(group.id), group.name),
    )
    await db.delete(group)
    await db.commit()


@router.post("/tag-groups/{group_id}/tags", status_code=201)
async def create_tag(
    group_id: str,
    body: TagCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "tags.manage")
    group = await db.get(TagGroup, _parse_group_id(group_id))
    if group is None:
        raise HTTPException(status_code=404, detail="Tag group not found")
    if body.dry_run:
        # Every check has run; nothing is stored and no audit row is written.
        return {
            "id": None,
            "name": body.name,
            "description": body.description,
            "color": body.color,
            "dry_run": True,
        }
    tag = Tag(
        tag_group_id=group.id,
        name=body.name,
        description=body.description,
        color=body.color,
    )
    db.add(tag)
    await db.flush()
    await audit_log.record(
        db,
        action="admin.tag.created",
        category="admin",
        actor=user,
        target=("tag", str(tag.id), tag.name),
        context={
            "tag_group": await _group_name(db, tag.tag_group_id),
            "color": tag.color,
        },
    )
    await db.commit()
    await db.refresh(tag)
    return {
        "id": str(tag.id),
        "name": tag.name,
        "description": tag.description,
        "color": tag.color,
    }


@router.patch("/tag-groups/{group_id}/tags/{tag_id}")
async def update_tag(
    group_id: str,
    tag_id: str,
    body: TagUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "tags.manage")
    result = await db.execute(
        select(Tag).where(
            Tag.id == uuid.UUID(tag_id),
            Tag.tag_group_id == uuid.UUID(group_id),
        )
    )
    tag = result.scalar_one_or_none()
    if tag is None:
        raise HTTPException(status_code=404, detail="Tag not found")
    updates = body.model_dump(exclude_unset=True)
    changes = audit_log.diff(tag, updates)
    for field, value in updates.items():
        setattr(tag, field, value)
    if changes:  # a save that changed nothing is not an audit event
        await audit_log.record(
            db,
            action="admin.tag.updated",
            category="admin",
            actor=user,
            target=("tag", str(tag.id), tag.name),
            changes=changes,
        )
    await db.commit()
    await db.refresh(tag)
    return {
        "id": str(tag.id),
        "name": tag.name,
        "description": tag.description,
        "color": tag.color,
        "tag_group_id": str(tag.tag_group_id),
    }


@router.delete("/tag-groups/{group_id}/tags/{tag_id}", status_code=204)
async def delete_tag(
    group_id: str,
    tag_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "tags.manage")
    result = await db.execute(
        select(Tag).where(
            Tag.id == uuid.UUID(tag_id),
            Tag.tag_group_id == uuid.UUID(group_id),
        )
    )
    tag = result.scalar_one_or_none()
    if tag is None:
        raise HTTPException(status_code=404, detail="Tag not found")
    await audit_log.record(
        db,
        action="admin.tag.deleted",
        category="admin",
        actor=user,
        target=("tag", str(tag.id), tag.name),
        context={
            "tag_group": await _group_name(db, tag.tag_group_id),
            "color": tag.color,
        },
    )
    await db.delete(tag)
    await db.commit()


async def _can_tag_card(db: AsyncSession, user: User, card_uuid: uuid.UUID) -> bool:
    """May the user tag this card? `tags.manage` globally, OR edit rights on
    the card (`inventory.edit` at the app level, or `card.edit` through a
    stakeholder role)."""
    if await PermissionService.check_permission(db, user, "tags.manage"):
        return True
    return await PermissionService.check_permission(
        db,
        user,
        "inventory.edit",
        card_id=card_uuid,
        card_permission="card.edit",
    )


async def _require_can_tag_card(db: AsyncSession, user: User, card_uuid: uuid.UUID) -> None:
    if not await _can_tag_card(db, user, card_uuid):
        raise HTTPException(status_code=403, detail="Insufficient permissions")


def _parse_uuid(raw: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(raw)
    except ValueError:
        return None


def _summarise(results: list[CardTagBulkResult], *, dry_run: bool) -> CardTagBulkResponse:
    return CardTagBulkResponse(
        results=results,
        updated=sum(1 for r in results if r.status == "updated"),
        unchanged=sum(1 for r in results if r.status == "unchanged"),
        failed=sum(1 for r in results if r.status in ("failed", "not_found")),
        dry_run=dry_run,
    )


async def _apply_tag_operation(
    db: AsyncSession,
    user: User,
    index: int,
    op: CardTagOperation,
    card: Card,
    *,
    dry_run: bool,
) -> CardTagBulkResult:
    """One row of ``POST /cards/tags/bulk``, inside the caller's savepoint."""
    if card.status == "ARCHIVED":
        return CardTagBulkResult(
            index=index, card_id=op.card_id, status="failed", error="Card is archived"
        )
    tag_uuids = [_parse_uuid(t) for t in op.tag_ids]
    bad = [raw for raw in op.tag_ids if _parse_uuid(raw) is None]
    if bad:
        return CardTagBulkResult(
            index=index,
            card_id=op.card_id,
            status="failed",
            error="Invalid tag id(s): " + ", ".join(bad),
        )
    added, removed = await tag_service.set_card_tags(
        db,
        card,
        [t for t in tag_uuids if t is not None],
        mode=op.mode,
        actor_id=user.id,
        dry_run=dry_run,
    )
    resulting = await tag_service.card_tag_ids(db, card.id)
    return CardTagBulkResult(
        index=index,
        card_id=op.card_id,
        status="updated" if added or removed else "unchanged",
        added=[str(t) for t in added],
        removed=[str(t) for t in removed],
        tag_ids=[str(t) for t in resulting],
    )


async def apply_card_tag_operations(
    db: AsyncSession, user: User, body: CardTagBulkRequest
) -> CardTagBulkResponse:
    """Add, remove or replace tags on many cards — the body of
    ``POST /cards/tags/bulk``.

    A card the caller may not read answers ``not_found`` exactly like one that
    does not exist (inventory read scope). Every readable card must be
    taggable by the caller or the whole call is refused before anything is
    written — the bulk-archive convention. Each row then runs in its own
    savepoint through ``tag_service.set_card_tags``, so the group rules
    (single-choice, card-type restriction) are enforced on the resulting set
    and a failed row rolls back only itself. ``dry_run`` rolls the whole call
    back and publishes nothing.
    """
    ops = list(body.operations)
    card_uuids = {u for u in (_parse_uuid(op.card_id) for op in ops) if u is not None}
    cards: dict[uuid.UUID, Card] = {}
    if card_uuids:
        rows = await db.execute(select(Card).where(Card.id.in_(card_uuids)))
        cards = {c.id: c for c in rows.scalars().all()}
    read_scope = await CardReadScope.load(db, user)
    visible = {
        cid: card
        for cid, card in cards.items()
        if read_scope.readable(cid, card.type, mode="inventory")
    }

    denied = [str(cid) for cid, card in visible.items() if not await _can_tag_card(db, user, cid)]
    if denied:
        raise HTTPException(
            403, "Not enough permissions to tag card(s): " + ", ".join(sorted(denied))
        )

    dry_run_savepoint = await db.begin_nested() if body.dry_run else None
    results: list[CardTagBulkResult] = []
    for index, op in enumerate(ops):
        cid = _parse_uuid(op.card_id)
        card = visible.get(cid) if cid is not None else None
        if card is None:
            results.append(CardTagBulkResult(index=index, card_id=op.card_id, status="not_found"))
            continue
        row_sp = await db.begin_nested()
        try:
            result = await _apply_tag_operation(db, user, index, op, card, dry_run=body.dry_run)
        except tag_service.TagWriteError as exc:
            await row_sp.rollback()
            result = CardTagBulkResult(
                index=index, card_id=op.card_id, status="failed", error=str(exc)
            )
        else:
            # A row refused before it wrote (archived, a bad tag id) has
            # nothing in its savepoint, so committing it is the same as not.
            await row_sp.commit()
        results.append(result)

    response = _summarise(results, dry_run=body.dry_run)
    if dry_run_savepoint is not None:
        await dry_run_savepoint.rollback()
    else:
        # Failed rows rolled back their own savepoints; what is left is the
        # rows that succeeded (or wrote nothing at all).
        await db.commit()
    return response


@router.post("/cards/tags/bulk", response_model=CardTagBulkResponse)
async def bulk_set_card_tags(
    body: CardTagBulkRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Add, remove or replace tags on many cards in one call, with group rules
    enforced and an optional ``dry_run``. The single-card ``POST
    /cards/{id}/tags`` stays as it is: the UI swaps a single-choice tag by
    adding before it removes, which the rule check here would refuse."""
    return await apply_card_tag_operations(db, user, body)


@router.post("/cards/{card_id}/tags", status_code=201)
async def assign_tags(
    card_id: str,
    tag_ids: list[str],
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card_uuid = uuid.UUID(card_id)
    await _require_can_tag_card(db, user, card_uuid)
    added: list[uuid.UUID] = []
    for tid in tag_ids:
        tag_uuid = uuid.UUID(tid)
        existing = await db.execute(
            select(CardTag).where(
                CardTag.card_id == card_uuid,
                CardTag.tag_id == tag_uuid,
            )
        )
        if not existing.scalar_one_or_none():
            db.add(CardTag(card_id=card_uuid, tag_id=tag_uuid))
            added.append(tag_uuid)
    # Mandatory tag groups are a data-quality bucket, so satisfying one has to
    # move the score without waiting for the card's next edit.
    await db.flush()
    await rescore_cards(db, [card_uuid])
    # Tagging moves `updated_at` (the rescore writes the row), so it owes the
    # History tab an entry — see the updated_at/History invariant in CLAUDE.md.
    # Re-assigning a tag the card already carries writes nothing and says nothing.
    for tag_uuid in added:
        await _publish_tag_event(db, "tag.added", card_uuid, tag_uuid, user.id)
    await db.commit()
    return {"status": "ok"}


@router.delete("/cards/{card_id}/tags/{tag_id}", status_code=204)
async def remove_tag(
    card_id: str,
    tag_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_can_tag_card(db, user, uuid.UUID(card_id))
    result = await db.execute(
        select(CardTag).where(
            CardTag.card_id == uuid.UUID(card_id),
            CardTag.tag_id == uuid.UUID(tag_id),
        )
    )
    fst = result.scalar_one_or_none()
    if fst:
        await db.delete(fst)
        await db.flush()
        await rescore_cards(db, [uuid.UUID(card_id)])
        await _publish_tag_event(db, "tag.removed", uuid.UUID(card_id), uuid.UUID(tag_id), user.id)
        await db.commit()
