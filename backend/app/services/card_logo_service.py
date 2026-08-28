"""Which cards carry a custom logo, resolved in bulk.

Every surface that renders a card — the inventory rows, a card payload, a web
portal, the dependency graph — needs the same two facts: does this card have a
logo, and when was it last written (which doubles as the cache-buster in the
image URL). Answering that per card would be a query per row.

The per-type ``allow_card_logo`` switch is applied *here* rather than in each
client. That is what makes "an admin switches logos off for a type and its
cards render exactly as they did before" true on every surface at once,
without the rule being restated — and differently — in four places.

The bytes are never touched: ``CardLogo.data`` is deferred on the model and
only ``GET /cards/{id}/logo`` selects it.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_logo import CardLogo
from app.models.card_type import CardType


async def logo_updated_map(db: AsyncSession, cards: list[Card]) -> dict[uuid.UUID, datetime]:
    """Return ``card_id → logo updated_at`` for the cards that have a logo.

    Two batched queries, never one per card. Cards absent from the result
    either have no logo or belong to a type with logos switched off; a caller
    cannot and need not tell those apart.
    """
    if not cards:
        return {}
    type_keys = {c.type for c in cards if c.type}
    if not type_keys:
        return {}
    allowed_types = set(
        (
            await db.execute(
                select(CardType.key).where(
                    CardType.key.in_(type_keys),
                    CardType.allow_card_logo.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    if not allowed_types:
        return {}
    candidate_ids = [c.id for c in cards if c.type in allowed_types]
    if not candidate_ids:
        return {}
    rows = await db.execute(
        select(CardLogo.card_id, CardLogo.updated_at).where(CardLogo.card_id.in_(candidate_ids))
    )
    return {card_id: updated_at for card_id, updated_at in rows.all()}
