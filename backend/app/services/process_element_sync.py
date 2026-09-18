"""Upsert the rows derived from a process's BPMN XML.

Both write paths — the legacy ``PUT /diagram`` save and the approve/publish
step of the flow workflow — extract the same rows from the same XML and used
to carry a verbatim copy of this upsert each. One helper, so a new
parser-derived column is added in one place.

The rules the helper encodes:

* **EA links survive a re-parse.** A row is matched on ``bpmn_element_id`` and
  updated in place, so the Application / Data Object / IT Component links (and
  a message flow's Interface link) a user set are kept as long as the element
  is still in the diagram. Rows for elements no longer in the XML are deleted.
* **Parser-derived columns are always overwritten** — they are a function of
  the XML, never edited by hand.
* Flush, never commit: the caller owns the transaction.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.process_element import ProcessElement
from app.models.process_message_flow import ProcessMessageFlow
from app.services.bpmn_parser import ParsedBpmn

DraftLinkApplier = Callable[[ProcessElement, dict], None]


async def sync_process_elements(
    db: AsyncSession,
    process_id: uuid.UUID,
    parsed: ParsedBpmn,
    *,
    draft_links: dict[str, dict] | None = None,
    apply_draft_link: DraftLinkApplier | None = None,
) -> None:
    """Upsert ``process_elements`` for ``process_id`` from ``parsed``.

    ``draft_links`` maps ``bpmn_element_id`` → the pre-links recorded on a
    draft; ``apply_draft_link`` is the workflow's applier, invoked for every
    element that has an entry (after the parser-derived columns are written).
    """
    existing = await db.execute(
        select(ProcessElement).where(ProcessElement.process_id == process_id)
    )
    old_by_bpmn_id = {e.bpmn_element_id: e for e in existing.scalars().all()}

    new_bpmn_ids = {e.bpmn_element_id for e in parsed.elements}
    for old_id, old_elem in old_by_bpmn_id.items():
        if old_id not in new_bpmn_ids:
            await db.delete(old_elem)

    for ext in parsed.elements:
        elem = old_by_bpmn_id.get(ext.bpmn_element_id)
        if elem is None:
            elem = ProcessElement(process_id=process_id, bpmn_element_id=ext.bpmn_element_id)
            db.add(elem)
        elem.element_type = ext.element_type
        elem.name = ext.name
        elem.documentation = ext.documentation
        elem.lane_name = ext.lane_name
        elem.is_automated = ext.is_automated
        elem.sequence_order = ext.sequence_order
        elem.event_definition_type = ext.event_definition_type
        elem.definition_name = ext.definition_name

        if draft_links and apply_draft_link is not None:
            link = draft_links.get(ext.bpmn_element_id)
            if link:
                apply_draft_link(elem, link)


async def sync_process_message_flows(
    db: AsyncSession, process_id: uuid.UUID, parsed: ParsedBpmn
) -> None:
    """Upsert ``process_message_flows`` for ``process_id`` from ``parsed``,
    keeping each surviving flow's ``interface_id``."""
    existing = await db.execute(
        select(ProcessMessageFlow).where(ProcessMessageFlow.process_id == process_id)
    )
    old_by_bpmn_id = {f.bpmn_element_id: f for f in existing.scalars().all()}

    new_bpmn_ids = {f.bpmn_element_id for f in parsed.message_flows}
    for old_id, old_flow in old_by_bpmn_id.items():
        if old_id not in new_bpmn_ids:
            await db.delete(old_flow)

    for ext in parsed.message_flows:
        flow = old_by_bpmn_id.get(ext.bpmn_element_id)
        if flow is None:
            flow = ProcessMessageFlow(process_id=process_id, bpmn_element_id=ext.bpmn_element_id)
            db.add(flow)
        flow.name = ext.name
        flow.source_ref = ext.source_ref
        flow.target_ref = ext.target_ref
        flow.source_name = ext.source_name
        flow.target_name = ext.target_name
        flow.sequence_order = ext.sequence_order


def message_flow_to_dict(flow: ProcessMessageFlow) -> dict:
    return {
        "id": str(flow.id),
        "process_id": str(flow.process_id),
        "bpmn_element_id": flow.bpmn_element_id,
        "name": flow.name,
        "source_ref": flow.source_ref,
        "target_ref": flow.target_ref,
        "source_name": flow.source_name,
        "target_name": flow.target_name,
        "sequence_order": flow.sequence_order,
        "interface_id": str(flow.interface_id) if flow.interface_id else None,
        "interface_name": flow.interface.name if flow.interface else None,
    }
