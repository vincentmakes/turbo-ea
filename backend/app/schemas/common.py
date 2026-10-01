from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.risk_mitigation_task import MAX_LEAD_TIME_DAYS, RecurrenceUnitLiteral


class StakeholderCreate(BaseModel):
    user_id: str
    role: str  # responsible/accountable/observer


class StakeholderBulkOperation(BaseModel):
    """One add/remove of a (card, user, role) stakeholder assignment.

    The user may be referenced by ``user_id`` or by ``user_email`` (resolved
    case-insensitively server-side) — the spreadsheet importer round-trips
    emails, the grid editor already holds ids.
    """

    row_index: int | None = None
    action: Literal["add", "remove"] = "add"
    card_id: str
    user_id: str | None = None
    user_email: str | None = None
    role: str

    @model_validator(mode="after")
    def _require_user_ref(self) -> StakeholderBulkOperation:
        if not self.user_id and not self.user_email:
            raise ValueError("Either user_id or user_email is required")
        return self


class StakeholderBulkRequest(BaseModel):
    operations: list[StakeholderBulkOperation] = Field(..., min_length=1, max_length=1000)
    dry_run: bool = False


class StakeholderBulkResult(BaseModel):
    row_index: int | None = None
    status: Literal["added", "removed", "noop", "error"]
    error: str | None = None


class StakeholderBulkResponse(BaseModel):
    results: list[StakeholderBulkResult]
    added: int
    removed: int
    failed: int
    dry_run: bool


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
    # External-tracker mirror (extension todos bridge). Read-only over REST —
    # deliberately absent from TodoCreate/TodoUpdate.
    external_ref: str | None = None
    external_url: str | None = None
    external_source: str | None = None

    model_config = {"from_attributes": True}


_ALLOWED_DOCUMENT_URL_SCHEMES = ("http://", "https://", "mailto:")


def _normalise_document_url(v: str | None) -> str | None:
    """Strip a document link's URL and require an allowed scheme.

    An empty or whitespace-only value means *no URL* and is stored as
    ``None`` — the Resources tab already sends ``null`` for an empty field,
    and on an update ``""`` is how a caller clears the URL. Anything else
    must start with ``http://``, ``https://`` or ``mailto:``; the check is
    shared by create and update so the two can never disagree (#1166).
    """
    if v is None:
        return None
    v = v.strip()
    if not v:
        return None
    if not v.startswith(_ALLOWED_DOCUMENT_URL_SCHEMES):
        raise ValueError("URL must use http://, https://, or mailto: scheme")
    return v


class DocumentCreate(BaseModel):
    name: str
    url: str | None = None
    type: str = "link"

    @field_validator("url")
    @classmethod
    def validate_url_scheme(cls, v: str | None) -> str | None:
        return _normalise_document_url(v)


class DocumentUpdate(BaseModel):
    """Partial update of a document link — omitted fields stay unchanged.

    ``url`` may be set to ``null`` (or ``""``) to clear it; ``name`` and
    ``type`` cannot be blanked.
    """

    name: str | None = None
    url: str | None = None
    type: str | None = None

    @field_validator("url")
    @classmethod
    def validate_url_scheme(cls, v: str | None) -> str | None:
        return _normalise_document_url(v)

    @field_validator("name", "type")
    @classmethod
    def validate_not_blank(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("must not be empty")
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
    view: str | None = None  # "cards" | "ppm_portfolio"; None → "cards"
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
    view: str | None = None
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
