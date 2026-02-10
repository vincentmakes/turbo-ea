import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.fact_sheet import FactSheetStatus, FactSheetType, QualitySeal


class FactSheetBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=500)
    type: FactSheetType
    description: str | None = None
    display_name: str | None = None
    alias: str | None = None
    external_id: str | None = None
    parent_id: uuid.UUID | None = None
    lifecycle: dict | None = None
    attributes: dict | None = None


class FactSheetCreate(FactSheetBase):
    pass


class FactSheetUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=500)
    description: str | None = None
    display_name: str | None = None
    alias: str | None = None
    status: FactSheetStatus | None = None
    external_id: str | None = None
    parent_id: uuid.UUID | None = None
    quality_seal: QualitySeal | None = None
    lifecycle: dict | None = None
    attributes: dict | None = None


class FactSheetRead(FactSheetBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: FactSheetStatus
    quality_seal: QualitySeal | None
    completion: float
    created_at: datetime
    updated_at: datetime


class FactSheetList(BaseModel):
    items: list[FactSheetRead]
    total: int
    page: int
    page_size: int
