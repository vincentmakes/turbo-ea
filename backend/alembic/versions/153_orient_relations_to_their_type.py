"""Store every relation in its relation type's direction.

A relation type runs one way — ``relAppToInterface`` from an Application to an
Interface — and every surface reads a relation row that way round: card detail
and the inventory list it under the side the card sits on, and its attributes
mean something on that axis (``flowDirection`` ``forward`` is the Application
*providing* the interface). Several write paths accepted card ids without
checking them against the type — ``/relations/bulk`` id refs, the MCP server,
the extension bridge, workspace import, the Excel Relations sheet and, before
2.39.1, a relation drawn the other way on a diagram — so installs carry rows
stored the other way round. Card detail showed them on neither card, and an
arrow drawn from one showed a provider as a consumer (discussion #1140). Every
write path now turns such a pair round (``app/services/relation_orientation``);
this migration repairs what was written before.

**What it does** — for each row of a cross-type relation type whose source card
is of the type's *target* type and whose target card of its *source* type, swap
``source_id`` / ``target_id``. The attributes are kept exactly as they are:
``flowDirection`` was always offered and read as the Application's role, so the
value the user chose means the same thing once the row runs the right way.
Self-referencing types are never touched — there the stored direction *is* the
meaning.

**Duplicates** — a backwards row can sit beside a correct row of the same type
between the same two cards (a user who could not see the backwards one added
the link again). Once turned, the two are one relation, collapsed with
migration 131's rule: the **oldest** row wins, the others' non-null attributes
fill only the gaps it has, a description is adopted only when it has none, and
the rest are deleted. Nothing references a relation id by foreign key.

``downgrade()`` is a no-op: re-reversing rows would recreate the bug, and the
merged duplicates cannot be told apart again.

Revision ID: 153
Revises: 152
"""

import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Union

import sqlalchemy as sa

from alembic import op

revision: str = "153"
down_revision: Union[str, None] = "152"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


@dataclass(frozen=True)
class RelRow:
    id: Any
    type: str
    source_id: Any
    target_id: Any
    created_at: datetime
    attributes: dict | None
    description: str | None
    backwards: bool


@dataclass
class Plan:
    #: Row ids whose ends are swapped.
    swaps: list = field(default_factory=list)
    #: Surviving row id → (attributes, description) after folding duplicates in.
    updates: dict = field(default_factory=dict)
    #: Duplicate row ids deleted after being folded into their survivor.
    deletes: list = field(default_factory=list)


def _oriented_key(row: RelRow) -> tuple:
    if row.backwards:
        return (row.type, row.target_id, row.source_id)
    return (row.type, row.source_id, row.target_id)


def plan_orientation(rows: list[RelRow]) -> Plan:
    """Decide what to do with the backwards rows in ``rows`` and any correct
    rows they collapse onto once turned. Pure — no database."""
    groups: dict[tuple, list[RelRow]] = {}
    for row in rows:
        groups.setdefault(_oriented_key(row), []).append(row)

    plan = Plan()
    for members in groups.values():
        if not any(m.backwards for m in members):
            continue
        members.sort(key=lambda m: (m.created_at, str(m.id)))
        keeper, losers = members[0], members[1:]
        if keeper.backwards:
            plan.swaps.append(keeper.id)
        if not losers:
            continue
        attributes = dict(keeper.attributes or {})
        description = keeper.description
        for loser in losers:
            for key, value in (loser.attributes or {}).items():
                if value is not None and attributes.get(key) in (None, ""):
                    attributes[key] = value
            if not description and loser.description:
                description = loser.description
        if attributes != (keeper.attributes or {}) or description != keeper.description:
            plan.updates[keeper.id] = (attributes, description)
        plan.deletes.extend(loser.id for loser in losers)
    return plan


_BACKWARDS = sa.text(
    """
    SELECT r.id, r.type, r.source_id, r.target_id, r.created_at, r.attributes, r.description
    FROM relations r
    JOIN relation_types rt ON rt.key = r.type
    JOIN cards s ON s.id = r.source_id
    JOIN cards t ON t.id = r.target_id
    WHERE rt.source_type_key <> rt.target_type_key
      AND s.type = rt.target_type_key
      AND t.type = rt.source_type_key
    """
)

_SAME_KEY = sa.text(
    """
    SELECT id, type, source_id, target_id, created_at, attributes, description
    FROM relations
    WHERE type = :t AND source_id = :s AND target_id = :g
    """
)


def upgrade() -> None:
    conn = op.get_bind()

    backwards = [RelRow(*r, backwards=True) for r in conn.execute(_BACKWARDS).fetchall()]
    if not backwards:
        return

    rows: dict[Any, RelRow] = {r.id: r for r in backwards}
    for b in backwards:
        # A correct row already holding the turned pair collapses with it.
        for r in conn.execute(_SAME_KEY, {"t": b.type, "s": b.target_id, "g": b.source_id}):
            rows.setdefault(r[0], RelRow(*r, backwards=False))

    plan = plan_orientation(list(rows.values()))

    if plan.deletes:
        conn.execute(sa.text("DELETE FROM relations WHERE id = ANY(:ids)"), {"ids": plan.deletes})
    for rel_id, (attributes, description) in plan.updates.items():
        conn.execute(
            sa.text(
                "UPDATE relations SET attributes = CAST(:a AS jsonb), description = :d "
                "WHERE id = :id"
            ),
            {"a": json.dumps(attributes), "d": description, "id": rel_id},
        )
    if plan.swaps:
        # Both SET expressions read the row's old values, so this swaps.
        conn.execute(
            sa.text(
                "UPDATE relations SET source_id = target_id, target_id = source_id "
                "WHERE id = ANY(:ids)"
            ),
            {"ids": plan.swaps},
        )

    print(
        f"[migration 153] Turned {len(plan.swaps)} relation(s) into their type's direction, "
        f"merged {len(plan.deletes)} duplicate(s)"
    )


def downgrade() -> None:
    # Re-reversing rows would recreate the bug; merged duplicates are gone.
    pass
