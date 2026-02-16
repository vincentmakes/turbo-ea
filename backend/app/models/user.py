from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin

DEFAULT_NOTIFICATION_PREFERENCES = {
    "in_app": {
        "todo_assigned": True,
        "card_updated": True,
        "comment_added": True,
        "approval_status_changed": True,
        "soaw_sign_requested": True,
        "soaw_signed": True,
        "survey_request": True,
    },
    "email": {
        "todo_assigned": True,
        "card_updated": False,
        "comment_added": False,
        "approval_status_changed": False,
        "soaw_sign_requested": True,
        "soaw_signed": True,
        "survey_request": True,
    },
}


class User(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(200), nullable=True)
    role: Mapped[str] = mapped_column(String(20), default="member")  # admin/bpm_admin/member/viewer
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    auth_provider: Mapped[str] = mapped_column(String(20), default="local")  # local/sso
    sso_subject_id: Mapped[str | None] = mapped_column(String(256), nullable=True, unique=True)
    password_setup_token: Mapped[str | None] = mapped_column(
        String(128), nullable=True, unique=True
    )
    notification_preferences: Mapped[dict | None] = mapped_column(
        JSONB, default=lambda: DEFAULT_NOTIFICATION_PREFERENCES.copy()
    )

    # M5: Account lockout after failed login attempts
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
