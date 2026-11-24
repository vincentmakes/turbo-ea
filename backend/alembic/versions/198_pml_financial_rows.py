"""Link PPM cost items to budgets and add invoice tracking.

Revision ID: 198
Revises: 197

Downgrade removes invoice rows and budget links. Existing budget and cost rows remain.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "198"
down_revision = "197"
branch_labels = None
depends_on = None


def upgrade():
    op.create_unique_constraint(
        "uq_ppm_budget_initiative_id", "ppm_budget_lines", ["initiative_id", "id"]
    )
    op.create_unique_constraint(
        "uq_ppm_cost_initiative_id", "ppm_cost_lines", ["initiative_id", "id"]
    )
    op.add_column(
        "ppm_cost_lines", sa.Column("budget_line_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_index(
        "ix_ppm_cost_initiative_budget", "ppm_cost_lines", ["initiative_id", "budget_line_id"]
    )
    op.create_foreign_key(
        "fk_ppm_cost_budget",
        "ppm_cost_lines",
        "ppm_budget_lines",
        ["initiative_id", "budget_line_id"],
        ["initiative_id", "id"],
        deferrable=True,
        initially="DEFERRED",
    )
    op.create_table(
        "ppm_invoices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "initiative_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("cost_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("invoice_date", sa.Date(), nullable=False),
        sa.Column("invoice_id", sa.Text(), nullable=False),
        sa.Column("amount", sa.Numeric(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "amount >= 0 AND amount < 'Infinity'::numeric", name="ck_ppm_invoice_amount_nonnegative"
        ),
        sa.ForeignKeyConstraint(
            ["initiative_id", "cost_item_id"],
            ["ppm_cost_lines.initiative_id", "ppm_cost_lines.id"],
            name="fk_ppm_invoice_cost",
            deferrable=True,
            initially="DEFERRED",
        ),
    )
    op.create_index(
        "ix_ppm_invoice_initiative_cost", "ppm_invoices", ["initiative_id", "cost_item_id"]
    )


def downgrade():
    op.drop_table("ppm_invoices")
    op.drop_constraint("fk_ppm_cost_budget", "ppm_cost_lines", type_="foreignkey")
    op.drop_index("ix_ppm_cost_initiative_budget", table_name="ppm_cost_lines")
    op.drop_column("ppm_cost_lines", "budget_line_id")
    op.drop_constraint("uq_ppm_cost_initiative_id", "ppm_cost_lines", type_="unique")
    op.drop_constraint("uq_ppm_budget_initiative_id", "ppm_budget_lines", type_="unique")
