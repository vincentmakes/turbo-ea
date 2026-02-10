import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.event import EventType


class EventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: EventType
    entity_type: str
    entity_id: uuid.UUID
    user_id: uuid.UUID | None
    payload: dict
    changes: dict | None
    created_at: datetime


class EventList(BaseModel):
    items: list[EventRead]
    total: int
