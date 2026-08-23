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

# Two-pool purchase-request model from issue #978. Mixed task types, a message
# flow in each direction, an exclusive gateway and a rework loop — and the
# elements are declared in an order that is neither flow order nor type order.
FLOW_ORDER_BPMN = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="definitions_1">
  <collaboration id="Collab_1">
    <participant id="Part_Req" name="Requester" processRef="Process_Req" />
    <participant id="Part_Proc" name="Procurement Officer" processRef="Process_Proc" />
    <messageFlow id="MF_1" sourceRef="Task_Submit" targetRef="Start_Received" />
    <messageFlow id="MF_2" sourceRef="Task_SendApproval" targetRef="Task_ReceiveApproval" />
  </collaboration>
  <process id="Process_Req" isExecutable="false">
    <laneSet id="ls_req">
      <lane id="Lane_Req" name="Requester">
        <flowNodeRef>Start_Need</flowNodeRef>
        <flowNodeRef>Task_Discuss</flowNodeRef>
        <flowNodeRef>Task_Create</flowNodeRef>
        <flowNodeRef>Task_Submit</flowNodeRef>
        <flowNodeRef>Task_ReceiveApproval</flowNodeRef>
        <flowNodeRef>End_RequestCompleted</flowNodeRef>
      </lane>
    </laneSet>
    <startEvent id="Start_Need" name="Need identified" />
    <manualTask id="Task_Discuss" name="Discuss purchasing need" />
    <userTask id="Task_Create" name="Create purchase request" />
    <sendTask id="Task_Submit" name="Submit purchase request" />
    <receiveTask id="Task_ReceiveApproval" name="Receive approval" />
    <endEvent id="End_RequestCompleted" name="Request completed" />
    <sequenceFlow id="sf_r1" sourceRef="Start_Need" targetRef="Task_Discuss" />
    <sequenceFlow id="sf_r2" sourceRef="Task_Discuss" targetRef="Task_Create" />
    <sequenceFlow id="sf_r3" sourceRef="Task_Create" targetRef="Task_Submit" />
    <sequenceFlow id="sf_r4" sourceRef="Task_Submit" targetRef="Task_ReceiveApproval" />
    <sequenceFlow id="sf_r5" sourceRef="Task_ReceiveApproval" targetRef="End_RequestCompleted" />
  </process>
  <process id="Process_Proc" isExecutable="false">
    <laneSet id="ls_proc">
      <lane id="Lane_Proc" name="Procurement Officer">
        <flowNodeRef>Start_Received</flowNodeRef>
        <flowNodeRef>Task_Review</flowNodeRef>
        <flowNodeRef>GW_Acceptable</flowNodeRef>
        <flowNodeRef>Task_SendApproval</flowNodeRef>
        <flowNodeRef>End_ProcessingCompleted</flowNodeRef>
        <flowNodeRef>Task_Rework</flowNodeRef>
      </lane>
    </laneSet>
    <startEvent id="Start_Received" name="Purchase request received" />
    <userTask id="Task_Review" name="Review purchase request" />
    <exclusiveGateway id="GW_Acceptable" name="Request acceptable?" />
    <sendTask id="Task_SendApproval" name="Send approval" />
    <endEvent id="End_ProcessingCompleted" name="Processing completed" />
    <manualTask id="Task_Rework" name="Rework assessment" />
    <sequenceFlow id="sf_p1" sourceRef="Start_Received" targetRef="Task_Review" />
    <sequenceFlow id="sf_p2" sourceRef="Task_Review" targetRef="GW_Acceptable" />
    <sequenceFlow id="sf_p3" sourceRef="GW_Acceptable" targetRef="Task_SendApproval" />
    <sequenceFlow id="sf_p4" sourceRef="GW_Acceptable" targetRef="Task_Rework" />
    <sequenceFlow id="sf_p5" sourceRef="Task_Rework" targetRef="Task_Review" />
    <sequenceFlow id="sf_p6" sourceRef="Task_SendApproval" targetRef="End_ProcessingCompleted" />
  </process>
</definitions>
"""

# The order the reporter expects, and the one the process actually reads in.
FLOW_ORDER_EXPECTED = [
    "Need identified",
    "Discuss purchasing need",
    "Create purchase request",
    "Submit purchase request",
    "Purchase request received",
    "Review purchase request",
    "Request acceptable?",
    "Rework assessment",
    "Send approval",
    "Receive approval",
    "Processing completed",
    "Request completed",
]

SCRAMBLED_LINEAR_BPMN = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">
  <process id="Process_1" isExecutable="false">
    <endEvent id="e_end" name="End" />
    <sendTask id="t_notify" name="Notify" />
    <userTask id="t_approve" name="Approve" />
    <manualTask id="t_collect" name="Collect" />
    <startEvent id="e_start" name="Start" />
    <sequenceFlow id="f1" sourceRef="e_start" targetRef="t_collect" />
    <sequenceFlow id="f2" sourceRef="t_collect" targetRef="t_approve" />
    <sequenceFlow id="f3" sourceRef="t_approve" targetRef="t_notify" />
    <sequenceFlow id="f4" sourceRef="t_notify" targetRef="e_end" />
  </process>
</definitions>
"""

SUBPROCESS_FLOW_BPMN = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">
  <process id="Process_1" isExecutable="false">
    <task id="before" name="Before" />
    <subProcess id="sub" name="Sub Process">
      <task id="inner_1" name="Inner One" />
      <task id="inner_2" name="Inner Two" />
      <sequenceFlow id="fi" sourceRef="inner_1" targetRef="inner_2" />
    </subProcess>
    <task id="after" name="After" />
    <sequenceFlow id="f1" sourceRef="before" targetRef="sub" />
    <sequenceFlow id="f2" sourceRef="sub" targetRef="after" />
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
    def test_order_is_contiguous_from_zero(self):
        # Deliberately stricter than «monotonic and unique», which the old
        # type-grouped counter also satisfied. Contiguity is what the `#`
        # column and `ORDER BY sequence_order` actually depend on.
        elements = parse_bpmn_xml(TASKS_BPMN)
        orders = [e.sequence_order for e in elements]
        assert orders == list(range(len(elements)))

    def test_sequence_order_matches_list_position(self):
        # `/draft-elements` returns the parser's list verbatim while the
        # persisted tables are re-read with ORDER BY sequence_order. The two
        # only agree while this invariant holds.
        elements = parse_bpmn_xml(FLOW_ORDER_BPMN)
        for position, element in enumerate(elements):
            assert element.sequence_order == position


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


class TestFlowOrder:
    """Regression tests for issue #978 — `sequence_order` follows the process,
    not the element-type table."""

    def test_two_pool_model_matches_expected_reading_order(self):
        elements = parse_bpmn_xml(FLOW_ORDER_BPMN)
        assert [e.name for e in elements] == FLOW_ORDER_EXPECTED

    def test_start_event_comes_first_not_last(self):
        # The symptom the issue leads with: iterating EXTRACTABLE_TYPES put
        # every task ahead of the start event that begins the process.
        elements = parse_bpmn_xml(FLOW_ORDER_BPMN)
        assert elements[0].element_type == "startEvent"
        assert elements[-1].element_type == "endEvent"

    def test_flow_beats_both_document_and_type_order(self):
        elements = parse_bpmn_xml(SCRAMBLED_LINEAR_BPMN)
        assert [e.name for e in elements] == ["Start", "Collect", "Approve", "Notify", "End"]

    def test_no_sequence_flows_degrades_to_document_order(self):
        # TASKS_BPMN has no connections at all, so there is no causal
        # information to use — document order is the honest fallback, and it is
        # still an improvement on grouping by element type.
        elements = parse_bpmn_xml(TASKS_BPMN)
        assert [e.bpmn_element_id for e in elements] == [
            "task_1",
            "ut_1",
            "st_1",
            "sct_1",
            "brt_1",
            "send_1",
            "recv_1",
            "man_1",
        ]

    def test_loop_does_not_strand_downstream_elements(self):
        xml = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">
  <process id="Process_1" isExecutable="false">
    <task id="a" /><task id="b" /><task id="c" /><task id="d" />
    <sequenceFlow id="f1" sourceRef="a" targetRef="b" />
    <sequenceFlow id="f2" sourceRef="b" targetRef="c" />
    <sequenceFlow id="f3" sourceRef="c" targetRef="b" />
    <sequenceFlow id="f4" sourceRef="c" targetRef="d" />
  </process>
</definitions>
"""
        assert [e.bpmn_element_id for e in parse_bpmn_xml(xml)] == ["a", "b", "c", "d"]

    def test_subprocess_children_follow_their_parent(self):
        elements = parse_bpmn_xml(SUBPROCESS_FLOW_BPMN)
        assert [e.bpmn_element_id for e in elements] == [
            "before",
            "sub",
            "inner_1",
            "inner_2",
            "after",
        ]

    def test_nested_subprocess_bodies_stay_contiguous(self):
        xml = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">
  <process id="Process_1" isExecutable="false">
    <task id="before" />
    <subProcess id="outer">
      <task id="o1" />
      <subProcess id="inner">
        <task id="i1" /><task id="i2" />
        <sequenceFlow id="fi" sourceRef="i1" targetRef="i2" />
      </subProcess>
      <sequenceFlow id="fo" sourceRef="o1" targetRef="inner" />
    </subProcess>
    <task id="after" />
    <sequenceFlow id="f1" sourceRef="before" targetRef="outer" />
    <sequenceFlow id="f2" sourceRef="outer" targetRef="after" />
  </process>
</definitions>
"""
        assert [e.bpmn_element_id for e in parse_bpmn_xml(xml)] == [
            "before",
            "outer",
            "o1",
            "inner",
            "i1",
            "i2",
            "after",
        ]

    def test_boundary_event_follows_the_activity_it_is_attached_to(self):
        # A boundary event has no incoming sequence flow. Without the
        # attachedToRef edge it ranks as a source and floats to the top.
        xml = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">
  <process id="Process_1" isExecutable="false">
    <startEvent id="start" />
    <boundaryEvent id="timeout" attachedToRef="work" />
    <task id="work" />
    <task id="escalate" />
    <endEvent id="done" />
    <sequenceFlow id="f1" sourceRef="start" targetRef="work" />
    <sequenceFlow id="f2" sourceRef="work" targetRef="done" />
    <sequenceFlow id="f3" sourceRef="timeout" targetRef="escalate" />
  </process>
</definitions>
"""
        order = [e.bpmn_element_id for e in parse_bpmn_xml(xml)]
        assert order.index("timeout") > order.index("work")
        assert order.index("escalate") > order.index("timeout")

    def test_unrelated_processes_stay_in_blocks(self):
        xml = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">
  <process id="P1" isExecutable="false">
    <task id="p1a" /><task id="p1b" />
    <sequenceFlow id="f1" sourceRef="p1a" targetRef="p1b" />
  </process>
  <process id="P2" isExecutable="false">
    <task id="p2a" /><task id="p2b" />
    <sequenceFlow id="f2" sourceRef="p2a" targetRef="p2b" />
  </process>
</definitions>
"""
        assert [e.bpmn_element_id for e in parse_bpmn_xml(xml)] == ["p1a", "p1b", "p2a", "p2b"]

    def test_deterministic_across_parses(self):
        first = [e.bpmn_element_id for e in parse_bpmn_xml(FLOW_ORDER_BPMN)]
        second = [e.bpmn_element_id for e in parse_bpmn_xml(FLOW_ORDER_BPMN)]
        assert first == second

    def test_lane_and_documentation_survive_reordering(self):
        by_id = {e.bpmn_element_id: e for e in parse_bpmn_xml(FLOW_ORDER_BPMN)}
        assert by_id["Start_Need"].lane_name == "Requester"
        assert by_id["Task_Review"].lane_name == "Procurement Officer"


class TestFlowOrderRobustness:
    """Malformed or exotic references must never raise — the parser runs on
    whatever a third-party modeller produced."""

    def test_dangling_and_non_node_refs_are_ignored(self):
        xml = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">
  <process id="Process_1" isExecutable="false">
    <task id="a" /><task id="b" />
    <dataObjectReference id="dor" />
    <sequenceFlow id="f1" sourceRef="a" targetRef="dor" />
    <sequenceFlow id="f2" sourceRef="ghost" targetRef="b" />
    <sequenceFlow id="f3" sourceRef="a" targetRef="b" />
  </process>
</definitions>
"""
        assert [e.bpmn_element_id for e in parse_bpmn_xml(xml)] == ["a", "b"]

    def test_self_loop_does_not_raise(self):
        xml = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">
  <process id="Process_1" isExecutable="false">
    <task id="a" /><task id="b" />
    <sequenceFlow id="f1" sourceRef="a" targetRef="a" />
    <sequenceFlow id="f2" sourceRef="a" targetRef="b" />
  </process>
</definitions>
"""
        assert [e.bpmn_element_id for e in parse_bpmn_xml(xml)] == ["a", "b"]

    def test_duplicate_sequence_flows_change_nothing(self):
        xml = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">
  <process id="Process_1" isExecutable="false">
    <task id="b" /><task id="a" />
    <sequenceFlow id="f1" sourceRef="a" targetRef="b" />
    <sequenceFlow id="f2" sourceRef="a" targetRef="b" />
  </process>
</definitions>
"""
        assert [e.bpmn_element_id for e in parse_bpmn_xml(xml)] == ["a", "b"]

    def test_message_flow_to_a_black_box_pool_is_dropped(self):
        # A black-box participant contributes no elements, so there is nothing
        # to order it against — the edge is simply not a constraint.
        xml = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">
  <collaboration id="c1">
    <participant id="Participant_2" name="Supplier" />
    <messageFlow id="mf1" sourceRef="a" targetRef="Participant_2" />
  </collaboration>
  <process id="Process_1" isExecutable="false">
    <task id="a" /><task id="b" />
    <sequenceFlow id="f1" sourceRef="a" targetRef="b" />
  </process>
</definitions>
"""
        assert [e.bpmn_element_id for e in parse_bpmn_xml(xml)] == ["a", "b"]

    def test_duplicate_element_ids_keep_the_first_occurrence(self):
        # Invalid BPMN, but it happens. The persistence layer upserts on
        # bpmn_element_id, so first-wins is what would be stored anyway.
        xml = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">
  <process id="Process_1" isExecutable="false">
    <task id="dup" name="First" />
    <task id="dup" name="Second" />
  </process>
</definitions>
"""
        elements = parse_bpmn_xml(xml)
        assert len(elements) == 1
        assert elements[0].name == "First"

    def test_long_chain_does_not_hit_the_recursion_limit(self):
        size = 2000
        nodes = "".join(f'<task id="t{i}" />' for i in range(size))
        flows = "".join(
            f'<sequenceFlow id="f{i}" sourceRef="t{i}" targetRef="t{i + 1}" />'
            for i in range(size - 1)
        )
        xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">'
            f'<process id="Process_1" isExecutable="false">{nodes}{flows}</process>'
            "</definitions>"
        )
        elements = parse_bpmn_xml(xml)
        assert len(elements) == size
        assert elements[0].bpmn_element_id == "t0"
        assert elements[-1].bpmn_element_id == f"t{size - 1}"
