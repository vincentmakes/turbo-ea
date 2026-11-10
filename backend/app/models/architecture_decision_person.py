from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin


class ArchitectureDecisionPerson(Base, UUIDMixin):
    """A person named on an architecture decision.

    ``part`` is ``decision_maker`` or ``participant``. ``user_id`` is set when
    the person is a user of this instance; ``name`` is always stored as a
    snapshot, so a free-text person, a deleted user or a user who did not match
    on a workspace import still reads correctly.
    """

    __tablename__ = "architecture_decision_people"

    architecture_decision_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("architecture_decisions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    part: Mapped[str] = mapped_column(String(20), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
