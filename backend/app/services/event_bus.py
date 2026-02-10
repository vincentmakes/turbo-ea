import asyncio
import json
import logging
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime

from app.models.event import EventType

logger = logging.getLogger(__name__)


class EventBus:
    """In-process async event bus with SSE broadcast support."""

    def __init__(self) -> None:
        self._subscribers: dict[str, asyncio.Queue] = {}
        self._handlers: dict[EventType, list] = {}

    def register_handler(self, event_type: EventType, handler) -> None:
        if event_type not in self._handlers:
            self._handlers[event_type] = []
        self._handlers[event_type].append(handler)

    async def publish(
        self,
        event_type: EventType,
        entity_type: str,
        entity_id: uuid.UUID,
        payload: dict,
        changes: dict | None = None,
        user_id: uuid.UUID | None = None,
    ) -> dict:
        event = {
            "id": str(uuid.uuid4()),
            "type": event_type.value,
            "entity_type": entity_type,
            "entity_id": str(entity_id),
            "user_id": str(user_id) if user_id else None,
            "payload": payload,
            "changes": changes,
            "created_at": datetime.utcnow().isoformat(),
        }

        # Broadcast to SSE subscribers
        dead_subscribers = []
        for sub_id, queue in self._subscribers.items():
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                dead_subscribers.append(sub_id)
                logger.warning("Dropping events for slow subscriber %s", sub_id)

        for sub_id in dead_subscribers:
            self._subscribers.pop(sub_id, None)

        # Dispatch to registered handlers
        handlers = self._handlers.get(event_type, [])
        for handler in handlers:
            try:
                await handler(event)
            except Exception:
                logger.exception("Event handler error for %s", event_type)

        return event

    def subscribe(self) -> tuple[str, asyncio.Queue]:
        sub_id = str(uuid.uuid4())
        queue: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._subscribers[sub_id] = queue
        return sub_id, queue

    def unsubscribe(self, sub_id: str) -> None:
        self._subscribers.pop(sub_id, None)

    async def stream(self, sub_id: str, queue: asyncio.Queue) -> AsyncGenerator[str, None]:
        try:
            while True:
                event = await queue.get()
                yield f"data: {json.dumps(event)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            self.unsubscribe(sub_id)


# Global singleton
event_bus = EventBus()
