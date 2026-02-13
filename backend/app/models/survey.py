from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class Survey(Base, UUIDMixin, TimestampMixin):
    """Admin-created data-maintenance survey targeting fact sheet subscribers."""

    __tablename__ = "surveys"

    name: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, default="")
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(20), default="draft")
    # Statuses: draft, active, closed

    target_type_key: Mapped[str] = mapped_column(String(100), nullable=False)
    target_filters: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    # {related_type?, related_ids?, tag_ids?, attribute_filters?: [{key, op, value}]}
    target_roles: Mapped[list | None] = mapped_column(JSONB, default=list)
    # e.g. ["responsible", "technical_application_owner"]

    fields: Mapped[list | None] = mapped_column(JSONB, default=list)
    # [{key, section, label, type, options?, action: "maintain"|"confirm"}]

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    creator = relationship("User", foreign_keys=[created_by], lazy="selectin")
    responses = relationship("SurveyResponse", back_populates="survey", lazy="noload")


class SurveyResponse(Base, UUIDMixin, TimestampMixin):
    """Individual response record: one per fact-sheet + user pair in a survey."""

    __tablename__ = "survey_responses"
    __table_args__ = (
        UniqueConstraint("survey_id", "fact_sheet_id", "user_id", name="uq_survey_response"),
    )

    survey_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("surveys.id", ondelete="CASCADE"), index=True
    )
    fact_sheet_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fact_sheets.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    status: Mapped[str] = mapped_column(String(20), default="pending")
    # Statuses: pending, completed

    responses: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    # {field_key: {current_value, new_value, confirmed: bool}}

    applied: Mapped[bool] = mapped_column(Boolean, default=False)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    survey = relationship("Survey", back_populates="responses", lazy="selectin")
    fact_sheet = relationship("FactSheet", lazy="selectin")
    user = relationship("User", lazy="selectin")
