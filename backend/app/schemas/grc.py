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
    # «Pending review» tracks the actual EU AI Act Art. 11 / ISO 42001 6.1.4
    # obligation: an AI card needs a documented risk classification *and* a
    # documented intended purpose before the impact assessment can close.
    pending_review: int
    by_risk_class: dict[str, int]
    by_lifecycle: dict[str, int]
    last_discovered_at: datetime | None


class AiLinkedRisk(BaseModel):
    """Compact projection of a Risk Register entry that touches an AI-bearing card.

    Backs the *Risks on AI systems* cross-link panel on the AI Inventory page —
    honours the user's instinct that AI Risk is a slice of the broader Risk
    Register without burying the inventory under the Risk tab.
    """

    id: str
    reference: str
    title: str
    status: str
    initial_level: str | None
    residual_level: str | None
    affected_card_ids: list[str]
    affected_card_names: list[str]


class GrcOverview(BaseModel):
    open_risks: int
    high_or_critical_risks: int
    ai_systems_total: int
    ai_systems_unowned: int
    ai_systems_high_risk: int
    ai_systems_last_discovered_at: datetime | None
