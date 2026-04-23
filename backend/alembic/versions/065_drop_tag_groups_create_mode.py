"""Drop unused create_mode column from tag_groups.

Pre-Alembic scaffolding: the column was created by the original
`Base.metadata.create_all()` at app startup but was never written,
read, or enforced anywhere in the codebase. Removing it before it
accretes users / assumptions.

Revision ID: 065
Revises: 064
"""

import sqlalchemy as sa

from alembic import op

revision = "065"
down_revision = "064"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("tag_groups") as batch:
        batch.drop_column("create_mode")


def downgrade() -> None:
    op.add_column(
        "tag_groups",
        sa.Column(
            "create_mode",
            sa.String(length=20),
            nullable=False,
            server_default="open",
        ),
    )
