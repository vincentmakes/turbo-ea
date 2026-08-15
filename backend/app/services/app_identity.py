"""The instance's display name — one home for a constant that had three.

Operators rename the instance under Admin → Settings (``app_title`` in
``app_settings.general_settings``); ``main.py`` hydrates it onto
``settings.APP_TITLE`` at startup, and ``PATCH /settings/app-title`` updates it
in place. Anything that puts the product name in front of a user — email
subjects, update notifications — reads it from here rather than hardcoding
"Turbo EA", so a white-labelled install stays white-labelled.

Deliberately sync and DB-free: it reads the already-hydrated runtime setting, so
it is safe to call from a notification-building path that is mid-transaction.
"""

from __future__ import annotations

from app.config import settings

DEFAULT_APP_TITLE = "Turbo EA"


def get_app_title() -> str:
    """The configured instance name, or ``"Turbo EA"`` when none is set."""
    title = (getattr(settings, "APP_TITLE", "") or "").strip()
    return title or DEFAULT_APP_TITLE
