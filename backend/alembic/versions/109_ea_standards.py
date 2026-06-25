"""Create ea_standards table.

Revision ID: 109
Revises: 108
Create Date: 2026-06-25 20:30:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "109"
down_revision = "108"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ea_standards",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column("category", sa.String(50), nullable=False, server_default="technical"),
        sa.Column("compliance_level", sa.String(20), nullable=False, server_default="recommended"),
        sa.Column("reference_url", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("catalogue_id", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ea_standards_catalogue_id"), "ea_standards", ["catalogue_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_ea_standards_catalogue_id"), table_name="ea_standards")
    op.drop_table("ea_standards")
