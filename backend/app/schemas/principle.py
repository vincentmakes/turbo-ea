"""Pydantic I/O for the EA principles spreadsheet import."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class PrincipleImportItem(BaseModel):
    """One spreadsheet row.

    Every column except ``title`` is optional, and ``None`` means *the sheet
    has no such column*: the importer then leaves that field as it is. An
    empty string is a deliberate blank and clears the field. ``is_active``
    and ``sort_order`` arrive as text so a bad cell fails only its own row
    instead of 422-ing the whole batch; so does ``title`` (a blank title is a
    per-row error).
    """

    row_index: int
    title: str = Field("", max_length=2000)
    reference_number: str | None = Field(None, max_length=50)
    description: str | None = None
    rationale: str | None = None
    implications: str | None = None
    is_active: str | None = Field(None, max_length=50)
    sort_order: str | None = Field(None, max_length=50)


class PrincipleImportRequest(BaseModel):
    items: list[PrincipleImportItem] = Field(..., min_length=1, max_length=1000)
    dry_run: bool = False


class PrincipleImportResult(BaseModel):
    row_index: int
    status: Literal["created", "updated", "skipped", "failed"]
    id: str | None = None
    reference_number: str | None = None
    changed_fields: list[str] = Field(default_factory=list)
    error: str | None = None
    warnings: list[str] = Field(default_factory=list)


class PrincipleImportResponse(BaseModel):
    results: list[PrincipleImportResult]
    created: int
    updated: int
    skipped: int
    failed: int
    dry_run: bool = False
