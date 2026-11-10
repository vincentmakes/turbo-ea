from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator


class ADRLinkIn(BaseModel):
    """One typed link from the decision being saved to another decision."""

    # A decision id (that exact revision) or a reference number such as
    # ``ADR-012`` (its chain's current revision).
    decision_id: str = Field(..., min_length=1, max_length=100)
    kind: str = Field(..., min_length=1, max_length=20)
    note: str | None = Field(None, max_length=1000)

    model_config = {"extra": "forbid"}


class ADRPersonIn(BaseModel):
    """A decision maker or participant: a user of this instance, or a name."""

    user_id: str | None = None
    name: str | None = Field(None, max_length=255)

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def _exactly_one(self) -> ADRPersonIn:
        if (self.user_id is None) == (self.name is None):
            raise ValueError("Give exactly one of user_id and name")
        return self


class ADRCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    context: str | None = None
    decision: str | None = None
    consequences: str | None = None
    alternatives_considered: str | None = None
    # Decision ids or reference numbers, saved as ``relates`` links.
    related_decisions: list[str] = []
    linked_card_ids: list[str] | None = None
    links: list[ADRLinkIn] | None = Field(None, max_length=500)
    decision_makers: list[ADRPersonIn] | None = Field(None, max_length=500)
    participants: list[ADRPersonIn] | None = Field(None, max_length=500)
    decided_on: date | None = None
    effective_from: date | None = None
    valid_until: date | None = None
    change_summary: str | None = Field(None, max_length=2000)

    # Unknown keys must fail loudly: silently-ignored extras caused the
    # ADR body/link loss in #800.
    model_config = {"extra": "forbid"}


class ADRUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=500)
    context: str | None = None
    decision: str | None = None
    consequences: str | None = None
    alternatives_considered: str | None = None
    # Replaces the ``relates`` links only; hard links are left untouched.
    related_decisions: list[str] | None = None
    status: str | None = None
    # Extension attributes bag — top-level keys must be namespaced ``ext.*``.
    # Merged shallowly into the stored attributes; a key set to null is removed.
    attributes: dict | None = None
    # Replace-set semantics: the full desired link list. None = leave links
    # unchanged; [] = remove all links.
    linked_card_ids: list[str] | None = None
    # Replace-set semantics for each of these; omitted = unchanged. ``links``
    # is the full typed set and cannot be sent with ``related_decisions``.
    links: list[ADRLinkIn] | None = Field(None, max_length=500)
    decision_makers: list[ADRPersonIn] | None = Field(None, max_length=500)
    participants: list[ADRPersonIn] | None = Field(None, max_length=500)
    # An explicit null clears a date or the change summary.
    decided_on: date | None = None
    effective_from: date | None = None
    valid_until: date | None = None
    change_summary: str | None = Field(None, max_length=2000)

    model_config = {"extra": "forbid"}


class ADRSignatureRequest(BaseModel):
    user_ids: list[str] = Field(..., min_length=1)
    message: str | None = None


class ADRSignRequest(BaseModel):
    # Optional signing note: it becomes a ``sign_note`` comment in the
    # decision's discussion and the note of the ``signature`` timeline row.
    comment: str | None = Field(default=None, max_length=2000)

    model_config = {"extra": "forbid"}


class ADRReviseRequest(BaseModel):
    """Optional body of ``POST /adr/{id}/revise``."""

    # Decision ids or reference numbers of the amending decisions this
    # revision consolidates; each becomes a ``consolidates`` link.
    consolidates: list[str] = Field(default_factory=list, max_length=100)
    change_summary: str | None = Field(default=None, max_length=2000)

    model_config = {"extra": "forbid"}


class ADRRecordRequest(BaseModel):
    """Body of ``POST /adr/{id}/record``: when a decision taken outside Turbo EA was made."""

    decided_on: date
    # Defaults to ``decided_on``.
    effective_from: date | None = None

    model_config = {"extra": "forbid"}


class ADRRejectRequest(BaseModel):
    # The reason, which also opens the rejection thread (and the history row's note).
    comment: str = Field(max_length=4000)


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
    # The export's revision column: several rows of one reference import the
    # highest. A cell that is not a number counts as absent, never a 422.
    revision_number: int | Annotated[str, StringConstraints(max_length=50)] | None = None


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
