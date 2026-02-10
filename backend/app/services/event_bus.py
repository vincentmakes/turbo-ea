from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event


class EventBus:
    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue] = []

    async def publish(
        self,
        event_type: str,
        data: dict[str, Any],
        db: AsyncSession | None = None,
        fact_sheet_id: uuid.UUID | None = None,
        user_id: uuid.UUID | None = None,
    ) -> None:
        if db:
            event = Event(
                fact_sheet_id=fact_sheet_id,
                user_id=user_id,
                event_type=event_type,
                data=data,
            )
            db.add(event)
            await db.flush()

        message = {
            "event": event_type,
            "data": data,
            "fact_sheet_id": str(fact_sheet_id) if fact_sheet_id else None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        dead: list[asyncio.Queue] = []
        for q in self._subscribers:
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self._subscribers.remove(q)

    async def subscribe(self) -> AsyncGenerator[str, None]:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._subscribers.append(q)
        try:
            while True:
                msg = await q.get()
                yield f"data: {json.dumps(msg, default=str)}\n\n"
        finally:
            if q in self._subscribers:
                self._subscribers.remove(q)


event_bus = EventBus()
