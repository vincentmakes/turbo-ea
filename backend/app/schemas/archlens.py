"""Pydantic schemas for ArchLens native integration."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------


class ArchLensAnalyseRequest(BaseModel):
    """Empty body — triggers vendor or duplicate analysis."""

    pass


class ArchLensArchitectRequest(BaseModel):
    model_config = {"populate_by_name": True}

    phase: int
    requirement: str | None = None
    phase1_qa: dict | list | None = Field(None, alias="phase1QA")
    all_qa: dict | list | None = Field(None, alias="allQA")
    selected_option: dict | None = Field(None, alias="selectedOption")
    objective_ids: list[str] | None = Field(None, alias="objectiveIds")


class ArchLensDuplicateStatusUpdate(BaseModel):
    status: str  # pending | confirmed | investigating | dismissed


class ArchLensModernizeRequest(BaseModel):
    target_type: str = "Application"
    modernization_type: str = "general"


# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------


class ArchLensStatusOut(BaseModel):
    ai_configured: bool
    ready: bool


class ArchLensOverviewOut(BaseModel):
    total_cards: int = 0
    cards_by_type: dict[str, int] = {}
    quality_avg: float = 0
    quality_bronze: int = 0
    quality_silver: int = 0
    quality_gold: int = 0
    total_cost: float = 0
    vendor_count: int = 0
    duplicate_clusters: int = 0
    modernization_count: int = 0
    top_issues: list[dict] = []


class VendorAnalysisOut(BaseModel):
    id: str
    vendor_name: str
    category: str
    sub_category: str = ""
    reasoning: str = ""
    app_count: int = 0
    total_cost: float = 0
    app_list: list[str] | None = None
    analysed_at: datetime | None = None

    model_config = {"from_attributes": True}

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id(cls, v: str | uuid.UUID) -> str:
        return str(v)


class VendorHierarchyOut(BaseModel):
    id: str
    canonical_name: str
    vendor_type: str = "vendor"
    parent_id: str | None = None
    aliases: list[str] | None = None
    category: str | None = None
    sub_category: str | None = None
    app_count: int = 0
    itc_count: int = 0
    total_cost: float = 0
    confidence: float | None = None
    analysed_at: datetime | None = None

    model_config = {"from_attributes": True}

    @field_validator("id", "parent_id", mode="before")
    @classmethod
    def coerce_uuid(cls, v: str | uuid.UUID | None) -> str | None:
        return str(v) if v is not None else None


class DuplicateClusterOut(BaseModel):
    id: str
    cluster_name: str
    card_type: str
    functional_domain: str | None = None
    card_ids: list[str] | None = None
    card_names: list[str] | None = None
    evidence: str = ""
    recommendation: str = ""
    status: str = "pending"
    analysed_at: datetime | None = None

    model_config = {"from_attributes": True}

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id(cls, v: str | uuid.UUID) -> str:
        return str(v)


class ModernizationOut(BaseModel):
    id: str
    target_type: str
    cluster_id: str | None = None
    card_id: str | None = None
    card_name: str | None = None
    current_tech: str = ""
    modernization_type: str = ""
    recommendation: str = ""
    effort: str = "medium"
    priority: str = "medium"
    status: str = "pending"
    analysed_at: datetime | None = None

    model_config = {"from_attributes": True}

    @field_validator("id", "cluster_id", "card_id", mode="before")
    @classmethod
    def coerce_uuid(cls, v: str | uuid.UUID | None) -> str | None:
        return str(v) if v is not None else None


class ArchLensAnalysisRunOut(BaseModel):
    id: str
    analysis_type: str
    status: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id(cls, v: str | uuid.UUID) -> str:
        return str(v)
