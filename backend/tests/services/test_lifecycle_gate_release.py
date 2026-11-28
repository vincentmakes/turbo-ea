"""Uninstalling an extension releases its lifecycle claims (database-backed).

``lifecycle_gate.release_extension_claims`` clears every
``cards.lifecycle_maintained`` marker naming the extension, leaves the dates
and other extensions' markers alone, and — being derived maintenance — neither
re-dates the card nor owes it an event.
"""

from __future__ import annotations

from sqlalchemy import select

from app.models.event import Event
from app.services.extensions import lifecycle_gate
from tests.conftest import create_card


async def test_clears_only_that_extensions_markers_without_redating(db, card_update_sql):
    mine = await create_card(
        db,
        name="Mine",
        lifecycle={"active": "2020-01-01"},
        lifecycle_maintained={"ext": "acme-sync", "phases": ["active"]},
    )
    also_mine = await create_card(
        db, name="Also mine", lifecycle_maintained={"ext": "acme-sync", "phases": ["plan"]}
    )
    theirs = await create_card(
        db, name="Theirs", lifecycle_maintained={"ext": "other-ext", "phases": ["active"]}
    )
    plain = await create_card(db, name="Plain")
    card_update_sql.clear()

    assert await lifecycle_gate.release_extension_claims(db, "acme-sync") == 2

    for card in (mine, also_mine, theirs, plain):
        await db.refresh(card)
    assert mine.lifecycle_maintained is None
    assert also_mine.lifecycle_maintained is None
    assert mine.lifecycle == {"active": "2020-01-01"}
    assert theirs.lifecycle_maintained == {"ext": "other-ext", "phases": ["active"]}
    assert plain.lifecycle_maintained is None
    # The UPDATE ran (not a no-op) and did not move updated_at.
    assert card_update_sql.statements
    assert not card_update_sql.bumped()
    assert (await db.execute(select(Event))).scalars().all() == []


async def test_nothing_to_release_is_a_no_op(db, card_update_sql):
    await create_card(db, name="Plain")
    card_update_sql.clear()
    assert await lifecycle_gate.release_extension_claims(db, "acme-sync") == 0
    assert card_update_sql.statements == []
