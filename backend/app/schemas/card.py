from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

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


class CardRelationSummaryEntry(BaseModel):
    """One row of the relation-summary endpoint — counts neighbours per
    relation-type / direction so the diagram editor can render LeanIX-style
    Show Dependency / Drill-Down / Roll-Up submenus with live counts."""

    relation_type_key: str
    label: str
    direction: str  # "outgoing" or "incoming"
    peer_type_key: str | None = None
    count: int


class CardRelationSummaryHierarchy(BaseModel):
    """Hierarchy snapshot returned alongside relation counts so the diagram
    editor can enable/disable the Drill-Down + Roll-Up menu sections without
    a second fetch."""

    children_count: int
    parent_id: str | None = None
    parent_name: str | None = None
    parent_type: str | None = None


class CardRelationSummaryResponse(BaseModel):
    by_type: list[CardRelationSummaryEntry]
    hierarchy: CardRelationSummaryHierarchy


class CardTypeCount(BaseModel):
    type: str
    count: int


class CardCountsResponse(BaseModel):
    by_type: list[CardTypeCount]
    total: int


ChildStrategy = Literal["cascade", "disconnect", "reparent"]


class CardArchiveRequest(BaseModel):
    child_strategy: ChildStrategy | None = None
    related_card_ids: list[str] = Field(default_factory=list, max_length=200)
    cascade_all_related: bool = False


class CardDeleteRequest(CardArchiveRequest):
    pass


class ArchiveImpactCardRef(BaseModel):
    id: str
    name: str
    type: str
    subtype: str | None = None


class ArchiveImpactChild(ArchiveImpactCardRef):
    descendants_count: int = 0
    approval_status: str = "DRAFT"


class ArchiveImpactRelatedCard(ArchiveImpactCardRef):
    relation_id: str
    relation_type_key: str
    relation_label: str
    direction: Literal["outgoing", "incoming"]


class ArchiveImpactResponse(BaseModel):
    child_count: int
    descendant_count: int
    approved_descendant_count: int
    grandparent: ArchiveImpactCardRef | None = None
    children: list[ArchiveImpactChild]
    related_cards: list[ArchiveImpactRelatedCard]


class CardArchiveResponse(BaseModel):
    primary: CardResponse
    affected_children_ids: list[str]
    affected_related_card_ids: list[str]


class CardDeleteResponse(BaseModel):
    deleted_card_ids: list[str]
    affected_children_ids: list[str]
    affected_related_card_ids: list[str]


class CardBulkArchiveRequest(BaseModel):
    card_ids: list[str] = Field(..., min_length=1, max_length=10000)
    child_strategy: ChildStrategy | None = None
    cascade_all_related: bool = False


CardBulkSkipReason = Literal["already_archived", "not_found"]


class CardBulkSkippedEntry(BaseModel):
    card_id: str
    reason: CardBulkSkipReason


class CardBulkArchiveResponse(BaseModel):
    requested: int
    archived_card_ids: list[str]
    cascaded_card_ids: list[str]
    skipped: list[CardBulkSkippedEntry]


CardBulkDeleteSkipReason = Literal["not_found"]


class CardBulkDeleteSkippedEntry(BaseModel):
    card_id: str
    reason: CardBulkDeleteSkipReason


class CardBulkDeleteRequest(BaseModel):
    card_ids: list[str] = Field(..., min_length=1, max_length=10000)
    child_strategy: ChildStrategy | None = None
    cascade_all_related: bool = False


class CardBulkDeleteResponse(BaseModel):
    requested: int
    deleted_card_ids: list[str]
    cascaded_card_ids: list[str]
    skipped: list[CardBulkDeleteSkippedEntry]


CardBulkRestoreSkipReason = Literal["already_active", "not_found"]


class CardBulkRestoreSkippedEntry(BaseModel):
    card_id: str
    reason: CardBulkRestoreSkipReason


class CardBulkRestoreRequest(BaseModel):
    card_ids: list[str] = Field(..., min_length=1, max_length=10000)


class CardBulkRestoreResponse(BaseModel):
    requested: int
    restored_card_ids: list[str]
    skipped: list[CardBulkRestoreSkippedEntry]


class RestoreImpactPassenger(ArchiveImpactCardRef):
    role: Literal["child", "related"]


class RestoreImpactResponse(BaseModel):
    passengers: list[RestoreImpactPassenger]


class CardRestoreRequest(BaseModel):
    also_restore_card_ids: list[str] = Field(default_factory=list, max_length=200)


class CardRestoreResponse(BaseModel):
    primary: CardResponse
    restored_passenger_ids: list[str]


# ----------------------------------------------------------------------------
# Spreadsheet bulk-import schemas.
#
# Used by `POST /cards/bulk-create` and `POST /cards/resolve-refs`. Parents
# can be expressed either by UUID (legacy / same-instance round-trips) or
# by `(parent_path[], parent_name)` so the server resolves names → ids in
# one transaction. The same `(parent_path[], parent_name)` shape is reused
# for relation source/target refs.
# ----------------------------------------------------------------------------


class CardBulkCreateItem(BaseModel):
    """One row of a bulk-create request. Mirrors `CardCreate` plus an
    optional parent reference + a stable `row_index` so the caller can
    pair the response back to its spreadsheet row.

    Either `parent_id` (UUID) or `parent_ref` may be supplied — never both.
    Server-side topological sort handles parents that are themselves rows
    in the same request (referenced by `parent_ref` and the row's own
    `(parent_path, name)` identity).
    """

    row_index: int
    type: str
    subtype: str | None = None
    name: str
    description: str | None = None
    parent_id: str | None = None
    parent_path: list[str] | None = None
    parent_name: str | None = None
    lifecycle: dict | None = None
    attributes: dict | None = None
    external_id: str | None = None
    alias: str | None = None
    approval_status: str | None = None

    @field_validator("lifecycle")
    @classmethod
    def validate_lifecycle(cls, v: dict | None) -> dict | None:
        return _validate_jsonb_dict(v, "lifecycle")

    @field_validator("attributes")
    @classmethod
    def validate_attributes(cls, v: dict | None) -> dict | None:
        return _validate_jsonb_dict(v, "attributes")


class CardBulkCreateRequest(BaseModel):
    cards: list[CardBulkCreateItem] = Field(..., min_length=1, max_length=2000)


class CardBulkCreateResult(BaseModel):
    """Per-row outcome. `id` is set on success, `error` on failure."""

    row_index: int
    status: Literal["created", "failed"]
    id: str | None = None
    error: str | None = None


class CardBulkCreateResponse(BaseModel):
    results: list[CardBulkCreateResult]
    created: int
    failed: int


class CardRefInput(BaseModel):
    """One ref to resolve, with `row` / `column` echoed back so the caller
    can pin the result to the originating spreadsheet cell.

    `ref` is the user-typed string (`"NexaCore ERP"` or
    `"Sales / Customer Mgmt / CRM"`, using the same escape rules as
    `parent_path`). `type` is the expected card type for the lookup —
    inferred by the importer from the relation type's `target_type_key`
    (for relation cells) or from the row's own `type` column (for parent
    refs).
    """

    row: int
    column: str
    type: str
    ref: str


class CardRefCandidate(BaseModel):
    id: str
    path: str  # human-readable `parent_path / name` for the disambig hint


class CardRefResolveResult(BaseModel):
    row: int
    column: str
    status: Literal["resolved", "ambiguous", "missing"]
    id: str | None = None
    candidates: list[CardRefCandidate] | None = None


class CardRefResolveRequest(BaseModel):
    refs: list[CardRefInput] = Field(..., max_length=5000)


class CardRefResolveResponse(BaseModel):
    results: list[CardRefResolveResult]
