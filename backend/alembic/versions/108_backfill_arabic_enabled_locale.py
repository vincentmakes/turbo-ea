"""Backfill: add Arabic (``ar``) to existing ``enabledLocales`` settings.

Migration 108 sits in the same release as the introduction of Arabic as
the tenth supported locale. On a fresh install the
``GET /settings/enabled-locales`` endpoint falls back to the hardcoded
``SUPPORTED_LOCALES`` constant, which already includes ``ar`` — Arabic
appears in the language picker out of the box.

The wrinkle is existing installs where an admin has already touched
**Admin → Settings → Languages** at least once. Doing so persists the
full locale list as ``app_settings.general_settings -> enabledLocales``
(JSONB). That stored list was frozen with the pre-Arabic locales, so the
next request continues to mask ``ar`` even though the constant now
exposes it.

This migration walks the singleton ``app_settings`` row in Python:

- if ``enabledLocales`` is a list AND ``ar`` is missing, append it.
- otherwise (key absent, value not a list, or already includes ``ar``),
  leave the row alone.

Idempotent: re-running is a no-op. See ``099_backfill_danish_enabled_locale``
for the rationale behind the Python-side fetch-mutate-update (it sidesteps
the ``?`` JSONB operator / ``text()`` named-parameter clash that broke an
earlier pure-SQL attempt).

Revision ID: 108
Revises: 107
Create Date: 2026-06-25
"""

import json
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "108"
down_revision: Union[str, None] = "107"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_LOCALE = "ar"


def _patched(settings: dict, *, add: bool) -> dict | None:
    """Return a copy of ``settings`` with ``NEW_LOCALE`` added or removed.

    Returns ``None`` when no change is needed so the caller can skip the
    UPDATE entirely.
    """
    locales = settings.get("enabledLocales")
    if not isinstance(locales, list):
        return None
    if add and NEW_LOCALE not in locales:
        new_locales = list(locales) + [NEW_LOCALE]
    elif not add and NEW_LOCALE in locales:
        new_locales = [loc for loc in locales if loc != NEW_LOCALE]
    else:
        return None
    return {**settings, "enabledLocales": new_locales}


def _apply(add: bool) -> None:
    conn = op.get_bind()
    rows = conn.execute(text("SELECT id, general_settings FROM app_settings")).fetchall()
    for row in rows:
        settings = row.general_settings or {}
        if not isinstance(settings, dict):
            continue
        patched = _patched(settings, add=add)
        if patched is None:
            continue
        conn.execute(
            text("UPDATE app_settings SET general_settings = CAST(:s AS jsonb) WHERE id = :id"),
            {"s": json.dumps(patched), "id": row.id},
        )


def upgrade() -> None:
    _apply(add=True)


def downgrade() -> None:
    _apply(add=False)
