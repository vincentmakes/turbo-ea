"""Parse BPMN 2.0 XML and extract elements for EA cross-referencing."""

from __future__ import annotations

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


@dataclass
class ExtractedElement:
    bpmn_element_id: str
    element_type: str
    name: str | None
    documentation: str | None
    lane_name: str | None
    is_automated: bool
    sequence_order: int


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

    order = 0
    for tag, element_type in EXTRACTABLE_TYPES.items():
        for elem in root.iter(tag):
            elem_id = elem.get("id", "")
            if not elem_id:
                continue

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
                    sequence_order=order,
                )
            )
            order += 1

    return elements
