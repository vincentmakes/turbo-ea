"""Demo-seed data-quality scores must come from the canonical scorer.

The demo seed inserts cards with a cheap dict-based approximation (it runs
before relations/tags exist), then replaces every score with the canonical
``calc_data_quality`` in a final pass. Without that pass, a demo-seeded
instance shows an inflated Average Completion that visibly drops after a
workspace export/import recomputes the scores honestly (discussion #667).
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.services.data_quality import calc_data_quality
from app.services.seed import seed_metamodel
from app.services.seed_demo import seed_demo_data

pytestmark = pytest.mark.asyncio


async def test_demo_seed_scores_match_canonical_scorer(db):
    await seed_metamodel(db)
    counts = await seed_demo_data(db)
    assert counts.get("cards", 0) > 0, counts

    cards = (await db.execute(select(Card).where(Card.status == "ACTIVE"))).scalars().all()
    assert cards
    mismatches = []
    for card in cards:
        canonical = await calc_data_quality(db, card)
        if card.data_quality != canonical:
            mismatches.append((card.type, card.name, card.data_quality, canonical))
    assert not mismatches, f"{len(mismatches)} cards stored non-canonical scores: {mismatches[:5]}"
