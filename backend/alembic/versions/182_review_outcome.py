"""Review outcomes on decisions and SoAWs (discussion #1433).

Until now a rejection wrote ``status = "draft"`` and nothing else on the
document, so "still being prepared" and "formally evaluated and not approved"
looked the same. Five nullable columns, the same on ``architecture_decisions``
and ``statement_of_architecture_works``, record how a review ended when it did
not end in a signature (``app/services/review_outcome.py``):

* ``outcome`` — ``changes_requested`` | ``rejected`` | ``withdrawn`` (null: none);
* ``outcome_at``, ``outcome_by`` (FK ``users.id``, ``SET NULL``),
  ``outcome_by_name`` (the name at the time) and ``outcome_note`` (the
  reason, up to 4000 characters like a timeline row's note).

Backfill, guarded: a draft that has no outcome yet and whose latest workflow
row on its timeline is ``rejected`` gets ``outcome = changes_requested`` with
the time, actor, actor name and note of that row — that is what a rejection
meant until now (back to an editable draft). The existing ``rejected`` rows and
``rejection`` threads are left as written.

Downgrade drops the columns (the outcomes are lost; the timeline keeps the rows).

Revision ID: 182
Revises: 181
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import Any, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "182"
down_revision: Union[str, None] = "181"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: Document table → the column of ``document_history`` naming its rows' owner.
TABLES: dict[str, str] = {
    "architecture_decisions": "architecture_decision_id",
    "statement_of_architecture_works": "soaw_id",
}

#: The timeline kinds written by a workflow step before this migration (a
#: ``save`` or ``restored`` row is not a step of the review).
WORKFLOW_KINDS: tuple[str, ...] = (
    "created",
    "revised",
    "sent_for_review",
    "signature",
    "signed",
    "rejected",
    "recalled",
    "recorded",
)

BACKFILLED = "changes_requested"


def _columns() -> list[sa.Column]:
    return [
        sa.Column("outcome", sa.String(length=20), nullable=True),
        sa.Column("outcome_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "outcome_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("outcome_by_name", sa.String(length=255), nullable=True),
        sa.Column("outcome_note", sa.String(length=4000), nullable=True),
    ]


def plan_backfill(
    drafts: Iterable[Any], history: Iterable[Mapping[str, Any]]
) -> dict[Any, dict[str, Any]]:
    """``{document id: outcome values}`` for the drafts to backfill (pure).

    ``drafts`` are the ids of the drafts without an outcome; ``history`` the
    workflow rows of the timeline, each ``{owner, seq, kind, created_at,
    actor_id, actor_name, note}``. A draft is backfilled when its row with the
    highest ``seq`` is ``rejected``; any other draft is left alone.
    """
    wanted = set(drafts)
    latest: dict[Any, Mapping[str, Any]] = {}
    for row in history:
        owner = row["owner"]
        if owner not in wanted or row["kind"] not in WORKFLOW_KINDS:
            continue
        held = latest.get(owner)
        if held is None or row["seq"] > held["seq"]:
            latest[owner] = row
    return {
        owner: {
            "outcome": BACKFILLED,
            "outcome_at": row["created_at"],
            "outcome_by": row["actor_id"],
            "outcome_by_name": row["actor_name"],
            "outcome_note": row["note"],
        }
        for owner, row in latest.items()
        if row["kind"] == "rejected"
    }


def _backfill(bind: sa.engine.Connection, table_name: str, owner_column: str) -> None:
    # Lightweight table clauses: only the columns read or written here.
    docs = sa.table(
        table_name,
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("status", sa.String()),
        sa.column("outcome", sa.String()),
        sa.column("outcome_at", sa.DateTime(timezone=True)),
        sa.column("outcome_by", postgresql.UUID(as_uuid=True)),
        sa.column("outcome_by_name", sa.String()),
        sa.column("outcome_note", sa.String()),
    )
    history = sa.table(
        "document_history",
        sa.column("seq", sa.BigInteger()),
        sa.column(owner_column, postgresql.UUID(as_uuid=True)),
        sa.column("kind", sa.String()),
        sa.column("actor_id", postgresql.UUID(as_uuid=True)),
        sa.column("actor_name", sa.String()),
        sa.column("note", sa.String()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    drafts = [
        r.id
        for r in bind.execute(
            sa.select(docs.c.id).where(docs.c.status == "draft", docs.c.outcome.is_(None))
        )
    ]
    if not drafts:
        return
    owner = history.c[owner_column]
    rows = bind.execute(
        sa.select(
            owner.label("owner"),
            history.c.seq,
            history.c.kind,
            history.c.created_at,
            history.c.actor_id,
            history.c.actor_name,
            history.c.note,
        ).where(owner.in_(drafts), history.c.kind.in_(WORKFLOW_KINDS))
    )
    plan = plan_backfill(drafts, [dict(r._mapping) for r in rows])
    for doc_id, values in plan.items():
        bind.execute(
            sa.update(docs)
            .where(docs.c.id == doc_id, docs.c.status == "draft", docs.c.outcome.is_(None))
            .values(**values)
        )


def upgrade() -> None:
    for table_name in TABLES:
        for column in _columns():
            op.add_column(table_name, column)
    bind = op.get_bind()
    for table_name, owner_column in TABLES.items():
        _backfill(bind, table_name, owner_column)


def downgrade() -> None:
    for table_name in TABLES:
        for column in ("outcome_note", "outcome_by_name", "outcome_by", "outcome_at", "outcome"):
            op.drop_column(table_name, column)
