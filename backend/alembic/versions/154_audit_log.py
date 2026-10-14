"""Add the ``audit_log`` table — the security & admin audit log.

Discussion #1185 asked whether Turbo EA records sign-ins, sign-outs, failed
authentication attempts and administrative actions. It did not: ``events`` and
``mutation_batches`` record landscape changes (cards, relations, risks, …), and
nothing in the auth or admin routes wrote anything at all. This table is where
those records go, written by the one helper ``services/audit_log.record``.

**Why not ``events``.** A card-less event auto-creates a mutation batch, is
delivered on the per-user SSE stream when its ``user_id`` matches the
subscriber, and showed up in the dashboard's Recent Activity for every holder
of ``reports.ea_dashboard``. A failed login must reach none of those.

Schema (one row per action):

- ``created_at`` — ``clock_timestamp()``, not ``now()``, so several rows one
  request writes keep their write order (as on ``events``, migration 145).
- ``category`` (``auth`` / ``admin`` / ``access``), ``action`` (dotted, e.g.
  ``auth.login.failed``), ``outcome`` (``success`` / ``failure``).
- ``actor_user_id`` (FK users, ``SET NULL``) + ``actor_email`` — the email is
  a snapshot, so the row still names the actor after the user is deleted.
- ``subject_email`` — the account acted upon: the email a failed sign-in
  tried, the user an admin edited.
- ``target_type`` / ``target_id`` / ``target_label`` — no foreign key: the
  target may be a role key, a setting key or an extension key.
- ``ip`` / ``user_agent`` / ``origin`` — the request context.
- ``impersonator_user_id`` / ``impersonated_role`` — a snapshot of an active
  "View as role" session.
- ``details`` JSONB — reason codes and ``{field: {old, new}}`` diffs, with
  secrets masked before they are written.

Rows are immutable: no route updates or deletes one; only the daily retention
purge does (``general_settings.auditLogRetentionDays``, default 365, ``0`` =
keep forever). Nothing to backfill — the history starts now.

Revision ID: 154
Revises: 153
"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "154"
down_revision: Union[str, None] = "153"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("clock_timestamp()"),
        ),
        sa.Column("category", sa.String(length=16), nullable=False),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False, server_default="success"),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("actor_email", sa.String(length=255), nullable=True),
        sa.Column("subject_email", sa.String(length=255), nullable=True),
        sa.Column("target_type", sa.String(length=50), nullable=True),
        sa.Column("target_id", sa.String(length=100), nullable=True),
        sa.Column("target_label", sa.String(length=255), nullable=True),
        sa.Column("ip", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("origin", sa.String(length=20), nullable=True),
        sa.Column("impersonator_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("impersonated_role", sa.String(length=100), nullable=True),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_index("ix_audit_log_created_at", "audit_log", ["created_at"])
    op.create_index("ix_audit_log_category_created_at", "audit_log", ["category", "created_at"])
    op.create_index("ix_audit_log_action", "audit_log", ["action"])
    op.create_index("ix_audit_log_actor_user_id", "audit_log", ["actor_user_id"])
    op.create_index("ix_audit_log_subject_email", "audit_log", ["subject_email"])
    op.create_index("ix_audit_log_ip", "audit_log", ["ip"])


def downgrade() -> None:
    # Dropping the table drops its indexes with it; explicit ``drop_index``
    # calls would only add ways for the migration-rollback job to fail.
    op.drop_table("audit_log")
