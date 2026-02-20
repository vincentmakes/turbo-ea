from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class RelationCreate(BaseModel):
    type: str
    source_id: str
    target_id: str
    attributes: dict | None = None
    description: str | None = None


class RelationUpdate(BaseModel):
    attributes: dict | None = None
    description: str | None = None


class CardRef(BaseModel):
    id: str
    type: str
    name: str

    model_config = {"from_attributes": True}


class RelationResponse(BaseModel):
    id: str
    type: str
    source_id: str
    target_id: str
    source: CardRef | None = None
    target: CardRef | None = None
    attributes: dict | None = None
    description: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}
