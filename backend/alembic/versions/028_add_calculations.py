"""Add calculations table for calculated fields.

Revision ID: 028
Revises: 027
Create Date: 2026-02-18
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "028"
down_revision: Union[str, None] = "027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "calculations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("target_type_key", sa.String(100), nullable=False, index=True),
        sa.Column("target_field_key", sa.String(200), nullable=False),
        sa.Column("formula", sa.Text, nullable=False),
        sa.Column("is_active", sa.Boolean, default=False),
        sa.Column("execution_order", sa.Integer, default=0),
        sa.Column("last_error", sa.Text, nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("calculations")
