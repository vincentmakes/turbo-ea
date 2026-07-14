"""Add an extension attributes bag to architecture_decisions.

ADRs are not cards, so extensions cannot extend them through the metamodel
field-contribution capability. This JSONB column lets extensions stash their
own data under ``ext.<key>.*`` top-level keys (an extension might write, e.g.,
``ext.savings``). It is frozen once the ADR is signed and
carried into revisions by the API layer.

Revision ID: 122
Revises: 121
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "122"
down_revision: Union[str, None] = "121"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column(
        "architecture_decisions",
        sa.Column(
            "attributes",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("architecture_decisions", "attributes")
