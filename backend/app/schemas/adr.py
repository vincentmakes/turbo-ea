from __future__ import annotations

from datetime import datetime

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
