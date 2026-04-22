"""TurboLens native models — vendor analysis, hierarchy, duplicates, modernization, runs."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class TurboLensVendorAnalysis(UUIDMixin, TimestampMixin, Base):
    """AI-categorised vendor with app counts and cost data."""

    __tablename__ = "turbolens_vendor_analysis"

    vendor_name: Mapped[str] = mapped_column(String(500), unique=True)
    category: Mapped[str] = mapped_column(String(200))
    sub_category: Mapped[str] = mapped_column(String(200), default="")
    reasoning: Mapped[str] = mapped_column(Text, default="")
    app_count: Mapped[int] = mapped_column(Integer, default=0)
    total_cost: Mapped[float] = mapped_column(Float, default=0)
    app_list: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    analysed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class TurboLensVendorHierarchy(UUIDMixin, TimestampMixin, Base):
    """Canonical vendor hierarchy: vendor -> product -> platform -> module."""

    __tablename__ = "turbolens_vendor_hierarchy"

    canonical_name: Mapped[str] = mapped_column(String(500), unique=True)
    vendor_type: Mapped[str] = mapped_column(String(50), default="vendor")
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("turbolens_vendor_hierarchy.id", ondelete="SET NULL"),
        nullable=True,
    )
    aliases: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    category: Mapped[str | None] = mapped_column(String(200), nullable=True)
    sub_category: Mapped[str | None] = mapped_column(String(200), nullable=True)
    app_count: Mapped[int] = mapped_column(Integer, default=0)
    itc_count: Mapped[int] = mapped_column(Integer, default=0)
    total_cost: Mapped[float] = mapped_column(Float, default=0)
    linked_fs: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    analysed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class TurboLensDuplicateCluster(UUIDMixin, TimestampMixin, Base):
    """Functional duplicate cluster detected by AI."""

    __tablename__ = "turbolens_duplicate_clusters"

    cluster_name: Mapped[str] = mapped_column(String(500))
    card_type: Mapped[str] = mapped_column(String(100))
    functional_domain: Mapped[str | None] = mapped_column(String(500), nullable=True)
    card_ids: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    card_names: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    evidence: Mapped[str] = mapped_column(Text, default="")
    recommendation: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(50), default="pending")
    analysed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class TurboLensModernization(UUIDMixin, TimestampMixin, Base):
    """Modernization assessment for a card or duplicate cluster."""

    __tablename__ = "turbolens_modernization_assessments"

    target_type: Mapped[str] = mapped_column(String(100))
    cluster_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("turbolens_duplicate_clusters.id", ondelete="SET NULL"),
        nullable=True,
    )
    card_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="SET NULL"),
        nullable=True,
    )
    card_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    current_tech: Mapped[str] = mapped_column(Text, default="")
    modernization_type: Mapped[str] = mapped_column(String(200), default="")
    recommendation: Mapped[str] = mapped_column(Text, default="")
    effort: Mapped[str] = mapped_column(String(50), default="medium")
    priority: Mapped[str] = mapped_column(String(50), default="medium")
    status: Mapped[str] = mapped_column(String(50), default="pending")
    analysed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class TurboLensAnalysisRun(UUIDMixin, TimestampMixin, Base):
    """A single analysis execution record with cached results."""

    __tablename__ = "turbolens_analysis_runs"

    connection_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    analysis_type: Mapped[str] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(20), default="running")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    results: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )


class TurboLensCveFinding(UUIDMixin, TimestampMixin, Base):
    """A single CVE affecting a specific card (Application or ITComponent)."""

    __tablename__ = "turbolens_cve_findings"

    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("turbolens_analysis_runs.id", ondelete="CASCADE"),
    )
    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
    )
    card_type: Mapped[str] = mapped_column(String(64))
    cve_id: Mapped[str] = mapped_column(String(32))
    vendor: Mapped[str] = mapped_column(String(255), default="")
    product: Mapped[str] = mapped_column(String(255), default="")
    version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    cvss_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    cvss_vector: Mapped[str | None] = mapped_column(String(128), nullable=True)
    severity: Mapped[str] = mapped_column(String(16), default="unknown")
    attack_vector: Mapped[str | None] = mapped_column(String(16), nullable=True)
    exploitability_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    impact_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    patch_available: Mapped[bool] = mapped_column(Boolean, default=False)
    published_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_modified_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    description: Mapped[str] = mapped_column(Text, default="")
    nvd_references: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    priority: Mapped[str] = mapped_column(String(16), default="medium")
    probability: Mapped[str] = mapped_column(String(16), default="medium")
    business_impact: Mapped[str | None] = mapped_column(Text, nullable=True)
    remediation: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="open")
    # Back-link to a promoted Risk. Null until the user clicks
    # "Create risk" on this finding.
    risk_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("risks.id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = (
        Index("ix_turbolens_cve_findings_card_id_severity", "card_id", "severity"),
        Index("ix_turbolens_cve_findings_run_id", "run_id"),
        Index("ix_turbolens_cve_findings_status", "status"),
        Index("ix_turbolens_cve_findings_cve_id", "cve_id"),
        Index("ix_turbolens_cve_findings_severity", "severity"),
        Index("ix_turbolens_cve_findings_priority", "priority"),
        Index("ix_turbolens_cve_findings_risk_id", "risk_id"),
    )


class TurboLensComplianceFinding(UUIDMixin, TimestampMixin, Base):
    """A compliance gap or attestation for a given regulation."""

    __tablename__ = "turbolens_compliance_findings"

    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("turbolens_analysis_runs.id", ondelete="CASCADE"),
    )
    regulation: Mapped[str] = mapped_column(String(32))
    regulation_article: Mapped[str | None] = mapped_column(String(128), nullable=True)
    card_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        nullable=True,
    )
    scope_type: Mapped[str] = mapped_column(String(16), default="landscape")
    category: Mapped[str] = mapped_column(String(64), default="")
    requirement: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="review_needed")
    severity: Mapped[str] = mapped_column(String(16), default="info")
    gap_description: Mapped[str] = mapped_column(Text, default="")
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    remediation: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_detected: Mapped[bool] = mapped_column(Boolean, default=False)
    risk_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("risks.id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = (
        Index(
            "ix_turbolens_compliance_findings_regulation_status",
            "regulation",
            "status",
        ),
        Index("ix_turbolens_compliance_findings_card_id", "card_id"),
        Index("ix_turbolens_compliance_findings_run_id", "run_id"),
        Index("ix_turbolens_compliance_findings_risk_id", "risk_id"),
    )


class TurboLensAssessment(UUIDMixin, TimestampMixin, Base):
    """Persisted architecture assessment capturing full phase 1-5 session data."""

    __tablename__ = "turbolens_assessments"

    title: Mapped[str] = mapped_column(String(500))
    requirement: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="saved")
    session_data: Mapped[dict] = mapped_column(JSONB)
    initiative_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
