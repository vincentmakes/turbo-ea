import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.relation import RelationType


class RelationBase(BaseModel):
    type: RelationType
    from_fact_sheet_id: uuid.UUID
    to_fact_sheet_id: uuid.UUID
    description: str | None = None
    active_from: datetime | None = None
    active_until: datetime | None = None
    attributes: dict | None = None


class RelationCreate(RelationBase):
    pass


class RelationUpdate(BaseModel):
    description: str | None = None
    active_from: datetime | None = None
    active_until: datetime | None = None
    attributes: dict | None = None


class RelationRead(RelationBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class RelationList(BaseModel):
    items: list[RelationRead]
    total: int
