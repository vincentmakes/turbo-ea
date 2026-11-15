from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin


class DocumentImage(Base, UUIDMixin):
    """A picture shown inline in the rich text of a decision or a SoAW (migration 173).

    Immutable: a row is written once by an upload and never changed except for
    ``used_at``. The text references it as
    ``<img src="/api/v1/document-images/{kind}/{id}">``, so revisions,
    duplicates, history versions and restores share the row without copying.
    ``kind`` (``adr`` / ``soaw``) is part of the address and of the permission
    check (``ck_document_images_kind``). ``used_at`` is stamped the first time a
    save stores the picture; a row never used is purged after a grace period
    (``document_image_service.purge_unused_once``). ``data`` is deferred: only
    the picture route and the workspace exporter read the bytes.
    """

    __tablename__ = "document_images"
    __table_args__ = (
        CheckConstraint("kind IN ('adr', 'soaw')", name="ck_document_images_kind"),
        Index("ix_document_images_used_at_created_at", "used_at", "created_at"),
    )

    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(32), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, deferred=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
