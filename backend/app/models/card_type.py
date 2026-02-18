from __future__ import annotations

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin, TimestampMixin


class CardType(Base, UUIDMixin, TimestampMixin):
    """Configurable metamodel: defines a card type with its field schema."""

    __tablename__ = "card_types"

    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str] = mapped_column(String(100), default="category")
    color: Mapped[str] = mapped_column(String(20), default="#1976d2")
    category: Mapped[str | None] = mapped_column(String(100))  # free-text layer label, not enum
    has_hierarchy: Mapped[bool] = mapped_column(Boolean, default=False)
    subtypes: Mapped[list | None] = mapped_column(JSONB, default=list)  # [{key, label}]
    fields_schema: Mapped[list] = mapped_column(JSONB, default=list)
    stakeholder_roles: Mapped[list | None] = mapped_column(JSONB, default=list)  # [{key, label}]
    section_config: Mapped[dict | None] = mapped_column(JSONB, default=dict)  # {sectionKey: {defaultExpanded, hidden}}
    built_in: Mapped[bool] = mapped_column(Boolean, default=True)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
