"""The shared upsert of the rows derived from a process's BPMN XML.

Both the diagram save and the publish step go through these helpers; the
contract is that EA links on surviving rows are kept, parser-derived columns
are always rewritten, and rows for elements no longer in the XML are deleted.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.process_element import ProcessElement
from app.models.process_message_flow import ProcessMessageFlow
from app.services.bpmn_parser import ExtractedElement, ExtractedMessageFlow, ParsedBpmn
from app.services.process_element_sync import (
    sync_process_elements,
    sync_process_message_flows,
)
from tests.conftest import create_card, create_card_type, create_user


def _element(bpmn_id: str, **overrides) -> ExtractedElement:
    base = dict(
        bpmn_element_id=bpmn_id,
        element_type="task",
        name=bpmn_id,
        documentation=None,
        lane_name=None,
        is_automated=False,
        sequence_order=0,
    )
    base.update(overrides)
    return ExtractedElement(**base)


def _flow(bpmn_id: str, **overrides) -> ExtractedMessageFlow:
    base = dict(
        bpmn_element_id=bpmn_id,
        name=bpmn_id,
        source_ref="a",
        target_ref="b",
        source_name="A",
        target_name="B",
        sequence_order=0,
    )
    base.update(overrides)
    return ExtractedMessageFlow(**base)


@pytest.fixture
async def env(db):
    user = await create_user(db, email="sync@test.com", role="admin")
    await create_card_type(db, key="BusinessProcess", label="Business Process")
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Interface", label="Interface")
    process = await create_card(db, card_type="BusinessProcess", name="P", user_id=user.id)
    app = await create_card(db, card_type="Application", name="ERP", user_id=user.id)
    iface = await create_card(db, card_type="Interface", name="API", user_id=user.id)
    return {"process": process, "app": app, "iface": iface}


async def _elements(db, pid):
    rows = await db.execute(
        select(ProcessElement)
        .where(ProcessElement.process_id == pid)
        .order_by(ProcessElement.sequence_order)
    )
    return rows.scalars().all()


class TestSyncElements:
    async def test_links_survive_and_derived_columns_are_rewritten(self, db, env):
        pid = env["process"].id
        await sync_process_elements(db, pid, ParsedBpmn(elements=[_element("t1")]))
        await db.flush()
        (row,) = await _elements(db, pid)
        row.application_id = env["app"].id
        await db.flush()
        first_id = row.id

        parsed = ParsedBpmn(
            elements=[
                _element(
                    "t1",
                    element_type="startEvent",
                    name="Renamed",
                    event_definition_type="message",
                    definition_name="Order",
                    sequence_order=1,
                ),
                _element("t2", sequence_order=0),
            ]
        )
        await sync_process_elements(db, pid, parsed)
        await db.flush()
        rows = {r.bpmn_element_id: r for r in await _elements(db, pid)}
        assert rows["t1"].id == first_id
        assert rows["t1"].application_id == env["app"].id
        assert rows["t1"].element_type == "startEvent"
        assert rows["t1"].name == "Renamed"
        assert rows["t1"].event_definition_type == "message"
        assert rows["t1"].definition_name == "Order"
        assert rows["t1"].sequence_order == 1
        assert rows["t2"].application_id is None

    async def test_removed_elements_are_deleted(self, db, env):
        pid = env["process"].id
        await sync_process_elements(
            db, pid, ParsedBpmn(elements=[_element("t1"), _element("t2", sequence_order=1)])
        )
        await db.flush()
        await sync_process_elements(db, pid, ParsedBpmn(elements=[_element("t2")]))
        await db.flush()
        assert [r.bpmn_element_id for r in await _elements(db, pid)] == ["t2"]

    async def test_definition_is_cleared_when_the_event_loses_it(self, db, env):
        pid = env["process"].id
        await sync_process_elements(
            db,
            pid,
            ParsedBpmn(
                elements=[_element("s", element_type="startEvent", event_definition_type="timer")]
            ),
        )
        await db.flush()
        await sync_process_elements(
            db, pid, ParsedBpmn(elements=[_element("s", element_type="startEvent")])
        )
        await db.flush()
        (row,) = await _elements(db, pid)
        assert row.event_definition_type is None

    async def test_draft_links_are_applied_to_new_and_kept_rows(self, db, env):
        pid = env["process"].id
        applied: list[str] = []

        def apply(elem, link):
            applied.append(elem.bpmn_element_id)
            elem.application_id = link["application_id"]

        await sync_process_elements(
            db,
            pid,
            ParsedBpmn(elements=[_element("t1"), _element("t2", sequence_order=1)]),
            draft_links={"t1": {"application_id": env["app"].id}},
            apply_draft_link=apply,
        )
        await db.flush()
        assert applied == ["t1"]
        rows = {r.bpmn_element_id: r for r in await _elements(db, pid)}
        assert rows["t1"].application_id == env["app"].id
        assert rows["t2"].application_id is None


class TestSyncMessageFlows:
    async def test_interface_link_survives_a_resync(self, db, env):
        pid = env["process"].id
        await sync_process_message_flows(db, pid, ParsedBpmn(message_flows=[_flow("mf1")]))
        await db.flush()
        (row,) = (
            (
                await db.execute(
                    select(ProcessMessageFlow).where(ProcessMessageFlow.process_id == pid)
                )
            )
            .scalars()
            .all()
        )
        row.interface_id = env["iface"].id
        await db.flush()
        first_id = row.id

        await sync_process_message_flows(
            db,
            pid,
            ParsedBpmn(
                message_flows=[
                    _flow("mf1", name="Renamed", target_name="Supplier", sequence_order=1),
                    _flow("mf2"),
                ]
            ),
        )
        await db.flush()
        rows = {
            r.bpmn_element_id: r
            for r in (
                await db.execute(
                    select(ProcessMessageFlow).where(ProcessMessageFlow.process_id == pid)
                )
            )
            .scalars()
            .all()
        }
        assert rows["mf1"].id == first_id
        assert rows["mf1"].interface_id == env["iface"].id
        assert rows["mf1"].name == "Renamed"
        assert rows["mf1"].target_name == "Supplier"
        assert rows["mf1"].sequence_order == 1
        assert rows["mf2"].interface_id is None

    async def test_removed_flows_are_deleted(self, db, env):
        pid = env["process"].id
        await sync_process_message_flows(
            db, pid, ParsedBpmn(message_flows=[_flow("mf1"), _flow("mf2", sequence_order=1)])
        )
        await db.flush()
        await sync_process_message_flows(db, pid, ParsedBpmn())
        await db.flush()
        rows = (
            (
                await db.execute(
                    select(ProcessMessageFlow).where(ProcessMessageFlow.process_id == pid)
                )
            )
            .scalars()
            .all()
        )
        assert rows == []
