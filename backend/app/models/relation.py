import enum
import uuid

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class RelationType(str, enum.Enum):
    APPLICATION_TO_BUSINESS_CAPABILITY = "application_to_business_capability"
    APPLICATION_TO_IT_COMPONENT = "application_to_it_component"
    APPLICATION_TO_ORGANIZATION = "application_to_organization"
    APPLICATION_TO_DATA_OBJECT = "application_to_data_object"
    APPLICATION_PROVIDES_INTERFACE = "application_provides_interface"
    APPLICATION_CONSUMES_INTERFACE = "application_consumes_interface"
    IT_COMPONENT_TO_PROVIDER = "it_component_to_provider"
    IT_COMPONENT_TO_TECH_CATEGORY = "it_component_to_tech_category"
    INTERFACE_TO_DATA_OBJECT = "interface_to_data_object"
    INITIATIVE_TO_APPLICATION = "initiative_to_application"
    OBJECTIVE_TO_INITIATIVE = "objective_to_initiative"
    OBJECTIVE_TO_BUSINESS_CAPABILITY = "objective_to_business_capability"
    REQUIRES = "requires"


class Relation(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "relations"

    type: Mapped[RelationType] = mapped_column(Enum(RelationType), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)

    from_fact_sheet_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("fact_sheets.id", ondelete="CASCADE"),
        nullable=False,
    )
    to_fact_sheet_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("fact_sheets.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Temporal validity
    active_from: Mapped[str | None] = mapped_column(DateTime(timezone=True))
    active_until: Mapped[str | None] = mapped_column(DateTime(timezone=True))

    # Relation-specific attributes stored as JSON
    # Examples: support_type, functional_suitability, cost, usage_type, etc.
    attributes: Mapped[dict | None] = mapped_column(JSONB, default=dict)

    # Relationships
    from_fact_sheet = relationship(
        "FactSheet",
        foreign_keys=[from_fact_sheet_id],
        lazy="joined",
    )
    to_fact_sheet = relationship(
        "FactSheet",
        foreign_keys=[to_fact_sheet_id],
        lazy="joined",
    )

    __table_args__ = (
        Index("ix_relations_from_to", "from_fact_sheet_id", "to_fact_sheet_id"),
        Index("ix_relations_type_from", "type", "from_fact_sheet_id"),
        Index("ix_relations_type_to", "type", "to_fact_sheet_id"),
    )

    def __repr__(self) -> str:
        return (
            f"<Relation(id={self.id}, type={self.type}, "
            f"from={self.from_fact_sheet_id}, to={self.to_fact_sheet_id})>"
        )
