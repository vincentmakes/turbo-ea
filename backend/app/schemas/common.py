from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.schemas.risk_mitigation_task import MAX_LEAD_TIME_DAYS, RecurrenceUnitLiteral


class StakeholderCreate(BaseModel):
    user_id: str
    role: str  # responsible/accountable/observer


class CommentCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)
    parent_id: str | None = None


class CommentUpdate(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)


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
    # Optional in-app deep link rendered on the todo (e.g. an ADR page).
    # Relative paths only ("/…") — validated in the route so a todo can
    # never carry an external URL.
    link: str | None = Field(default=None, max_length=500)
    # Recurrence (card todos only). ``recurrence_unit == "none"`` (the
    # default) creates an ordinary one-shot todo. ``lead_time_days`` is
    # optional — when omitted on a recurring todo the server picks a smart
    # per-unit default (see ``recurrence.default_lead_time_days``).
    recurrence_unit: RecurrenceUnitLiteral = "none"
    recurrence_interval: int = Field(default=1, ge=1, le=365)
    lead_time_days: int | None = Field(default=None, ge=0, le=MAX_LEAD_TIME_DAYS)


class TodoUpdate(BaseModel):
    description: str | None = None
    status: str | None = None
    assigned_to: str | None = None
    due_date: str | None = None
    recurrence_unit: RecurrenceUnitLiteral | None = None
    recurrence_interval: int | None = Field(default=None, ge=1, le=365)
    lead_time_days: int | None = Field(default=None, ge=0, le=MAX_LEAD_TIME_DAYS)


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
    series_id: str | None = None
    recurrence_unit: str = "none"
    recurrence_interval: int = 1
    lead_time_days: int = 0

    model_config = {"from_attributes": True}


class DocumentCreate(BaseModel):
    name: str
    url: str | None = None
    type: str = "link"

    @field_validator("url")
    @classmethod
    def validate_url_scheme(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        # Only allow http, https, and mailto schemes
        if not (v.startswith("http://") or v.startswith("https://") or v.startswith("mailto:")):
            raise ValueError("URL must use http://, https://, or mailto: scheme")
        return v


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
    restrict_to_types: list[str] | None = None


class TagCreate(BaseModel):
    name: str
    description: str | None = None
    color: str | None = None


class TagGroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    mode: str | None = None
    mandatory: bool | None = None
    restrict_to_types: list[str] | None = None


class TagUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
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


class BookmarkShareEntry(BaseModel):
    user_id: str
    can_edit: bool = False


class BookmarkCreate(BaseModel):
    name: str
    card_type: str | None = None
    filters: dict | None = None
    columns: list | None = None
    column_state: list | None = None
    column_filter_model: dict | None = None
    sort: dict | None = None
    is_default: bool = False
    visibility: str = "private"
    odata_enabled: bool = False
    shared_with: list[BookmarkShareEntry] | None = None


class BookmarkUpdate(BaseModel):
    name: str | None = None
    card_type: str | None = None
    filters: dict | None = None
    columns: list | None = None
    column_state: list | None = None
    column_filter_model: dict | None = None
    sort: dict | None = None
    is_default: bool | None = None
    visibility: str | None = None
    odata_enabled: bool | None = None
    shared_with: list[BookmarkShareEntry] | None = None


class BookmarkResponse(BaseModel):
    id: str
    name: str
    card_type: str | None = None
    filters: dict | None = None
    columns: list | None = None
    column_state: list | None = None
    column_filter_model: dict | None = None
    sort: dict | None = None
    is_default: bool
    visibility: str = "private"
    odata_enabled: bool = False
    owner_id: str | None = None
    owner_name: str | None = None
    is_owner: bool = True
    can_edit: bool = True
    shared_with: list[dict] | None = None
    odata_url: str | None = None
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
    access_mode: str | None = None  # "public" | "sso"; None → "public"
    allowed_email_domains: list[str] | None = None


class WebPortalUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
    description: str | None = None
    card_type: str | None = None
    filters: dict | None = None
    display_fields: list | None = None
    card_config: dict | None = None
    is_published: bool | None = None
    access_mode: str | None = None
    allowed_email_domains: list[str] | None = None


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
