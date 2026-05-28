"""Backfill: add Danish (``da``) to existing ``enabledLocales`` settings.

Migration 099 sits in the same release as the introduction of Danish as
the ninth supported locale. On a fresh install the
``GET /settings/enabled-locales`` endpoint falls back to the hardcoded
``SUPPORTED_LOCALES`` constant, which already includes ``da`` — Danish
appears in the language picker out of the box.

The wrinkle is existing installs where an admin has already touched
**Admin → Settings → Languages** at least once. Doing so persists the
full locale list as ``app_settings.general_settings -> enabledLocales``
(JSONB). That stored list was frozen with the 8 pre-Danish locales, so
the next request continues to mask ``da`` even though the constant now
exposes it.

This migration walks the singleton ``app_settings`` row in Python:

- if ``enabledLocales`` is a list AND ``da`` is missing, append it.
- otherwise (key absent, value not a list, or already includes ``da``),
  leave the row alone.

Idempotent: re-running is a no-op. Source-agnostic: any future locale
addition can copy this file and bump the literal.

Implementation note: an earlier attempt used a single JSONB UPDATE with
``:locale::text`` bind params and the ``?`` / ``@>`` / ``||``
operators. SQLAlchemy's named-parameter scanner inside ``text()`` and
PostgreSQL's ``?`` JSONB operator share the same lexical territory
closely enough that the combination tripped up the migration runner in
CI (the upgrade kept rolling back, sending the container into a restart
loop). The Python-side variant below sidesteps both the operator
overlap and the bind-param gymnastics — at the cost of an extra round
trip per ``app_settings`` row, which is fine because that table holds
at most one row.

Revision ID: 099
Revises: 098
Create Date: 2026-05-28
"""

import json
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "099"
down_revision: Union[str, None] = "098"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_LOCALE = "da"


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
