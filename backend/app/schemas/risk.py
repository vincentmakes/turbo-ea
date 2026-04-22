"""Pydantic schemas for the Risk register API."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.services.risk_service import (
    IMPACT_VALUES,
    LEVEL_VALUES,
    PROBABILITY_VALUES,
    STATUS_VALUES,
)

ProbabilityLiteral = Literal["very_high", "high", "medium", "low"]
ImpactLiteral = Literal["critical", "high", "medium", "low"]
LevelLiteral = Literal["critical", "high", "medium", "low"]
StatusLiteral = Literal[
    "identified",
    "analysed",
    "mitigation_planned",
    "in_progress",
    "mitigated",
    "monitoring",
    "accepted",
    "closed",
]
CategoryLiteral = Literal[
    "security",
    "compliance",
    "operational",
    "technology",
    "financial",
    "reputational",
    "strategic",
]
SourceLiteral = Literal["manual", "security_cve", "security_compliance"]
RoleLiteral = Literal["affected", "contributing", "owner_of_control"]


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------


class RiskCreate(BaseModel):
    """Manual risk creation payload."""

    title: str = Field(..., min_length=1, max_length=500)
    description: str = ""
    category: CategoryLiteral = "operational"
    initial_probability: ProbabilityLiteral = "medium"
    initial_impact: ImpactLiteral = "medium"
    mitigation: str | None = None
    owner_id: str | None = None
    target_resolution_date: date | None = None
    card_ids: list[str] = Field(default_factory=list)


class RiskUpdate(BaseModel):
    """Partial risk update. Derived ``initial_level`` / ``residual_level``
    are re-computed server-side and ignored here.
    """

    title: str | None = Field(default=None, max_length=500)
    description: str | None = None
    category: CategoryLiteral | None = None

    initial_probability: ProbabilityLiteral | None = None
    initial_impact: ImpactLiteral | None = None

    mitigation: str | None = None
    residual_probability: ProbabilityLiteral | None = None
    residual_impact: ImpactLiteral | None = None

    owner_id: str | None = None
    target_resolution_date: date | None = None
    status: StatusLiteral | None = None
    acceptance_rationale: str | None = None


class RiskPromoteRequest(BaseModel):
    """Overrides for the promote-from-finding endpoints. All optional."""

    title: str | None = None
    description: str | None = None
    category: CategoryLiteral | None = None
    initial_probability: ProbabilityLiteral | None = None
    initial_impact: ImpactLiteral | None = None
    mitigation: str | None = None
    owner_id: str | None = None
    target_resolution_date: date | None = None


class RiskCardLinkRequest(BaseModel):
    card_ids: list[str]
    role: RoleLiteral = "affected"


# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------


class RiskCardLinkOut(BaseModel):
    card_id: str
    card_name: str
    card_type: str
    role: RoleLiteral


class RiskOut(BaseModel):
    id: str
    reference: str
    title: str
    description: str
    category: CategoryLiteral
    source_type: SourceLiteral
    source_ref: str | None

    initial_probability: ProbabilityLiteral
    initial_impact: ImpactLiteral
    initial_level: LevelLiteral

    mitigation: str | None = None
    residual_probability: ProbabilityLiteral | None = None
    residual_impact: ImpactLiteral | None = None
    residual_level: LevelLiteral | None = None

    owner_id: str | None = None
    owner_name: str | None = None
    target_resolution_date: date | None = None

    status: StatusLiteral
    acceptance_rationale: str | None = None
    accepted_by: str | None = None
    accepted_at: datetime | None = None

    created_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    cards: list[RiskCardLinkOut] = Field(default_factory=list)


class RiskListPage(BaseModel):
    items: list[RiskOut]
    total: int
    page: int
    page_size: int


class RiskMetricsOut(BaseModel):
    total: int = 0
    by_status: dict[str, int] = Field(default_factory=dict)
    by_level: dict[str, int] = Field(default_factory=dict)
    by_category: dict[str, int] = Field(default_factory=dict)
    overdue: int = 0
    created_this_month: int = 0
    initial_matrix: list[list[int]] = Field(default_factory=list)
    residual_matrix: list[list[int]] = Field(default_factory=list)


# Public vocabularies so the frontend can keep label keys aligned.
RiskVocabularies = {
    "probability": list(PROBABILITY_VALUES),
    "impact": list(IMPACT_VALUES),
    "level": list(LEVEL_VALUES),
    "status": list(STATUS_VALUES),
}
