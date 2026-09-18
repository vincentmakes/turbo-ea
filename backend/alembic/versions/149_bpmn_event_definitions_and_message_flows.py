"""Record BPMN event definitions, data artefacts and message flows.

Two additive columns on ``process_elements`` — ``event_definition_type`` (the
event's sub-type: message, timer, signal, error, ...) and ``definition_name``
(the name of the Message / Signal / Error the element refers to) — and a new
``process_message_flows`` table for the messages exchanged between pools, with
an optional ``interface_id`` link to an Interface card.

Both are entirely derived from the stored BPMN XML, so — following migration
138 — the existing published flows are re-parsed with the *current* parser and
backfilled here rather than waiting for the next publish: the sub-type columns
are UPDATEd on rows that already exist, the message flows are INSERTed (the
table is new, so nothing can be overwritten), and the elements the old parser
never extracted at all — data objects, data stores, transactions, ad-hoc
sub-processes, complex gateways — are INSERTed with no EA links. Only
processes that already hold element rows are touched, so a process whose
elements were deleted on purpose stays empty. Every per-process step is
wrapped so one unparseable diagram cannot fail a startup upgrade.

The FK constraint names match what ``create_all`` produces from the model so
a fresh install and a migrated one end up identical.

Revision ID: 149
Revises: 148
Create Date: 2026-09-18
"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import text

from alembic import op

revision: str = "149"
down_revision: Union[str, None] = "148"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    from sqlalchemy import inspect as sa_inspect

    return {c["name"] for c in sa_inspect(op.get_bind()).get_columns(table)}


def _has_table(table: str) -> bool:
    from sqlalchemy import inspect as sa_inspect

    return sa_inspect(op.get_bind()).has_table(table)


def upgrade() -> None:
    if "event_definition_type" not in _columns("process_elements"):
        op.add_column(
            "process_elements",
            sa.Column("event_definition_type", sa.String(length=50), nullable=True),
        )
    if "definition_name" not in _columns("process_elements"):
        op.add_column(
            "process_elements",
            sa.Column("definition_name", sa.String(length=500), nullable=True),
        )

    if not _has_table("process_message_flows"):
        op.create_table(
            "process_message_flows",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("process_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("bpmn_element_id", sa.String(length=200), nullable=False),
            sa.Column("name", sa.String(length=500), nullable=True),
            sa.Column("source_ref", sa.String(length=200), nullable=False),
            sa.Column("target_ref", sa.String(length=200), nullable=False),
            sa.Column("source_name", sa.String(length=500), nullable=True),
            sa.Column("target_name", sa.String(length=500), nullable=True),
            sa.Column("sequence_order", sa.Integer(), nullable=True),
            sa.Column("interface_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.ForeignKeyConstraint(
                ["process_id"],
                ["cards.id"],
                name="process_message_flows_process_id_fkey",
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["interface_id"],
                ["cards.id"],
                name="process_message_flows_interface_id_fkey",
                ondelete="SET NULL",
            ),
        )
        op.create_index(
            "ix_process_message_flows_process_id",
            "process_message_flows",
            ["process_id"],
        )

    _backfill()


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

            parsed = parse_bpmn(source)
            existing = {
                row[0]
                for row in conn.execute(
                    text("SELECT bpmn_element_id FROM process_elements WHERE process_id = :pid"),
                    {"pid": process_id},
                )
            }

            for element in parsed.elements:
                if element.bpmn_element_id in existing:
                    conn.execute(
                        text(
                            """
                            UPDATE process_elements
                            SET event_definition_type = :edt,
                                definition_name = :dn,
                                sequence_order = :seq
                            WHERE process_id = :pid AND bpmn_element_id = :bid
                            """
                        ),
                        {
                            "edt": element.event_definition_type,
                            "dn": element.definition_name,
                            "seq": element.sequence_order,
                            "pid": process_id,
                            "bid": element.bpmn_element_id,
                        },
                    )
                else:
                    # An element the *old* parser never produced — a data
                    # object, a transaction, a complex gateway. Inserting it
                    # here is exactly what the next save or publish would do,
                    # with no EA links, so the table matches the diagram now
                    # rather than after someone happens to re-publish.
                    conn.execute(
                        text(
                            """
                            INSERT INTO process_elements
                                (id, created_at, updated_at, process_id, bpmn_element_id,
                                 element_type, name, documentation, lane_name, is_automated,
                                 sequence_order, event_definition_type, definition_name,
                                 custom_fields)
                            VALUES
                                (gen_random_uuid(), now(), now(), :pid, :bid,
                                 :etype, :name, :doc, :lane, :auto,
                                 :seq, :edt, :dn, '{}'::jsonb)
                            """
                        ),
                        {
                            "pid": process_id,
                            "bid": element.bpmn_element_id,
                            "etype": element.element_type,
                            "name": element.name,
                            "doc": element.documentation,
                            "lane": element.lane_name,
                            "auto": element.is_automated,
                            "seq": element.sequence_order,
                            "edt": element.event_definition_type,
                            "dn": element.definition_name,
                        },
                    )

            existing_flows = {
                row[0]
                for row in conn.execute(
                    text(
                        "SELECT bpmn_element_id FROM process_message_flows WHERE process_id = :pid"
                    ),
                    {"pid": process_id},
                )
            }
            for flow in parsed.message_flows:
                if flow.bpmn_element_id in existing_flows:
                    continue
                conn.execute(
                    text(
                        """
                        INSERT INTO process_message_flows
                            (id, created_at, updated_at, process_id, bpmn_element_id, name,
                             source_ref, target_ref, source_name, target_name, sequence_order)
                        VALUES
                            (gen_random_uuid(), now(), now(), :pid, :bid, :name,
                             :sref, :tref, :sname, :tname, :seq)
                        """
                    ),
                    {
                        "pid": process_id,
                        "bid": flow.bpmn_element_id,
                        "name": flow.name,
                        "sref": flow.source_ref,
                        "tref": flow.target_ref,
                        "sname": flow.source_name,
                        "tname": flow.target_name,
                        "seq": flow.sequence_order,
                    },
                )
        except Exception:  # noqa: BLE001 - one bad diagram must not fail an upgrade
            continue


def downgrade() -> None:
    if _has_table("process_message_flows"):
        op.drop_index("ix_process_message_flows_process_id", table_name="process_message_flows")
        op.drop_table("process_message_flows")
    if "definition_name" in _columns("process_elements"):
        op.drop_column("process_elements", "definition_name")
    if "event_definition_type" in _columns("process_elements"):
        op.drop_column("process_elements", "event_definition_type")
