"""Backfill: re-order ``process_elements.sequence_order`` by process flow.

Until this release the BPMN parser numbered extracted elements by iterating
its element-type table, so the Process Flow element tables listed every user
task, then every send task, then the gateways, and finally the start and end
events — with the step that begins the process near the bottom
(`#978 <https://github.com/vincentmakes/turbo-ea/issues/978>`_). The parser now
ranks elements causally instead.

``sequence_order`` is persisted, and the only writers are "save diagram" and
"approve flow version". Without this backfill every process already published
on an existing install would keep the old numbering until somebody happened to
edit it — and for a published flow that means pushing a new revision through
the approval workflow purely to fix a display order, which is not an audit
event anyone should have to fake.

Source XML per process, in order of preference:

1. the newest **published** ``process_flow_versions`` row — the modern flow
   editor writes here, and ``approve()`` populates ``process_elements`` from it
   without ever creating a ``ProcessDiagram`` row, so reading only
   ``process_diagrams`` would skip exactly the processes this is about;
2. otherwise the newest ``process_diagrams`` row.

Implementation note: this imports ``parse_bpmn_xml`` from the application
rather than freezing a copy of the algorithm into the revision, which is
unusual for a migration here and deliberate. ``sequence_order`` is entirely
derived from the stored XML and carries no user intent, so "recompute with
whatever the current parser produces" is the correct semantic — a future
re-run would simply produce the newer correct order. Vendoring the ranking
code to protect a derived display column would cost far more than it buys.

Each process is guarded independently: a stored diagram that no longer parses
is left exactly as it is rather than failing an upgrade, because migrations run
during startup. Elements the parser no longer produces are also left alone —
this is a re-ordering, not a re-sync.

Revision ID: 138
Revises: 137
"""

from collections.abc import Sequence
from typing import Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "138"
down_revision: Union[str, None] = "137"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Imported lazily so the module import cost is only paid when the migration
    # actually runs.
    from app.services.bpmn_parser import parse_bpmn_xml

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

            for element in parse_bpmn_xml(source):
                conn.execute(
                    text(
                        """
                        UPDATE process_elements
                        SET sequence_order = :seq
                        WHERE process_id = :pid AND bpmn_element_id = :bid
                        """
                    ),
                    {
                        "seq": element.sequence_order,
                        "pid": process_id,
                        "bid": element.bpmn_element_id,
                    },
                )
        except Exception:  # noqa: BLE001 - one bad diagram must not fail an upgrade
            continue


def downgrade() -> None:
    # The previous ordering was an artefact of the parser's iteration order and
    # carries no information worth restoring.
    pass
