"""Card tagging — the shared writer behind ``POST /cards/tags/bulk`` (the
MCP ``set_card_tags`` tool) and the SDK data bridge's ``set_card_tags``.

Two facts every tag write owes, whichever path performs it:

* **Rescore.** Mandatory tag groups are a data-quality bucket, so a tag
  change moves the score without waiting for the card's next edit.
* **History.** The rescore UPDATEs the card row and so moves ``updated_at``;
  without a ``tag.added`` / ``tag.removed`` event the Inventory's Modified
  column moves while the History tab stays silent (#995). A tag the card
  already carries writes nothing and says nothing.

Group rules ``set_card_tags`` enforces: a *single*-mode group holds at most
one tag per card, and a group restricted to card types refuses cards of
other types. The single-card routes ``POST /cards/{id}/tags`` and
``DELETE /cards/{id}/tags/{tag_id}`` trust the UI instead, which swaps a
single-choice tag by adding before it removes.
"""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.tag import CardTag, Tag, TagGroup
from app.models.user import User
from app.schemas.common import (
    CardTagBulkRequest,
    CardTagBulkResponse,
    CardTagBulkResult,
    CardTagOperation,
)
from app.services.card_read_scope import CardReadScope
from app.services.data_quality import rescore_cards
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

TagSetMode = Literal["replace", "add", "remove"]


class TagWriteError(ValueError):
    """A tag write that violates a group rule or names an unknown tag."""


async def publish_tag_event(
    db: AsyncSession,
    event_type: str,
    card_id: uuid.UUID,
    tag_id: uuid.UUID,
    user_id: uuid.UUID | None,
    *,
    extra: dict | None = None,
) -> None:
    """Record a tag change on the card's History timeline."""
    row = (
        await db.execute(
            select(Tag.name, TagGroup.name)
            .join(TagGroup, Tag.tag_group_id == TagGroup.id)
            .where(Tag.id == tag_id)
        )
    ).first()
    tag_name, group_name = row if row else (None, None)
    payload = {
        "tag_id": str(tag_id),
        "tag_name": tag_name,
        "group_name": group_name,
    }
    if extra:
        payload.update(extra)
    await event_bus.publish(
        event_type,
        payload,
        db=db,
        card_id=card_id,
        user_id=user_id,
    )


async def card_tag_ids(db: AsyncSession, card_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await db.execute(
        select(CardTag.tag_id).where(CardTag.card_id == card_id).order_by(CardTag.tag_id)
    )
    return list(rows.scalars().all())


async def set_card_tags(
    db: AsyncSession,
    card: Card,
    tag_ids: list[uuid.UUID],
    *,
    mode: TagSetMode = "replace",
    actor_id: uuid.UUID | None,
    event_extra: dict | None = None,
    dry_run: bool = False,
) -> tuple[list[uuid.UUID], list[uuid.UUID]]:
    """Make the card's tag set equal to / include / exclude ``tag_ids``.

    Validates every id against the ``tags`` table, then the *resulting* set
    against the group rules, so a ``replace`` that swaps one single-mode
    tag for another passes while an ``add`` that would leave two fails.
    Publishes one event per changed tag and rescores once. Flushes, never
    commits. Returns ``(added, removed)``.

    ``dry_run`` publishes nothing: the caller previews inside a savepoint it
    rolls back, and a savepoint does not stop ``event_bus.publish`` from
    fanning the event out to live SSE subscribers — a preview would announce
    a tag change that never happened.
    """
    wanted = list(dict.fromkeys(tag_ids))
    if wanted:
        rows = await db.execute(
            select(Tag.id, Tag.tag_group_id, TagGroup.mode, TagGroup.restrict_to_types)
            .join(TagGroup, Tag.tag_group_id == TagGroup.id)
            .where(Tag.id.in_(wanted))
        )
        known = {r[0]: r for r in rows.all()}
        missing = [str(t) for t in wanted if t not in known]
        if missing:
            raise TagWriteError(f"Unknown tag(s): {', '.join(missing)}")

    current = set(await card_tag_ids(db, card.id))
    if mode == "replace":
        target = set(wanted)
    elif mode == "add":
        target = current | set(wanted)
    elif mode == "remove":
        target = current - set(wanted)
    else:  # pragma: no cover - typed literal
        raise TagWriteError(f"Unknown tag write mode {mode!r}")

    if target:
        rows = await db.execute(
            select(Tag.id, Tag.tag_group_id, TagGroup.mode, TagGroup.restrict_to_types)
            .join(TagGroup, Tag.tag_group_id == TagGroup.id)
            .where(Tag.id.in_(list(target)))
        )
        per_group: dict[uuid.UUID, list[uuid.UUID]] = {}
        for tag_id, group_id, group_mode, restrict in rows.all():
            if restrict and card.type not in restrict:
                raise TagWriteError(
                    f"Tag {tag_id} belongs to a group restricted to "
                    f"{', '.join(restrict)}; the card is a {card.type}"
                )
            if group_mode == "single":
                per_group.setdefault(group_id, []).append(tag_id)
        for group_id, members in per_group.items():
            if len(members) > 1:
                raise TagWriteError(
                    f"Tag group {group_id} is single-choice; the write would leave "
                    f"{len(members)} of its tags on the card"
                )

    added = sorted(target - current, key=str)
    removed = sorted(current - target, key=str)
    if not added and not removed:
        return [], []

    for tag_id in added:
        db.add(CardTag(card_id=card.id, tag_id=tag_id))
    if removed:
        rows = await db.execute(
            select(CardTag).where(CardTag.card_id == card.id, CardTag.tag_id.in_(removed))
        )
        links: list[CardTag] = list(rows.scalars().all())
        for link in links:
            await db.delete(link)
    await db.flush()
    await rescore_cards(db, [card.id])
    if dry_run:
        return added, removed
    for tag_id in added:
        await publish_tag_event(db, "tag.added", card.id, tag_id, actor_id, extra=event_extra)
    for tag_id in removed:
        await publish_tag_event(db, "tag.removed", card.id, tag_id, actor_id, extra=event_extra)
    return added, removed


async def can_tag_card(db: AsyncSession, user: User, card_id: uuid.UUID) -> bool:
    """Check tag management or edit authority for a card already known to be readable."""
    if await PermissionService.check_permission(db, user, "tags.manage"):
        return True
    return await PermissionService.check_permission(
        db, user, "inventory.edit", card_id=card_id, card_permission="card.edit"
    )


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
    added, removed = await set_card_tags(
        db,
        card,
        [t for t in tag_uuids if t is not None],
        mode=op.mode,
        actor_id=user.id,
        dry_run=dry_run,
    )
    resulting = await card_tag_ids(db, card.id)
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
        if read_scope.readable(cid, card.type, subtype=card.subtype, mode="inventory")
    }

    denied = [str(cid) for cid, card in visible.items() if not await can_tag_card(db, user, cid)]
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
        except TagWriteError as exc:
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
    return response
