from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ADRCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    context: str | None = None
    decision: str | None = None
    consequences: str | None = None
    alternatives_considered: str | None = None
    related_decisions: list[str] = []
    linked_card_ids: list[str] | None = None

    # Unknown keys must fail loudly: silently-ignored extras caused the
    # ADR body/link loss in #800.
    model_config = {"extra": "forbid"}


class ADRUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=500)
    context: str | None = None
    decision: str | None = None
    consequences: str | None = None
    alternatives_considered: str | None = None
    related_decisions: list[str] | None = None
    status: str | None = None
    # Extension attributes bag — top-level keys must be namespaced ``ext.*``.
    # Merged shallowly into the stored attributes; a key set to null is removed.
    attributes: dict | None = None
    # Replace-set semantics: the full desired link list. None = leave links
    # unchanged; [] = remove all links.
    linked_card_ids: list[str] | None = None

    model_config = {"extra": "forbid"}


class ADRSignatureRequest(BaseModel):
    user_ids: list[str] = Field(..., min_length=1)
    message: str | None = None


class ADRSignRequest(BaseModel):
    # Optional note stored on the signer's signatory entry. Previously the
    # MCP sign_adr tool sent this to a body-less endpoint and it was dropped.
    comment: str | None = Field(default=None, max_length=2000)

    model_config = {"extra": "forbid"}


class ADRRejectRequest(BaseModel):
    comment: str


class ADRCardLink(BaseModel):
    card_id: str


class ADRLinkedCard(BaseModel):
    id: str
    name: str
    type: str

    model_config = {"from_attributes": True}


class ADRResponse(BaseModel):
    id: str
    reference_number: str
    title: str
    status: str
    context: str | None = None
    decision: str | None = None
    consequences: str | None = None
    alternatives_considered: str | None = None
    related_decisions: list[str] = []
    attributes: dict = {}
    created_by: str | None = None
    creator_name: str | None = None
    signatories: list[dict] = []
    signed_at: datetime | None = None
    revision_number: int = 1
    parent_id: str | None = None
    linked_cards: list[ADRLinkedCard] = []
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class ADRImportItem(BaseModel):
    """One spreadsheet row for ``POST /adr/bulk-import``.

    ``title`` is not length-checked here so a blank or over-long title fails
    its own row instead of 422-ing the batch. The four sections arrive as
    HTML (the dialog converts plain-text cells). ``status`` is read only to
    warn that an imported decision always lands as a draft.
    """

    row_index: int
    title: str = Field("", max_length=5000)
    reference_number: str | None = Field(None, max_length=50)
    context: str | None = None
    decision: str | None = None
    consequences: str | None = None
    alternatives_considered: str | None = None
    card_names: list[str] = Field(default_factory=list, max_length=500)
    related_references: list[str] = Field(default_factory=list, max_length=500)
    status: str | None = Field(None, max_length=50)


class ADRImportRequest(BaseModel):
    items: list[ADRImportItem] = Field(..., min_length=1, max_length=1000)
    dry_run: bool = False


class ADRImportResult(BaseModel):
    row_index: int
    status: Literal["created", "skipped", "failed"]
    id: str | None = None
    reference_number: str | None = None
    error: str | None = None
    warnings: list[str] = Field(default_factory=list)


class ADRImportResponse(BaseModel):
    results: list[ADRImportResult]
    created: int
    skipped: int
    failed: int
    dry_run: bool = False


class FileAttachmentResponse(BaseModel):
    id: str
    card_id: str
    name: str
    mime_type: str
    size: int
    created_by: str | None = None
    creator_name: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}
