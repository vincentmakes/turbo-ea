from __future__ import annotations

from sqlalchemy import Boolean, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin

DEFAULT_NOTIFICATION_PREFERENCES = {
    "in_app": {
        "todo_assigned": True,
        "fact_sheet_updated": True,
        "comment_added": True,
        "quality_seal_changed": True,
        "soaw_sign_requested": True,
        "soaw_signed": True,
        "survey_request": True,
    },
    "email": {
        "todo_assigned": True,
        "fact_sheet_updated": False,
        "comment_added": False,
        "quality_seal_changed": False,
        "soaw_sign_requested": True,
        "soaw_signed": True,
        "survey_request": True,
    },
}


class User(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="member")  # admin/bpm_admin/member/viewer
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notification_preferences: Mapped[dict | None] = mapped_column(
        JSONB, default=lambda: DEFAULT_NOTIFICATION_PREFERENCES.copy()
    )
