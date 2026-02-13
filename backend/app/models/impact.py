from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class Impact(Base, UUIDMixin, TimestampMixin):
    """A granular change that a Transformation will apply when executed."""

    __tablename__ = "impacts"

    transformation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("transformations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Classification: introduction, decommissioning, rollout, withdrawal,
    # discontinuation, upgrade, replacement, migration, modification
    impact_type: Mapped[str] = mapped_column(String(50), nullable=False)
    # Operation: create_fact_sheet, archive_fact_sheet, set_field, copy_field,
    # create_relation, remove_relation, remove_all_relations,
    # set_relation_validity, set_relation_field,
    # add_tag, remove_tag, replace_tags
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    source_fact_sheet_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("fact_sheets.id", ondelete="SET NULL"),
        nullable=True,
    )
    target_fact_sheet_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("fact_sheets.id", ondelete="SET NULL"),
        nullable=True,
    )
    field_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    field_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    relation_type: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_implied: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_disabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    execution_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Relationships
    transformation = relationship("Transformation", back_populates="impacts")
    source_fact_sheet = relationship(
        "FactSheet", foreign_keys=[source_fact_sheet_id], lazy="selectin"
    )
    target_fact_sheet = relationship(
        "FactSheet", foreign_keys=[target_fact_sheet_id], lazy="selectin"
    )
