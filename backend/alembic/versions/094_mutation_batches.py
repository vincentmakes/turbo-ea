"""Add ``mutation_batches`` table + ``events.batch_id`` column.

Underpins the MCP-server safeguards (S1 / S2 / S6 / S7) by giving every
mutation a stable batch identifier that flows from the request through
the audit log. A batch is opened by the tool wrapper before any writes,
stamped onto every event that the underlying handlers publish, and
closed (committed) once all rows succeed.

Schema:

- ``mutation_batches``
  - ``id UUID PK``
  - ``tool_name TEXT`` — the MCP tool that opened the batch
    (``create_cards_bulk``, ``update_cards_bulk``, ``rollback_batch``, …).
  - ``actor_user_id UUID NULL FK users`` — the SSO-resolved user behind
    the call. Nullable so system-initiated batches (background jobs)
    still land.
  - ``origin TEXT`` — mirrors the ``X-Turbo-EA-Origin`` header (``mcp``,
    ``web``, ``api``).
  - ``dry_run BOOL`` — whether the batch was opened in preview mode.
    Dry-run batches that the tool wrapper completes are kept on the
    record (with ``committed_at NULL``) so the agent has a stable
    handle to quote a ``confirm_token`` back to.
  - ``confirm_token TEXT NULL`` — set on dry-runs above the per-call
    confirmation threshold. The matching commit must echo it. 15-min
    TTL enforced in service code.
  - ``summary JSONB`` — per-row outcome (status, before/after diff for
    diffable writes, error per row) captured at commit time.
  - ``created_at`` / ``committed_at`` timestamps.

- ``events.batch_id UUID NULL`` — every event emitted under a batch
  carries the reference. Indexed so the change-history endpoint can
  fetch a whole batch's events in a single query.

Backfill is intentionally skipped: pre-existing events are not part of
any batch, and the ``GET /mutation-batches`` endpoint only ever queries
forward from a batch the caller already knows about.

Revision ID: 094
Revises: 093
Create Date: 2026-05-23
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "094"
down_revision: Union[str, None] = "093"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mutation_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tool_name", sa.String(length=100), nullable=False),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("origin", sa.String(length=20), nullable=False, server_default="api"),
        sa.Column("dry_run", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("confirm_token", sa.String(length=64), nullable=True),
        sa.Column("summary", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_mutation_batches_actor_created",
        "mutation_batches",
        ["actor_user_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_mutation_batches_tool_created",
        "mutation_batches",
        ["tool_name", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_mutation_batches_origin_created",
        "mutation_batches",
        ["origin", sa.text("created_at DESC")],
    )

    op.add_column(
        "events",
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_events_batch_id",
        "events",
        "mutation_batches",
        ["batch_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_events_batch_id", "events", ["batch_id"])


def downgrade() -> None:
    # ``Base.metadata.create_all`` (used on fresh DBs and by the
    # migration-rollback CI job) auto-generates the FK with a different
    # name than the one Alembic chose on the upgrade path, so naming
    # the constraint here would mismatch on either side. Postgres
    # auto-drops the FK when the column is dropped — same with the
    # index — so a plain ``drop_column`` is the portable downgrade.
    op.drop_column("events", "batch_id")

    op.drop_index("ix_mutation_batches_origin_created", table_name="mutation_batches")
    op.drop_index("ix_mutation_batches_tool_created", table_name="mutation_batches")
    op.drop_index("ix_mutation_batches_actor_created", table_name="mutation_batches")
    op.drop_table("mutation_batches")
