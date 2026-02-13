"""add subscription_roles column to fact_sheet_types

Revision ID: 010
Revises: 009
Create Date: 2026-02-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULT_ROLES = [
    {"key": "responsible", "label": "Responsible"},
    {"key": "observer", "label": "Observer"},
]

APP_ROLES = [
    {"key": "responsible", "label": "Responsible"},
    {"key": "observer", "label": "Observer"},
    {"key": "technical_application_owner", "label": "Technical Application Owner"},
    {"key": "business_application_owner", "label": "Business Application Owner"},
]


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    bind = op.get_bind()
    inspector = sa_inspect(bind)
    columns = [c["name"] for c in inspector.get_columns("fact_sheet_types")]
    if "subscription_roles" in columns:
        return

    op.add_column(
        "fact_sheet_types",
        sa.Column("subscription_roles", postgresql.JSONB(), nullable=True),
    )

    # Backfill: Application gets 4 roles, everything else gets 2
    fact_sheet_types = sa.table(
        "fact_sheet_types",
        sa.column("key", sa.String),
        sa.column("subscription_roles", postgresql.JSONB),
    )
    op.execute(
        fact_sheet_types.update()
        .where(fact_sheet_types.c.key == "Application")
        .values(subscription_roles=APP_ROLES)
    )
    op.execute(
        fact_sheet_types.update()
        .where(fact_sheet_types.c.key != "Application")
        .values(subscription_roles=DEFAULT_ROLES)
    )


def downgrade() -> None:
    op.drop_column("fact_sheet_types", "subscription_roles")
