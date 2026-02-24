"""Add visible/mandatory flags to relation_types.

Each flag has source_ and target_ variants so admins can independently control
display and requirement behaviour for each side of a relation.

Revision ID: 040
Revises: 039
Create Date: 2026-02-24
"""

import sqlalchemy as sa

from alembic import op

revision = "040"
down_revision = "039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "relation_types",
        sa.Column("source_visible", sa.Boolean(), server_default="true", nullable=False),
    )
    op.add_column(
        "relation_types",
        sa.Column("source_mandatory", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column(
        "relation_types",
        sa.Column("target_visible", sa.Boolean(), server_default="true", nullable=False),
    )
    op.add_column(
        "relation_types",
        sa.Column("target_mandatory", sa.Boolean(), server_default="false", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("relation_types", "target_mandatory")
    op.drop_column("relation_types", "target_visible")
    op.drop_column("relation_types", "source_mandatory")
    op.drop_column("relation_types", "source_visible")
