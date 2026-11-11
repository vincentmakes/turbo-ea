from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin


class ArchitectureDecisionFileContent(Base, UUIDMixin):
    """The bytes of a file attached to architecture decisions.

    A side table so a revision (or a duplicate) can point at the same bytes as
    the decision it was made from without copying them: each decision holds its
    own ``ArchitectureDecisionFile`` row, and several rows may share one content
    row. ``data`` is deferred (precedent ``card_logo.py``): only the download
    endpoint and the workspace exporter need the bytes.
    """

    __tablename__ = "architecture_decision_file_contents"

    size: Mapped[int] = mapped_column(Integer, nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, deferred=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ArchitectureDecisionFile(Base, UUIDMixin):
    """A file attached to one architecture decision, pointing at its bytes.

    ``content_id`` is ``RESTRICT``: content is removed explicitly once no file
    row points at it any more, never by a cascade from one decision.
    """

    __tablename__ = "architecture_decision_files"

    architecture_decision_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("architecture_decisions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    content_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("architecture_decision_file_contents.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(200), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
