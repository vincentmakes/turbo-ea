"""A ServiceNow-archived card must enter the retention window like any other.

The purge loop (`app/main.py`) selects on
``status = 'ARCHIVED' AND archived_at IS NOT NULL``, so a card archived with
``status`` alone is invisible to retention and is kept forever — the 30-day
restore window the UI promises never starts and never ends.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.models.servicenow import SnowStagedRecord
from app.services.servicenow_service import SyncEngine
from tests.conftest import create_card, create_card_type, create_role, create_user


@pytest.fixture
async def env(db):
    await create_role(db, key="admin")
    user = await create_user(db, role="admin")
    await create_card_type(db, key="ITComponent", label="IT Component")
    card = await create_card(
        db, card_type="ITComponent", name="Retired Load Balancer", user_id=user.id
    )
    await db.commit()
    return {"user": user, "card": card}


def _staged(card_id, sys_id="sys-del-1"):
    return SnowStagedRecord(
        sync_run_id=None,
        mapping_id=None,
        snow_sys_id=sys_id,
        snow_data={},
        card_id=card_id,
        action="delete",
        status="pending",
    )


class _Mapping:
    """Minimal stand-in — `_apply_delete` only reads `.id` off the mapping."""

    id = None


class TestServiceNowArchiveStampsRetention:
    async def test_archive_sets_archived_at(self, db, env):
        engine = SyncEngine(db, client=None)
        card = env["card"]
        before = datetime.now(timezone.utc)

        await engine._apply_delete(_staged(card.id), _Mapping(), env["user"].id)
        await db.flush()

        assert card.status == "ARCHIVED"
        assert card.archived_at is not None, (
            "an archived card with no archived_at is invisible to the retention purge"
        )
        assert card.archived_at >= before - timedelta(seconds=5)
        assert card.updated_by == env["user"].id

    async def test_archived_card_is_visible_to_the_purge_query(self, db, env):
        """The actual predicate `_archive_purge_loop` runs, not a proxy for it."""
        engine = SyncEngine(db, client=None)
        await engine._apply_delete(_staged(env["card"].id), _Mapping(), env["user"].id)
        await db.flush()

        cutoff = datetime.now(timezone.utc) + timedelta(days=31)
        purgeable = (
            (
                await db.execute(
                    select(Card).where(
                        Card.status == "ARCHIVED",
                        Card.archived_at.isnot(None),
                        Card.archived_at <= cutoff,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert env["card"].id in [c.id for c in purgeable]

    async def test_already_archived_card_keeps_its_original_stamp(self, db, env):
        """Re-syncing a deletion must not restart the retention clock."""
        original = datetime.now(timezone.utc) - timedelta(days=20)
        env["card"].status = "ARCHIVED"
        env["card"].archived_at = original
        await db.commit()

        engine = SyncEngine(db, client=None)
        await engine._apply_delete(_staged(env["card"].id), _Mapping(), env["user"].id)
        await db.flush()

        assert env["card"].archived_at == original
