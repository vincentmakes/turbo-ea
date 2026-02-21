"""Integration tests for the archived card purge loop.

Tests the business logic of permanently deleting cards archived 30+ days ago,
along with their relations. Requires a PostgreSQL test database.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.models.relation import Relation
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)

_PURGE_RETENTION_DAYS = 30


@pytest.fixture
async def purge_env(db):
    """Create card types, relation types, and sample cards for purge tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    user = await create_user(db, email="admin@test.com", role="admin")
    ct = await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_relation_type(
        db,
        key="app_to_itc",
        label="App to ITC",
        source_type_key="Application",
        target_type_key="ITComponent",
    )
    return {"user": user, "ct": ct}


async def _run_purge(db):
    """Execute the purge logic (extracted from _purge_archived_cards_loop)."""
    from sqlalchemy import or_

    cutoff = datetime.now(timezone.utc) - timedelta(days=_PURGE_RETENTION_DAYS)
    result = await db.execute(
        select(Card).where(
            Card.status == "ARCHIVED",
            Card.archived_at.isnot(None),
            Card.archived_at <= cutoff,
        )
    )
    cards_to_purge = result.scalars().all()
    if not cards_to_purge:
        return 0

    purged_ids = [c.id for c in cards_to_purge]
    # Delete relations referencing these cards
    rels = await db.execute(
        select(Relation).where(
            or_(
                Relation.source_id.in_(purged_ids),
                Relation.target_id.in_(purged_ids),
            )
        )
    )
    for rel in rels.scalars().all():
        await db.delete(rel)

    for card in cards_to_purge:
        await db.delete(card)

    await db.commit()
    return len(purged_ids)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestPurgeArchivedCards:
    async def test_no_cards_to_purge(self, db, purge_env):
        """When no archived cards exist, purge does nothing."""
        count = await _run_purge(db)
        assert count == 0

    async def test_active_card_not_purged(self, db, purge_env):
        """Active cards are never purged."""
        card = await create_card(
            db, card_type="Application", name="Active Card", user_id=purge_env["user"].id
        )

        count = await _run_purge(db)
        assert count == 0

        # Card still exists
        result = await db.execute(select(Card).where(Card.id == card.id))
        assert result.scalar_one_or_none() is not None

    async def test_recently_archived_not_purged(self, db, purge_env):
        """Cards archived within the retention window are not purged."""
        card = await create_card(
            db,
            card_type="Application",
            name="Recent Archive",
            status="ARCHIVED",
            user_id=purge_env["user"].id,
        )
        card.archived_at = datetime.now(timezone.utc) - timedelta(days=10)
        await db.flush()

        count = await _run_purge(db)
        assert count == 0

        result = await db.execute(select(Card).where(Card.id == card.id))
        assert result.scalar_one_or_none() is not None

    async def test_old_archived_card_purged(self, db, purge_env):
        """Cards archived beyond the retention window are permanently deleted."""
        card = await create_card(
            db,
            card_type="Application",
            name="Old Archive",
            status="ARCHIVED",
            user_id=purge_env["user"].id,
        )
        card.archived_at = datetime.now(timezone.utc) - timedelta(days=45)
        await db.flush()

        count = await _run_purge(db)
        assert count == 1

        result = await db.execute(select(Card).where(Card.id == card.id))
        assert result.scalar_one_or_none() is None

    async def test_exactly_30_days_purged(self, db, purge_env):
        """Cards archived exactly at the cutoff should be purged (<=)."""
        card = await create_card(
            db,
            card_type="Application",
            name="Cutoff Card",
            status="ARCHIVED",
            user_id=purge_env["user"].id,
        )
        card.archived_at = datetime.now(timezone.utc) - timedelta(days=30, seconds=1)
        await db.flush()

        count = await _run_purge(db)
        assert count == 1

    async def test_relations_deleted_with_card(self, db, purge_env):
        """When a card is purged, its relations are also deleted."""
        source = await create_card(
            db,
            card_type="Application",
            name="Source App",
            status="ARCHIVED",
            user_id=purge_env["user"].id,
        )
        source.archived_at = datetime.now(timezone.utc) - timedelta(days=45)
        target = await create_card(
            db,
            card_type="ITComponent",
            name="Target ITC",
            user_id=purge_env["user"].id,
        )
        rel = await create_relation(
            db, type_key="app_to_itc", source_id=source.id, target_id=target.id
        )
        await db.flush()

        count = await _run_purge(db)
        assert count == 1

        # Relation should be gone
        result = await db.execute(select(Relation).where(Relation.id == rel.id))
        assert result.scalar_one_or_none() is None

        # Target card should still exist (it's not archived)
        result = await db.execute(select(Card).where(Card.id == target.id))
        assert result.scalar_one_or_none() is not None

    async def test_target_card_relations_deleted(self, db, purge_env):
        """Relations where the purged card is the target are also deleted."""
        source = await create_card(
            db,
            card_type="Application",
            name="Active App",
            user_id=purge_env["user"].id,
        )
        target = await create_card(
            db,
            card_type="ITComponent",
            name="Archived ITC",
            status="ARCHIVED",
            user_id=purge_env["user"].id,
        )
        target.archived_at = datetime.now(timezone.utc) - timedelta(days=45)
        rel = await create_relation(
            db, type_key="app_to_itc", source_id=source.id, target_id=target.id
        )
        await db.flush()

        count = await _run_purge(db)
        assert count == 1

        # Relation gone
        result = await db.execute(select(Relation).where(Relation.id == rel.id))
        assert result.scalar_one_or_none() is None

        # Source card still exists
        result = await db.execute(select(Card).where(Card.id == source.id))
        assert result.scalar_one_or_none() is not None

    async def test_multiple_cards_purged(self, db, purge_env):
        """Multiple old archived cards are purged in one run."""
        for i in range(3):
            card = await create_card(
                db,
                card_type="Application",
                name=f"Old Card {i}",
                status="ARCHIVED",
                user_id=purge_env["user"].id,
            )
            card.archived_at = datetime.now(timezone.utc) - timedelta(days=40 + i)
        await db.flush()

        count = await _run_purge(db)
        assert count == 3

    async def test_archived_without_timestamp_not_purged(self, db, purge_env):
        """Cards with status=ARCHIVED but no archived_at are not purged."""
        card = await create_card(
            db,
            card_type="Application",
            name="Missing Timestamp",
            status="ARCHIVED",
            user_id=purge_env["user"].id,
        )
        # archived_at is None (default)
        assert card.archived_at is None

        count = await _run_purge(db)
        assert count == 0

    async def test_mix_of_old_and_recent(self, db, purge_env):
        """Only old archived cards are purged; recent ones are kept."""
        old_card = await create_card(
            db,
            card_type="Application",
            name="Old",
            status="ARCHIVED",
            user_id=purge_env["user"].id,
        )
        old_card.archived_at = datetime.now(timezone.utc) - timedelta(days=45)

        recent_card = await create_card(
            db,
            card_type="Application",
            name="Recent",
            status="ARCHIVED",
            user_id=purge_env["user"].id,
        )
        recent_card.archived_at = datetime.now(timezone.utc) - timedelta(days=5)
        await db.flush()

        count = await _run_purge(db)
        assert count == 1

        # Old card gone
        result = await db.execute(select(Card).where(Card.id == old_card.id))
        assert result.scalar_one_or_none() is None

        # Recent card still exists
        result = await db.execute(select(Card).where(Card.id == recent_card.id))
        assert result.scalar_one_or_none() is not None
