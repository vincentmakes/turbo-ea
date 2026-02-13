from __future__ import annotations

from sqlalchemy import Boolean, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class TransformationTemplate(Base, UUIDMixin, TimestampMixin):
    """Predefined or custom transformation template."""

    __tablename__ = "transformation_templates"

    name: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_fact_sheet_type: Mapped[str] = mapped_column(String(100), nullable=False)
    is_predefined: Mapped[bool] = mapped_column(Boolean, default=False)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    # JSON schema defining which impacts are auto-generated
    implied_impacts_schema: Mapped[list] = mapped_column(JSONB, default=list)
    # Fields the user must fill when using this template
    required_fields: Mapped[list] = mapped_column(JSONB, default=list)
