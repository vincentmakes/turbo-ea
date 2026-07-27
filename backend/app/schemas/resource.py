"""Schemas for the repository-wide Resource management endpoints.

A "resource" is the union of the two card-owned attachment kinds:

- ``file`` — a row in ``file_attachments`` (a binary blob stored in Postgres)
- ``link`` — a row in ``documents`` (a URL)

Both are surfaced on a card's Resources tab; these schemas back the
repository-wide view of the same data at ``GET /resources``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

ResourceKind = Literal["file", "link"]


class ResourceOut(BaseModel):
    """One resource row in the unified list.

    ``mime_type`` / ``size`` are always ``None`` for links, ``url`` is
    always ``None`` for files. The binary payload of a file attachment is
    never included — download it from
    ``GET /file-attachments/{id}/download``.
    """

    id: UUID
    kind: ResourceKind
    card_id: UUID
    card_name: str
    card_type: str
    card_archived: bool
    name: str
    category: str | None = None
    mime_type: str | None = None
    size: int | None = None
    url: str | None = None
    created_by: UUID | None = None
    creator_name: str | None = None
    created_at: datetime | None = None


class ResourceListPage(BaseModel):
    """Paginated response for ``GET /resources``. Mirrors the
    ``{items, total, page, page_size}`` envelope used by ``GET /cards``
    and the rest of the paginated read endpoints."""

    items: list[ResourceOut]
    total: int
    page: int
    page_size: int


class ResourceBucket(BaseModel):
    """Count (and, for files, byte total) grouped by a single key.

    ``key`` is ``None`` for resources with no category / link type set.
    """

    key: str | None = None
    count: int = 0
    bytes: int = 0


class ResourceCardTypeBucket(BaseModel):
    """Per-card-type rollup — files and links counted separately."""

    key: str
    file_count: int = 0
    link_count: int = 0
    bytes: int = 0


class ResourceLargestFile(BaseModel):
    id: UUID
    name: str
    size: int
    card_id: UUID
    card_name: str


class ResourceStats(BaseModel):
    """Storage + usage rollup for ``GET /resources/stats``.

    Honours the same filters as ``GET /resources`` so the figures always
    describe what the caller is currently looking at.
    """

    file_count: int = 0
    link_count: int = 0
    total_bytes: int = 0
    card_count: int = 0
    by_category: list[ResourceBucket] = []
    by_link_type: list[ResourceBucket] = []
    by_card_type: list[ResourceCardTypeBucket] = []
    largest_files: list[ResourceLargestFile] = []


class ResourceRef(BaseModel):
    """Addresses one resource. The kind is required because file and
    link ids live in different tables and could theoretically collide."""

    kind: ResourceKind
    id: UUID


class ResourceBulkDelete(BaseModel):
    refs: list[ResourceRef] = Field(..., min_length=1, max_length=500)


class ResourceSkipped(BaseModel):
    id: UUID
    kind: ResourceKind
    reason: str


class ResourceBulkDeleteResult(BaseModel):
    """Mirrors ``POST /users/bulk-delete``: rows the caller may not touch
    are reported back rather than failing the whole request."""

    deleted: int
    skipped: list[ResourceSkipped] = []
