"""Add users.access_expires_at + ops_request_nonces (control-plane ops API).

Revision ID: 118
Revises: 117
Create Date: 2026-07-05
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "118"
down_revision = "117"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("access_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "ops_request_nonces",
        sa.Column("nonce", sa.String(length=64), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("ops_request_nonces")
    op.drop_column("users", "access_expires_at")
