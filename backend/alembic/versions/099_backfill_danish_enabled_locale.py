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

This migration walks the singleton ``app_settings`` row and:

- if ``enabledLocales`` exists AND ``da`` is not in it, appends ``"da"``
  to the list and writes it back.
- if ``enabledLocales`` exists AND the admin has explicitly disabled a
  locale (list shorter than the historical 8), still appends ``da`` —
  we treat the addition of a new built-in locale as "enabled by
  default" and let the admin disable it again from the UI if needed.
- if the key is absent, do nothing (the runtime fallback already
  exposes all of ``SUPPORTED_LOCALES``).

Idempotent: re-running is a no-op. Source-agnostic: this is the same
pattern any future locale addition can reuse — just bump the locale
literal.

Revision ID: 099
Revises: 098
Create Date: 2026-05-28
"""

from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "099"
down_revision: Union[str, None] = "098"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_LOCALE = "da"


def upgrade() -> None:
    conn = op.get_bind()
    # JSONB array append, guarded by a "not already present" check. The
    # ``general_settings`` column is JSONB and ``enabledLocales`` is the
    # nested array we care about.
    conn.execute(
        text(
            """
            UPDATE app_settings
            SET general_settings = jsonb_set(
                general_settings,
                '{enabledLocales}',
                COALESCE(general_settings -> 'enabledLocales', '[]'::jsonb)
                    || to_jsonb(:locale::text)
            )
            WHERE general_settings ? 'enabledLocales'
              AND NOT (general_settings -> 'enabledLocales' @> to_jsonb(:locale::text))
            """
        ),
        {"locale": NEW_LOCALE},
    )


def downgrade() -> None:
    # Drop ``da`` from any stored list. Mirrors upgrade's idempotency.
    conn = op.get_bind()
    conn.execute(
        text(
            """
            UPDATE app_settings
            SET general_settings = jsonb_set(
                general_settings,
                '{enabledLocales}',
                (
                    SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
                    FROM jsonb_array_elements(general_settings -> 'enabledLocales') elem
                    WHERE elem <> to_jsonb(:locale::text)
                )
            )
            WHERE general_settings ? 'enabledLocales'
              AND general_settings -> 'enabledLocales' @> to_jsonb(:locale::text)
            """
        ),
        {"locale": NEW_LOCALE},
    )
