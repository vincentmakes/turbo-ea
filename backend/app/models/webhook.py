import enum
import uuid

from sqlalchemy import Boolean, DateTime, Enum, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class WebhookStatus(str, enum.Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    FAILED = "failed"


class Webhook(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "webhooks"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    secret: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[WebhookStatus] = mapped_column(
        Enum(WebhookStatus), default=WebhookStatus.ACTIVE, nullable=False
    )

    # Which event types to fire on (empty = all)
    event_types: Mapped[list | None] = mapped_column(JSONB)

    # Delivery tracking
    last_delivery_at: Mapped[str | None] = mapped_column(String(50))
    last_status_code: Mapped[int | None] = mapped_column()
    failure_count: Mapped[int] = mapped_column(default=0)

    def __repr__(self) -> str:
        return f"<Webhook(id={self.id}, name={self.name!r}, url={self.url!r})>"
