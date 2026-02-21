"""expand subscription role column to 50 chars

Revision ID: 002
Revises: 001
Create Date: 2026-02-11

Subscription role was VARCHAR(20) which is too short for roles like
'technical_application_owner' and 'business_application_owner'.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "subscriptions",
        "role",
        existing_type=sa.String(20),
        type_=sa.String(50),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "subscriptions",
        "role",
        existing_type=sa.String(50),
        type_=sa.String(20),
        existing_nullable=False,
    )
