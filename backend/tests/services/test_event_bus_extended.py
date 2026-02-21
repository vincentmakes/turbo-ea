"""Extended event bus tests — DB persistence and edge cases.

Tests that events published with a db session are persisted to the Event table,
and that events without a db session are not persisted. Also tests large payload
serialization and concurrent subscriber ordering.

Integration tests requiring a PostgreSQL test database.
"""

from __future__ import annotations

import asyncio
import json
import uuid

from sqlalchemy import select

from app.models.event import Event
from app.services.event_bus import EventBus
from tests.conftest import (
    create_card,
    create_card_type,
    create_role,
    create_user,
)

# ---------------------------------------------------------------------------
# DB persistence
# ---------------------------------------------------------------------------


class TestEventPersistence:
    async def test_publish_with_db_persists_event(self, db):
        """Publishing with a db session should create an Event record."""
        bus = EventBus()
        await create_role(db, key="admin", permissions={"*": True})
        user = await create_user(db, role="admin")
        await create_card_type(db, key="Application", label="Application")
        card = await create_card(db, card_type="Application", name="Test", user_id=user.id)

        await bus.publish(
            event_type="card.created",
            data={"name": "Test"},
            db=db,
            card_id=card.id,
            user_id=user.id,
        )

        result = await db.execute(
            select(Event).where(
                Event.card_id == card.id,
                Event.event_type == "card.created",
            )
        )
        event = result.scalar_one_or_none()
        assert event is not None
        assert event.event_type == "card.created"
        assert event.data["name"] == "Test"
        assert event.user_id == user.id

    async def test_publish_without_db_no_persistence(self):
        """Publishing without a db session should NOT persist anything."""
        bus = EventBus()
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        bus._subscribers.append(q)

        await bus.publish(
            event_type="notification.created",
            data={"title": "Hello"},
            # db=None (default)
        )

        # Message should still be delivered to queue
        assert not q.empty()
        msg = q.get_nowait()
        assert msg["event"] == "notification.created"

    async def test_multiple_events_persisted(self, db):
        """Multiple publishes should create multiple Event records."""
        bus = EventBus()
        await create_role(db, key="admin", permissions={"*": True})
        user = await create_user(db, role="admin")
        await create_card_type(db, key="Application", label="Application")
        card = await create_card(db, card_type="Application", name="Test", user_id=user.id)

        for i in range(3):
            await bus.publish(
                event_type=f"test.event.{i}",
                data={"index": i},
                db=db,
                card_id=card.id,
            )

        result = await db.execute(select(Event).where(Event.card_id == card.id))
        events = result.scalars().all()
        assert len(events) == 3


# ---------------------------------------------------------------------------
# Large payload serialization
# ---------------------------------------------------------------------------


class TestLargePayloads:
    async def test_nested_data_serialized(self):
        """Complex nested data should be serialized via default=str."""
        bus = EventBus()
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        bus._subscribers.append(q)

        nested_data = {
            "changes": {
                "name": {"old": "Foo", "new": "Bar"},
                "attributes": {"old": {"cost": 100}, "new": {"cost": 200}},
            },
            "tags": ["prod", "important"],
        }
        await bus.publish(event_type="card.updated", data=nested_data)

        msg = q.get_nowait()
        assert msg["data"]["changes"]["name"]["new"] == "Bar"

    async def test_uuid_in_data_serialized(self):
        """UUID values in data should be serialized to strings."""
        bus = EventBus()
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        bus._subscribers.append(q)

        test_id = uuid.uuid4()
        await bus.publish(
            event_type="test",
            data={"card_id": test_id},
        )

        msg = q.get_nowait()
        # The raw message data keeps the UUID as-is; JSON serialization handles it
        # The subscribe() method uses json.dumps(msg, default=str)
        raw = json.dumps(msg, default=str)
        assert str(test_id) in raw


# ---------------------------------------------------------------------------
# Concurrent subscriber behavior
# ---------------------------------------------------------------------------


class TestConcurrentSubscribers:
    async def test_fifo_ordering_per_subscriber(self):
        """Messages should arrive in FIFO order per subscriber."""
        bus = EventBus()
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        bus._subscribers.append(q)

        for i in range(5):
            await bus.publish(event_type=f"event.{i}", data={"order": i})

        for i in range(5):
            msg = q.get_nowait()
            assert msg["event"] == f"event.{i}"
            assert msg["data"]["order"] == i

    async def test_subscriber_removal_on_overflow(self):
        """When queue is full, subscriber should be removed (not block)."""
        bus = EventBus()
        q_small: asyncio.Queue = asyncio.Queue(maxsize=2)
        q_large: asyncio.Queue = asyncio.Queue(maxsize=256)
        bus._subscribers.append(q_small)
        bus._subscribers.append(q_large)

        # Fill small queue
        await bus.publish(event_type="e1", data={})
        await bus.publish(event_type="e2", data={})
        # This should overflow q_small and remove it
        await bus.publish(event_type="e3", data={})

        assert q_small not in bus._subscribers
        assert q_large in bus._subscribers
        # Large queue should have all 3
        assert q_large.qsize() == 3

    async def test_no_subscribers_no_error(self):
        """Publishing with no subscribers should not error."""
        bus = EventBus()
        # Should not raise
        await bus.publish(event_type="test", data={"lonely": True})

    async def test_subscribe_and_cancel_cleanup(self):
        """After cancelling subscriber, queue is removed from _subscribers."""
        bus = EventBus()

        async def sub():
            async for _ in bus.subscribe():
                pass

        task = asyncio.create_task(sub())
        await asyncio.sleep(0.05)
        assert len(bus._subscribers) == 1

        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

        assert len(bus._subscribers) == 0

    async def test_multiple_subscribe_and_publish(self):
        """Multiple concurrent subscribers each receive all messages."""
        bus = EventBus()
        received = {0: [], 1: []}

        async def sub(idx):
            async for msg in bus.subscribe():
                received[idx].append(msg)
                if len(received[idx]) >= 2:
                    break

        t0 = asyncio.create_task(sub(0))
        t1 = asyncio.create_task(sub(1))
        await asyncio.sleep(0.05)

        await bus.publish(event_type="a", data={})
        await bus.publish(event_type="b", data={})

        await asyncio.wait_for(asyncio.gather(t0, t1), timeout=2.0)

        assert len(received[0]) == 2
        assert len(received[1]) == 2
        assert received[0][0].startswith("data: ")
        assert received[1][0].startswith("data: ")
