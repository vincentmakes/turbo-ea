"""Widen staged_records.card_type_key from VARCHAR(100) to TEXT.

``card_type_key`` doubles as the staging slot for both card type keys
(short, TEA-controlled) and relation type keys (free-form, derived from
the source platform's native name). For custom tenant-defined relation
types that aren't in the adapter's ``RELATION_MAPPING``, the staging
pipeline writes the source's raw type name straight in — and external
sources have no obligation to keep that under 100 chars. Real LeanIX
exports surface concatenated synthetic relation names like
``proposedSolutionToAppApplicationToAppToProposedSolution…`` that
overflow.

Widening to TEXT is permissive and source-agnostic — every future
adapter (Ardoq, HOPEX, BiZZdesign, Avolution Abacus, …) inherits the
headroom without revisiting this column. Mirrors migration 095's
treatment of ``source_id`` / ``parent_source_id``.

Revision ID: 097
Revises: 096
Create Date: 2026-05-28
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "097"
down_revision: Union[str, None] = "096"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "staged_records",
        "card_type_key",
        existing_type=sa.String(length=100),
        type_=sa.Text(),
        existing_nullable=True,
    )


def downgrade() -> None:
    # Truncation guard mirrors 095's pattern: any row that landed during
    # the TEXT window may legitimately exceed 100, so substring-on-cast
    # so the migration succeeds. Information loss for over-long rows is
    # accepted because they could not have existed pre-upgrade anyway.
    op.alter_column(
        "staged_records",
        "card_type_key",
        existing_type=sa.Text(),
        type_=sa.String(length=100),
        existing_nullable=True,
        postgresql_using="substring(card_type_key, 1, 100)",
    )
