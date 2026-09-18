"""Parse BPMN 2.0 XML and extract elements for EA cross-referencing."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import defusedxml.ElementTree as ET  # noqa: N817

from app.services.bpmn_flow_order import order_flow_nodes

BPMN_NS = "http://www.omg.org/spec/BPMN/20100524/MODEL"

# BPMN element types we extract for EA linking
EXTRACTABLE_TYPES = {
    f"{{{BPMN_NS}}}task": "task",
    f"{{{BPMN_NS}}}userTask": "userTask",
    f"{{{BPMN_NS}}}serviceTask": "serviceTask",
    f"{{{BPMN_NS}}}scriptTask": "scriptTask",
    f"{{{BPMN_NS}}}businessRuleTask": "businessRuleTask",
    f"{{{BPMN_NS}}}sendTask": "sendTask",
    f"{{{BPMN_NS}}}receiveTask": "receiveTask",
    f"{{{BPMN_NS}}}manualTask": "manualTask",
    f"{{{BPMN_NS}}}callActivity": "callActivity",
    f"{{{BPMN_NS}}}subProcess": "subProcess",
    f"{{{BPMN_NS}}}transaction": "transaction",
    f"{{{BPMN_NS}}}adHocSubProcess": "adHocSubProcess",
    f"{{{BPMN_NS}}}exclusiveGateway": "exclusiveGateway",
    f"{{{BPMN_NS}}}parallelGateway": "parallelGateway",
    f"{{{BPMN_NS}}}inclusiveGateway": "inclusiveGateway",
    f"{{{BPMN_NS}}}eventBasedGateway": "eventBasedGateway",
    f"{{{BPMN_NS}}}complexGateway": "complexGateway",
    f"{{{BPMN_NS}}}startEvent": "startEvent",
    f"{{{BPMN_NS}}}endEvent": "endEvent",
    f"{{{BPMN_NS}}}intermediateCatchEvent": "intermediateCatchEvent",
    f"{{{BPMN_NS}}}intermediateThrowEvent": "intermediateThrowEvent",
    f"{{{BPMN_NS}}}boundaryEvent": "boundaryEvent",
    f"{{{BPMN_NS}}}dataObjectReference": "dataObjectReference",
    f"{{{BPMN_NS}}}dataStoreReference": "dataStoreReference",
}

# Flow node types that can contain other flow nodes.
CONTAINER_TYPES = frozenset({"subProcess", "transaction", "adHocSubProcess"})

# Data artefacts. They are extracted so a data object drawn on the diagram can
# be linked to a DataObject card, but they are not *steps*: nothing flows into
# or out of them, so they take no part in the causal ordering and are listed
# after the last flow node instead (a data object ranked as a source would
# float to the top of every element table).
ARTEFACT_TYPES = frozenset({"dataObjectReference", "dataStoreReference"})

EVENT_TYPES = frozenset(
    {
        "startEvent",
        "endEvent",
        "intermediateCatchEvent",
        "intermediateThrowEvent",
        "boundaryEvent",
    }
)

# Element types that carry a `messageRef` directly rather than through an
# event definition.
_MESSAGE_TASK_TYPES = frozenset({"sendTask", "receiveTask"})

_EVENT_DEFINITION_SUFFIX = "EventDefinition"

# Event definitions that point at a root-level definition element via a `*Ref`
# attribute. The referenced element's `name` is what a reader calls the
# message/signal/error — the event itself is usually unnamed.
_DEFINITION_REF_ATTRS = {
    "message": "messageRef",
    "signal": "signalRef",
    "error": "errorRef",
    "escalation": "escalationRef",
}

# Root-level definition elements (children of <definitions>) that the refs
# above resolve against.
_ROOT_DEFINITION_TAGS = ("message", "signal", "error", "escalation")


@dataclass
class ExtractedElement:
    bpmn_element_id: str
    element_type: str
    name: str | None
    documentation: str | None
    lane_name: str | None
    is_automated: bool
    sequence_order: int
    # Sub-type of an event (`message`, `timer`, `signal`, `error`, `escalation`,
    # `conditional`, `link`, `compensation`, `cancel`, `terminate`) — `None` on
    # a plain event and on every non-event element.
    event_definition_type: str | None = None
    # The name of the Message / Signal / Error / Escalation the element refers
    # to, resolved from the root definitions. Also set on send/receive tasks.
    definition_name: str | None = None


@dataclass
class ExtractedMessageFlow:
    """A message flow between two pools (or between nodes of two pools)."""

    bpmn_element_id: str
    name: str | None
    source_ref: str
    target_ref: str
    # Resolved display names: the flow node's name when the ref is a node,
    # else the participant's name, else the raw ref.
    source_name: str | None
    target_name: str | None
    sequence_order: int


@dataclass
class ParsedBpmn:
    elements: list[ExtractedElement] = field(default_factory=list)
    message_flows: list[ExtractedMessageFlow] = field(default_factory=list)


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _walk_flow_nodes(root: Any) -> tuple[list[tuple[str, str, Any]], dict[str, str | None]]:
    """Depth-first pre-order walk returning extractable nodes in document order.

    Also returns, per node, the id of the enclosing sub-process (``None`` at the
    top level) — ElementTree has no parent pointer, so the containment has to be
    tracked during the walk rather than recovered afterwards.

    An id seen twice wins on first occurrence. Duplicate ids are invalid BPMN
    but do occur in the wild, and the callers already upsert `ProcessElement`
    rows on `bpmn_element_id`, so first-wins is what actually gets persisted.
    """
    nodes: list[tuple[str, str, Any]] = []
    parent_of: dict[str, str | None] = {}
    seen: set[str] = set()

    # (element, enclosing sub-process id). Children are pushed reversed so they
    # pop in document order. Iterative so deep nesting can't hit the recursion
    # limit.
    stack: list[tuple[Any, str | None]] = [(root, None)]
    while stack:
        elem, container = stack.pop()
        child_container = container

        element_type = EXTRACTABLE_TYPES.get(elem.tag)
        if element_type is not None:
            elem_id = elem.get("id", "")
            if elem_id and elem_id not in seen:
                seen.add(elem_id)
                nodes.append((elem_id, element_type, elem))
                parent_of[elem_id] = container
                if element_type in CONTAINER_TYPES:
                    child_container = elem_id

        for child in reversed(list(elem)):
            stack.append((child, child_container))

    return nodes, parent_of


def _collect_edges(root: Any, known: set[str]) -> set[tuple[str, str]]:
    """Ordering constraints between extracted flow nodes.

    Both endpoints are filtered against ``known``, which silently drops the refs
    that are not orderable nodes: a dangling ref, a `dataObjectReference`, or a
    message flow that lands on a black-box `participant`. A black-box pool
    contributes no elements, so dropping the edge is correct — resolving
    `participant → processRef → its nodes` would fan one edge out into N and
    distort every rank downstream of it.
    """
    edges: set[tuple[str, str]] = set()

    for tag in ("sequenceFlow", "messageFlow"):
        for flow in root.iter(f"{{{BPMN_NS}}}{tag}"):
            source = flow.get("sourceRef")
            target = flow.get("targetRef")
            if source in known and target in known:
                edges.add((source, target))

    # A boundary event has no incoming sequence flow; without this it would rank
    # as a source and float to the very top of the table.
    for event in root.iter(f"{{{BPMN_NS}}}boundaryEvent"):
        host = event.get("attachedToRef")
        event_id = event.get("id")
        if host in known and event_id in known:
            edges.add((host, event_id))

    return edges


def _root_definition_names(root: Any) -> dict[str, str]:
    """id → display name for the root-level Message / Signal / Error /
    Escalation elements. An error without a name falls back to its code."""
    names: dict[str, str] = {}
    for tag in _ROOT_DEFINITION_TAGS:
        for elem in root.findall(f"{{{BPMN_NS}}}{tag}"):
            elem_id = elem.get("id")
            if not elem_id:
                continue
            name = elem.get("name") or (elem.get("errorCode") if tag == "error" else None)
            if name:
                names[elem_id] = name
    return names


def _event_definition(elem: Any) -> tuple[str | None, Any]:
    """The first `*EventDefinition` child of an event, as ``(type, element)``.

    ``type`` is the tag without its suffix (`messageEventDefinition` →
    `message`). A multiple-definition event is rare and reads as its first
    definition — that is also how bpmn-js picks the icon it draws.
    """
    for child in elem:
        local = _local_name(child.tag)
        if local.endswith(_EVENT_DEFINITION_SUFFIX) and child.tag.startswith(f"{{{BPMN_NS}}}"):
            return local[: -len(_EVENT_DEFINITION_SUFFIX)] or None, child
    return None, None


def _resolve_definition_name(
    element_type: str, elem: Any, definition_names: dict[str, str]
) -> tuple[str | None, str | None]:
    """``(event_definition_type, definition_name)`` for one element."""
    if element_type in _MESSAGE_TASK_TYPES:
        ref = elem.get("messageRef")
        return None, definition_names.get(ref) if ref else None

    if element_type not in EVENT_TYPES:
        return None, None

    definition_type, definition = _event_definition(elem)
    if definition_type is None:
        return None, None

    ref_attr = _DEFINITION_REF_ATTRS.get(definition_type)
    if ref_attr is not None:
        ref = definition.get(ref_attr)
        return definition_type, definition_names.get(ref) if ref else None

    if definition_type == "link":
        return definition_type, definition.get("name") or None

    return definition_type, None


def parse_bpmn(bpmn_xml: str) -> ParsedBpmn:
    """Parse BPMN 2.0 XML into flow nodes, artefacts and message flows.

    ``elements`` is ordered causally — a step follows the steps that lead to
    it — with the data artefacts appended after the last flow node, and
    `sequence_order` is the position in that list. Callers rely on both:
    `/draft-elements` returns the list verbatim, while the persisted element
    tables are re-read with `ORDER BY sequence_order`.

    ``message_flows`` is in document order; its names are resolved against the
    flow nodes first and the participants second, so a flow drawn pool-to-pool
    still reads "Customer → Company".
    """
    root = ET.fromstring(bpmn_xml)

    # Build lane → element mapping
    lane_map: dict[str, str] = {}  # element_id → lane_name
    for lane in root.iter(f"{{{BPMN_NS}}}lane"):
        lane_name = lane.get("name", "")
        # Use findall for direct children only (iter would recurse into nested laneSets)
        for flow_node_ref in lane.findall(f"{{{BPMN_NS}}}flowNodeRef"):
            if flow_node_ref.text:
                lane_map[flow_node_ref.text.strip()] = lane_name

    definition_names = _root_definition_names(root)

    nodes, parent_of = _walk_flow_nodes(root)
    flow_node_ids = [
        elem_id for elem_id, element_type, _ in nodes if element_type not in ARTEFACT_TYPES
    ]
    artefact_ids = [elem_id for elem_id, element_type, _ in nodes if element_type in ARTEFACT_TYPES]
    known = set(flow_node_ids)
    edges = _collect_edges(root, known)

    by_id: dict[str, ExtractedElement] = {}
    for elem_id, element_type, elem in nodes:
        name = elem.get("name")

        # Extract documentation
        doc_elem = elem.find(f"{{{BPMN_NS}}}documentation")
        documentation = doc_elem.text if doc_elem is not None and doc_elem.text else None

        # Determine if automated (serviceTask, scriptTask, businessRuleTask)
        is_automated = element_type in ("serviceTask", "scriptTask", "businessRuleTask")

        event_definition_type, definition_name = _resolve_definition_name(
            element_type, elem, definition_names
        )

        by_id[elem_id] = ExtractedElement(
            bpmn_element_id=elem_id,
            element_type=element_type,
            name=name,
            documentation=documentation,
            lane_name=lane_map.get(elem_id),
            is_automated=is_automated,
            sequence_order=0,
            event_definition_type=event_definition_type,
            definition_name=definition_name,
        )

    ordered_ids = order_flow_nodes(flow_node_ids, edges, parent_of) + artefact_ids

    elements: list[ExtractedElement] = []
    for order, elem_id in enumerate(ordered_ids):
        element = by_id[elem_id]
        element.sequence_order = order
        elements.append(element)

    return ParsedBpmn(elements=elements, message_flows=_collect_message_flows(root, by_id))


def _collect_message_flows(
    root: Any, by_id: dict[str, ExtractedElement]
) -> list[ExtractedMessageFlow]:
    participant_names: dict[str, str] = {}
    for participant in root.iter(f"{{{BPMN_NS}}}participant"):
        pid = participant.get("id")
        if pid:
            participant_names[pid] = participant.get("name") or ""

    def resolve(ref: str | None) -> str | None:
        if not ref:
            return None
        element = by_id.get(ref)
        if element is not None:
            return element.name or None
        return participant_names.get(ref) or None

    flows: list[ExtractedMessageFlow] = []
    seen: set[str] = set()
    for flow in root.iter(f"{{{BPMN_NS}}}messageFlow"):
        flow_id = flow.get("id", "")
        source = flow.get("sourceRef")
        target = flow.get("targetRef")
        if not flow_id or flow_id in seen or not source or not target:
            continue
        seen.add(flow_id)
        flows.append(
            ExtractedMessageFlow(
                bpmn_element_id=flow_id,
                name=flow.get("name") or None,
                source_ref=source,
                target_ref=target,
                source_name=resolve(source),
                target_name=resolve(target),
                sequence_order=len(flows),
            )
        )
    return flows


def parse_bpmn_xml(bpmn_xml: str) -> list[ExtractedElement]:
    """Parse BPMN 2.0 XML and return extracted elements in process-flow order.

    Thin wrapper over :func:`parse_bpmn` kept for the callers (and the
    backfill migrations) that only need the element list.
    """
    return parse_bpmn(bpmn_xml).elements
