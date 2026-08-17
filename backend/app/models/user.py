from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin

DEFAULT_NOTIFICATION_PREFERENCES = {
    "in_app": {
        "todo_assigned": True,
        "task_assigned": True,
        "card_updated": True,
        "comment_added": True,
        "approval_status_changed": True,
        "soaw_sign_requested": True,
        "soaw_signed": True,
        "survey_request": True,
        "app_update_available": True,
        "app_updated": True,
        "extension_available": True,
        "extension_update_available": True,
    },
    "email": {
        "todo_assigned": True,
        "task_assigned": True,
        "card_updated": False,
        "comment_added": False,
        "approval_status_changed": False,
        "soaw_sign_requested": True,
        "soaw_signed": True,
        "survey_request": True,
        "app_update_available": False,
        # Off by default like the app-update notice: useful in the bell, not
        # worth an inbox. Unlike ``app_updated`` these go only to the handful of
        # ``admin.manage_extensions`` holders, so email stays a real opt-in
        # rather than a mass mailing — hence no IN_APP_ONLY_TYPES entry.
        "extension_available": False,
        "extension_update_available": False,
    },
}

DEFAULT_UI_PREFERENCES = {
    "dashboard_default_tab": "overview",
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
    password_reset_token: Mapped[str | None] = mapped_column(
        String(128), nullable=True, unique=True, index=True
    )
    password_reset_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    notification_preferences: Mapped[dict | None] = mapped_column(
        JSONB, default=lambda: DEFAULT_NOTIFICATION_PREFERENCES.copy()
    )
    ui_preferences: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    locale: Mapped[str] = mapped_column(String(10), default="en", server_default="en")

    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # M5: Account lockout after failed login attempts
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Time-boxed accounts (control-plane rescue access): past this moment the
    # account is rejected by get_current_user and deactivated by the hourly loop.
    access_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
