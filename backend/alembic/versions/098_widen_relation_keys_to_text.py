"""Widen relation type/key columns from VARCHAR to TEXT.

Migration 097 widened ``staged_records.card_type_key`` so the staging
layer could carry long source-imported relation type names. The apply
pipeline downstream then materialises those into the metamodel — and
hit the *same* overflow on ``relation_types.key`` (VARCHAR(100)) the
moment it tried to create the row. Worse, even after widening
``relation_types.key``, every subsequent relation insert would have
overflowed ``relations.type`` (also VARCHAR(100)) because the relation
type's wire-format key is denormalised onto each ``relations`` row.

Columns widened:

- ``relation_types.key`` (was VARCHAR(100) UNIQUE)
- ``relation_types.label`` (was VARCHAR(200))
- ``relation_types.reverse_label`` (was VARCHAR(200))
- ``relations.type`` (was VARCHAR(100), indexed)

``label`` / ``reverse_label`` are widened because ``apply.py`` falls
back to ``key`` when the source export doesn't ship a friendly label
— a long key landing in a 200-char label column would overflow too.

What we deliberately don't touch:

- ``card_types.key`` and every ``*_type_key`` column on other tables.
  Adapters always map source card types to TEA card types via the
  per-adapter ``TYPE_MAPPING``, so card type keys stay short and
  TEA-controlled. Widening speculatively would be churn.

Postgres ``TEXT`` and ``VARCHAR`` are identical in storage and
performance; the unique index on ``relation_types.key`` and the
``ix_relations_type`` index both work unchanged on TEXT. Source-
agnostic: every current and future migration adapter inherits the
headroom.

Revision ID: 098
Revises: 097
Create Date: 2026-05-28
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "098"
down_revision: Union[str, None] = "097"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "relation_types",
        "key",
        existing_type=sa.String(length=100),
        type_=sa.Text(),
        existing_nullable=False,
    )
    op.alter_column(
        "relation_types",
        "label",
        existing_type=sa.String(length=200),
        type_=sa.Text(),
        existing_nullable=False,
    )
    op.alter_column(
        "relation_types",
        "reverse_label",
        existing_type=sa.String(length=200),
        type_=sa.Text(),
        existing_nullable=True,
    )
    op.alter_column(
        "relations",
        "type",
        existing_type=sa.String(length=100),
        type_=sa.Text(),
        existing_nullable=False,
    )


def downgrade() -> None:
    # Truncation guards mirror 097's pattern: rows that landed during
    # the TEXT window may legitimately exceed the legacy caps, so
    # substring-on-cast so the migration succeeds. Information loss for
    # over-long rows is accepted because they could not have existed
    # pre-upgrade anyway.
    op.alter_column(
        "relations",
        "type",
        existing_type=sa.Text(),
        type_=sa.String(length=100),
        existing_nullable=False,
        postgresql_using="substring(type, 1, 100)",
    )
    op.alter_column(
        "relation_types",
        "reverse_label",
        existing_type=sa.Text(),
        type_=sa.String(length=200),
        existing_nullable=True,
        postgresql_using="substring(reverse_label, 1, 200)",
    )
    op.alter_column(
        "relation_types",
        "label",
        existing_type=sa.Text(),
        type_=sa.String(length=200),
        existing_nullable=False,
        postgresql_using="substring(label, 1, 200)",
    )
    op.alter_column(
        "relation_types",
        "key",
        existing_type=sa.Text(),
        type_=sa.String(length=100),
        existing_nullable=False,
        postgresql_using="substring(key, 1, 100)",
    )
