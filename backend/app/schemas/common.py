from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class StakeholderCreate(BaseModel):
    user_id: str
    role: str  # responsible/accountable/observer


class CommentCreate(BaseModel):
    content: str
    parent_id: str | None = None


class CommentUpdate(BaseModel):
    content: str


class CommentResponse(BaseModel):
    id: str
    card_id: str
    user_id: str
    user_display_name: str | None = None
    content: str
    parent_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    replies: list[CommentResponse] = []

    model_config = {"from_attributes": True}


class TodoCreate(BaseModel):
    description: str
    assigned_to: str | None = None
    due_date: str | None = None


class TodoUpdate(BaseModel):
    description: str | None = None
    status: str | None = None
    assigned_to: str | None = None
    due_date: str | None = None


class TodoResponse(BaseModel):
    id: str
    card_id: str | None = None
    description: str
    status: str
    assigned_to: str | None = None
    assignee_name: str | None = None
    created_by: str | None = None
    due_date: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class DocumentCreate(BaseModel):
    name: str
    url: str | None = None
    type: str = "link"


class DocumentResponse(BaseModel):
    id: str
    card_id: str
    name: str
    url: str | None = None
    type: str
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class TagGroupCreate(BaseModel):
    name: str
    description: str | None = None
    mode: str = "multi"
    mandatory: bool = False


class TagCreate(BaseModel):
    name: str
    color: str | None = None


class TagGroupResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    mode: str
    mandatory: bool
    tags: list[TagResponse] = []

    model_config = {"from_attributes": True}


class TagResponse(BaseModel):
    id: str
    name: str
    color: str | None = None
    tag_group_id: str

    model_config = {"from_attributes": True}


class BookmarkCreate(BaseModel):
    name: str
    card_type: str | None = None
    filters: dict | None = None
    columns: list | None = None
    sort: dict | None = None
    is_default: bool = False


class BookmarkUpdate(BaseModel):
    name: str | None = None
    card_type: str | None = None
    filters: dict | None = None
    columns: list | None = None
    sort: dict | None = None
    is_default: bool | None = None


class BookmarkResponse(BaseModel):
    id: str
    name: str
    card_type: str | None = None
    filters: dict | None = None
    columns: list | None = None
    sort: dict | None = None
    is_default: bool
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class EventResponse(BaseModel):
    id: str
    card_id: str | None = None
    user_id: str | None = None
    user_display_name: str | None = None
    event_type: str
    data: dict | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class WebPortalCreate(BaseModel):
    name: str
    slug: str
    description: str | None = None
    card_type: str
    filters: dict | None = None
    display_fields: list | None = None
    card_config: dict | None = None
    is_published: bool = False


class WebPortalUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
    description: str | None = None
    card_type: str | None = None
    filters: dict | None = None
    display_fields: list | None = None
    card_config: dict | None = None
    is_published: bool | None = None


class SavedReportCreate(BaseModel):
    name: str
    description: str | None = None
    report_type: str
    config: dict
    thumbnail: str | None = None
    visibility: str = "private"
    shared_with: list[str] | None = None


class SavedReportUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    config: dict | None = None
    thumbnail: str | None = None
    visibility: str | None = None
    shared_with: list[str] | None = None


# Fix forward refs
TagGroupResponse.model_rebuild()
CommentResponse.model_rebuild()
