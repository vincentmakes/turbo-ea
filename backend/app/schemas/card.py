from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class CardCreate(BaseModel):
    type: str
    subtype: str | None = None
    name: str
    description: str | None = None
    parent_id: str | None = None
    lifecycle: dict | None = None
    attributes: dict | None = None
    external_id: str | None = None
    alias: str | None = None


class CardUpdate(BaseModel):
    name: str | None = None
    subtype: str | None = None
    description: str | None = None
    parent_id: str | None = None
    lifecycle: dict | None = None
    attributes: dict | None = None
    status: str | None = None
    external_id: str | None = None
    alias: str | None = None


class CardBulkUpdate(BaseModel):
    ids: list[str]
    updates: CardUpdate


class TagRef(BaseModel):
    id: str
    name: str
    color: str | None = None
    group_name: str | None = None

    model_config = {"from_attributes": True}


class StakeholderRef(BaseModel):
    id: str
    user_id: str
    user_display_name: str | None = None
    user_email: str | None = None
    role: str

    model_config = {"from_attributes": True}


class CardResponse(BaseModel):
    id: str
    type: str
    subtype: str | None = None
    name: str
    description: str | None = None
    parent_id: str | None = None
    lifecycle: dict | None = None
    attributes: dict | None = None
    status: str
    approval_status: str
    data_quality: float
    external_id: str | None = None
    alias: str | None = None
    archived_at: datetime | None = None
    created_by: str | None = None
    updated_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    tags: list[TagRef] = []
    stakeholders: list[StakeholderRef] = []

    model_config = {"from_attributes": True}


class CardListResponse(BaseModel):
    items: list[CardResponse]
    total: int
    page: int
    page_size: int
