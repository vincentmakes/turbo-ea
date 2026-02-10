import enum
import uuid

from sqlalchemy import Enum, Index, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class EventType(str, enum.Enum):
    FACT_SHEET_CREATED = "fact_sheet.created"
    FACT_SHEET_UPDATED = "fact_sheet.updated"
    FACT_SHEET_ARCHIVED = "fact_sheet.archived"
    FACT_SHEET_DELETED = "fact_sheet.deleted"
    RELATION_CREATED = "relation.created"
    RELATION_UPDATED = "relation.updated"
    RELATION_DELETED = "relation.deleted"
    TAG_CREATED = "tag.created"
    TAG_ASSIGNED = "tag.assigned"
    TAG_REMOVED = "tag.removed"
    COMMENT_CREATED = "comment.created"


class Event(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "events"

    type: Mapped[EventType] = mapped_column(Enum(EventType), nullable=False, index=True)

    # The entity this event relates to
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    # Who triggered the event
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))

    # Snapshot of the data at event time
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # What changed (for updates)
    changes: Mapped[dict | None] = mapped_column(JSONB)

    __table_args__ = (
        Index("ix_events_entity", "entity_type", "entity_id"),
        Index("ix_events_created_at", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<Event(id={self.id}, type={self.type}, entity_id={self.entity_id})>"
