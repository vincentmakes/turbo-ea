"""Recurrence support for card todos.

Adds the four columns that turn a plain ``Todo`` into a self-perpetuating
recurring series (GitHub discussion #588 — "have person X review this card
every 6 months"). The design reuses the Risk Mitigation Task recurrence
model but keeps todos lightweight: each occurrence is a normal ``Todo`` row
linked to its siblings by ``series_id``; there is no separate occurrence
table.

* ``series_id`` — groups the rows of one recurring todo. NULL for ordinary
  one-shot todos (the vast majority), so existing rows are untouched.
* ``recurrence_unit`` / ``recurrence_interval`` — the recurrence rule
  (``none`` / ``days`` / ``weeks`` / ``months`` / ``years`` × interval).
* ``lead_time_days`` — how many days before ``due_date`` a rolled-forward
  occurrence is promoted from the new ``scheduled`` status to ``open``.

All columns carry server defaults so the add is safe on a populated table;
no backfill is required (existing rows default to a non-recurring todo).
Two indexes are added: ``series_id`` for series lookups and a composite
``(status, due_date)`` for the daily promotion query.

Revision ID: 100
Revises: 099
Create Date: 2026-05-29
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "100"
down_revision: Union[str, None] = "099"
branch_labels: Union[str, tuple[str], None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column(
        "todos",
        sa.Column("series_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "todos",
        sa.Column(
            "recurrence_unit",
            sa.String(length=8),
            nullable=False,
            server_default="none",
        ),
    )
    op.add_column(
        "todos",
        sa.Column(
            "recurrence_interval",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
    )
    op.add_column(
        "todos",
        sa.Column(
            "lead_time_days",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.create_index("ix_todos_series_id", "todos", ["series_id"])
    op.create_index("ix_todos_status_due_date", "todos", ["status", "due_date"])


def downgrade() -> None:
    op.drop_index("ix_todos_status_due_date", table_name="todos")
    op.drop_index("ix_todos_series_id", table_name="todos")
    op.drop_column("todos", "lead_time_days")
    op.drop_column("todos", "recurrence_interval")
    op.drop_column("todos", "recurrence_unit")
    op.drop_column("todos", "series_id")
