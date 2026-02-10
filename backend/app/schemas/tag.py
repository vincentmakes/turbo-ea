import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class TagGroupBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None


class TagGroupCreate(TagGroupBase):
    pass


class TagGroupRead(TagGroupBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime


class TagBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    color: str | None = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    group_id: uuid.UUID


class TagCreate(TagBase):
    pass


class TagRead(TagBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
