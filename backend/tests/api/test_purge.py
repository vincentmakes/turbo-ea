"""Integration tests for the archived card purge loop.

Runs the loop's own body (``_purge_archived_cards_once`` in ``app.main``)
against a PostgreSQL test database: cards archived past the retention
window are permanently deleted together with their relations, and the
admin's retention setting is honoured.
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
    """The production purge body, run once with no retention setting stored
    (so the 30-day default applies). ``None`` would mean "purge disabled"."""
    from app.main import _purge_archived_cards_once

    return await _purge_archived_cards_once(db)


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

    async def test_purge_self_heals_stranded_children(self, db, purge_env):
        """An ACTIVE child whose parent is being purged should survive with parent_id=NULL.

        This protects against historical data created before the child-strategy
        feature shipped (where archive could leave children pointing at an
        archived parent and the self-FK would block the delete at purge time).
        """
        parent = await create_card(
            db,
            card_type="Application",
            name="Old Parent",
            status="ARCHIVED",
            user_id=purge_env["user"].id,
        )
        parent.archived_at = datetime.now(timezone.utc) - timedelta(days=45)
        child = await create_card(
            db,
            card_type="Application",
            name="Surviving Child",
            parent_id=parent.id,
            user_id=purge_env["user"].id,
        )
        await db.flush()

        count = await _run_purge(db)
        assert count == 1

        # Parent gone.
        parent_row = (
            await db.execute(select(Card).where(Card.id == parent.id))
        ).scalar_one_or_none()
        assert parent_row is None
        # Child survived with parent_id cleared.
        child_row = (await db.execute(select(Card).where(Card.id == child.id))).scalar_one()
        assert child_row.parent_id is None
        assert child_row.status == "ACTIVE"

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


class TestArchivePurgeCutoff:
    """Unit tests for the pure retention-window helper (no DB)."""

    def test_zero_retention_disables_purge(self):
        from app.main import _archive_purge_cutoff

        now = datetime.now(timezone.utc)
        assert _archive_purge_cutoff(0, now) is None

    def test_none_retention_disables_purge(self):
        from app.main import _archive_purge_cutoff

        now = datetime.now(timezone.utc)
        assert _archive_purge_cutoff(None, now) is None

    def test_negative_retention_disables_purge(self):
        from app.main import _archive_purge_cutoff

        now = datetime.now(timezone.utc)
        assert _archive_purge_cutoff(-5, now) is None

    def test_positive_retention_returns_cutoff(self):
        from app.main import _archive_purge_cutoff

        now = datetime.now(timezone.utc)
        assert _archive_purge_cutoff(30, now) == now - timedelta(days=30)


class TestRetentionSetting:
    """The window comes from ``general_settings.archiveRetentionDays``."""

    async def _settings(self, db, days):
        from app.models.app_settings import AppSettings

        db.add(AppSettings(id="default", general_settings={"archiveRetentionDays": days}))
        await db.flush()

    async def _archived(self, db, env, name, days_ago):
        card = await create_card(
            db, card_type="Application", name=name, status="ARCHIVED", user_id=env["user"].id
        )
        card.archived_at = datetime.now(timezone.utc) - timedelta(days=days_ago)
        await db.flush()
        return card

    async def test_zero_keeps_archived_cards_forever(self, db, purge_env):
        from app.main import _purge_archived_cards_once

        await self._settings(db, 0)
        old = await self._archived(db, purge_env, "Ancient", 400)
        assert await _purge_archived_cards_once(db) is None
        assert (await db.execute(select(Card).where(Card.id == old.id))).scalar_one_or_none()

    async def test_a_custom_window_moves_the_cutoff(self, db, purge_env):
        from app.main import _purge_archived_cards_once

        await self._settings(db, 10)
        gone = await self._archived(db, purge_env, "Eleven days", 11)
        kept = await self._archived(db, purge_env, "Nine days", 9)
        assert await _purge_archived_cards_once(db) == 1
        assert (
            await db.execute(select(Card).where(Card.id == gone.id))
        ).scalar_one_or_none() is None
        assert (await db.execute(select(Card).where(Card.id == kept.id))).scalar_one_or_none()

    async def test_a_pinned_clock_decides_the_cutoff(self, db, purge_env):
        from app.main import _purge_archived_cards_once

        card = await self._archived(db, purge_env, "Borderline", 20)
        assert await _purge_archived_cards_once(db) == 0
        later = datetime.now(timezone.utc) + timedelta(days=11)
        assert await _purge_archived_cards_once(db, now=later) == 1
        assert (
            await db.execute(select(Card).where(Card.id == card.id))
        ).scalar_one_or_none() is None
