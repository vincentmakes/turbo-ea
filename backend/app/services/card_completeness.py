"""Check whether a card satisfies all mandatory-metamodel items.

Pure, read-only helper. Returns the list of unsatisfied mandatory
relation sides and tag groups for a card, which the approval-status
handler and the data-quality calculator consume.
"""

from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.tag import CardTag, Tag, TagGroup


async def missing_mandatory(db: AsyncSession, card: Card) -> dict:
    """Return unsatisfied mandatory items + applicable counts for a card.

    Shape:
        {
            "relations": [ {key, label, side, other_type_key}, ... ],
            "tag_groups": [ {id, name}, ... ],
            "relations_applicable": int,   # total mandatory relation sides
            "tag_groups_applicable": int,  # total applicable mandatory groups
        }

    - A RelationType with ``source_mandatory`` and ``source_type_key == card.type``
      requires at least one outgoing relation of that type.
    - A RelationType with ``target_mandatory`` and ``target_type_key == card.type``
      requires at least one incoming relation of that type.
    - A TagGroup with ``mandatory`` whose ``restrict_to_types`` is null OR
      includes the card's type requires at least one tag from that group
      on the card. Empty mandatory groups (no tags configured) are skipped
      to avoid an unreachable gate from an admin mis-configuration.
    """
    missing_relations: list[dict] = []
    missing_tag_groups: list[dict] = []
    relations_applicable = 0
    tag_groups_applicable = 0

    # ── Relation types touching this card's type on a mandatory side ────────
    rt_rows = await db.execute(
        select(RelationType).where(
            or_(
                (RelationType.source_type_key == card.type)
                & (RelationType.source_mandatory.is_(True)),
                (RelationType.target_type_key == card.type)
                & (RelationType.target_mandatory.is_(True)),
            ),
            RelationType.is_hidden.is_(False),
        )
    )
    relation_types = rt_rows.scalars().all()

    for rt in relation_types:
        source_side = rt.source_type_key == card.type and rt.source_mandatory
        target_side = rt.target_type_key == card.type and rt.target_mandatory

        # Outgoing check (source side)
        if source_side:
            relations_applicable += 1
            exists = await db.execute(
                select(Relation.id)
                .where(
                    Relation.source_id == card.id,
                    Relation.type == rt.key,
                )
                .limit(1)
            )
            if exists.scalar_one_or_none() is None:
                missing_relations.append(
                    {
                        "key": rt.key,
                        "label": rt.label,
                        "side": "source",
                        "other_type_key": rt.target_type_key,
                    }
                )

        # Incoming check (target side)
        if target_side:
            relations_applicable += 1
            exists = await db.execute(
                select(Relation.id)
                .where(
                    Relation.target_id == card.id,
                    Relation.type == rt.key,
                )
                .limit(1)
            )
            if exists.scalar_one_or_none() is None:
                missing_relations.append(
                    {
                        "key": rt.key,
                        "label": rt.reverse_label or rt.label,
                        "side": "target",
                        "other_type_key": rt.source_type_key,
                    }
                )

    # ── Mandatory tag groups applicable to this card's type ──────────────────
    tg_rows = await db.execute(select(TagGroup).where(TagGroup.mandatory.is_(True)))
    tag_groups = tg_rows.scalars().all()

    for tg in tag_groups:
        if tg.restrict_to_types and card.type not in tg.restrict_to_types:
            continue

        # Skip empty mandatory groups (admin error — don't hard-block)
        has_any_tag = await db.execute(select(Tag.id).where(Tag.tag_group_id == tg.id).limit(1))
        if has_any_tag.scalar_one_or_none() is None:
            continue

        tag_groups_applicable += 1
        satisfied = await db.execute(
            select(CardTag.tag_id)
            .join(Tag, Tag.id == CardTag.tag_id)
            .where(
                CardTag.card_id == card.id,
                Tag.tag_group_id == tg.id,
            )
            .limit(1)
        )
        if satisfied.scalar_one_or_none() is None:
            missing_tag_groups.append({"id": str(tg.id), "name": tg.name})

    return {
        "relations": missing_relations,
        "tag_groups": missing_tag_groups,
        "relations_applicable": relations_applicable,
        "tag_groups_applicable": tag_groups_applicable,
    }
