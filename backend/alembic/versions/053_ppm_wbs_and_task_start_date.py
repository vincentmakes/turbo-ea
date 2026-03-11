"""Add ppm_wbs table, start_date and wbs_id columns to ppm_tasks."""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "053"
down_revision = "052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ppm_wbs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "initiative_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "parent_id",
            UUID(as_uuid=True),
            sa.ForeignKey("ppm_wbs.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("start_date", sa.Date, nullable=True),
        sa.Column("end_date", sa.Date, nullable=True),
        sa.Column("sort_order", sa.Integer, default=0),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.add_column("ppm_tasks", sa.Column("start_date", sa.Date, nullable=True))
    op.add_column("ppm_tasks", sa.Column("wbs_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_ppm_tasks_wbs_id",
        "ppm_tasks",
        "ppm_wbs",
        ["wbs_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_ppm_tasks_wbs_id", "ppm_tasks", ["wbs_id"])


def downgrade() -> None:
    op.drop_index("ix_ppm_tasks_wbs_id", table_name="ppm_tasks")
    op.drop_constraint("fk_ppm_tasks_wbs_id", "ppm_tasks", type_="foreignkey")
    op.drop_column("ppm_tasks", "wbs_id")
    op.drop_column("ppm_tasks", "start_date")
    op.drop_table("ppm_wbs")
