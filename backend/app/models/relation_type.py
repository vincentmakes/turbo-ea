from __future__ import annotations

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class RelationType(Base, UUIDMixin, TimestampMixin):
    """Configurable metamodel: defines an allowed relation between two card types."""

    __tablename__ = "relation_types"

    # Built-in TEA keys are short (``relAppToBC``, …) but the migration
    # apply pipeline materialises custom source relation types using the
    # source's native name as the key. LeanIX in particular surfaces
    # synthetic concatenated names like ``proposedSolutionToApp…`` that
    # exceed 100 chars, so TEXT — source-agnostic, mirrors the staging
    # treatment in migration 097.
    key: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    reverse_label: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    source_type_key: Mapped[str] = mapped_column(String(100), nullable=False)
    target_type_key: Mapped[str] = mapped_column(String(100), nullable=False)
    cardinality: Mapped[str] = mapped_column(String(10), default="n:m")  # "1:1", "1:n", "n:m"
    attributes_schema: Mapped[list] = mapped_column(JSONB, default=list)
    built_in: Mapped[bool] = mapped_column(Boolean, default=True)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    translations: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    source_visible: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    source_mandatory: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    target_visible: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    target_mandatory: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
