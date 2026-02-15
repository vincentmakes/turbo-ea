from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class SsoInvitation(Base, UUIDMixin, TimestampMixin):
    """Pre-assigned SSO invitation. Admins invite users by email with a specific role.
    When the user logs in via SSO, this role is applied instead of the default 'viewer'.
    Invitations do not expire."""

    __tablename__ = "sso_invitations"

    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="viewer")  # admin/bpm_admin/member/viewer
    invited_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
