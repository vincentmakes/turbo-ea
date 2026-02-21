from __future__ import annotations

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class RelationType(Base, UUIDMixin, TimestampMixin):
    """Configurable metamodel: defines an allowed relation between two card types."""

    __tablename__ = "relation_types"

    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    reverse_label: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    source_type_key: Mapped[str] = mapped_column(String(100), nullable=False)
    target_type_key: Mapped[str] = mapped_column(String(100), nullable=False)
    cardinality: Mapped[str] = mapped_column(String(10), default="n:m")  # "1:1", "1:n", "n:m"
    attributes_schema: Mapped[list] = mapped_column(JSONB, default=list)
    built_in: Mapped[bool] = mapped_column(Boolean, default=True)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
