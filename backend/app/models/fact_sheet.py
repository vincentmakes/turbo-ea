import enum
import uuid

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class FactSheetType(str, enum.Enum):
    APPLICATION = "application"
    BUSINESS_CAPABILITY = "business_capability"
    BUSINESS_CONTEXT = "business_context"
    ORGANIZATION = "organization"
    OBJECTIVE = "objective"
    IT_COMPONENT = "it_component"
    TECH_CATEGORY = "tech_category"
    PROVIDER = "provider"
    INTERFACE = "interface"
    DATA_OBJECT = "data_object"
    INITIATIVE = "initiative"
    PLATFORM = "platform"


class FactSheetStatus(str, enum.Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class LifecyclePhase(str, enum.Enum):
    PLAN = "plan"
    PHASE_IN = "phase_in"
    ACTIVE = "active"
    PHASE_OUT = "phase_out"
    END_OF_LIFE = "end_of_life"


class BusinessCriticality(str, enum.Enum):
    ADMINISTRATIVE_SERVICE = "administrative_service"
    BUSINESS_OPERATIONAL = "business_operational"
    BUSINESS_CRITICAL = "business_critical"
    MISSION_CRITICAL = "mission_critical"


class Suitability(str, enum.Enum):
    UNREASONABLE = "unreasonable"
    INSUFFICIENT = "insufficient"
    APPROPRIATE = "appropriate"
    PERFECT = "perfect"


class QualitySeal(str, enum.Enum):
    APPROVED = "approved"
    BROKEN = "broken"
    NOT_APPLICABLE = "n_a"


class FactSheet(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "fact_sheets"

    name: Mapped[str] = mapped_column(String(500), nullable=False, index=True)
    display_name: Mapped[str | None] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    type: Mapped[FactSheetType] = mapped_column(Enum(FactSheetType), nullable=False, index=True)
    status: Mapped[FactSheetStatus] = mapped_column(
        Enum(FactSheetStatus), default=FactSheetStatus.ACTIVE, nullable=False
    )
    external_id: Mapped[str | None] = mapped_column(String(500), index=True)
    alias: Mapped[str | None] = mapped_column(String(500))
    quality_seal: Mapped[QualitySeal | None] = mapped_column(Enum(QualitySeal))
    completion: Mapped[float] = mapped_column(default=0.0)

    # Hierarchy (self-referencing for parent/child)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fact_sheets.id", ondelete="SET NULL"), index=True
    )

    # Lifecycle as JSON: {"plan": "2025-01-01", "phase_in": "2025-06-01", ...}
    lifecycle: Mapped[dict | None] = mapped_column(JSONB)

    # Type-specific fields stored as JSON for flexibility
    # Examples: business_criticality, technical_suitability, category, etc.
    attributes: Mapped[dict | None] = mapped_column(JSONB, default=dict)

    # Relationships
    parent: Mapped["FactSheet | None"] = relationship(
        "FactSheet",
        remote_side="FactSheet.id",
        back_populates="children",
    )
    children: Mapped[list["FactSheet"]] = relationship(
        "FactSheet",
        back_populates="parent",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_fact_sheets_type_status", "type", "status"),
        Index("ix_fact_sheets_parent_id_type", "parent_id", "type"),
    )

    def __repr__(self) -> str:
        return f"<FactSheet(id={self.id}, type={self.type}, name={self.name!r})>"
