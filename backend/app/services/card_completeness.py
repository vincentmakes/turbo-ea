"""Check whether a card satisfies all mandatory-metamodel items.

Read-only. Returns the list of unsatisfied mandatory relation sides and tag
groups for a card, which the approval-status handler and the data-quality
calculator consume.

The check is split in three so that rescoring every card of a type costs a
handful of queries rather than several per card:

* :func:`load_mandatory_config` — what the card *type* requires, loaded once
  per type;
* :func:`load_link_facts` — which of those requirements each card holds,
  loaded in one query per kind for a whole list of cards;
* :func:`evaluate` — the pure verdict for one card from the two.

:func:`missing_mandatory` is the single-card composition of the three, so the
approval gate and the batched rescore share one definition.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.tag import CardTag, Tag, TagGroup
from app.services.relation_orientation import side_key


def optional_relation_sides(subtypes: object, subtype: str | None) -> frozenset[str]:
    """The mandatory relation sides the card's subtype exempts (#1296).

    ``card_types.subtypes[*].optional_relations`` lists side keys (see
    ``side_key``) the admin ticked under *Relations not required for this
    subtype*. A card with no subtype, a subtype the type does not define, or a
    malformed list exempts nothing. Unknown keys are harmless: they simply name
    no side.
    """
    if not subtype or not isinstance(subtypes, list):
        return frozenset()
    for st in subtypes:
        if isinstance(st, dict) and st.get("key") == subtype:
            keys = st.get("optional_relations")
            if not isinstance(keys, list):
                return frozenset()
            return frozenset(k for k in keys if isinstance(k, str))
    return frozenset()


@dataclass(frozen=True)
class MandatorySide:
    """One mandatory relation side a card of the type must hold."""

    key: str  # relation type key
    label: str  # the verb read from this side
    side: str  # "source" (outgoing) or "target" (incoming)
    other_type_key: str
    side_key: str  # the ``optional_relations`` vocabulary (see ``side_key``)


@dataclass(frozen=True)
class MandatoryTagGroup:
    id: uuid.UUID
    name: str


@dataclass(frozen=True)
class MandatoryConfig:
    """What a card type requires, independent of any one card.

    ``tag_groups`` holds only the groups that apply to the type and have at
    least one tag: an empty mandatory group is an admin mis-configuration and
    must not become an unreachable gate.
    """

    sides: tuple[MandatorySide, ...] = ()
    tag_groups: tuple[MandatoryTagGroup, ...] = ()


@dataclass(frozen=True)
class LinkFacts:
    """Which mandatory items one card holds.

    ``sides`` is a set of ``(relation type key, "source" | "target")`` pairs;
    ``tag_groups`` the ids of the groups the card carries a tag from.
    """

    sides: frozenset[tuple[str, str]] = frozenset()
    tag_groups: frozenset[uuid.UUID] = frozenset()


NO_LINKS = LinkFacts()


async def load_mandatory_config(db: AsyncSession, type_key: str) -> MandatoryConfig:
    """Load the mandatory relation sides and tag groups of a card type.

    - A RelationType with ``source_mandatory`` and ``source_type_key == type``
      contributes the outgoing side; one with ``target_mandatory`` and
      ``target_type_key == type`` the incoming side. A self-referencing type
      can contribute both.
    - A TagGroup with ``mandatory`` whose ``restrict_to_types`` is null OR
      includes the type applies, provided it has at least one tag.
    """
    relation_types = (
        (
            await db.execute(
                select(RelationType).where(
                    or_(
                        (RelationType.source_type_key == type_key)
                        & (RelationType.source_mandatory.is_(True)),
                        (RelationType.target_type_key == type_key)
                        & (RelationType.target_mandatory.is_(True)),
                    ),
                    RelationType.is_hidden.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    sides: list[MandatorySide] = []
    for rt in relation_types:
        if rt.source_type_key == type_key and rt.source_mandatory:
            sides.append(
                MandatorySide(
                    key=rt.key,
                    label=rt.label,
                    side="source",
                    other_type_key=rt.target_type_key,
                    side_key=side_key(rt, True),
                )
            )
        if rt.target_type_key == type_key and rt.target_mandatory:
            sides.append(
                MandatorySide(
                    key=rt.key,
                    label=rt.reverse_label or rt.label,
                    side="target",
                    other_type_key=rt.source_type_key,
                    side_key=side_key(rt, False),
                )
            )

    groups = [
        tg
        for tg in (await db.execute(select(TagGroup).where(TagGroup.mandatory.is_(True))))
        .scalars()
        .all()
        if not tg.restrict_to_types or type_key in tg.restrict_to_types
    ]
    tag_groups: tuple[MandatoryTagGroup, ...] = ()
    if groups:
        non_empty = set(
            (
                await db.execute(
                    select(Tag.tag_group_id)
                    .where(Tag.tag_group_id.in_([tg.id for tg in groups]))
                    .distinct()
                )
            ).scalars()
        )
        tag_groups = tuple(
            MandatoryTagGroup(id=tg.id, name=tg.name) for tg in groups if tg.id in non_empty
        )
    return MandatoryConfig(sides=tuple(sides), tag_groups=tag_groups)


async def load_link_facts(
    db: AsyncSession, config: MandatoryConfig, card_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, LinkFacts]:
    """Which mandatory items each card in ``card_ids`` holds.

    At most three queries whatever the number of cards: outgoing relations,
    incoming relations, and tags from the applicable groups — each skipped
    when the type requires nothing of that kind. Every id gets an entry.
    """
    ids = list(card_ids)
    held: dict[uuid.UUID, set[tuple[str, str]]] = {cid: set() for cid in ids}
    groups: dict[uuid.UUID, set[uuid.UUID]] = {cid: set() for cid in ids}
    if ids:
        source_keys = {s.key for s in config.sides if s.side == "source"}
        if source_keys:
            rows = await db.execute(
                select(Relation.source_id, Relation.type)
                .where(Relation.source_id.in_(ids), Relation.type.in_(source_keys))
                .distinct()
            )
            for card_id, type_key in rows:
                held[card_id].add((type_key, "source"))
        target_keys = {s.key for s in config.sides if s.side == "target"}
        if target_keys:
            rows = await db.execute(
                select(Relation.target_id, Relation.type)
                .where(Relation.target_id.in_(ids), Relation.type.in_(target_keys))
                .distinct()
            )
            for card_id, type_key in rows:
                held[card_id].add((type_key, "target"))
        if config.tag_groups:
            tag_rows = await db.execute(
                select(CardTag.card_id, Tag.tag_group_id)
                .join(Tag, Tag.id == CardTag.tag_id)
                .where(
                    CardTag.card_id.in_(ids),
                    Tag.tag_group_id.in_([tg.id for tg in config.tag_groups]),
                )
                .distinct()
            )
            for card_id, group_id in tag_rows:
                groups[card_id].add(group_id)
    return {
        cid: LinkFacts(sides=frozenset(held[cid]), tag_groups=frozenset(groups[cid])) for cid in ids
    }


def mandatory_items(
    config: MandatoryConfig,
    facts: LinkFacts,
    optional_sides: frozenset[str] = frozenset(),
) -> tuple[list[tuple[MandatorySide, bool]], list[tuple[MandatoryTagGroup, bool]]]:
    """Every applicable mandatory item for one card, each with whether it is held.

    The per-item form of :func:`evaluate` (which is built on it): a side the
    card's subtype exempts is left out, every other side and every mandatory
    tag group is listed once, satisfied or not. The data-quality breakdown
    (#1334) reads this to list what is still missing *and* what already counts.
    """
    sides = [
        (s, (s.key, s.side) in facts.sides)
        for s in config.sides
        if s.side_key not in optional_sides
    ]
    groups = [(tg, tg.id in facts.tag_groups) for tg in config.tag_groups]
    return sides, groups


def evaluate(
    config: MandatoryConfig,
    facts: LinkFacts,
    optional_sides: frozenset[str] = frozenset(),
) -> dict:
    """The unsatisfied mandatory items + applicable counts for one card.

    Shape:
        {
            "relations": [ {key, label, side, other_type_key}, ... ],
            "tag_groups": [ {id, name}, ... ],
            "relations_applicable": int,   # total mandatory relation sides
            "tag_groups_applicable": int,  # total applicable mandatory groups
        }

    A side the card's subtype lists in ``optional_relations`` (passed as
    ``optional_sides``) is not required at all for that card — neither missing
    nor counted as applicable, exactly as a subtype's ``hidden_fields`` drop
    out of the field score.
    """
    sides, groups = mandatory_items(config, facts, optional_sides)
    return {
        "relations": [
            {
                "key": s.key,
                "label": s.label,
                "side": s.side,
                "other_type_key": s.other_type_key,
            }
            for s, held in sides
            if not held
        ],
        "tag_groups": [{"id": str(tg.id), "name": tg.name} for tg, held in groups if not held],
        "relations_applicable": len(sides),
        "tag_groups_applicable": len(groups),
    }


async def missing_mandatory(
    db: AsyncSession, card: Card, *, optional_sides: frozenset[str] | None = None
) -> dict:
    """Return unsatisfied mandatory items + applicable counts for a card.

    The shape and rules are :func:`evaluate`'s. ``optional_sides`` lets a
    caller that already loaded the type's subtypes pass the card's exemptions
    in; otherwise they are read here.
    """
    config = await load_mandatory_config(db, card.type)
    if optional_sides is None:
        optional_sides = frozenset()
        if card.subtype and config.sides:
            subtypes = (
                await db.execute(select(CardType.subtypes).where(CardType.key == card.type))
            ).scalar_one_or_none()
            optional_sides = optional_relation_sides(subtypes, card.subtype)
    facts = (await load_link_facts(db, config, [card.id]))[card.id]
    return evaluate(config, facts, optional_sides)
