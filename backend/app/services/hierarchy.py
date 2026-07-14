"""
Generic hierarchy-level support shared across the app.

Exposes the ``hierarchyLevel`` built-in attribute (raw tree depth, 1 = root)
for every card type with ``has_hierarchy = True`` — built-in and custom alike.

This module is import-neutral: the calculation engine (a service) cannot import
from ``app/api/v1/cards.py`` (cards.py imports the engine), so the field key,
the field definition, and the depth math live here and are consumed by the
seed, the metamodel API, the cards router, the calc engine, and the demo seed.

Note: the Macro-aware ``capabilityLevel`` (BusinessCapability only, capped
L1..L5) is a separate concern and stays in ``app/api/v1/cards.py``.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType

HIERARCHY_LEVEL_KEY = "hierarchyLevel"


def hierarchy_level_field_def() -> dict:
    """The single source of truth for the ``hierarchyLevel`` field definition.

    ``weight: 0`` mirrors ``capabilityLevel`` so this always-auto-filled field
    never shifts a card's data-quality score (``weight <= 0`` is excluded from
    ``calc_data_quality``).
    """
    return {
        "key": HIERARCHY_LEVEL_KEY,
        "label": "Hierarchy Level",
        "type": "number",
        "readonly": True,
        "weight": 0,
        "translations": {
            "de": "Hierarchieebene",
            "fr": "Niveau hiérarchique",
            "es": "Nivel jerárquico",
            "it": "Livello gerarchico",
            "pt": "Nível hierárquico",
            "zh": "层级级别",
            "ru": "Уровень иерархии",
            "da": "Hierarkiniveau",
            "ar": "مستوى التسلسل الهرمي",
        },
    }


async def compute_hierarchy_level(
    db: AsyncSession, parent_id: uuid.UUID | None, *, exclude: set[uuid.UUID] | None = None
) -> int:
    """Return the raw hierarchy depth for a card whose parent is ``parent_id``.

    1 = root (no parent), 2 = child of a root, … . Cycle-guarded. No macro
    logic — this is the generic depth used by every hierarchical type and
    exposed to formulas as ``hierarchy_level``.
    """
    depth = 0
    seen: set[uuid.UUID] = set(exclude or set())
    current_id = parent_id
    while current_id and current_id not in seen:
        seen.add(current_id)
        depth += 1
        row = (await db.execute(select(Card.parent_id).where(Card.id == current_id))).first()
        if row is None:
            break
        current_id = row[0]
    return depth + 1


async def backfill_hierarchy_levels_for_type(db: AsyncSession, type_key: str) -> int:
    """Compute and persist ``attributes.hierarchyLevel`` for every card of a type.

    BFS from the roots (``parent_id IS NULL``) so each card's depth is derived
    from its already-computed parent depth. Writes only when the value differs.
    Returns the number of cards updated.
    """
    roots = (
        (await db.execute(select(Card).where(Card.type == type_key, Card.parent_id.is_(None))))
        .scalars()
        .all()
    )
    updated = 0
    frontier: list[tuple[Card, int]] = [(c, 1) for c in roots]
    while frontier:
        card, level = frontier.pop()
        attrs = dict(card.attributes or {})
        if attrs.get(HIERARCHY_LEVEL_KEY) != level:
            attrs[HIERARCHY_LEVEL_KEY] = level
            card.attributes = attrs
            updated += 1
        children = (await db.execute(select(Card).where(Card.parent_id == card.id))).scalars().all()
        frontier.extend((child, level + 1) for child in children)
    return updated


async def backfill_hierarchy_levels(db: AsyncSession) -> int:
    """Backfill ``hierarchyLevel`` for every ``has_hierarchy`` card type.

    Returns the total number of cards updated.
    """
    type_keys = (
        (
            await db.execute(
                select(CardType.key).where(CardType.has_hierarchy == True)  # noqa: E712
            )
        )
        .scalars()
        .all()
    )
    total = 0
    for type_key in type_keys:
        total += await backfill_hierarchy_levels_for_type(db, type_key)
    return total
