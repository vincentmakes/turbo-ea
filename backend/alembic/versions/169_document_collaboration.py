"""Collaboration on decisions and SoAWs: discussion and history tables.

Two tables arrive, each owned by exactly one decision revision or one SoAW
revision (two real foreign keys and a check that exactly one is set):

* ``document_comments`` — threads with one level of replies (``parent_id``),
  an author and a snapshot of their name, a short rich-text ``body``, an
  optional ``section``, a ``kind`` (``comment``, ``sign_note``,
  ``rejection``), resolve / edit / soft-delete stamps and the channel the
  comment came from (``created_via``);
* ``document_history`` — the timeline of a document: a ``kind``, the actor
  and a snapshot of their name, a ``note``, an optional ``content`` snapshot
  and, on ``sent_for_review`` rows, the ``signatories`` asked. Ordered by
  ``seq`` (an identity column); ``created_at`` takes ``clock_timestamp()``
  so the steps one request writes keep distinct stamps for display.

Names (constraints, indexes) are exactly the models' own, so a schema built
by ``create_all`` downgrades cleanly. Downgrade drops both tables.

Revision ID: 169
Revises: 168
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "169"
down_revision: Union[str, None] = "168"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COMMENTS = "document_comments"
HISTORY = "document_history"
ONE_OWNER = "num_nonnulls(architecture_decision_id, soaw_id) = 1"


def _owner_columns() -> list[sa.Column]:
    return [
        sa.Column(
            "architecture_decision_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("architecture_decisions.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "soaw_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("statement_of_architecture_works.id", ondelete="CASCADE"),
            nullable=True,
        ),
    ]


def _user_fk(name: str) -> sa.Column:
    return sa.Column(
        name,
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )


def upgrade() -> None:
    op.create_table(
        COMMENTS,
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        *_owner_columns(),
        sa.Column(
            "parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("document_comments.id", ondelete="CASCADE"),
            nullable=True,
        ),
        _user_fk("author_id"),
        sa.Column("author_name", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("section", sa.String(length=64), nullable=True),
        sa.Column("kind", sa.String(length=20), nullable=False, server_default="comment"),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        _user_fk("resolved_by"),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_via", sa.String(length=20), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(ONE_OWNER, name="ck_document_comments_one_owner"),
    )
    for column in ("architecture_decision_id", "soaw_id", "parent_id"):
        op.create_index(op.f(f"ix_{COMMENTS}_{column}"), COMMENTS, [column])

    op.create_table(
        HISTORY,
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        *_owner_columns(),
        sa.Column("kind", sa.String(length=20), nullable=False),
        _user_fk("actor_id"),
        sa.Column("actor_name", sa.String(length=255), nullable=True),
        sa.Column("note", sa.String(length=4000), nullable=True),
        sa.Column("content", postgresql.JSONB(), nullable=True),
        sa.Column("signatories", postgresql.JSONB(), nullable=True),
        sa.Column("via", sa.String(length=20), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.clock_timestamp(),
        ),
        sa.CheckConstraint(ONE_OWNER, name="ck_document_history_one_owner"),
    )
    op.create_index("ix_document_history_adr_seq", HISTORY, ["architecture_decision_id", "seq"])
    op.create_index("ix_document_history_soaw_seq", HISTORY, ["soaw_id", "seq"])


def downgrade() -> None:
    op.drop_index("ix_document_history_soaw_seq", table_name=HISTORY)
    op.drop_index("ix_document_history_adr_seq", table_name=HISTORY)
    op.drop_table(HISTORY)
    for column in ("parent_id", "soaw_id", "architecture_decision_id"):
        op.drop_index(op.f(f"ix_{COMMENTS}_{column}"), table_name=COMMENTS)
    op.drop_table(COMMENTS)
