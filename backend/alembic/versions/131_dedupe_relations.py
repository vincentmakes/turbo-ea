"""Collapse duplicate relations that share (type, source_id, target_id).

Until now ``POST /relations`` inserted unconditionally, while
``POST /relations/bulk`` upserted on ``(type, source_id, target_id)``. Any path
that went through the single-relation endpoint could therefore fork the
repository into duplicate rows — most visibly the diagram editor, where drawing
an edge between two cards that were *already* related created a second identical
relation. The diagram looked right; the inventory quietly gained a phantom edge
(discussion #905). The endpoint now reuses the existing row; this migration
cleans up what the old behaviour already wrote.

**Merge strategy** — keep the **oldest** row of each duplicate group (it owns the
history: events, and any downstream reference, point at the first id) and fold
the survivors' siblings into it:

* ``attributes`` — shallow-merge every duplicate's keys into the survivor,
  oldest-first, so a later row's explicitly-set value wins over an earlier
  blank. Keys the survivor already has a non-null value for are preserved.
* ``description`` — the survivor keeps its own; if it has none, the first
  non-empty description among the duplicates is adopted.

Nothing is silently dropped: everything either survives on the kept row or was
identical to begin with.

No unique constraint is added. The application layer now owns this invariant on
every write path, and a hard constraint would turn a future edge case into a
500 on a customer's instance rather than a merge. Revisit if duplicates
reappear in the wild.

``downgrade()`` is a no-op — the deleted rows were exact duplicates by
definition, and re-splitting them would be inventing data.

Revision ID: 131
Revises: 130
"""

import json
from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "131"
down_revision: Union[str, None] = "130"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # Groups with more than one row for the same (type, source, target).
    groups = conn.execute(
        sa.text(
            """
            SELECT type, source_id, target_id
            FROM relations
            GROUP BY type, source_id, target_id
            HAVING COUNT(*) > 1
            """
        )
    ).fetchall()

    if not groups:
        return

    merged = 0
    for rel_type, source_id, target_id in groups:
        rows = conn.execute(
            sa.text(
                """
                SELECT id, attributes, description
                FROM relations
                WHERE type = :t AND source_id = :s AND target_id = :g
                ORDER BY created_at ASC, id ASC
                """
            ),
            {"t": rel_type, "s": source_id, "g": target_id},
        ).fetchall()

        keeper = rows[0]
        losers = rows[1:]

        attributes = dict(keeper[1] or {})
        description = keeper[2]
        for _, loser_attrs, loser_desc in losers:
            for key, value in (loser_attrs or {}).items():
                # Only fill gaps — never overwrite a value the keeper already
                # carries, and never write a null over something meaningful.
                if value is not None and attributes.get(key) in (None, ""):
                    attributes[key] = value
            if not description and loser_desc:
                description = loser_desc

        conn.execute(
            sa.text(
                """
                UPDATE relations
                SET attributes = CAST(:a AS jsonb), description = :d
                WHERE id = :id
                """
            ),
            {"a": json.dumps(attributes), "d": description, "id": keeper[0]},
        )
        conn.execute(
            sa.text("DELETE FROM relations WHERE id = ANY(:ids)"),
            {"ids": [row[0] for row in losers]},
        )
        merged += len(losers)

    print(f"[migration 131] Merged {merged} duplicate relation row(s)")


def downgrade() -> None:
    # Deleted rows were exact duplicates; re-creating them would invent data.
    pass
