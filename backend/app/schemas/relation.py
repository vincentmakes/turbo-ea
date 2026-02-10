import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.relation import RelationType


class RelationBase(BaseModel):
    type: RelationType
    from_fact_sheet_id: uuid.UUID
    to_fact_sheet_id: uuid.UUID
    description: str | None = None
    active_from: datetime | None = None
    active_until: datetime | None = None
    attributes: dict | None = None


class RelationCreate(RelationBase):
    pass


class RelationUpdate(BaseModel):
    description: str | None = None
    active_from: datetime | None = None
    active_until: datetime | None = None
    attributes: dict | None = None


class RelationRead(RelationBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class FactSheetSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    type: str


class RelationEnriched(RelationRead):
    """Relation with embedded fact sheet summaries for display."""

    from_fact_sheet: FactSheetSummary | None = None
    to_fact_sheet: FactSheetSummary | None = None


class RelationList(BaseModel):
    items: list[RelationEnriched]
    total: int
