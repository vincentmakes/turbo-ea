"""Parse BPMN 2.0 XML and extract elements for EA cross-referencing."""

from __future__ import annotations

from dataclasses import dataclass
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
    f"{{{BPMN_NS}}}exclusiveGateway": "exclusiveGateway",
    f"{{{BPMN_NS}}}parallelGateway": "parallelGateway",
    f"{{{BPMN_NS}}}inclusiveGateway": "inclusiveGateway",
    f"{{{BPMN_NS}}}eventBasedGateway": "eventBasedGateway",
    f"{{{BPMN_NS}}}startEvent": "startEvent",
    f"{{{BPMN_NS}}}endEvent": "endEvent",
    f"{{{BPMN_NS}}}intermediateCatchEvent": "intermediateCatchEvent",
    f"{{{BPMN_NS}}}intermediateThrowEvent": "intermediateThrowEvent",
    f"{{{BPMN_NS}}}boundaryEvent": "boundaryEvent",
}

# Flow node types that can contain other flow nodes.
CONTAINER_TYPES = frozenset({"subProcess"})


@dataclass
class ExtractedElement:
    bpmn_element_id: str
    element_type: str
    name: str | None
    documentation: str | None
    lane_name: str | None
    is_automated: bool
    sequence_order: int


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


def parse_bpmn_xml(bpmn_xml: str) -> list[ExtractedElement]:
    """Parse BPMN 2.0 XML and return extracted elements in process-flow order.

    The returned list is ordered causally — a step follows the steps that lead
    to it — and `sequence_order` is the position in that list. Callers rely on
    both: `/draft-elements` returns the list verbatim, while the persisted
    element tables are re-read with `ORDER BY sequence_order`.
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

    nodes, parent_of = _walk_flow_nodes(root)
    known = {elem_id for elem_id, _, _ in nodes}
    edges = _collect_edges(root, known)

    by_id: dict[str, ExtractedElement] = {}
    for elem_id, element_type, elem in nodes:
        name = elem.get("name")

        # Extract documentation
        doc_elem = elem.find(f"{{{BPMN_NS}}}documentation")
        documentation = doc_elem.text if doc_elem is not None and doc_elem.text else None

        # Determine if automated (serviceTask, scriptTask, businessRuleTask)
        is_automated = element_type in ("serviceTask", "scriptTask", "businessRuleTask")

        by_id[elem_id] = ExtractedElement(
            bpmn_element_id=elem_id,
            element_type=element_type,
            name=name,
            documentation=documentation,
            lane_name=lane_map.get(elem_id),
            is_automated=is_automated,
            sequence_order=0,
        )

    ordered_ids = order_flow_nodes([elem_id for elem_id, _, _ in nodes], edges, parent_of)

    elements: list[ExtractedElement] = []
    for order, elem_id in enumerate(ordered_ids):
        element = by_id[elem_id]
        element.sequence_order = order
        elements.append(element)
    return elements
