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
* **A step's process link is both.** The XML's process reference — a call
  activity's ``calledElement``, else ``turboea:processRef`` on any flow node
  (``ExtractedElement.process_reference``) — is parser data; when it holds
  the UUID of an ACTIVE BusinessProcess card (the modeler writes one when a
  process is picked) **the XML wins** and ``business_process_id`` is set from
  it. When it does not resolve — a diagram imported from another tool carries
  that tool's own process id, or nothing at all — a link the user made in the
  element table is **kept**, like every other link. A data artefact is not a
  step and never carries the link.
* Flush, never commit: the caller owns the transaction.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.process_element import ProcessElement
from app.models.process_message_flow import ProcessMessageFlow
from app.services.bpmn_parser import ARTEFACT_TYPES, ParsedBpmn

DraftLinkApplier = Callable[[ProcessElement, dict], None]


def as_card_uuid(value: str | None) -> uuid.UUID | None:
    """The UUID a ``calledElement`` holds, or ``None`` for a foreign reference."""
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


async def resolve_process_references(
    db: AsyncSession, process_id: uuid.UUID, parsed: ParsedBpmn
) -> dict[str, uuid.UUID]:
    """``bpmn_element_id`` → BusinessProcess card id for every step whose
    process reference is the UUID of an ACTIVE BusinessProcess card other than
    the process itself. One query for the whole diagram."""
    candidates: dict[str, uuid.UUID] = {}
    for ext in parsed.elements:
        if ext.element_type in ARTEFACT_TYPES:
            continue
        target = as_card_uuid(ext.process_reference)
        if target and target != process_id:
            candidates[ext.bpmn_element_id] = target
    if not candidates:
        return {}
    rows = await db.execute(
        select(Card.id).where(
            Card.id.in_(set(candidates.values())),
            Card.type == "BusinessProcess",
            Card.status == "ACTIVE",
        )
    )
    active = {row[0] for row in rows.all()}
    return {bid: cid for bid, cid in candidates.items() if cid in active}


#: The card type each step link takes. The four single links are the target
#: type of the relation each one mints (``ELEMENT_LINK_RELATION_MAP`` in
#: ``element_relation_sync``: relProcessToApp → Application, relProcessToDataObj
#: → DataObject, relProcessToITC → ITComponent, relProcessCalls →
#: BusinessProcess, as seeded); the informative M:N link takes Organization,
#: as the published element table has always checked it. The modeler's
#: pickers offer the same types (``LINK_KIND_TYPE``, ``calledProcess.ts``).
#: Pinned against the seeded relation types by
#: ``tests/services/test_process_element_sync.py``.
ELEMENT_LINK_CARD_TYPES: dict[str, str] = {
    "application_id": "Application",
    "data_object_id": "DataObject",
    "it_component_id": "ITComponent",
    "business_process_id": "BusinessProcess",
    "organization_ids": "Organization",
}


def _link_card_id(key: str, value: object) -> uuid.UUID:
    """``value`` as a card id for the ``key`` link, or a 400."""
    if isinstance(value, str):
        try:
            return uuid.UUID(value)
        except ValueError:
            pass
    raise HTTPException(400, f"{key} must be a card id (UUID)")


def normalise_draft_link_body(body: dict) -> dict[str, set[uuid.UUID]]:
    """The card ids a draft-link body names, per link; a 400 for any value
    that is not a card id, before anything is looked up or stored.

    ``body`` is rewritten in place to the canonical id strings, the form every
    reader compares against (``get_draft_elements``' name map, publishing's set
    of valid ids), so an id sent in another spelling is not dropped later. An
    empty single link (``None`` / ``""``) and an empty or ``None``
    ``organization_ids`` name nothing: they are clears, or "say nothing"."""
    named: dict[str, set[uuid.UUID]] = {}
    for key in ("application_id", "data_object_id", "it_component_id", "business_process_id"):
        value = body.get(key)
        if value in (None, ""):
            continue
        card_id = _link_card_id(key, value)
        body[key] = str(card_id)
        named[key] = {card_id}
    orgs = body.get("organization_ids")
    if orgs is not None:
        if not isinstance(orgs, list):
            raise HTTPException(400, "organization_ids must be a list of card ids")
        card_ids = [_link_card_id("organization_ids", org) for org in orgs if org]
        body["organization_ids"] = [str(card_id) for card_id in card_ids]
        named["organization_ids"] = set(card_ids)
    return named


async def validate_link_cards(db: AsyncSession, named: dict[str, set[uuid.UUID]]) -> None:
    """Every id in ``named`` must be an ACTIVE card of the type its link takes
    (``ELEMENT_LINK_CARD_TYPES``): a card that does not exist or is archived
    answers 404 — publishing drops such a link anyway — and a card of another
    type 400. The caller has already turned away cards hidden from the user
    with a 404, so naming the type here reveals nothing they cannot read."""
    ids = set().union(*named.values())
    if not ids:
        return
    rows = await db.execute(select(Card.id, Card.type, Card.status).where(Card.id.in_(ids)))
    found = {card_id: (card_type, status) for card_id, card_type, status in rows.all()}
    for key, key_ids in named.items():
        wanted = ELEMENT_LINK_CARD_TYPES[key]
        for card_id in key_ids:
            card_type, status = found.get(card_id, (None, None))
            if status != "ACTIVE":
                raise HTTPException(404, "Card not found")
            if card_type != wanted:
                raise HTTPException(400, f"{key} takes a card of type {wanted}, not {card_type}")


def stored_link_ids(link: dict, key: str) -> set[uuid.UUID]:
    """The card ids a stored draft link already holds under ``key``."""
    values = link.get(key) if key == "organization_ids" else [link.get(key)]
    return {card_id for value in values or [] if (card_id := as_card_uuid(value))}


async def validate_process_link(db: AsyncSession, process_id: uuid.UUID, value: str) -> uuid.UUID:
    """The card id a manual process link may point at, or an HTTP error.

    Shared by the published element table and the draft pre-link route so the
    two cannot disagree: an ACTIVE BusinessProcess card (404 when missing or
    archived, 400 when it is another type of card) that is not the process
    itself (400).
    """
    target = as_card_uuid(value)
    if target is None:
        raise HTTPException(400, "Invalid business process id")
    if target == process_id:
        raise HTTPException(400, "A process cannot call itself")
    await validate_link_cards(db, {"business_process_id": {target}})
    return target


async def sync_process_elements(
    db: AsyncSession,
    process_id: uuid.UUID,
    parsed: ParsedBpmn,
    *,
    draft_links: dict[str, dict] | None = None,
    apply_draft_link: DraftLinkApplier | None = None,
) -> list[ProcessElement]:
    """Upsert ``process_elements`` for ``process_id`` from ``parsed``.

    ``draft_links`` maps ``bpmn_element_id`` → the pre-links recorded on a
    draft; ``apply_draft_link`` is the workflow's applier, invoked for every
    element that has an entry (after the parser-derived columns are written).
    Returns the surviving rows, in XML order, so a caller can mint relations
    from the links they now carry.
    """
    existing = await db.execute(
        select(ProcessElement).where(ProcessElement.process_id == process_id)
    )
    old_by_bpmn_id = {e.bpmn_element_id: e for e in existing.scalars().all()}
    called = await resolve_process_references(db, process_id, parsed)

    new_bpmn_ids = {e.bpmn_element_id for e in parsed.elements}
    for old_id, old_elem in old_by_bpmn_id.items():
        if old_id not in new_bpmn_ids:
            await db.delete(old_elem)

    rows: list[ProcessElement] = []
    for ext in parsed.elements:
        elem = old_by_bpmn_id.get(ext.bpmn_element_id)
        if elem is None:
            elem = ProcessElement(process_id=process_id, bpmn_element_id=ext.bpmn_element_id)
            db.add(elem)
        rows.append(elem)
        elem.element_type = ext.element_type
        elem.name = ext.name
        elem.documentation = ext.documentation
        elem.lane_name = ext.lane_name
        elem.is_automated = ext.is_automated
        elem.sequence_order = ext.sequence_order
        elem.event_definition_type = ext.event_definition_type
        elem.definition_name = ext.definition_name

        if ext.element_type in ARTEFACT_TYPES:
            elem.called_element = None
            elem.business_process_id = None
        else:
            # `called_element` stores the *effective* reference (see the
            # module docstring) — a call activity's calledElement, else the
            # turboea:processRef any step may carry.
            elem.called_element = ext.process_reference
            resolved = called.get(ext.bpmn_element_id)
            if resolved is not None:
                elem.business_process_id = resolved

        if draft_links and apply_draft_link is not None:
            link = draft_links.get(ext.bpmn_element_id)
            if link:
                apply_draft_link(elem, link)
    return rows


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
