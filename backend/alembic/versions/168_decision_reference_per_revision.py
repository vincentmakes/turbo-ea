"""Decision register, schema step: a revision keeps its decision's reference.

A revision of an architecture decision now carries the reference of the
decision it revises ("ADR-012 · Rev 2"), so ``reference_number`` alone is no
longer unique: the single unique ``architecture_decisions_reference_number_key``
is replaced by ``uq_adr_reference_revision`` on ``(reference_number,
revision_number)`` plus a plain index on ``reference_number``. The untyped
``related_decisions`` column goes: migration 167 turned its entries into
``relates`` links, which are the only record now.

Downgrade: before the single unique can come back, every reference carried by
more than one row keeps it on its lowest ``(revision_number, created_at, id)``
row and every other row is given a fresh ``ADR-NNN`` continuing after the
highest existing number (:func:`plan_renumbering`). ``related_decisions``
returns, filled per decision with the target ids of its outgoing ``relates``
links.

Revision ID: 168
Revises: 167
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from datetime import datetime
from typing import Any, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "168"
down_revision: Union[str, None] = "167"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ADR_TABLE = "architecture_decisions"
#: The single unique the table carried until now (PostgreSQL's default name
#: for ``unique=True`` on the column, whether built by migrations or by
#: ``create_all``).
OLD_UNIQUE = "architecture_decisions_reference_number_key"
#: Both names exactly as the model declares them (``create_all`` must agree).
NEW_UNIQUE = "uq_adr_reference_revision"
REFERENCE_INDEX = "ix_architecture_decisions_reference_number"

_REFERENCE_RE = re.compile(r"^ADR-(\d+)$", re.IGNORECASE)


# --- Pure planner ---------------------------------------------------------------


def _keep_order(row: tuple[Any, str, int, datetime | None]) -> tuple[Any, ...]:
    row_id, _reference, revision_number, created_at = row
    return (revision_number, created_at is not None, created_at, str(row_id))


def plan_renumbering(
    rows: Iterable[tuple[Any, str, int, datetime | None]],
) -> list[tuple[Any, str]]:
    """Plan the fresh references that make ``reference_number`` unique again.

    ``rows`` carry ``(id, reference_number, revision_number, created_at)``. For
    every reference carried by more than one row, the row with the lowest
    ``(revision_number, created_at, id)`` keeps it and each other row gets a
    new ``ADR-NNN``: numbered on from the highest ``ADR-<n>`` among all rows
    (any case; references in another format are ignored), zero-padded to at
    least three digits, the same rule as the app's reference generator.
    References are compared exactly, as the unique constraint compares them.
    The renamed rows come out ordered by their old reference, then the keep
    order, as ``(id, new_reference)`` pairs.
    """
    rows = list(rows)
    highest = 0
    groups: dict[str, list[tuple[Any, str, int, datetime | None]]] = {}
    for row in rows:
        reference = row[1]
        match = _REFERENCE_RE.match(reference or "")
        if match:
            highest = max(highest, int(match.group(1)))
        groups.setdefault(reference, []).append(row)

    plan: list[tuple[Any, str]] = []
    for reference in sorted(groups):
        members = sorted(groups[reference], key=_keep_order)
        for row in members[1:]:
            highest += 1
            plan.append((row[0], f"ADR-{highest:03d}"))
    return plan


# --- Migration ------------------------------------------------------------------


def upgrade() -> None:
    op.drop_column(ADR_TABLE, "related_decisions")
    op.drop_constraint(OLD_UNIQUE, ADR_TABLE, type_="unique")
    op.create_unique_constraint(NEW_UNIQUE, ADR_TABLE, ["reference_number", "revision_number"])
    op.create_index(REFERENCE_INDEX, ADR_TABLE, ["reference_number"])


def _renumber(bind: sa.engine.Connection) -> None:
    adrs = sa.table(
        ADR_TABLE,
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("reference_number", sa.String),
        sa.column("revision_number", sa.Integer),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    rows = bind.execute(
        sa.select(adrs.c.id, adrs.c.reference_number, adrs.c.revision_number, adrs.c.created_at)
    ).all()
    for row_id, reference in plan_renumbering((r[0], r[1], r[2], r[3]) for r in rows):
        bind.execute(adrs.update().where(adrs.c.id == row_id).values(reference_number=reference))


def _backfill_related_decisions(bind: sa.engine.Connection) -> None:
    adrs = sa.table(
        ADR_TABLE,
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("related_decisions", postgresql.JSONB),
    )
    links = sa.table(
        "architecture_decision_links",
        sa.column("source_id", postgresql.UUID(as_uuid=True)),
        sa.column("target_id", postgresql.UUID(as_uuid=True)),
        sa.column("kind", sa.String),
    )
    related: dict[Any, list[str]] = {}
    for source_id, target_id in bind.execute(
        sa.select(links.c.source_id, links.c.target_id)
        .where(links.c.kind == "relates")
        .order_by(links.c.source_id, links.c.target_id)
    ).all():
        related.setdefault(source_id, []).append(str(target_id))
    for source_id, targets in related.items():
        bind.execute(adrs.update().where(adrs.c.id == source_id).values(related_decisions=targets))


def downgrade() -> None:
    bind = op.get_bind()
    _renumber(bind)
    op.drop_constraint(NEW_UNIQUE, ADR_TABLE, type_="unique")
    op.drop_index(REFERENCE_INDEX, table_name=ADR_TABLE)
    op.create_unique_constraint(OLD_UNIQUE, ADR_TABLE, ["reference_number"])
    op.add_column(
        ADR_TABLE,
        sa.Column(
            "related_decisions",
            postgresql.JSONB(),
            server_default="[]",
            nullable=False,
        ),
    )
    _backfill_related_decisions(bind)
