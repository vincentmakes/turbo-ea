"""Give a PPM budget line an optional description.

One additive, nullable column, no backfill. Cost lines have always carried a
description; a planned budget line only had fiscal year, category and amount,
so two lines on the same fiscal year + category could not say what each was
for. Several lines per pair stay allowed: deliberately no unique constraint.

Downgrade drops the column, which discards the descriptions.

Revision ID: 155
Revises: 154
Create Date: 2026-10-19
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "155"
down_revision: Union[str, None] = "154"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def _columns(table: str) -> set[str]:
    from sqlalchemy import inspect as sa_inspect

    return {c["name"] for c in sa_inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if "description" not in _columns("ppm_budget_lines"):
        op.add_column("ppm_budget_lines", sa.Column("description", sa.Text(), nullable=True))


def downgrade() -> None:
    if "description" in _columns("ppm_budget_lines"):
        op.drop_column("ppm_budget_lines", "description")
