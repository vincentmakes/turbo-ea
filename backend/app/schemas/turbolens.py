"""Pydantic schemas for TurboLens native integration."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------


class TurboLensAnalyseRequest(BaseModel):
    """Empty body — triggers vendor or duplicate analysis."""

    pass


class TurboLensArchitectRequest(BaseModel):
    model_config = {"populate_by_name": True}

    phase: int | None = None
    requirement: str | None = None
    phase1_qa: dict | list | None = Field(None, alias="phase1QA")
    all_qa: dict | list | None = Field(None, alias="allQA")
    selected_option: dict | None = Field(None, alias="selectedOption")
    selected_recommendations: list[dict] | None = Field(None, alias="selectedRecommendations")
    selected_products: list[dict] | None = Field(None, alias="selectedProducts")
    objective_ids: list[str] | None = Field(None, alias="objectiveIds")
    selected_capabilities: list[dict] | None = Field(None, alias="selectedCapabilities")


class TurboLensDuplicateStatusUpdate(BaseModel):
    status: str  # pending | confirmed | investigating | dismissed


class TurboLensModernizeRequest(BaseModel):
    target_type: str = "Application"
    modernization_type: str = "general"


class TurboLensAssessmentCreate(BaseModel):
    """Save an architecture assessment session."""

    model_config = {"populate_by_name": True}

    title: str
    requirement: str
    session_data: dict = Field(..., alias="sessionData")


class TurboLensAssessmentUpdate(BaseModel):
    """Update an existing architecture assessment session."""

    model_config = {"populate_by_name": True}

    title: str | None = None
    requirement: str | None = None
    session_data: dict | None = Field(default=None, alias="sessionData")


class TurboLensCommitRequest(BaseModel):
    """Commit an assessment: create initiative, cards, relations, ADR."""

    model_config = {"populate_by_name": True}

    assessment_id: str = Field(..., alias="assessmentId")
    initiative_name: str = Field(..., alias="initiativeName")
    start_date: str = Field(..., alias="startDate")
    end_date: str = Field(..., alias="endDate")
    selected_card_ids: list[str] = Field(..., alias="selectedCardIds")
    selected_relation_indices: list[int] = Field(..., alias="selectedRelationIndices")
    objective_ids: list[str] = Field(default_factory=list, alias="objectiveIds")
    renamed_cards: dict[str, str] = Field(
        default_factory=dict,
        alias="renamedCards",
        description="Map of card ID → new name for cards renamed by the user",
    )


# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------


class TurboLensStatusOut(BaseModel):
    ai_configured: bool
    ready: bool
    enabled: bool = True


class TurboLensOverviewOut(BaseModel):
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


class TurboLensAnalysisRunOut(BaseModel):
    id: str
    analysis_type: str
    status: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    results: dict | None = None
    error_message: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id(cls, v: str | uuid.UUID) -> str:
        return str(v)


class TurboLensAssessmentOut(BaseModel):
    id: str
    title: str
    requirement: str
    status: str = "saved"
    session_data: dict | None = None
    initiative_id: str | None = None
    initiative_name: str | None = None
    created_by: str | None = None
    created_by_name: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}

    @field_validator("id", "initiative_id", "created_by", mode="before")
    @classmethod
    def coerce_uuid(cls, v: str | uuid.UUID | None) -> str | None:
        return str(v) if v is not None else None


# ---------------------------------------------------------------------------
# Security & Compliance
# ---------------------------------------------------------------------------


class SecurityScanRequest(BaseModel):
    """Options for an on-demand security & compliance scan."""

    regulations: list[str] | None = None
    include_itc: bool = True


class CveFindingStatusUpdate(BaseModel):
    status: Literal["open", "acknowledged", "in_progress", "mitigated", "accepted"]


class CveFindingCreate(BaseModel):
    """Body for ``POST /security/cve-findings`` — manual finding entry.

    Used by GRC analysts logging a vulnerability the NVD-driven scanner
    didn't pick up (or to seed findings in installs that haven't run a
    scan yet). The endpoint creates a synthetic "manual"
    :class:`TurboLensAnalysisRun` to satisfy the non-null ``run_id`` FK
    and persists the row with ``priority`` / ``probability`` defaulting
    to ``medium`` (manual entries skip the AI prioritisation step).
    """

    cve_id: str
    card_id: str
    severity: Literal["critical", "high", "medium", "low", "info", "unknown"]
    cvss_score: float | None = None
    attack_vector: Literal["network", "adjacent", "local", "physical"] | None = None
    patch_available: bool = False
    description: str = ""
    business_impact: str | None = None
    remediation: str | None = None
    nvd_references: list[dict] | None = None
    status: Literal["open", "acknowledged", "in_progress", "mitigated", "accepted"] = "open"


class CveFindingBulkStatusUpdate(BaseModel):
    """Body for ``PATCH /security/cve-findings/bulk``.

    Findings already promoted to a Risk (``risk_id`` non-null) are
    reported in the response's ``skipped`` list with ``reason="risk_tracked"``
    instead of being updated — the linked Risk's lifecycle is the source
    of truth in that case.
    """

    ids: list[str]
    status: Literal["open", "acknowledged", "in_progress", "mitigated", "accepted"]


class CveFindingBulkDelete(BaseModel):
    """Body for ``DELETE /security/cve-findings/bulk``."""

    ids: list[str]


class CveFindingBulkResult(BaseModel):
    """Outcome of a bulk delete or bulk status update.

    ``updated`` is the count of rows actually changed.
    ``skipped`` lists rows left untouched, each with a ``reason``
    ("not_found", "risk_tracked", …).
    """

    updated: int
    skipped: list[dict[str, str]] = []


class CveFindingOut(BaseModel):
    id: str
    run_id: str
    card_id: str
    card_name: str | None = None
    card_type: str
    cve_id: str
    vendor: str = ""
    product: str = ""
    version: str | None = None
    cvss_score: float | None = None
    cvss_vector: str | None = None
    severity: str = "unknown"
    attack_vector: str | None = None
    exploitability_score: float | None = None
    impact_score: float | None = None
    patch_available: bool = False
    published_date: date | None = None
    last_modified_date: date | None = None
    description: str = ""
    nvd_references: list[dict] | None = None
    priority: str = "medium"
    probability: str = "medium"
    business_impact: str | None = None
    remediation: str | None = None
    status: str = "open"
    risk_id: str | None = None
    risk_reference: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}

    @field_validator("id", "run_id", "card_id", "risk_id", mode="before")
    @classmethod
    def coerce_uuid(cls, v: str | uuid.UUID | None) -> str | None:
        return str(v) if v is not None else None


class ComplianceFindingOut(BaseModel):
    id: str
    run_id: str
    regulation: str
    regulation_article: str | None = None
    card_id: str | None = None
    card_name: str | None = None
    card_type: str | None = None
    card_has_ai_features: bool | None = None
    scope_type: str = "landscape"
    category: str = ""
    requirement: str = ""
    status: str = "review_needed"
    severity: str = "info"
    gap_description: str = ""
    evidence: str | None = None
    remediation: str | None = None
    ai_detected: bool = False
    risk_id: str | None = None
    risk_reference: str | None = None
    decision: str = "new"
    reviewed_by: str | None = None
    reviewer_name: str | None = None
    reviewed_at: datetime | None = None
    review_note: str | None = None
    auto_resolved: bool = False
    last_seen_run_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}

    @field_validator(
        "id",
        "run_id",
        "card_id",
        "risk_id",
        "reviewed_by",
        "last_seen_run_id",
        mode="before",
    )
    @classmethod
    def coerce_uuid(cls, v: str | uuid.UUID | None) -> str | None:
        return str(v) if v is not None else None


class ComplianceFindingCreate(BaseModel):
    """Body for ``POST /security/compliance-findings`` — manual finding entry.

    Used by auditors / GRC analysts who want to record a finding the
    scanner didn't pick up. The endpoint creates a synthetic "manual"
    :class:`TurboLensAnalysisRun` to satisfy the FK and persists a row
    with ``decision='new'`` so the lifecycle starts at the same place
    as scanner-emitted findings.
    """

    regulation: str
    regulation_article: str | None = None
    card_id: str | None = None
    category: str = ""
    requirement: str
    status: str
    severity: str
    gap_description: str = ""
    evidence: str | None = None
    remediation: str | None = None


class ComplianceFindingDecisionUpdate(BaseModel):
    """Body for ``PATCH /security/compliance-findings/{id}``.

    Users transition the decision through the compliance lifecycle
    states ``new``, ``in_review``, ``mitigated``, ``verified``,
    ``accepted`` and ``not_applicable``. Allowed transitions are
    enforced server-side by ``compliance_lifecycle_allowed``.
    ``risk_tracked`` is set automatically when a finding is promoted to
    a Risk (``POST /risks/promote/compliance/{id}``); ``auto_resolved``
    is set by the scanner when a re-scan no longer reports the finding.
    Neither is user-settable.
    """

    decision: str
    review_note: str | None = None


class ComplianceFindingBulkDelete(BaseModel):
    """Body for ``DELETE /security/compliance-findings/bulk``.

    Accepts a list of finding ids; rows the caller can't see (or that
    don't exist) are reported in the response's ``skipped`` list.
    """

    ids: list[str]


class ComplianceFindingBulkDecisionUpdate(BaseModel):
    """Body for ``PATCH /security/compliance-findings/bulk``.

    Bulk transition of multiple findings to a single new ``decision``.
    Per-row lifecycle validation still runs; rows where the transition
    isn't allowed (or that are tracked by an active Risk) are reported
    in the response's ``skipped`` list with a reason — the rest succeed.
    """

    ids: list[str]
    decision: str
    review_note: str | None = None


class ComplianceFindingBulkResult(BaseModel):
    """Outcome of a bulk delete or bulk decision update.

    ``updated`` is the count of rows the call actually changed.
    ``skipped`` lists rows that were left untouched, each with a
    ``reason`` ("not_found", "illegal_transition", "risk_tracked", …).
    """

    updated: int
    skipped: list[dict[str, str]] = []


class ComplianceFindingAiVerdict(BaseModel):
    """Body for ``POST /security/compliance-findings/{id}/ai-verdict``.

    Captures the user's verdict on the scanner's AI-detection claim and
    persists it on the impacted card's ``hasAiFeatures`` attribute.
    """

    verdict: str  # "confirmed" | "rejected"


class SecurityScanRunOut(BaseModel):
    """Summary of the latest run for a given scan type (cve / compliance)."""

    run_id: str | None = None
    status: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None
    progress: dict[str, object] | None = None
    summary: dict[str, object] | None = None


class SecurityOverviewOut(BaseModel):
    # Per-scan-type latest runs — each one reports its own progress so the
    # UI can render independent progress bars for CVE vs compliance.
    cve_run: SecurityScanRunOut = Field(default_factory=SecurityScanRunOut)
    compliance_run: SecurityScanRunOut = Field(default_factory=SecurityScanRunOut)

    total_findings: int = 0
    by_severity: dict[str, int] = Field(default_factory=dict)
    by_status: dict[str, int] = Field(default_factory=dict)
    by_probability: dict[str, int] = Field(default_factory=dict)
    risk_matrix: list[list[int]] = Field(default_factory=list)
    compliance_scores: dict[str, int] = Field(default_factory=dict)
    compliance_by_status: dict[str, dict[str, int]] = Field(default_factory=dict)
    top_critical: list[CveFindingOut] = Field(default_factory=list)


class ComplianceBundleOut(BaseModel):
    regulation: str
    label: str | None = None
    is_enabled: bool = True
    is_known: bool = True
    score: int = 0
    findings: list[ComplianceFindingOut] = Field(default_factory=list)
