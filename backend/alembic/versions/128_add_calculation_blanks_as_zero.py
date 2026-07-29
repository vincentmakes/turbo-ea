"""Add ``calculations.blanks_as_zero``.

Per-calculation opt-in: when set, an empty numeric field evaluates as ``0``
instead of raising, so a cost roll-up over cards where some inputs are blank
produces a number rather than a generic evaluation error.

Deliberately **not** engine-wide and deliberately defaulting to ``false``. The
engine cannot tell an empty field from a mistyped field name at evaluation time
— both arrive as ``None`` — so blanket coercion would turn a loud typo into a
quiet wrong number. The save path now rejects unknown field keys outright
(``services/calculation_lint.py``), which is what makes the opt-in safe; the
default stays off so existing calculations keep their current behaviour and
nobody's stored values change on upgrade.

Revision ID: 128
Revises: 127
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "128"
down_revision: Union[str, None] = "127"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column(
        "calculations",
        sa.Column("blanks_as_zero", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("calculations", "blanks_as_zero")
