"""Add ArchLens native tables: vendor analysis, hierarchy, duplicates,
modernization assessments, and analysis runs.

Revision ID: 057
Revises: 056
Create Date: 2026-03-14
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision = "057"
down_revision = "056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "archlens_vendor_analysis",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("vendor_name", sa.String(500), nullable=False, unique=True),
        sa.Column("category", sa.String(200), nullable=False),
        sa.Column("sub_category", sa.String(200), nullable=True, server_default=""),
        sa.Column("reasoning", sa.Text, nullable=True, server_default=""),
        sa.Column("app_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("total_cost", sa.Float, nullable=False, server_default="0"),
        sa.Column("app_list", JSONB, nullable=True),
        sa.Column(
            "analysed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
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
    )

    op.create_table(
        "archlens_vendor_hierarchy",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("canonical_name", sa.String(500), nullable=False, unique=True),
        sa.Column(
            "vendor_type",
            sa.String(50),
            nullable=False,
            server_default="vendor",
        ),
        sa.Column(
            "parent_id",
            UUID(as_uuid=True),
            sa.ForeignKey("archlens_vendor_hierarchy.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("aliases", JSONB, nullable=True),
        sa.Column("category", sa.String(200), nullable=True),
        sa.Column("sub_category", sa.String(200), nullable=True),
        sa.Column("app_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("itc_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("total_cost", sa.Float, nullable=False, server_default="0"),
        sa.Column("linked_fs", JSONB, nullable=True),
        sa.Column("confidence", sa.Float, nullable=True),
        sa.Column(
            "analysed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
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
    )

    op.create_table(
        "archlens_duplicate_clusters",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("cluster_name", sa.String(500), nullable=False),
        sa.Column("card_type", sa.String(100), nullable=False),
        sa.Column("functional_domain", sa.String(500), nullable=True),
        sa.Column("card_ids", JSONB, nullable=True),
        sa.Column("card_names", JSONB, nullable=True),
        sa.Column("evidence", sa.Text, nullable=True, server_default=""),
        sa.Column("recommendation", sa.Text, nullable=True, server_default=""),
        sa.Column(
            "status",
            sa.String(50),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "analysed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
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
    )

    op.create_table(
        "archlens_modernization_assessments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("target_type", sa.String(100), nullable=False),
        sa.Column(
            "cluster_id",
            UUID(as_uuid=True),
            sa.ForeignKey("archlens_duplicate_clusters.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "card_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("card_name", sa.String(500), nullable=True),
        sa.Column("current_tech", sa.Text, nullable=True, server_default=""),
        sa.Column("modernization_type", sa.String(200), nullable=True, server_default=""),
        sa.Column("recommendation", sa.Text, nullable=True, server_default=""),
        sa.Column("effort", sa.String(50), nullable=True, server_default="medium"),
        sa.Column("priority", sa.String(50), nullable=True, server_default="medium"),
        sa.Column("status", sa.String(50), nullable=False, server_default="pending"),
        sa.Column(
            "analysed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
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
    )

    op.create_table(
        "archlens_analysis_runs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("connection_id", UUID(as_uuid=True), nullable=True),
        sa.Column("analysis_type", sa.String(50), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="running"),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("results", JSONB, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("archlens_analysis_runs")
    op.drop_table("archlens_modernization_assessments")
    op.drop_table("archlens_duplicate_clusters")
    op.drop_table("archlens_vendor_hierarchy")
    op.drop_table("archlens_vendor_analysis")
