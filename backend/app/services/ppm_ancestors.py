"""The Initiative ancestors a PPM change has to refresh.

A calculated field can roll an Initiative's PPM figures up the hierarchy level
by level — ``ppm.totalBudget + SUM(PLUCK(children, "attributes.rolledUpBudget"))``
on every Initiative — and each level reads the value its children hold. So when
a PPM row changes on one Initiative, every ancestor above it owes a re-run, in
order from the nearest parent up, or the parent would read its child's stale
total.

Kept out of the route module so the walk carries a mutation score of its own.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card

INITIATIVE_TYPE = "Initiative"

# No hierarchy is deeper than six levels (`card_write_service` allows five, six
# under a macro capability root), so a card has at most five ancestors. The cap
# is a backstop against data the depth check never saw (an import, a
# migration), not a limit anyone should reach.
MAX_ANCESTORS = 6


async def active_initiative_ancestors(db: AsyncSession, card: Card) -> list[Card]:
    """The ACTIVE Initiative ancestors of ``card``, nearest parent first.

    The walk stops at the first parent that is missing, archived or not an
    Initiative: a roll-up through an archived card would be invisible on every
    surface, and a parent of another type has no PPM figures to roll up. A cycle
    (only possible in corrupt data) ends the walk instead of looping.
    """
    out: list[Card] = []
    seen: set[uuid.UUID] = {card.id}
    parent_id = card.parent_id
    while parent_id is not None and parent_id not in seen and len(out) < MAX_ANCESTORS:
        seen.add(parent_id)
        parent = (
            await db.execute(
                select(Card).where(
                    Card.id == parent_id,
                    Card.type == INITIATIVE_TYPE,
                    Card.status == "ACTIVE",
                )
            )
        ).scalar_one_or_none()
        if parent is None:
            break
        out.append(parent)
        parent_id = parent.parent_id
    return out
