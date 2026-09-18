"""Integration tests for the /bpm endpoints (templates, assessments)."""

from __future__ import annotations

import pathlib
import uuid

import pytest
from sqlalchemy import select

from app.models.process_diagram import ProcessDiagram
from app.models.process_element import ProcessElement
from app.models.process_message_flow import ProcessMessageFlow
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def bpm_env(db):
    """Prerequisite data for BPM tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={
            "inventory.view": True,
            "bpm.view": True,
        },
    )
    await create_card_type(
        db,
        key="BusinessProcess",
        label="Business Process",
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    process = await create_card(
        db,
        card_type="BusinessProcess",
        name="Order Fulfillment",
        user_id=admin.id,
    )
    return {
        "admin": admin,
        "viewer": viewer,
        "process": process,
    }


class TestBpmTemplates:
    async def test_list_templates(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        resp = await client.get(
            "/api/v1/bpm/templates",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        keys = [t["key"] for t in data]
        assert "blank" in keys

    async def test_list_templates_has_fields(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        resp = await client.get(
            "/api/v1/bpm/templates",
            headers=auth_headers(admin),
        )
        first = resp.json()[0]
        assert "key" in first
        assert "name" in first
        assert "description" in first
        assert "category" in first

    async def test_templates_require_auth(self, client, db, bpm_env):
        resp = await client.get("/api/v1/bpm/templates")
        assert resp.status_code == 401

    async def test_get_template_returns_full_bpmn_xml(self, client, db, bpm_env):
        # Regression for #581: non-blank templates must ship the full BPMN
        # XML (tasks + gateways), not silently fall back to the blank stub
        # when the bpmn_templates/ directory is missing from the image.
        admin = bpm_env["admin"]
        resp = await client.get(
            "/api/v1/bpm/templates/simple-approval",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["key"] == "simple-approval"
        xml = body["bpmn_xml"]
        assert "<bpmn:userTask" in xml or "<bpmn:task" in xml
        assert "<bpmn:exclusiveGateway" in xml or "<bpmn:parallelGateway" in xml


class TestProcessAssessments:
    async def test_create_assessment(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        process = bpm_env["process"]
        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            json={
                "assessment_date": "2026-01-15",
                "overall_score": 4,
                "efficiency": 3,
                "effectiveness": 4,
                "compliance": 5,
                "automation": 2,
                "notes": "Good process maturity",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["overall_score"] == 4
        assert "id" in data

    async def test_list_assessments(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        process = bpm_env["process"]
        # Create an assessment first
        await client.post(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            json={
                "assessment_date": "2026-02-01",
                "overall_score": 3,
                "efficiency": 3,
                "effectiveness": 3,
                "compliance": 3,
                "automation": 3,
            },
            headers=auth_headers(admin),
        )

        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        first = data[0]
        assert "efficiency" in first
        assert "effectiveness" in first
        assert "compliance" in first
        assert "automation" in first

    async def test_update_assessment(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        process = bpm_env["process"]
        create_resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            json={
                "assessment_date": "2026-02-10",
                "overall_score": 2,
                "efficiency": 2,
                "effectiveness": 2,
                "compliance": 2,
                "automation": 2,
            },
            headers=auth_headers(admin),
        )
        a_id = create_resp.json()["id"]

        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/assessments/{a_id}",
            json={"overall_score": 5, "notes": "Improved"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "updated"

    async def test_delete_assessment(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        process = bpm_env["process"]
        create_resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/assessments",
            json={
                "assessment_date": "2026-02-15",
                "overall_score": 1,
                "efficiency": 1,
                "effectiveness": 1,
                "compliance": 1,
                "automation": 1,
            },
            headers=auth_headers(admin),
        )
        a_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/bpm/processes/{process.id}/assessments/{a_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

    async def test_assessment_nonexistent_process(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.get(
            f"/api/v1/bpm/processes/{fake_id}/assessments",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_delete_nonexistent_assessment(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        process = bpm_env["process"]
        fake_id = uuid.uuid4()
        resp = await client.delete(
            f"/api/v1/bpm/processes/{process.id}/assessments/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


_MINIMAL_BPMN = """<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  id="Defs" targetNamespace="http://example.com/bpmn">
  <bpmn:process id="P1" isExecutable="true">
    <bpmn:startEvent id="Start1" name="Start" />
    <bpmn:task id="T1" name="Pick item" />
    <bpmn:endEvent id="End1" name="Done" />
  </bpmn:process>
</bpmn:definitions>
"""


class TestSaveDiagramDryRun:
    """Dry-run path used by the MCP `import_bpmn` tool."""

    async def test_dry_run_parses_but_does_not_persist(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        process = bpm_env["process"]
        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/diagram",
            json={"bpmn_xml": _MINIMAL_BPMN, "dry_run": True},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["dry_run"] is True
        # The parser ran and extracted elements.
        assert body["element_count"] >= 1
        # …but nothing persisted.
        diagrams = (
            (
                await db.execute(
                    select(ProcessDiagram).where(ProcessDiagram.process_id == process.id)
                )
            )
            .scalars()
            .all()
        )
        elements = (
            (
                await db.execute(
                    select(ProcessElement).where(ProcessElement.process_id == process.id)
                )
            )
            .scalars()
            .all()
        )
        assert diagrams == []
        assert elements == []

    async def test_collaboration_bpmn_with_di_round_trips_intact(self, client, db, bpm_env):
        """Regression for the «diagram doesn't render» MCP report: a BPMN
        with `<collaboration>`, `<participant>`, lanes and `<bpmndi:>`
        sections must round-trip byte-for-byte. The save_diagram handler
        is supposed to store the XML verbatim and never rewrite the DI
        plane — if rendering fails downstream it's a frontend problem,
        not a backend mangling problem. The response must also surface
        `diagram_id`, `flow_nodes_extracted` and `bpmn_xml_bytes`."""
        admin = bpm_env["admin"]
        process = bpm_env["process"]
        bpmn = """<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Defs_1" targetNamespace="http://example.com/bpmn">
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_1" name="Sales" processRef="Process_1"/>
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_1" name="Rep">
        <bpmn:flowNodeRef>Start_1</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_1</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start_1" name="Begin"/>
    <bpmn:task id="Task_1" name="Do work"/>
    <bpmn:endEvent id="End_1" name="Done"/>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1"/>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Collaboration_1">
      <bpmndi:BPMNShape id="Participant_1_di" bpmnElement="Participant_1" isHorizontal="true">
        <dc:Bounds x="160" y="80" width="600" height="180"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="220" y="160" width="36" height="36"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="320" y="138" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="480" y="160" width="36" height="36"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="256" y="178"/>
        <di:waypoint x="320" y="178"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="420" y="178"/>
        <di:waypoint x="480" y="178"/>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
"""
        save_resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/diagram",
            json={"bpmn_xml": bpmn, "dry_run": False},
            headers=auth_headers(admin),
        )
        assert save_resp.status_code == 200, save_resp.text
        save_body = save_resp.json()
        assert save_body["diagram_id"]  # not None / empty
        # Flow-nodes extracted = startEvent + task + endEvent = 3.
        # Sequence flows, lanes, BPMNDI shapes are intentionally NOT counted.
        assert save_body["flow_nodes_extracted"] == 3
        assert save_body["bpmn_xml_bytes"] == len(bpmn)
        # Round-trip: the saved XML must be byte-for-byte identical.
        get_resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/diagram",
            headers=auth_headers(admin),
        )
        assert get_resp.status_code == 200
        assert get_resp.json()["bpmn_xml"] == bpmn

    async def test_business_process_card_accepts_description_via_bulk(self, client, db, bpm_env):
        """Regression for the empty-card report: a BusinessProcess card
        created via /cards/bulk-create with a `description` field must
        land with that description set on the card row, exactly like any
        other card type. The BPMN flow does not change card-level
        description semantics; description is a top-level column on
        `cards`, not a per-type attribute."""
        from sqlalchemy import select

        from app.models.card import Card

        admin = bpm_env["admin"]
        payload = {
            "cards": [
                {
                    "row_index": 0,
                    "type": "BusinessProcess",
                    "name": "Procure to Pay",
                    "description": "End-to-end procurement workflow.",
                    "attributes": {"processType": "Core"},
                }
            ]
        }
        resp = await client.post(
            "/api/v1/cards/bulk-create", json=payload, headers=auth_headers(admin)
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["created"] == 1
        cid = body["results"][0]["id"]
        card = (await db.execute(select(Card).where(Card.id == uuid.UUID(cid)))).scalar_one()
        assert card.description == "End-to-end procurement workflow."
        assert card.attributes.get("processType") == "Core"

    async def test_commit_persists_after_dry_run(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        process = bpm_env["process"]
        # Dry-run first.
        await client.put(
            f"/api/v1/bpm/processes/{process.id}/diagram",
            json={"bpmn_xml": _MINIMAL_BPMN, "dry_run": True},
            headers=auth_headers(admin),
        )
        # Then commit.
        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/diagram",
            json={"bpmn_xml": _MINIMAL_BPMN, "dry_run": False},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["dry_run"] is False
        rows = (
            (
                await db.execute(
                    select(ProcessDiagram).where(ProcessDiagram.process_id == process.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1


# A deliberately "unsorted" model: the elements are declared end-first, and the
# element types are interleaved, so neither document order nor the parser's old
# element-type grouping produces the reading order below.
_FLOW_ORDER_BPMN = """<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="defs_order">
  <bpmn:process id="P_order" isExecutable="true">
    <bpmn:endEvent id="Ev_end" name="Order shipped" />
    <bpmn:sendTask id="Task_notify" name="Notify customer" />
    <bpmn:exclusiveGateway id="Gw_stock" name="In stock?" />
    <bpmn:userTask id="Task_check" name="Check stock" />
    <bpmn:manualTask id="Task_pick" name="Pick items" />
    <bpmn:startEvent id="Ev_start" name="Order received" />
    <bpmn:sequenceFlow id="f1" sourceRef="Ev_start" targetRef="Task_check" />
    <bpmn:sequenceFlow id="f2" sourceRef="Task_check" targetRef="Gw_stock" />
    <bpmn:sequenceFlow id="f3" sourceRef="Gw_stock" targetRef="Task_pick" />
    <bpmn:sequenceFlow id="f4" sourceRef="Task_pick" targetRef="Task_notify" />
    <bpmn:sequenceFlow id="f5" sourceRef="Task_notify" targetRef="Ev_end" />
  </bpmn:process>
</bpmn:definitions>
"""

_FLOW_ORDER_EXPECTED = [
    "Order received",
    "Check stock",
    "In stock?",
    "Pick items",
    "Notify customer",
    "Order shipped",
]


class TestElementOrderingEndToEnd:
    """Issue #978 — the persisted `#` column has to follow the process.

    The parser can be right and the stored order still wrong: `save_diagram`
    upserts elements one by one and the read endpoint re-derives the order with
    `ORDER BY sequence_order`, so both halves need pinning.
    """

    async def test_saved_elements_are_returned_in_flow_order(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        process = bpm_env["process"]
        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/diagram",
            json={"bpmn_xml": _FLOW_ORDER_BPMN, "dry_run": False},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text

        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/elements",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        elements = resp.json()
        assert [e["name"] for e in elements] == _FLOW_ORDER_EXPECTED
        assert [e["sequence_order"] for e in elements] == list(range(len(_FLOW_ORDER_EXPECTED)))

    async def test_resaving_rewrites_the_stored_order(self, client, db, bpm_env):
        """The upsert path preserves EA links by matching on `bpmn_element_id`;
        it must still refresh `sequence_order` on rows it keeps."""
        admin = bpm_env["admin"]
        process = bpm_env["process"]
        for _ in range(2):
            resp = await client.put(
                f"/api/v1/bpm/processes/{process.id}/diagram",
                json={"bpmn_xml": _FLOW_ORDER_BPMN, "dry_run": False},
                headers=auth_headers(admin),
            )
            assert resp.status_code == 200, resp.text

        rows = (
            (
                await db.execute(
                    select(ProcessElement)
                    .where(ProcessElement.process_id == process.id)
                    .order_by(ProcessElement.sequence_order)
                )
            )
            .scalars()
            .all()
        )
        assert [r.name for r in rows] == _FLOW_ORDER_EXPECTED


# ---------------------------------------------------------------------------
# Event definitions + message flows (the bundled Collaboration template)
# ---------------------------------------------------------------------------

_COLLABORATION_BPMN = (
    pathlib.Path(__file__).resolve().parents[2] / "bpmn_templates" / "collaboration.bpmn"
).read_text()


class TestMessageFlows:
    async def _save(self, client, admin, process, xml=_COLLABORATION_BPMN):
        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/diagram",
            json={"bpmn_xml": xml, "dry_run": False},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        return resp.json()

    async def test_save_persists_event_definitions_and_artefacts(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        process = bpm_env["process"]
        await self._save(client, admin, process)

        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/elements", headers=auth_headers(admin)
        )
        assert resp.status_code == 200, resp.text
        by_id = {e["bpmn_element_id"]: e for e in resp.json()}
        start = by_id["StartEvent_RequestReceived"]
        assert start["event_definition_type"] == "message"
        assert start["definition_name"] == "Request"
        assert by_id["Task_SendRequest"]["definition_name"] == "Request"
        assert by_id["Task_HandleRequest"]["event_definition_type"] is None
        # The data object is an element too, listed after every flow node.
        artefact = by_id["DataObjectReference_Request"]
        assert artefact["element_type"] == "dataObjectReference"
        assert artefact["sequence_order"] == max(e["sequence_order"] for e in by_id.values())

    async def test_list_message_flows(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        process = bpm_env["process"]
        await self._save(client, admin, process)

        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/message-flows", headers=auth_headers(admin)
        )
        assert resp.status_code == 200, resp.text
        flows = resp.json()
        assert [f["bpmn_element_id"] for f in flows] == [
            "MessageFlow_Request",
            "MessageFlow_Confirmation",
        ]
        assert flows[0]["name"] == "Request"
        assert flows[0]["source_name"] == "Send request"
        assert flows[0]["target_name"] == "Request received"
        assert flows[0]["interface_id"] is None
        assert flows[0]["interface_name"] is None

    async def test_viewer_can_list_but_not_link(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        viewer = bpm_env["viewer"]
        process = bpm_env["process"]
        await self._save(client, admin, process)
        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/message-flows", headers=auth_headers(viewer)
        )
        assert resp.status_code == 200
        flow_id = resp.json()[0]["id"]
        resp = await client.patch(
            f"/api/v1/bpm/processes/{process.id}/message-flows/{flow_id}",
            json={"interface_id": None},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_link_interface_survives_a_resave(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        process = bpm_env["process"]
        await create_card_type(db, key="Interface", label="Interface")
        iface = await create_card(db, card_type="Interface", name="Order API", user_id=admin.id)
        await self._save(client, admin, process)
        flows = (
            await client.get(
                f"/api/v1/bpm/processes/{process.id}/message-flows", headers=auth_headers(admin)
            )
        ).json()
        flow_id = flows[0]["id"]

        resp = await client.patch(
            f"/api/v1/bpm/processes/{process.id}/message-flows/{flow_id}",
            json={"interface_id": str(iface.id)},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["interface_id"] == str(iface.id)
        assert resp.json()["interface_name"] == "Order API"

        # A re-save re-parses the same XML: the row is updated in place and
        # keeps its link, exactly like an element keeps its Application link.
        await self._save(client, admin, process)
        flows = (
            await client.get(
                f"/api/v1/bpm/processes/{process.id}/message-flows", headers=auth_headers(admin)
            )
        ).json()
        assert [f["id"] for f in flows][0] == flow_id
        assert flows[0]["interface_id"] == str(iface.id)

        # Clearing works with null.
        resp = await client.patch(
            f"/api/v1/bpm/processes/{process.id}/message-flows/{flow_id}",
            json={"interface_id": None},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["interface_id"] is None

    async def test_link_rejects_a_card_that_is_not_an_interface(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        process = bpm_env["process"]
        await create_card_type(db, key="Application", label="Application")
        app = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
        await self._save(client, admin, process)
        flow_id = (
            await client.get(
                f"/api/v1/bpm/processes/{process.id}/message-flows", headers=auth_headers(admin)
            )
        ).json()[0]["id"]
        resp = await client.patch(
            f"/api/v1/bpm/processes/{process.id}/message-flows/{flow_id}",
            json={"interface_id": str(app.id)},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_flows_removed_from_the_diagram_are_deleted(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        process = bpm_env["process"]
        await self._save(client, admin, process)
        # A single-pool diagram has no message flows.
        await self._save(client, admin, process, xml=_MINIMAL_BPMN)
        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/message-flows", headers=auth_headers(admin)
        )
        assert resp.json() == []

    async def test_delete_diagram_clears_message_flows(self, client, db, bpm_env):
        admin = bpm_env["admin"]
        process = bpm_env["process"]
        await self._save(client, admin, process)
        resp = await client.delete(
            f"/api/v1/bpm/processes/{process.id}/diagram", headers=auth_headers(admin)
        )
        assert resp.status_code == 200, resp.text
        rows = (
            (
                await db.execute(
                    select(ProcessMessageFlow).where(ProcessMessageFlow.process_id == process.id)
                )
            )
            .scalars()
            .all()
        )
        assert rows == []
