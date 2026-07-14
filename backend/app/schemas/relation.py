from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class RelationCreate(BaseModel):
    type: str
    source_id: str
    target_id: str
    attributes: dict | None = None
    description: str | None = None


class RelationUpdate(BaseModel):
    attributes: dict | None = None
    description: str | None = None


class CardRef(BaseModel):
    id: str
    type: str
    name: str
    subtype: str | None = None

    model_config = {"from_attributes": True}


class RelationResponse(BaseModel):
    id: str
    type: str
    source_id: str
    target_id: str
    source: CardRef | None = None
    target: CardRef | None = None
    attributes: dict | None = None
    description: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


# ----------------------------------------------------------------------------
# Bulk-import schemas — see `backend/app/schemas/card.py` for the equivalent
# card-side schemas. Source/target refs accept either a resolved `id` (when
# the importer has just created the card) or a `(type, parent_path, name)`
# tuple resolved server-side via `CardResolver`.
# ----------------------------------------------------------------------------


class RelationRefInput(BaseModel):
    """Either a resolved UUID or a name+path tuple. Exactly one of `id` or
    (`type` + `name`) must be supplied."""

    id: str | None = None
    type: str | None = None
    parent_path: list[str] | None = None
    name: str | None = None


class RelationBulkOperation(BaseModel):
    """One row of a bulk-relation request."""

    row_index: int
    action: Literal["upsert", "delete"] = "upsert"
    type: str  # relation type key
    source: RelationRefInput
    target: RelationRefInput
    attributes: dict | None = None
    description: str | None = None


class RelationBulkRequest(BaseModel):
    operations: list[RelationBulkOperation] = Field(..., min_length=1, max_length=5000)
    # When true, run every validator and resolver, then roll back instead of
    # committing — used by the MCP server's `upsert_relations_bulk` tool to
    # surface a preview before the agent confirms the write.
    dry_run: bool = False


class RelationBulkResult(BaseModel):
    row_index: int
    status: Literal["upserted", "deleted", "noop", "failed"]
    relation_id: str | None = None
    error: str | None = None


class RelationBulkResponse(BaseModel):
    results: list[RelationBulkResult]
    upserted: int
    deleted: int
    failed: int
    dry_run: bool = False
