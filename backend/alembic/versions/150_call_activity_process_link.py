"""Link a call activity to the Business Process it invokes.

Two additive columns on ``process_elements``: ``called_element`` (the raw
``calledElement`` attribute of a BPMN call activity, parser-derived) and
``business_process_id`` (the BusinessProcess card the activity invokes — a
fifth EA link beside application / data object / IT component, minted into
the ``relProcessCalls`` relation by the element table exactly like the others).

Both are derived from the stored BPMN XML wherever it already carries a card
UUID in ``calledElement`` (the modeler writes one when a process is picked),
so — following migrations 138 and 149 — the existing flows are re-parsed with
the current parser and backfilled here: ``called_element`` on every call
activity row, ``business_process_id`` only where the reference is the UUID of
an ACTIVE BusinessProcess card other than the process itself. A foreign
reference (a diagram imported from another tool) stays unresolved and is
linked through the picker. Every per-process step is wrapped so one
unparseable diagram cannot fail a startup upgrade.

The relation type itself needs no migration: ``seed_metamodel`` upserts
relation types by key on every boot.

Revision ID: 150
Revises: 149
Create Date: 2026-09-18
"""

import uuid
from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import text

from alembic import op

revision: str = "150"
down_revision: Union[str, None] = "149"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    from sqlalchemy import inspect as sa_inspect

    return {c["name"] for c in sa_inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if "called_element" not in _columns("process_elements"):
        op.add_column(
            "process_elements",
            sa.Column("called_element", sa.String(length=200), nullable=True),
        )
    if "business_process_id" not in _columns("process_elements"):
        op.add_column(
            "process_elements",
            sa.Column(
                "business_process_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey(
                    "cards.id",
                    name="process_elements_business_process_id_fkey",
                    ondelete="SET NULL",
                ),
                nullable=True,
            ),
        )

    _backfill()


def _as_uuid(value: str | None) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


def _backfill() -> None:
    # Imported lazily so the module import cost is only paid when the migration
    # actually runs.
    from app.services.bpmn_parser import parse_bpmn

    conn = op.get_bind()

    process_ids = [
        row[0] for row in conn.execute(text("SELECT DISTINCT process_id FROM process_elements"))
    ]

    for process_id in process_ids:
        try:
            source = conn.execute(
                text(
                    """
                    SELECT bpmn_xml FROM process_flow_versions
                    WHERE process_id = :pid AND status = 'published'
                    ORDER BY revision DESC
                    LIMIT 1
                    """
                ),
                {"pid": process_id},
            ).scalar()
            if not source:
                source = conn.execute(
                    text(
                        """
                        SELECT bpmn_xml FROM process_diagrams
                        WHERE process_id = :pid
                        ORDER BY version DESC
                        LIMIT 1
                        """
                    ),
                    {"pid": process_id},
                ).scalar()
            if not source:
                continue

            calls = [e for e in parse_bpmn(source).elements if e.element_type == "callActivity"]
            if not calls:
                continue

            # Resolve every UUID-shaped reference in one query.
            candidates = {
                u for u in (_as_uuid(e.called_element) for e in calls) if u and u != process_id
            }
            resolved: set[uuid.UUID] = set()
            if candidates:
                rows = conn.execute(
                    text(
                        """
                        SELECT id FROM cards
                        WHERE id = ANY(:ids) AND type = 'BusinessProcess' AND status = 'ACTIVE'
                        """
                    ),
                    {"ids": list(candidates)},
                )
                resolved = {row[0] for row in rows}

            for element in calls:
                target = _as_uuid(element.called_element)
                if target in resolved:
                    conn.execute(
                        text(
                            """
                            UPDATE process_elements
                            SET called_element = :ref, business_process_id = :bp
                            WHERE process_id = :pid AND bpmn_element_id = :bid
                            """
                        ),
                        {
                            "ref": element.called_element,
                            "bp": target,
                            "pid": process_id,
                            "bid": element.bpmn_element_id,
                        },
                    )
                else:
                    conn.execute(
                        text(
                            """
                            UPDATE process_elements
                            SET called_element = :ref
                            WHERE process_id = :pid AND bpmn_element_id = :bid
                            """
                        ),
                        {
                            "ref": element.called_element,
                            "pid": process_id,
                            "bid": element.bpmn_element_id,
                        },
                    )
        except Exception:  # noqa: BLE001 - one bad diagram must not fail an upgrade
            continue


def downgrade() -> None:
    if "business_process_id" in _columns("process_elements"):
        op.drop_column("process_elements", "business_process_id")
    if "called_element" in _columns("process_elements"):
        op.drop_column("process_elements", "called_element")
