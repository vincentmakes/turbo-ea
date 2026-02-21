"""Unit tests for the BPMN 2.0 XML parser.

These tests do NOT require a database — they test pure XML parsing only.
"""

from __future__ import annotations

import pytest

from app.services.bpmn_parser import parse_bpmn_xml

# ---------------------------------------------------------------------------
# Sample BPMN XML fixtures
# ---------------------------------------------------------------------------

MINIMAL_BPMN = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             id="definitions_1">
  <process id="Process_1" isExecutable="false">
    <startEvent id="start_1" name="Start" />
    <endEvent id="end_1" name="End" />
  </process>
</definitions>
"""

TASKS_BPMN = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             id="definitions_1">
  <process id="Process_1" isExecutable="false">
    <task id="task_1" name="Review Request" />
    <userTask id="ut_1" name="Approve Order" />
    <serviceTask id="st_1" name="Send Email" />
    <scriptTask id="sct_1" name="Run Script" />
    <businessRuleTask id="brt_1" name="Check Policy" />
    <sendTask id="send_1" name="Notify" />
    <receiveTask id="recv_1" name="Wait for Response" />
    <manualTask id="man_1" name="Physical Check" />
  </process>
</definitions>
"""

GATEWAYS_BPMN = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             id="definitions_1">
  <process id="Process_1" isExecutable="false">
    <exclusiveGateway id="gw_exc" name="Is Approved?" />
    <parallelGateway id="gw_par" name="Split" />
    <inclusiveGateway id="gw_inc" name="Options" />
    <eventBasedGateway id="gw_evt" name="Wait" />
  </process>
</definitions>
"""

LANES_BPMN = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             id="definitions_1">
  <process id="Process_1" isExecutable="false">
    <laneSet id="ls_1">
      <lane id="lane_mgr" name="Manager">
        <flowNodeRef>task_approve</flowNodeRef>
      </lane>
      <lane id="lane_sys" name="System">
        <flowNodeRef>st_send</flowNodeRef>
      </lane>
    </laneSet>
    <task id="task_approve" name="Approve" />
    <serviceTask id="st_send" name="Send Notification" />
    <task id="task_unassigned" name="Unassigned Task" />
  </process>
</definitions>
"""

DOCUMENTATION_BPMN = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             id="definitions_1">
  <process id="Process_1" isExecutable="false">
    <task id="task_doc" name="Documented Task">
      <documentation>This task does important work.</documentation>
    </task>
    <task id="task_nodoc" name="Undocumented Task" />
  </process>
</definitions>
"""


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestParseMinimal:
    def test_extracts_start_and_end_events(self):
        elements = parse_bpmn_xml(MINIMAL_BPMN)
        types = {e.element_type for e in elements}
        assert "startEvent" in types
        assert "endEvent" in types

    def test_element_count(self):
        elements = parse_bpmn_xml(MINIMAL_BPMN)
        assert len(elements) == 2

    def test_names_populated(self):
        elements = parse_bpmn_xml(MINIMAL_BPMN)
        names = {e.name for e in elements}
        assert "Start" in names
        assert "End" in names

    def test_events_not_automated(self):
        elements = parse_bpmn_xml(MINIMAL_BPMN)
        for e in elements:
            assert e.is_automated is False


class TestParseTasks:
    def test_extracts_all_task_types(self):
        elements = parse_bpmn_xml(TASKS_BPMN)
        types = {e.element_type for e in elements}
        assert "task" in types
        assert "userTask" in types
        assert "serviceTask" in types
        assert "scriptTask" in types
        assert "businessRuleTask" in types
        assert "sendTask" in types
        assert "receiveTask" in types
        assert "manualTask" in types

    def test_automation_flags(self):
        elements = parse_bpmn_xml(TASKS_BPMN)
        by_id = {e.bpmn_element_id: e for e in elements}
        # Automated types
        assert by_id["st_1"].is_automated is True
        assert by_id["sct_1"].is_automated is True
        assert by_id["brt_1"].is_automated is True
        # Non-automated types
        assert by_id["task_1"].is_automated is False
        assert by_id["ut_1"].is_automated is False
        assert by_id["send_1"].is_automated is False
        assert by_id["man_1"].is_automated is False


class TestParseGateways:
    def test_extracts_all_gateway_types(self):
        elements = parse_bpmn_xml(GATEWAYS_BPMN)
        types = {e.element_type for e in elements}
        assert "exclusiveGateway" in types
        assert "parallelGateway" in types
        assert "inclusiveGateway" in types
        assert "eventBasedGateway" in types

    def test_gateway_names(self):
        elements = parse_bpmn_xml(GATEWAYS_BPMN)
        by_id = {e.bpmn_element_id: e for e in elements}
        assert by_id["gw_exc"].name == "Is Approved?"
        assert by_id["gw_par"].name == "Split"


class TestParseLanes:
    def test_lane_assignment(self):
        elements = parse_bpmn_xml(LANES_BPMN)
        by_id = {e.bpmn_element_id: e for e in elements}
        assert by_id["task_approve"].lane_name == "Manager"
        assert by_id["st_send"].lane_name == "System"

    def test_element_not_in_lane(self):
        elements = parse_bpmn_xml(LANES_BPMN)
        by_id = {e.bpmn_element_id: e for e in elements}
        assert by_id["task_unassigned"].lane_name is None


class TestParseDocumentation:
    def test_documentation_extracted(self):
        elements = parse_bpmn_xml(DOCUMENTATION_BPMN)
        by_id = {e.bpmn_element_id: e for e in elements}
        assert by_id["task_doc"].documentation == "This task does important work."

    def test_no_documentation_is_none(self):
        elements = parse_bpmn_xml(DOCUMENTATION_BPMN)
        by_id = {e.bpmn_element_id: e for e in elements}
        assert by_id["task_nodoc"].documentation is None


class TestSequenceOrder:
    def test_order_increments(self):
        elements = parse_bpmn_xml(TASKS_BPMN)
        orders = [e.sequence_order for e in elements]
        assert orders == sorted(orders)
        assert len(set(orders)) == len(orders)  # all unique


class TestEdgeCases:
    def test_empty_process(self):
        xml = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">
  <process id="Process_1" isExecutable="false" />
</definitions>
"""
        elements = parse_bpmn_xml(xml)
        assert elements == []

    def test_element_without_id_is_skipped(self):
        xml = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">
  <process id="Process_1" isExecutable="false">
    <task name="No ID" />
    <task id="has_id" name="Has ID" />
  </process>
</definitions>
"""
        elements = parse_bpmn_xml(xml)
        assert len(elements) == 1
        assert elements[0].bpmn_element_id == "has_id"

    def test_element_without_name(self):
        xml = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">
  <process id="Process_1" isExecutable="false">
    <task id="nameless" />
  </process>
</definitions>
"""
        elements = parse_bpmn_xml(xml)
        assert len(elements) == 1
        assert elements[0].name is None

    def test_malformed_xml_raises(self):
        with pytest.raises(Exception):
            parse_bpmn_xml("this is not xml")

    def test_subprocess_extracted(self):
        xml = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">
  <process id="Process_1" isExecutable="false">
    <subProcess id="sub_1" name="Sub Process" />
    <callActivity id="call_1" name="Call Activity" />
  </process>
</definitions>
"""
        elements = parse_bpmn_xml(xml)
        types = {e.element_type for e in elements}
        assert "subProcess" in types
        assert "callActivity" in types

    def test_intermediate_events(self):
        xml = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">
  <process id="Process_1" isExecutable="false">
    <intermediateCatchEvent id="ice_1" name="Timer" />
    <intermediateThrowEvent id="ite_1" name="Signal" />
    <boundaryEvent id="be_1" name="Error" />
  </process>
</definitions>
"""
        elements = parse_bpmn_xml(xml)
        types = {e.element_type for e in elements}
        assert "intermediateCatchEvent" in types
        assert "intermediateThrowEvent" in types
        assert "boundaryEvent" in types
