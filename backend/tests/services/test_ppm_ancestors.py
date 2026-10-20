"""``active_initiative_ancestors``: which Initiatives a PPM change re-runs."""

from __future__ import annotations

from app.services.ppm_ancestors import MAX_ANCESTORS, active_initiative_ancestors
from tests.conftest import create_card, create_card_type


async def _chain(db, depth: int):
    """A straight chain of ``depth`` Initiatives, root first."""
    cards = []
    parent = None
    for n in range(depth):
        parent = await create_card(
            db, card_type="Initiative", name=f"L{n + 1}", parent_id=parent.id if parent else None
        )
        cards.append(parent)
    return cards


class TestActiveInitiativeAncestors:
    async def test_nearest_parent_first(self, db):
        await create_card_type(db, key="Initiative", label="Initiative")
        root, mid, leaf = await _chain(db, 3)
        assert [c.id for c in await active_initiative_ancestors(db, leaf)] == [mid.id, root.id]
        assert [c.id for c in await active_initiative_ancestors(db, mid)] == [root.id]

    async def test_a_root_has_none(self, db):
        await create_card_type(db, key="Initiative", label="Initiative")
        (root,) = await _chain(db, 1)
        assert await active_initiative_ancestors(db, root) == []

    async def test_stops_at_an_archived_parent(self, db):
        await create_card_type(db, key="Initiative", label="Initiative")
        root = await create_card(db, card_type="Initiative", name="Root")
        gone = await create_card(
            db, card_type="Initiative", name="Gone", status="ARCHIVED", parent_id=root.id
        )
        leaf = await create_card(db, card_type="Initiative", name="Leaf", parent_id=gone.id)
        # The walk does not jump the archived card to reach the root above it.
        assert await active_initiative_ancestors(db, leaf) == []

    async def test_stops_at_a_parent_of_another_type(self, db):
        await create_card_type(db, key="Initiative", label="Initiative")
        await create_card_type(db, key="Objective", label="Objective")
        top = await create_card(db, card_type="Initiative", name="Top")
        odd = await create_card(db, card_type="Objective", name="Odd", parent_id=top.id)
        mid = await create_card(db, card_type="Initiative", name="Mid", parent_id=odd.id)
        leaf = await create_card(db, card_type="Initiative", name="Leaf", parent_id=mid.id)
        assert [c.id for c in await active_initiative_ancestors(db, leaf)] == [mid.id]

    async def test_a_cycle_ends_the_walk(self, db):
        await create_card_type(db, key="Initiative", label="Initiative")
        a = await create_card(db, card_type="Initiative", name="A")
        b = await create_card(db, card_type="Initiative", name="B", parent_id=a.id)
        a.parent_id = b.id
        await db.flush()
        assert [c.id for c in await active_initiative_ancestors(db, b)] == [a.id]
        assert [c.id for c in await active_initiative_ancestors(db, a)] == [b.id]

    async def test_a_cycle_above_the_card_ends_the_walk(self, db):
        await create_card_type(db, key="Initiative", label="Initiative")
        a = await create_card(db, card_type="Initiative", name="A")
        b = await create_card(db, card_type="Initiative", name="B", parent_id=a.id)
        a.parent_id = b.id
        leaf = await create_card(db, card_type="Initiative", name="Leaf", parent_id=b.id)
        await db.flush()
        assert [c.id for c in await active_initiative_ancestors(db, leaf)] == [b.id, a.id]

    async def test_capped(self, db):
        await create_card_type(db, key="Initiative", label="Initiative")
        cards = await _chain(db, MAX_ANCESTORS + 3)
        ancestors = await active_initiative_ancestors(db, cards[-1])
        assert len(ancestors) == MAX_ANCESTORS
        assert ancestors[0].id == cards[-2].id
        assert ancestors[-1].id == cards[-1 - MAX_ANCESTORS].id

    async def test_cap_is_six(self):
        assert MAX_ANCESTORS == 6
