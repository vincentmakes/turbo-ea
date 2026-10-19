"""Permanent deletion of a custom card type and everything that hangs off it.

A built-in type is only ever hidden (``is_hidden``), so the seed can restore it.
A custom type — one an admin created — can be removed for good, and that removal
takes its dependants with it: the cards of the type (with every relation,
stakeholder, comment, attachment and so on that cascades from a card), the
relation types that connect the type to any other (with their relation rows),
the calculations that target it and the stakeholder roles defined for it
(``stakeholder_role_definitions`` cascades at the database level).

Two entry points, both called by ``DELETE /metamodel/types/{key}``:

* ``type_delete_impact`` — what the deletion would take, for the confirmation
  dialog and for the 409 the route answers when cards exist and the caller
  did not opt in with ``delete_cards=true``.
* ``delete_type_dependents`` — the deletion itself, flushing but never
  committing (the route owns the transaction, as every helper does).

Cards are deleted **leaves first** so the self-referencing ``parent_id`` is
satisfied at every step, exactly as ``POST /cards/bulk-delete`` does; a card
whose parent is not in the set (a hierarchy never crosses types, but a row
written by an importer might) counts as a root.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calculation import Calculation
from app.models.card import Card
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.services.event_bus import event_bus

if TYPE_CHECKING:
    from app.models.card_type import CardType


@dataclass
class RelationTypeImpact:
    key: str
    label: str
    relation_count: int


@dataclass
class TypeDeleteImpact:
    key: str
    label: str
    built_in: bool
    active_card_count: int
    archived_card_count: int
    relation_types: list[RelationTypeImpact] = field(default_factory=list)
    calculation_count: int = 0
    stakeholder_role_count: int = 0

    @property
    def card_count(self) -> int:
        return self.active_card_count + self.archived_card_count

    @property
    def relation_count(self) -> int:
        return sum(rt.relation_count for rt in self.relation_types)

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "built_in": self.built_in,
            "card_count": self.card_count,
            "active_card_count": self.active_card_count,
            "archived_card_count": self.archived_card_count,
            "relation_count": self.relation_count,
            "relation_types": [
                {"key": rt.key, "label": rt.label, "relation_count": rt.relation_count}
                for rt in self.relation_types
            ],
            "calculation_count": self.calculation_count,
            "stakeholder_role_count": self.stakeholder_role_count,
        }


def _touches_type(key: str):
    return or_(RelationType.source_type_key == key, RelationType.target_type_key == key)


async def type_delete_impact(db: AsyncSession, card_type: CardType) -> TypeDeleteImpact:
    """Count everything ``delete_type_dependents`` would remove for this type."""
    key = card_type.key
    status_counts = await db.execute(
        select(Card.status, func.count()).where(Card.type == key).group_by(Card.status)
    )
    active = 0
    archived = 0
    for status, count in status_counts.all():
        if status == "ARCHIVED":
            archived += count
        else:
            active += count

    rel_rows = await db.execute(
        select(RelationType).where(_touches_type(key)).order_by(RelationType.sort_order)
    )
    relation_types: list[RelationTypeImpact] = []
    for rt in rel_rows.scalars().all():
        n = await db.execute(
            select(func.count()).select_from(Relation).where(Relation.type == rt.key)
        )
        relation_types.append(
            RelationTypeImpact(key=rt.key, label=rt.label or rt.key, relation_count=n.scalar() or 0)
        )

    calc_count = await db.execute(
        select(func.count()).select_from(Calculation).where(Calculation.target_type_key == key)
    )
    role_count = await db.execute(
        select(func.count())
        .select_from(StakeholderRoleDefinition)
        .where(StakeholderRoleDefinition.card_type_key == key)
    )
    return TypeDeleteImpact(
        key=key,
        label=card_type.label,
        built_in=bool(card_type.built_in),
        active_card_count=active,
        archived_card_count=archived,
        relation_types=relation_types,
        calculation_count=calc_count.scalar() or 0,
        stakeholder_role_count=role_count.scalar() or 0,
    )


def leaves_first(cards: list[Card]) -> list[Card]:
    """Order cards so that every card comes before its parent.

    Depth is measured *within the set*: a card whose parent is absent is a root.
    A parent cycle (which the hierarchy guards never allow) resolves to depth 0
    rather than recursing forever. Ties keep the input order, so the result is
    deterministic.
    """
    by_id: dict[uuid.UUID, Card] = {c.id: c for c in cards}
    depth: dict[uuid.UUID, int] = {}

    def depth_of(cid: uuid.UUID) -> int:
        if cid in depth:
            return depth[cid]
        depth[cid] = 0
        card = by_id[cid]
        if card.parent_id is None or card.parent_id not in by_id:
            return 0
        d = 1 + depth_of(card.parent_id)
        depth[cid] = d
        return d

    for cid in by_id:
        depth_of(cid)
    return sorted(cards, key=lambda c: depth[c.id], reverse=True)


async def delete_type_dependents(
    db: AsyncSession, card_type: CardType, *, actor_id: uuid.UUID | None
) -> TypeDeleteImpact:
    """Remove every card, relation type, relation and calculation of a custom type.

    Flushes, never commits. Publishes one ``card.deleted`` event per card with
    ``db=`` so the deletion is on record, the way the inventory's bulk delete
    is. The card type row itself is left for the caller to delete, after it has
    written its audit entry. Returns what was there before the deletion, counted
    by ``type_delete_impact``, so the caller reports the same numbers the
    confirmation dialog showed.
    """
    key = card_type.key
    impact = await type_delete_impact(db, card_type)
    card_rows = await db.execute(select(Card).where(Card.type == key))
    cards = leaves_first(list(card_rows.scalars().all()))
    for card in cards:
        await event_bus.publish(
            "card.deleted",
            {"id": str(card.id), "type": card.type, "name": card.name},
            db=db,
            card_id=card.id,
            user_id=actor_id,
        )
    for card in cards:
        await db.delete(card)
        await db.flush()

    rel_rows = await db.execute(select(RelationType).where(_touches_type(key)))
    for rt in rel_rows.scalars().all():
        # Every row of such a type has a card of this type at one end, so the
        # card cascade already took it. Delete by type key as well so a row
        # that somehow points elsewhere cannot dangle without its type.
        await db.execute(delete(Relation).where(Relation.type == rt.key))
        await db.delete(rt)

    await db.execute(delete(Calculation).where(Calculation.target_type_key == key))
    await db.flush()
    return impact
