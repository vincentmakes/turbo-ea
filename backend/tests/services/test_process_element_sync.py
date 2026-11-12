"""The shared upsert of the rows derived from a process's BPMN XML.

Both the diagram save and the publish step go through these helpers; the
contract is that EA links on surviving rows are kept, parser-derived columns
are always rewritten, and rows for elements no longer in the XML are deleted.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.process_element import ProcessElement
from app.models.process_message_flow import ProcessMessageFlow
from app.services.bpmn_parser import ExtractedElement, ExtractedMessageFlow, ParsedBpmn
from app.services.process_element_sync import (
    ELEMENT_LINK_CARD_TYPES,
    normalise_draft_link_body,
    resolve_process_references,
    stored_link_ids,
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
    callee = await create_card(db, card_type="BusinessProcess", name="Callee", user_id=user.id)
    app = await create_card(db, card_type="Application", name="ERP", user_id=user.id)
    iface = await create_card(db, card_type="Interface", name="API", user_id=user.id)
    return {"process": process, "callee": callee, "app": app, "iface": iface}


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


class TestCalledProcess:
    """``calledElement`` → ``business_process_id`` precedence."""

    async def test_a_card_uuid_in_the_xml_wins(self, db, env):
        pid, callee = env["process"].id, env["callee"]
        await sync_process_elements(
            db,
            pid,
            ParsedBpmn(
                elements=[
                    _element("ca", element_type="callActivity", called_element=str(callee.id))
                ]
            ),
        )
        await db.flush()
        (row,) = await _elements(db, pid)
        assert row.called_element == str(callee.id)
        assert row.business_process_id == callee.id

    async def test_a_foreign_reference_keeps_a_manual_link(self, db, env):
        pid, callee = env["process"].id, env["callee"]
        parsed = ParsedBpmn(
            elements=[_element("ca", element_type="callActivity", called_element="Process_X")]
        )
        await sync_process_elements(db, pid, parsed)
        await db.flush()
        (row,) = await _elements(db, pid)
        assert row.called_element == "Process_X"
        assert row.business_process_id is None

        row.business_process_id = callee.id  # linked through the table
        await db.flush()
        await sync_process_elements(db, pid, parsed)  # re-save, same XML
        await db.flush()
        (row,) = await _elements(db, pid)
        assert row.business_process_id == callee.id

    async def test_the_process_itself_never_resolves(self, db, env):
        pid = env["process"].id
        parsed = ParsedBpmn(
            elements=[_element("ca", element_type="callActivity", called_element=str(pid))]
        )
        assert await resolve_process_references(db, pid, parsed) == {}
        await sync_process_elements(db, pid, parsed)
        await db.flush()
        (row,) = await _elements(db, pid)
        assert row.called_element == str(pid)
        assert row.business_process_id is None

    async def test_a_card_that_is_not_an_active_process_does_not_resolve(self, db, env):
        pid = env["process"].id
        archived = await create_card(db, card_type="BusinessProcess", name="Old", status="ARCHIVED")
        parsed = ParsedBpmn(
            elements=[
                _element("app", element_type="callActivity", called_element=str(env["app"].id)),
                _element(
                    "old",
                    element_type="callActivity",
                    called_element=str(archived.id),
                    sequence_order=1,
                ),
                _element("junk", element_type="callActivity", called_element="not-a-uuid"),
            ]
        )
        assert await resolve_process_references(db, pid, parsed) == {}

    async def test_a_plain_step_links_through_process_ref(self, db, env):
        pid, callee = env["process"].id, env["callee"]
        await sync_process_elements(
            db,
            pid,
            ParsedBpmn(
                elements=[
                    _element("t", element_type="userTask", process_ref=str(callee.id)),
                    _element("g", element_type="exclusiveGateway", sequence_order=1),
                ]
            ),
        )
        await db.flush()
        rows = {r.bpmn_element_id: r for r in await _elements(db, pid)}
        assert rows["t"].called_element == str(callee.id)
        assert rows["t"].business_process_id == callee.id
        assert rows["g"].business_process_id is None

    async def test_a_call_activity_prefers_its_called_element(self, db, env):
        pid, callee = env["process"].id, env["callee"]
        other = await create_card(db, card_type="BusinessProcess", name="Other")
        await sync_process_elements(
            db,
            pid,
            ParsedBpmn(
                elements=[
                    _element(
                        "ca",
                        element_type="callActivity",
                        called_element=str(callee.id),
                        process_ref=str(other.id),
                    )
                ]
            ),
        )
        await db.flush()
        (row,) = await _elements(db, pid)
        assert row.business_process_id == callee.id

    async def test_a_task_keeps_its_link_when_morphed_and_an_artefact_loses_it(self, db, env):
        """Morphing a call activity into a task keeps the link (the modeler
        copies `turboea:processRef` across); only an artefact drops it."""
        pid, callee = env["process"].id, env["callee"]
        await sync_process_elements(
            db,
            pid,
            ParsedBpmn(
                elements=[_element("x", element_type="callActivity", called_element=str(callee.id))]
            ),
        )
        await db.flush()
        await sync_process_elements(
            db, pid, ParsedBpmn(elements=[_element("x", process_ref=str(callee.id))])
        )
        await db.flush()
        (row,) = await _elements(db, pid)
        assert row.element_type == "task"
        assert row.business_process_id == callee.id

        await sync_process_elements(
            db, pid, ParsedBpmn(elements=[_element("x", element_type="dataObjectReference")])
        )
        await db.flush()
        (row,) = await _elements(db, pid)
        assert row.called_element is None
        assert row.business_process_id is None


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


# ── Draft step links: what each slot takes ──────────────────────────────────


class TestDraftLinkSlots:
    def test_each_single_link_takes_the_target_type_of_the_relation_it_mints(self):
        """The slot → type map is not a second source of truth: each single
        link's type is the seeded target of the relation type it mints."""
        from app.services.element_relation_sync import ELEMENT_LINK_RELATION_MAP
        from app.services.seed import RELATIONS

        targets = {r["key"]: r["target_type_key"] for r in RELATIONS}
        for key, relation in ELEMENT_LINK_RELATION_MAP.items():
            assert ELEMENT_LINK_CARD_TYPES[key] == targets[relation], key
        assert set(ELEMENT_LINK_CARD_TYPES) == {*ELEMENT_LINK_RELATION_MAP, "organization_ids"}
        assert ELEMENT_LINK_CARD_TYPES["organization_ids"] == "Organization"


_A = "00000000-0000-4000-8000-00000000000a"
_B = "00000000-0000-4000-8000-00000000000b"


class TestNormaliseDraftLinkBody:
    def test_ids_are_collected_per_slot_and_rewritten_canonical(self):
        body = {
            "application_id": _A.upper(),
            "data_object_id": "",
            "it_component_id": None,
            "business_process_id": "{" + _B + "}",
            "organization_ids": [_A, "", None, _B.replace("-", "")],
            "custom_fields": {"x": 1},
        }
        named = normalise_draft_link_body(body)
        assert named == {
            "application_id": {uuid.UUID(_A)},
            "business_process_id": {uuid.UUID(_B)},
            "organization_ids": {uuid.UUID(_A), uuid.UUID(_B)},
        }
        assert body == {
            "application_id": _A,
            "data_object_id": "",
            "it_component_id": None,
            "business_process_id": _B,
            "organization_ids": [_A, _B],
            "custom_fields": {"x": 1},
        }

    @pytest.mark.parametrize("orgs", [None, []])
    def test_no_organizations_name_nothing(self, orgs):
        body = {"organization_ids": orgs}
        named = normalise_draft_link_body(body)
        assert named == ({} if orgs is None else {"organization_ids": set()})
        assert body == {"organization_ids": orgs}

    def test_an_empty_body_names_nothing(self):
        assert normalise_draft_link_body({}) == {}

    @pytest.mark.parametrize(
        "key", ["application_id", "data_object_id", "it_component_id", "business_process_id"]
    )
    @pytest.mark.parametrize("value", ["nope", 7, [_A], {"id": _A}])
    def test_a_value_that_is_not_a_card_id_is_a_400(self, key, value):
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            normalise_draft_link_body({key: value})
        assert exc.value.status_code == 400
        assert exc.value.detail == f"{key} must be a card id (UUID)"

    @pytest.mark.parametrize(
        ("orgs", "detail"),
        [
            (_A, "organization_ids must be a list of card ids"),
            ({"id": _A}, "organization_ids must be a list of card ids"),
            ([_A, "Sales"], "organization_ids must be a card id (UUID)"),
            ([_A, 3], "organization_ids must be a card id (UUID)"),
        ],
    )
    def test_organizations_must_be_a_list_of_card_ids(self, orgs, detail):
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            normalise_draft_link_body({"organization_ids": orgs})
        assert exc.value.status_code == 400
        assert exc.value.detail == detail


class TestStoredLinkIds:
    @pytest.mark.parametrize(
        ("link", "key", "expected"),
        [
            ({"application_id": _A}, "application_id", {_A}),
            ({"application_id": None}, "application_id", set()),
            ({}, "application_id", set()),
            ({"application_id": "legacy-junk"}, "application_id", set()),
            ({"organization_ids": [_A, _B, "junk", None]}, "organization_ids", {_A, _B}),
            ({"organization_ids": None}, "organization_ids", set()),
            ({}, "organization_ids", set()),
            ({"application_id": _A}, "data_object_id", set()),
        ],
    )
    def test_the_ids_a_stored_link_holds(self, link, key, expected):
        assert stored_link_ids(link, key) == {uuid.UUID(v) for v in expected}
