from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel

# ── Fact Sheet reference (lightweight) ──────────────────────────


class FSRef(BaseModel):
    id: str
    type: str
    name: str

    model_config = {"from_attributes": True}


# ── Transformation Template ────────────────────────────────────


class TransformationTemplateResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    target_fact_sheet_type: str
    is_predefined: bool
    is_hidden: bool = False
    implied_impacts_schema: list = []
    required_fields: list = []

    model_config = {"from_attributes": True}


# ── Impact ──────────────────────────────────────────────────────


class ImpactCreate(BaseModel):
    impact_type: str
    action: str
    source_fact_sheet_id: str | None = None
    target_fact_sheet_id: str | None = None
    field_name: str | None = None
    field_value: dict | list | str | int | float | bool | None = None
    relation_type: str | None = None
    is_implied: bool = False
    execution_order: int = 0


class ImpactUpdate(BaseModel):
    impact_type: str | None = None
    action: str | None = None
    source_fact_sheet_id: str | None = None
    target_fact_sheet_id: str | None = None
    field_name: str | None = None
    field_value: dict | list | str | int | float | bool | None = None
    relation_type: str | None = None
    is_disabled: bool | None = None
    execution_order: int | None = None


class ImpactResponse(BaseModel):
    id: str
    transformation_id: str
    impact_type: str
    action: str
    source_fact_sheet_id: str | None = None
    target_fact_sheet_id: str | None = None
    source_fact_sheet: FSRef | None = None
    target_fact_sheet: FSRef | None = None
    field_name: str | None = None
    field_value: dict | list | str | int | float | bool | None = None
    relation_type: str | None = None
    is_implied: bool
    is_disabled: bool = False
    execution_order: int

    model_config = {"from_attributes": True}


# ── Transformation ──────────────────────────────────────────────


class TransformationCreate(BaseModel):
    name: str
    initiative_id: str
    template_id: str | None = None
    status: str = "draft"
    completion_date: date | None = None
    # Template-specific fields for implied impact generation
    template_fields: dict | None = None


class TransformationUpdate(BaseModel):
    name: str | None = None
    status: str | None = None
    completion_date: date | None = None


class UserRef(BaseModel):
    id: str
    display_name: str | None = None

    model_config = {"from_attributes": True}


class TemplateRef(BaseModel):
    id: str
    name: str
    target_fact_sheet_type: str

    model_config = {"from_attributes": True}


class TransformationResponse(BaseModel):
    id: str
    name: str
    initiative_id: str
    initiative: FSRef | None = None
    template_id: str | None = None
    template: TemplateRef | None = None
    status: str
    completion_date: date | None = None
    created_by: str | None = None
    updated_by: str | None = None
    creator: UserRef | None = None
    impacts: list[ImpactResponse] = []
    impact_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class TransformationListResponse(BaseModel):
    items: list[TransformationResponse]
    total: int


# ── Milestone ───────────────────────────────────────────────────


class MilestoneCreate(BaseModel):
    initiative_id: str
    name: str
    target_date: date
    description: str | None = None


class MilestoneUpdate(BaseModel):
    name: str | None = None
    target_date: date | None = None
    description: str | None = None


class MilestoneResponse(BaseModel):
    id: str
    initiative_id: str
    initiative: FSRef | None = None
    name: str
    target_date: date
    description: str | None = None
    inherited: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}
