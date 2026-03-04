"""Pydantic schemas for AI-powered card metadata suggestions."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class AiSuggestRequest(BaseModel):
    type_key: str = Field(..., min_length=1, max_length=100)
    subtype: str | None = Field(None, max_length=100)
    name: str = Field(..., min_length=1, max_length=500)
    context: str | None = Field(None, max_length=500)


class AiFieldSuggestion(BaseModel):
    value: str | float | bool | None = None
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    source: str | None = None


class AiSourceRef(BaseModel):
    url: str | None = None
    title: str | None = None


class AiSuggestResponse(BaseModel):
    suggestions: dict[str, AiFieldSuggestion] = {}
    sources: list[AiSourceRef] = []
    model: str | None = None
    search_provider: str | None = None


class PortfolioInsightsRequest(BaseModel):
    """Summary data for AI portfolio analysis."""

    total_apps: int = Field(0, ge=0)
    group_by: str | None = None
    color_by: str | None = None
    groups: list[dict] = Field(
        default_factory=list,
        description="List of {name, count, breakdown} dicts summarising each group",
    )
    attribute_summary: dict = Field(
        default_factory=dict,
        description="Aggregated attribute distributions (e.g. hostingType counts)",
    )
    lifecycle_summary: dict = Field(
        default_factory=dict,
        description="Counts by lifecycle phase",
    )
    active_filters: list[str] = Field(
        default_factory=list,
        description="Human-readable descriptions of active filters",
    )


class StructuredInsight(BaseModel):
    title: str = ""
    observation: str = ""
    recommendation: str = ""


class PortfolioInsightsResponse(BaseModel):
    insights: list[StructuredInsight | str | Any] = Field(
        default_factory=list,
        description="List of structured insight objects or plain strings",
    )
    model: str | None = None
