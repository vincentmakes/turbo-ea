"""Card tagging — the one writer behind ``POST /cards/{id}/tags``,
``DELETE /cards/{id}/tags/{tag_id}`` and the SDK data bridge's
``set_card_tags``.

Two facts every tag write owes, whichever path performs it:

* **Rescore.** Mandatory tag groups are a data-quality bucket, so a tag
  change moves the score without waiting for the card's next edit.
* **History.** The rescore UPDATEs the card row and so moves ``updated_at``;
  without a ``tag.added`` / ``tag.removed`` event the Inventory's Modified
  column moves while the History tab stays silent (#995). A tag the card
  already carries writes nothing and says nothing.

Group rules the bridge enforces (the REST routes trust the UI, which never
offers an invalid pick): a *single*-mode group holds at most one tag per
card, and a group restricted to card types refuses cards of other types.
"""

from __future__ import annotations

import uuid
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.tag import CardTag, Tag, TagGroup
from app.services.data_quality import rescore_cards
from app.services.event_bus import event_bus

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
) -> tuple[list[uuid.UUID], list[uuid.UUID]]:
    """Make the card's tag set equal to / include / exclude ``tag_ids``.

    Validates every id against the ``tags`` table, then the *resulting* set
    against the group rules, so a ``replace`` that swaps one single-mode
    tag for another passes while an ``add`` that would leave two fails.
    Publishes one event per changed tag and rescores once. Flushes, never
    commits. Returns ``(added, removed)``.
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
        for link in rows.scalars().all():
            await db.delete(link)
    await db.flush()
    await rescore_cards(db, [card.id])
    for tag_id in added:
        await publish_tag_event(db, "tag.added", card.id, tag_id, actor_id, extra=event_extra)
    for tag_id in removed:
        await publish_tag_event(db, "tag.removed", card.id, tag_id, actor_id, extra=event_extra)
    return added, removed
