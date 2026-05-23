from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class MutationBatchOpen(BaseModel):
    """Open a batch before a mutating tool wrapper performs writes."""

    tool_name: str = Field(..., min_length=1, max_length=100)
    dry_run: bool = False


class MutationBatchCommit(BaseModel):
    """Close a batch after the wrapper's underlying writes complete."""

    summary: dict[str, Any] | None = None
    confirm_token: str | None = Field(default=None, max_length=64)


class MutationBatchOut(BaseModel):
    id: UUID
    tool_name: str
    actor_user_id: UUID | None
    actor_display_name: str | None = None
    origin: str
    dry_run: bool
    confirm_token: str | None = None
    summary: dict[str, Any] | None = None
    created_at: datetime
    committed_at: datetime | None

    model_config = {"from_attributes": True}


class MutationBatchEvent(BaseModel):
    id: UUID
    event_type: str
    data: dict[str, Any] | None
    card_id: UUID | None
    user_id: UUID | None
    user_display_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class MutationBatchHistory(BaseModel):
    """Response for ``GET /mutation-batches/{id}/events`` — the batch
    metadata plus every event emitted under it, in chronological order."""

    batch: MutationBatchOut
    events: list[MutationBatchEvent]


class MutationBatchListPage(BaseModel):
    """Paginated response for ``GET /mutation-batches``. Mirrors the
    ``{items, total, page, page_size}`` envelope used by ``GET /cards``
    and the rest of the paginated read endpoints."""

    items: list[MutationBatchOut]
    total: int
    page: int
    page_size: int
