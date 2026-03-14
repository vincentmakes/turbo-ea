"""ArchLens native models — vendor analysis, hierarchy, duplicates, modernization, runs."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class ArchLensVendorAnalysis(UUIDMixin, TimestampMixin, Base):
    """AI-categorised vendor with app counts and cost data."""

    __tablename__ = "archlens_vendor_analysis"

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


class ArchLensVendorHierarchy(UUIDMixin, TimestampMixin, Base):
    """Canonical vendor hierarchy: vendor -> product -> platform -> module."""

    __tablename__ = "archlens_vendor_hierarchy"

    canonical_name: Mapped[str] = mapped_column(String(500), unique=True)
    vendor_type: Mapped[str] = mapped_column(String(50), default="vendor")
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("archlens_vendor_hierarchy.id", ondelete="SET NULL"),
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


class ArchLensDuplicateCluster(UUIDMixin, TimestampMixin, Base):
    """Functional duplicate cluster detected by AI."""

    __tablename__ = "archlens_duplicate_clusters"

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


class ArchLensModernization(UUIDMixin, TimestampMixin, Base):
    """Modernization assessment for a card or duplicate cluster."""

    __tablename__ = "archlens_modernization_assessments"

    target_type: Mapped[str] = mapped_column(String(100))
    cluster_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("archlens_duplicate_clusters.id", ondelete="SET NULL"),
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


class ArchLensAnalysisRun(UUIDMixin, TimestampMixin, Base):
    """A single analysis execution record with cached results."""

    __tablename__ = "archlens_analysis_runs"

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
