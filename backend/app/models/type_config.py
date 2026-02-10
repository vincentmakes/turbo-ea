import uuid

from sqlalchemy import Boolean, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class FactSheetTypeConfig(Base, UUIDMixin, TimestampMixin):
    """Metamodel: defines a fact sheet type with its custom fields."""
    __tablename__ = "fact_sheet_type_configs"

    key: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    icon: Mapped[str] = mapped_column(String(100), default="circle")
    color: Mapped[str] = mapped_column(String(20), default="#1976d2")

    # Custom field definitions as JSON array:
    # [{"key": "business_criticality", "label": "Business Criticality",
    #   "type": "enum", "options": [...], "section": "General",
    #   "show_in_grid": true, "required": false}, ...]
    fields: Mapped[list] = mapped_column(JSONB, default=list)

    # Built-in types can't be deleted (only fields customized)
    built_in: Mapped[bool] = mapped_column(Boolean, default=False)

    def __repr__(self) -> str:
        return f"<FactSheetTypeConfig(key={self.key!r}, label={self.label!r})>"
