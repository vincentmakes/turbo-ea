from __future__ import annotations

from sqlalchemy import Boolean, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin, TimestampMixin


class RelationType(Base, UUIDMixin, TimestampMixin):
    """Configurable metamodel: defines an allowed relation between two fact sheet types."""

    __tablename__ = "relation_types"

    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    source_type_key: Mapped[str] = mapped_column(String(100), nullable=False)
    target_type_key: Mapped[str] = mapped_column(String(100), nullable=False)
    attributes_schema: Mapped[list] = mapped_column(JSONB, default=list)
    built_in: Mapped[bool] = mapped_column(Boolean, default=True)
