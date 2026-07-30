"""Drop the transition_plans table and clean up its role permission keys.

Migration 129 added ``transition_plans`` for a planning module that has since
been removed from the codebase. Migration 129 is deliberately left in place
rather than deleted: an install that already applied it holds ``'129'`` in
``alembic_version``, and removing the revision file would make that version
unresolvable — ``app.main``'s lifespan calls ``command.upgrade(cfg, "head")``,
which would raise and take the backend down on boot. Creating the table and
then dropping it costs a fresh install nothing.

Two jobs here:

1. **Drop the table** (and its index). Guarded with ``IF EXISTS`` so the
   migration is safe on any starting state.

2. **Strip the stale permission keys from existing role rows.** ``seed.py`` is
   insert-only — it never re-syncs an existing ``roles`` row — so a role seeded
   while the module existed keeps ``transition_plans.*`` inside its
   ``permissions`` JSONB indefinitely. That matters because
   ``app/api/v1/roles.py`` validates submitted permission dicts against
   ``ALL_APP_PERMISSION_KEYS`` and rejects unknown keys, so an admin who merely
   opened a role and saved it back unchanged would get
   ``Unknown permission keys: transition_plans...``.

``downgrade()`` recreates the table exactly as 129 left it, which is what
"downgrade to revision 129" means and what the CI Migration Rollback Test
requires: that job builds the schema from ``Base.metadata`` (which no longer
contains this table now that the model is gone), stamps head, then runs
``downgrade -1`` followed by ``upgrade head``. A no-op downgrade would leave the
re-upgrade dropping a table that was never created.

The permission-key strip is deliberately **one-way** — the downgrade cannot know
which roles originally carried the keys, and re-adding them to every role would
be wrong. Re-seeding is not needed either: the keys no longer exist in the
registry, so nothing reads them.

Revision ID: 130
Revises: 129
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import text

from alembic import op

revision: str = "130"
down_revision: Union[str, None] = "129"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STALE_PREFIX = "transition_plans."


def strip_keys(perms):
    """Return ``perms`` without any ``transition_plans.*`` key.

    Returns ``None`` when nothing needs changing so the caller can skip the
    UPDATE. Pure and non-mutating, so it is unit-testable without a database —
    same shape as ``plan_patch`` in migration 116.
    """
    if not isinstance(perms, dict):
        return None
    cleaned = {k: v for k, v in perms.items() if not k.startswith(STALE_PREFIX)}
    if len(cleaned) == len(perms):
        return None
    return cleaned


def upgrade() -> None:
    # Dropping the table takes its index with it.
    op.execute("DROP TABLE IF EXISTS transition_plans")

    # Python-side fetch → mutate → write with a ``CAST(:s AS jsonb)`` update.
    # This is the canonical pattern in this tree (see 099 and 116); a single SQL
    # UPDATE using the ``?`` JSONB key-existence operator interacts badly with
    # SQLAlchemy's ``text()`` named-parameter scanner and silently rolls back in
    # the migration runner.
    conn = op.get_bind()
    rows = conn.execute(text("SELECT id, permissions FROM roles")).fetchall()
    for row in rows:
        patched = strip_keys(row.permissions)
        if patched is None:
            continue
        conn.execute(
            text("UPDATE roles SET permissions = CAST(:s AS jsonb) WHERE id = :id"),
            {"s": json.dumps(patched), "id": row.id},
        )


def downgrade() -> None:
    op.create_table(
        "transition_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="draft"),
        sa.Column("scope", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("plan_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "initiative_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_transition_plans_initiative_id", "transition_plans", ["initiative_id"])
