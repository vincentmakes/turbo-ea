from __future__ import annotations

import copy
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin

# Canonical registry of every notification type the backend emits.
#
# Before this existed the type list was maintained by hand in four places that
# had already drifted apart: the preference defaults below, the preferences
# dialog's own array, the bell's icon map, and a comment on ``notifications.type``.
# Fourteen of the twenty-six emitted types appeared in none of them, so they were
# invisible in the UI and fell through to whatever the code's implicit default
# happened to be. The specs here are the single source of truth: the defaults
# dict is derived from them, ``notification_service`` resolves opt-ins against
# them, and the dialog renders its rows from them (served by
# ``GET /users/me/notification-preferences``).
#
# Adding a notification type means adding a spec here — and, for anything
# ``user_configurable``, a ``preferences.<camelCaseKey>`` label in the
# ``notifications`` i18n namespace for all supported locales.


@dataclass(frozen=True)
class NotificationTypeSpec:
    """How one notification type behaves across delivery channels.

    ``in_app_default`` / ``email_default`` are the fallbacks used when a user's
    stored preferences carry no entry for this type — which is the normal case
    for every type added after the account was created. Extension-delivered
    channels have no per-type default: they are **always** opt-in-off, so a
    newly installed extension can never start delivering on its own.
    """

    key: str
    #: Shown in the bell unless the user turns it off.
    in_app_default: bool = True
    #: Emailed unless the user turns it on. Ignored when ``in_app_only``.
    email_default: bool = False
    #: Never leaves the bell — no email, and no extension channel either.
    #: ``app_updated`` fans out to *every* active user on every upgrade, so any
    #: outbound channel would turn a patch release into a mass mailing.
    in_app_only: bool = False
    #: Email always sends and the switch renders on and disabled. A survey
    #: invitation that only lands in the bell is an invitation nobody answers.
    email_locked: bool = False
    #: Offered in the preferences dialog. ``False`` keeps a type out of the UI
    #: *and* off every extension channel — the posture for security alerts the
    #: recipient must not be able to mute.
    user_configurable: bool = True


#: Every type passed to ``create_notification`` anywhere in the backend.
#:
#: Ordered as the preferences dialog presents them: personal work first, then
#: documents and approvals, then landscape-wide and administrative notices.
NOTIFICATION_TYPE_SPECS: tuple[NotificationTypeSpec, ...] = (
    # --- personal work ---
    NotificationTypeSpec("todo_assigned", email_default=True),
    NotificationTypeSpec("task_assigned", email_default=True),
    NotificationTypeSpec("survey_request", email_default=True, email_locked=True),
    # --- cards ---
    NotificationTypeSpec("card_updated"),
    NotificationTypeSpec("comment_added"),
    NotificationTypeSpec("approval_status_changed"),
    # --- statements of architecture work ---
    NotificationTypeSpec("soaw_sign_requested", email_default=True),
    NotificationTypeSpec("soaw_signed", email_default=True),
    NotificationTypeSpec("soaw_sign_recalled"),
    NotificationTypeSpec("soaw_rejected"),
    # --- architecture decision records ---
    NotificationTypeSpec("adr_sign_requested"),
    NotificationTypeSpec("adr_signed"),
    NotificationTypeSpec("adr_sign_recalled"),
    NotificationTypeSpec("adr_rejected"),
    # --- process flow approvals ---
    NotificationTypeSpec("process_flow_approval_requested"),
    NotificationTypeSpec("process_flow_approved"),
    NotificationTypeSpec("process_flow_rejected"),
    NotificationTypeSpec("process_flow_withdrawn"),
    # --- risk and compliance ---
    NotificationTypeSpec("risk_assigned"),
    NotificationTypeSpec("risk_status_changed"),
    NotificationTypeSpec("security_scan_complete"),
    # --- instance and extension notices ---
    NotificationTypeSpec("app_update_available"),
    NotificationTypeSpec("app_updated", in_app_only=True),
    NotificationTypeSpec("extension_available"),
    NotificationTypeSpec("extension_update_available"),
    # A message an installed extension sends to named people through the
    # SDK notification bridge — "a rule you set up fired", "a sync needs
    # your attention". One generic type on purpose: core owns the registry
    # the preferences dialog renders from, so an extension can address
    # people but never invent a type nobody can switch off.
    NotificationTypeSpec("extension_notice"),
    # Rescue access is a security alert: ops.py emails it unconditionally and
    # the recipient must not be able to mute the record of it, so it is kept
    # out of the dialog and off every extension channel.
    NotificationTypeSpec("ops_rescue_access", user_configurable=False),
)

NOTIFICATION_TYPE_SPECS_BY_KEY: dict[str, NotificationTypeSpec] = {
    spec.key: spec for spec in NOTIFICATION_TYPE_SPECS
}

#: Seed for a new account, and the fallback when a row predates the column.
#: Derived so it can never drift from the specs. ``in_app_only`` types are
#: deliberately absent from ``email`` — that absence is the shape the API has
#: always returned.
DEFAULT_NOTIFICATION_PREFERENCES = {
    "in_app": {spec.key: spec.in_app_default for spec in NOTIFICATION_TYPE_SPECS},
    "email": {
        spec.key: spec.email_default for spec in NOTIFICATION_TYPE_SPECS if not spec.in_app_only
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
        JSONB, default=lambda: copy.deepcopy(DEFAULT_NOTIFICATION_PREFERENCES)
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
