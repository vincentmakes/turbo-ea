"""Add withdrawal columns to process_flow_versions.

Lets an accidentally-approved process flow be *withdrawn* instead of leaving a
deletion of the whole Business Process card as the only escape
(`discussion #916 <https://github.com/vincentmakes/turbo-ea/discussions/916>`_).

Withdrawal is forward-only, which is what keeps it defensible under GxP
(21 CFR 11.10(e) — record changes "shall not obscure previously recorded
information") and ISO 9001:2015 §7.5.3.2 (control of obsolete documented
information). The published row is never rewound to ``draft`` and never
deleted: it moves to a new terminal ``withdrawn`` status while keeping its
``revision``, ``bpmn_xml``, ``approved_by`` and ``approved_at`` intact, and
gains the three columns added here — who withdrew it, when, and a mandatory
written reason.

``status`` itself is a plain ``String(20)`` with no enum or CHECK constraint,
so the new state needs no DDL of its own.

Existing rows are untouched: all three columns are nullable with no server
default, so every historical version simply has no withdrawal metadata, which
is the correct reading — nothing has been withdrawn yet. Idempotency is not a
concern here (plain ``add_column`` on columns that cannot pre-exist), and the
downgrade drops all three.

Revision ID: 135
Revises: 134
"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "135"
down_revision: Union[str, None] = "134"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "process_flow_versions",
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "process_flow_versions",
        sa.Column("withdrawn_by", sa.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "process_flow_versions",
        sa.Column("withdrawal_reason", sa.Text(), nullable=True),
    )
    # SET NULL, matching created_by / submitted_by / approved_by: deleting a user
    # must never take the audit row with it.
    op.create_foreign_key(
        "fk_process_flow_versions_withdrawn_by_users",
        "process_flow_versions",
        "users",
        ["withdrawn_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_process_flow_versions_withdrawn_by_users",
        "process_flow_versions",
        type_="foreignkey",
    )
    op.drop_column("process_flow_versions", "withdrawal_reason")
    op.drop_column("process_flow_versions", "withdrawn_by")
    op.drop_column("process_flow_versions", "withdrawn_at")
