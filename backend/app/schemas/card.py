from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_validator

# M-1: Limits for JSONB dict fields to prevent memory exhaustion
_MAX_DICT_KEYS = 200
_MAX_DICT_DEPTH = 5
_MAX_DICT_STR_LEN = 50_000  # max total serialised size in characters


def _check_depth(obj: Any, current: int = 0) -> int:
    """Return the maximum nesting depth of a dict/list structure."""
    if current > _MAX_DICT_DEPTH:
        return current
    if isinstance(obj, dict):
        if not obj:
            return current
        return max(_check_depth(v, current + 1) for v in obj.values())
    if isinstance(obj, list):
        if not obj:
            return current
        return max(_check_depth(v, current + 1) for v in obj)
    return current


def _validate_jsonb_dict(v: dict | None, field_name: str) -> dict | None:
    if v is None:
        return v
    if len(v) > _MAX_DICT_KEYS:
        msg = f"{field_name} exceeds maximum of {_MAX_DICT_KEYS} keys"
        raise ValueError(msg)
    if _check_depth(v) > _MAX_DICT_DEPTH:
        msg = f"{field_name} exceeds maximum nesting depth of {_MAX_DICT_DEPTH}"
        raise ValueError(msg)
    # Rough size check via repr length
    if len(repr(v)) > _MAX_DICT_STR_LEN:
        msg = f"{field_name} exceeds maximum serialised size"
        raise ValueError(msg)
    return v


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

    @field_validator("lifecycle")
    @classmethod
    def validate_lifecycle(cls, v: dict | None) -> dict | None:
        return _validate_jsonb_dict(v, "lifecycle")

    @field_validator("attributes")
    @classmethod
    def validate_attributes(cls, v: dict | None) -> dict | None:
        return _validate_jsonb_dict(v, "attributes")


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

    @field_validator("lifecycle")
    @classmethod
    def validate_lifecycle(cls, v: dict | None) -> dict | None:
        return _validate_jsonb_dict(v, "lifecycle")

    @field_validator("attributes")
    @classmethod
    def validate_attributes(cls, v: dict | None) -> dict | None:
        return _validate_jsonb_dict(v, "attributes")


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
