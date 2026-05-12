"""Pydantic schemas for the GRC API (/api/v1/grc/*)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class AiInventoryDetection(BaseModel):
    """How a card was identified as AI-bearing."""

    # subtype: detected because the card's subtype is AI Agent / AI Model / MCP Server
    # semantic: LLM flagged it from name / description / vendor
    # override: admin set aiClassificationOverride="yes"
    method: Literal["subtype", "semantic", "override"]
    role: Literal["provider", "consumer", "embedded"]
    confidence: float
    subtype_match: bool
    signal: str
    detected_at: datetime | None


class AiInventoryItem(BaseModel):
    card_id: str
    card_name: str
    card_type: str
    card_subtype: str | None
    detection: AiInventoryDetection
    ai_risk_class: str | None
    ai_system_role: str | None
    ai_lifecycle_stage: str | None
    ai_intended_purpose: str | None
    ai_classification_override: str | None
    owner_count: int


class AiInventoryPage(BaseModel):
    items: list[AiInventoryItem]
    total: int
    page: int
    page_size: int


class AiInventoryKpis(BaseModel):
    total: int
    with_risk_class: int
    unclassified: int
    high_or_unacceptable: int
    unowned: int
    by_risk_class: dict[str, int]
    by_lifecycle: dict[str, int]
    last_discovered_at: datetime | None


class GrcOverview(BaseModel):
    open_risks: int
    high_or_critical_risks: int
    ai_systems_total: int
    ai_systems_unowned: int
    ai_systems_high_risk: int
    ai_systems_last_discovered_at: datetime | None


class DiscoverResponse(BaseModel):
    classified: int
    by_method: dict[str, int]
    skipped_no_ai_provider: bool
