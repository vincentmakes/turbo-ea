"""Unit tests for the in-memory event bus (pub/sub + SSE streaming).

These tests do NOT require a database — they test the pure EventBus
class directly using asyncio tasks for concurrent subscribe/publish.
"""

from __future__ import annotations

import asyncio
import json

from app.services.event_bus import EventBus

# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------


class TestPublish:
    async def test_publish_adds_to_subscriber_queues(self):
        """Published messages should appear in all subscriber queues."""
        bus = EventBus()
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        bus._subscribers.append(q)

        await bus.publish(
            event_type="card.created",
            data={"name": "Test Card"},
        )

        assert not q.empty()
        msg = q.get_nowait()
        assert msg["event"] == "card.created"
        assert msg["data"]["name"] == "Test Card"
        assert "timestamp" in msg

    async def test_publish_to_multiple_subscribers(self):
        """All subscribers should receive the same message."""
        bus = EventBus()
        q1: asyncio.Queue = asyncio.Queue(maxsize=256)
        q2: asyncio.Queue = asyncio.Queue(maxsize=256)
        bus._subscribers.append(q1)
        bus._subscribers.append(q2)

        await bus.publish(
            event_type="card.updated",
            data={"id": "abc"},
        )

        assert not q1.empty()
        assert not q2.empty()
        assert q1.get_nowait()["event"] == "card.updated"
        assert q2.get_nowait()["event"] == "card.updated"

    async def test_publish_with_card_id(self):
        """card_id should be stringified in the message."""
        import uuid

        bus = EventBus()
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        bus._subscribers.append(q)

        card_id = uuid.uuid4()
        await bus.publish(
            event_type="card.deleted",
            data={},
            card_id=card_id,
        )

        msg = q.get_nowait()
        assert msg["card_id"] == str(card_id)

    async def test_publish_without_card_id(self):
        """card_id should be None when not provided."""
        bus = EventBus()
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        bus._subscribers.append(q)

        await bus.publish(
            event_type="notification.created",
            data={"title": "Hello"},
        )

        msg = q.get_nowait()
        assert msg["card_id"] is None

    async def test_full_queue_removes_subscriber(self):
        """Subscribers with full queues should be removed."""
        bus = EventBus()
        q: asyncio.Queue = asyncio.Queue(maxsize=1)
        bus._subscribers.append(q)

        # Fill the queue
        await bus.publish(event_type="first", data={})
        # This should overflow and remove the subscriber
        await bus.publish(event_type="second", data={})

        assert q not in bus._subscribers


# ---------------------------------------------------------------------------
# Subscribe
# ---------------------------------------------------------------------------


class TestSubscribe:
    async def test_subscribe_yields_json_messages(self):
        """subscribe() should yield SSE-formatted JSON strings."""
        bus = EventBus()
        received: list[str] = []

        async def subscriber():
            async for msg in bus.subscribe():
                received.append(msg)
                if len(received) >= 1:
                    break

        task = asyncio.create_task(subscriber())
        # Give the subscriber a moment to register
        await asyncio.sleep(0.05)

        await bus.publish(
            event_type="test.event",
            data={"key": "value"},
        )

        await asyncio.wait_for(task, timeout=2.0)

        assert len(received) == 1
        assert received[0].startswith("data: ")
        assert received[0].endswith("\n\n")

        # Parse the JSON payload
        payload = json.loads(received[0].removeprefix("data: ").strip())
        assert payload["event"] == "test.event"
        assert payload["data"]["key"] == "value"

    async def test_subscribe_cleans_up_on_cancel(self):
        """Cancelling a subscriber should remove its queue."""
        bus = EventBus()

        async def subscriber():
            async for _ in bus.subscribe():
                pass  # pragma: no cover

        task = asyncio.create_task(subscriber())
        await asyncio.sleep(0.05)

        assert len(bus._subscribers) == 1
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

        assert len(bus._subscribers) == 0


# ---------------------------------------------------------------------------
# Message format
# ---------------------------------------------------------------------------


class TestMessageFormat:
    async def test_message_contains_required_fields(self):
        """Each message should have event, data, card_id, timestamp."""
        bus = EventBus()
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        bus._subscribers.append(q)

        await bus.publish(
            event_type="relation.created",
            data={"source": "a", "target": "b"},
        )

        msg = q.get_nowait()
        assert "event" in msg
        assert "data" in msg
        assert "card_id" in msg
        assert "timestamp" in msg

    async def test_timestamp_is_iso_format(self):
        """Timestamp should be a valid ISO 8601 string."""
        from datetime import datetime

        bus = EventBus()
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        bus._subscribers.append(q)

        await bus.publish(event_type="test", data={})

        msg = q.get_nowait()
        # Should not raise
        parsed = datetime.fromisoformat(msg["timestamp"])
        assert parsed is not None
