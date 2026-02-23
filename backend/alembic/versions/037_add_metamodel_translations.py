"""Add translations JSONB column to card_types, relation_types, stakeholder_role_definitions

Revision ID: 037
Revises: 036
Create Date: 2026-02-23
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "037"
down_revision = "036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("card_types", sa.Column("translations", JSONB, server_default="{}", nullable=False))
    op.add_column(
        "relation_types", sa.Column("translations", JSONB, server_default="{}", nullable=False)
    )
    op.add_column(
        "stakeholder_role_definitions",
        sa.Column("translations", JSONB, server_default="{}", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("stakeholder_role_definitions", "translations")
    op.drop_column("relation_types", "translations")
    op.drop_column("card_types", "translations")
