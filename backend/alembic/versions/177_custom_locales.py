"""Custom languages: the ``custom_locales`` and ``custom_locale_strings`` tables.

A custom locale is a UI language an administrator adds (one that does not ship
with the app). ``custom_locales`` holds the language itself — ``code`` (unique),
native ``name``, ``english_name`` (the name AI prompts use), ``rtl``,
``enabled`` and the transient ``translate_job`` state of the AI translation
run. ``custom_locale_strings`` holds one row per (locale, i18next namespace):
``strings`` ``{flat_key: translation}`` and ``meta`` ``{flat_key: {h, o}}`` —
the hash of the English source each translation was made from and its origin.
Its rows go with their locale (``ON DELETE CASCADE``).

Names (the unique constraints) are exactly the models' own, so a schema built
by ``create_all`` downgrades cleanly. Downgrade drops both tables.

Revision ID: 177
Revises: 176
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "177"
down_revision: Union[str, None] = "176"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LOCALES = "custom_locales"
STRINGS = "custom_locale_strings"
UNIQUE_LOCALE_NAMESPACE = "uq_custom_locale_strings_locale_ns"


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    ]


def upgrade() -> None:
    op.create_table(
        LOCALES,
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(length=10), nullable=False, unique=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("english_name", sa.String(length=100), nullable=False),
        sa.Column("rtl", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("translate_job", postgresql.JSONB(), nullable=True),
        *_timestamps(),
    )
    op.create_table(
        STRINGS,
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "locale_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("custom_locales.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("namespace", sa.String(length=50), nullable=False),
        sa.Column("strings", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("meta", postgresql.JSONB(), nullable=False, server_default="{}"),
        *_timestamps(),
        sa.UniqueConstraint("locale_id", "namespace", name=UNIQUE_LOCALE_NAMESPACE),
    )


def downgrade() -> None:
    op.drop_table(STRINGS)
    op.drop_table(LOCALES)
