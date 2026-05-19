"""Widen LeanIX-id columns from 64 to 255 chars.

The original schema sized ``leanix_id`` for a single LeanIX UUID (36
chars). The staging code synthesises composite ids for entities the
LeanIX snapshot does not give us a stable id for — card-tag joins
(``{fs_uuid}:{tag_uuid}`` = 73), subscriptions
(``{fs_uuid}:{role_type}:{role_name}:{email}`` = 60-150), comments
(``{fs_uuid}:{iso}:{hash}`` = 60-90). All three overflowed the
original 64-char column on real-world xlsx exports.

The fix is permissive: widen to 255 across both
``leanix_staged_records`` and ``leanix_identity_map``. Existing rows
keep their content untouched.

Revision ID: 092
Revises: 091
Create Date: 2026-05-19
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "092"
down_revision: Union[str, None] = "091"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "leanix_staged_records",
        "leanix_id",
        existing_type=sa.String(length=64),
        type_=sa.String(length=255),
        existing_nullable=False,
    )
    op.alter_column(
        "leanix_staged_records",
        "parent_leanix_id",
        existing_type=sa.String(length=64),
        type_=sa.String(length=255),
        existing_nullable=True,
    )
    op.alter_column(
        "leanix_identity_map",
        "leanix_id",
        existing_type=sa.String(length=64),
        type_=sa.String(length=255),
        existing_nullable=False,
    )


def downgrade() -> None:
    # No data is at risk of truncation only if every existing value
    # already fits in 64 chars — which is not guaranteed once any
    # xlsx-driven row has landed. Use ``USING`` with substring guards
    # to keep downgrade safe-ish (loses information for over-long ids).
    op.alter_column(
        "leanix_identity_map",
        "leanix_id",
        existing_type=sa.String(length=255),
        type_=sa.String(length=64),
        existing_nullable=False,
        postgresql_using="substring(leanix_id, 1, 64)",
    )
    op.alter_column(
        "leanix_staged_records",
        "parent_leanix_id",
        existing_type=sa.String(length=255),
        type_=sa.String(length=64),
        existing_nullable=True,
        postgresql_using="substring(parent_leanix_id, 1, 64)",
    )
    op.alter_column(
        "leanix_staged_records",
        "leanix_id",
        existing_type=sa.String(length=255),
        type_=sa.String(length=64),
        existing_nullable=False,
        postgresql_using="substring(leanix_id, 1, 64)",
    )
