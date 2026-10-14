from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin


class AuditLogEntry(Base, UUIDMixin):
    """One security or administrative action: a sign-in, a failed attempt, a
    settings change, an export.

    Deliberately not an ``Event``: a card-less event auto-creates a mutation
    batch, reaches the per-user SSE stream and the dashboard's Recent Activity,
    none of which a failed login should. Written only by
    ``services/audit_log.record`` and immutable — no route updates or deletes a
    row; only the retention purge in ``app.main`` removes them. Excluded from
    workspace transfer (it is this instance's security history).
    """

    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_log_created_at", "created_at"),
        Index("ix_audit_log_category_created_at", "category", "created_at"),
        Index("ix_audit_log_action", "action"),
        Index("ix_audit_log_actor_user_id", "actor_user_id"),
        Index("ix_audit_log_subject_email", "subject_email"),
        Index("ix_audit_log_ip", "ip"),
    )
    # Fetch ``created_at`` back with the INSERT (RETURNING), so a row just
    # recorded can be serialised — and logged — without a lazy load, which an
    # async session cannot do.
    __mapper_args__ = {"eager_defaults": True}

    # ``clock_timestamp()``, not ``now()``: several rows written by one request
    # keep their write order, exactly as on ``events`` (migration 145).
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp(), nullable=False
    )
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False, default="success")
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Snapshot, so the row still names the actor after the user is deleted.
    actor_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # The account acted upon: the email a failed login tried, the user edited.
    subject_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # No foreign key: a role key, a setting key, an extension key, a user id.
    target_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    target_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    origin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    impersonator_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    impersonated_role: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Reason codes and ``{field: {old, new}}`` diffs; secrets masked at write time.
    details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    actor = relationship("User", lazy="noload")
