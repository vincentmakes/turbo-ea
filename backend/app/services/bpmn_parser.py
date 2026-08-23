"""Parse BPMN 2.0 XML and extract elements for EA cross-referencing."""

from __future__ import annotations

import heapq
from dataclasses import dataclass

import defusedxml.ElementTree as ET  # noqa: N817

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

FLOW_TYPES = (
    f"{{{BPMN_NS}}}sequenceFlow",
    f"{{{BPMN_NS}}}messageFlow",
)


@dataclass
class ExtractedElement:
    bpmn_element_id: str
    element_type: str
    name: str | None
    documentation: str | None
    lane_name: str | None
    is_automated: bool
    sequence_order: int


def _strongly_connected_components(
    node_ids: list[str], adjacency: dict[str, set[str]]
) -> list[list[str]]:
    """Return graph SCCs in deterministic order.

    BPMN sequence flows may contain loops. Collapsing each loop into a strongly
    connected component lets us derive a stable causal order without pretending
    a cyclic process has a conventional topological sort.
    """
    next_index = 0
    index_by_node: dict[str, int] = {}
    lowlink: dict[str, int] = {}
    stack: list[str] = []
    on_stack: set[str] = set()
    components: list[list[str]] = []

    def visit(node_id: str) -> None:
        nonlocal next_index
        index_by_node[node_id] = next_index
        lowlink[node_id] = next_index
        next_index += 1
        stack.append(node_id)
        on_stack.add(node_id)

        for target_id in adjacency[node_id]:
            if target_id not in index_by_node:
                visit(target_id)
                lowlink[node_id] = min(lowlink[node_id], lowlink[target_id])
            elif target_id in on_stack:
                lowlink[node_id] = min(lowlink[node_id], index_by_node[target_id])

        if lowlink[node_id] != index_by_node[node_id]:
            return

        component: list[str] = []
        while True:
            member = stack.pop()
            on_stack.remove(member)
            component.append(member)
            if member == node_id:
                break
        components.append(component)

    for node_id in node_ids:
        if node_id not in index_by_node:
            visit(node_id)

    return components


def _chronological_element_ids(root: ET.Element, node_ids: list[str]) -> list[str]:
    """Order BPMN elements by causal flow, with XML order as a stable tie-breaker.

    Sequence flows define order inside a process and message flows add ordering
    constraints between pools. Parallel/alternative nodes at the same causal
    depth retain their order in the source XML. Cycles are treated as one causal
    level and their members also retain XML order.
    """
    if not node_ids:
        return []

    xml_position = {node_id: position for position, node_id in enumerate(node_ids)}
    adjacency = {node_id: set() for node_id in node_ids}

    for flow_tag in FLOW_TYPES:
        for flow in root.iter(flow_tag):
            source_id = flow.get("sourceRef")
            target_id = flow.get("targetRef")
            if source_id in adjacency and target_id in adjacency and source_id != target_id:
                adjacency[source_id].add(target_id)

    components = _strongly_connected_components(node_ids, adjacency)
    component_by_node: dict[str, int] = {}
    component_position: list[int] = []
    for component_id, component in enumerate(components):
        for node_id in component:
            component_by_node[node_id] = component_id
        component_position.append(min(xml_position[node_id] for node_id in component))

    component_adjacency = {component_id: set() for component_id in range(len(components))}
    indegree = [0] * len(components)
    for source_id, target_ids in adjacency.items():
        source_component = component_by_node[source_id]
        for target_id in target_ids:
            target_component = component_by_node[target_id]
            if source_component == target_component:
                continue
            if target_component not in component_adjacency[source_component]:
                component_adjacency[source_component].add(target_component)
                indegree[target_component] += 1

    level = [0] * len(components)
    ready = [
        (component_position[component_id], component_id)
        for component_id, degree in enumerate(indegree)
        if degree == 0
    ]
    heapq.heapify(ready)

    while ready:
        _, component_id = heapq.heappop(ready)
        for target_component in component_adjacency[component_id]:
            level[target_component] = max(level[target_component], level[component_id] + 1)
            indegree[target_component] -= 1
            if indegree[target_component] == 0:
                heapq.heappush(
                    ready,
                    (component_position[target_component], target_component),
                )

    return sorted(
        node_ids,
        key=lambda node_id: (
            level[component_by_node[node_id]],
            xml_position[node_id],
        ),
    )


def parse_bpmn_xml(bpmn_xml: str) -> list[ExtractedElement]:
    """Parse BPMN 2.0 XML and return extracted elements."""
    root = ET.fromstring(bpmn_xml)
    elements: list[ExtractedElement] = []
    # Build lane → element mapping
    lane_map: dict[str, str] = {}  # element_id → lane_name
    for lane in root.iter(f"{{{BPMN_NS}}}lane"):
        lane_name = lane.get("name", "")
        # Use findall for direct children only (iter would recurse into nested laneSets)
        for flow_node_ref in lane.findall(f"{{{BPMN_NS}}}flowNodeRef"):
            if flow_node_ref.text:
                lane_map[flow_node_ref.text.strip()] = lane_name

    # Collect extractable nodes in XML document order first. The old parser iterated
    # EXTRACTABLE_TYPES and therefore grouped the EA-linking table by BPMN type.
    extractable: list[tuple[ET.Element, str]] = []
    for elem in root.iter():
        element_type = EXTRACTABLE_TYPES.get(elem.tag)
        if element_type is None or not elem.get("id"):
            continue
        extractable.append((elem, element_type))

    ordered_ids = _chronological_element_ids(
        root,
        [elem.get("id", "") for elem, _ in extractable],
    )
    order_by_id = {elem_id: order for order, elem_id in enumerate(ordered_ids)}

    for elem, element_type in extractable:
        elem_id = elem.get("id", "")
        name = elem.get("name")

        # Extract documentation
        doc_elem = elem.find(f"{{{BPMN_NS}}}documentation")
        documentation = doc_elem.text if doc_elem is not None and doc_elem.text else None
        # Determine if automated (serviceTask, scriptTask, businessRuleTask)
        is_automated = element_type in ("serviceTask", "scriptTask", "businessRuleTask")
        elements.append(
            ExtractedElement(
                bpmn_element_id=elem_id,
                element_type=element_type,
                name=name,
                documentation=documentation,
                lane_name=lane_map.get(elem_id),
                is_automated=is_automated,
                sequence_order=order_by_id[elem_id],
            )
        )

    elements.sort(key=lambda element: element.sequence_order)
    return elements
