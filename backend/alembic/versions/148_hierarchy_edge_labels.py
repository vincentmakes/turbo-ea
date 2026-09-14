"""Label a parent/child link.

Two additive columns, no backfill (discussion #1100).

``cards.parent_label`` — the label on this card's edge to its parent. The
hierarchy edge is already one column on the child row (``parent_id``), so its
label lives there too; a join table or a synthetic ``relations`` row would have
to be kept in sync on every one of the ~38 call sites that read ``parent_id``
directly.

``card_types.hierarchy_labels`` — the per-type vocabulary those labels are drawn
from, shaped like ``subtypes``: ``[{key, label, color, translations}]``.

Deliberately no backfill and no seed change: an empty vocabulary means the
feature renders nowhere, so every existing install is byte-for-byte unchanged
until an admin configures labels on the one type that needs them. That is also
why no guarded ``UPDATE`` of built-in defaults is owed here.

Downgrade drops both columns, which discards the labels — the standard trade for
an additive column, and the vocabulary is cheap to re-enter.

Revision ID: 148
Revises: 147
Create Date: 2026-09-14
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "148"
down_revision: Union[str, None] = "147"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def _columns(table: str) -> set[str]:
    from sqlalchemy import inspect as sa_inspect

    return {c["name"] for c in sa_inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if "parent_label" not in _columns("cards"):
        op.add_column("cards", sa.Column("parent_label", sa.String(length=100), nullable=True))
    if "hierarchy_labels" not in _columns("card_types"):
        op.add_column(
            "card_types",
            sa.Column(
                "hierarchy_labels",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=True,
                server_default="[]",
            ),
        )


def downgrade() -> None:
    if "hierarchy_labels" in _columns("card_types"):
        op.drop_column("card_types", "hierarchy_labels")
    if "parent_label" in _columns("cards"):
        op.drop_column("cards", "parent_label")
