"""A step's link to a Business Process — a call activity's callee, or the
process any other step links to through ``turboea:processRef``.

Covers the two write paths (the published element table and the draft
pre-link), the read shape, the XML-over-pre-link precedence at publish, and
the ``relProcessCalls`` relation the link mints.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.process_element import ProcessElement
from app.models.relation import Relation
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation_type,
    create_role,
    create_user,
)


def _bpmn(called: str | None = None, task_ref: str | None = None) -> str:
    attr = f' calledElement="{called}"' if called else ""
    ref = f' turboea:processRef="{task_ref}"' if task_ref else ""
    return f"""\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:turboea="http://turbo-ea.io/schema/bpmn/1.0" id="definitions_1">
  <process id="Process_1" isExecutable="false">
    <task id="task_quote" name="Create Quote"{ref} />
    <callActivity id="call_credit" name="Run credit check"{attr} />
    <dataObjectReference id="data_order" name="Order" dataObjectRef="do_1" />
    <dataObject id="do_1" />
  </process>
</definitions>
"""


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_card_type(db, key="BusinessProcess", label="Business Process")
    await create_card_type(db, key="Application", label="Application")
    await create_relation_type(
        db,
        key="relProcessCalls",
        label="calls",
        source_type_key="BusinessProcess",
        target_type_key="BusinessProcess",
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    process = await create_card(
        db, card_type="BusinessProcess", name="Order to Cash", user_id=admin.id
    )
    credit = await create_card(
        db, card_type="BusinessProcess", name="Credit Check", user_id=admin.id
    )
    other = await create_card(db, card_type="BusinessProcess", name="Invoicing", user_id=admin.id)
    app = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    return {"admin": admin, "process": process, "credit": credit, "other": other, "app": app}


async def _save(client, env, xml):
    resp = await client.put(
        f"/api/v1/bpm/processes/{env['process'].id}/diagram",
        json={"bpmn_xml": xml},
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200, resp.text


async def _elements(client, env, pid=None, headers=None):
    # `pid` / `headers` let a caller that has expired the session pass values
    # captured beforehand.
    resp = await client.get(
        f"/api/v1/bpm/processes/{pid or env['process'].id}/elements",
        headers=headers or auth_headers(env["admin"]),
    )
    assert resp.status_code == 200, resp.text
    return {e["bpmn_element_id"]: e for e in resp.json()}


async def _calls_relations(db, process_id):
    rows = await db.execute(
        select(Relation.target_id).where(
            Relation.type == "relProcessCalls", Relation.source_id == process_id
        )
    )
    return {row[0] for row in rows.all()}


class TestElementTable:
    async def test_a_uuid_in_the_xml_links_on_save(self, client, db, env):
        credit = env["credit"]
        await _save(client, env, _bpmn(str(credit.id)))
        elems = await _elements(client, env)
        call = elems["call_credit"]
        assert call["called_element"] == str(credit.id)
        assert call["business_process_id"] == str(credit.id)
        assert call["business_process_name"] == "Credit Check"
        assert elems["task_quote"]["business_process_id"] is None
        assert elems["task_quote"]["called_element"] is None

    async def test_manual_link_and_clear(self, client, db, env):
        credit, pid = env["credit"], env["process"].id
        await _save(client, env, _bpmn("Process_Credit"))
        elems = await _elements(client, env)
        assert elems["call_credit"]["called_element"] == "Process_Credit"
        assert elems["call_credit"]["business_process_id"] is None

        headers = auth_headers(env["admin"])
        url = f"/api/v1/bpm/processes/{pid}/elements/{elems['call_credit']['id']}"
        resp = await client.put(url, json={"business_process_id": str(credit.id)}, headers=headers)
        assert resp.status_code == 200, resp.text
        elems = await _elements(client, env)
        assert elems["call_credit"]["business_process_name"] == "Credit Check"
        # The foreign reference is still reported beside the manual link.
        assert elems["call_credit"]["called_element"] == "Process_Credit"
        assert await _calls_relations(db, pid) == {credit.id}

        # The link survives a re-save of the same XML …
        await _save(client, env, _bpmn("Process_Credit"))
        elems = await _elements(client, env)
        assert elems["call_credit"]["business_process_id"] == str(credit.id)

        # … and "" clears it (the relation is additive and stays).
        resp = await client.put(url, json={"business_process_id": ""}, headers=headers)
        assert resp.status_code == 200
        elems = await _elements(client, env)
        assert elems["call_credit"]["business_process_id"] is None

    async def test_validation(self, client, db, env):
        pid = env["process"].id
        await _save(client, env, _bpmn())
        elems = await _elements(client, env)
        headers = auth_headers(env["admin"])
        call_url = f"/api/v1/bpm/processes/{pid}/elements/{elems['call_credit']['id']}"
        task_url = f"/api/v1/bpm/processes/{pid}/elements/{elems['task_quote']['id']}"

        # Not a process card.
        resp = await client.put(
            call_url, json={"business_process_id": str(env["app"].id)}, headers=headers
        )
        assert resp.status_code == 404
        # The process itself.
        resp = await client.put(call_url, json={"business_process_id": str(pid)}, headers=headers)
        assert resp.status_code == 400
        # Not a UUID at all.
        resp = await client.put(call_url, json={"business_process_id": "nope"}, headers=headers)
        assert resp.status_code == 400
        # A data artefact is not a step and never links a process.
        data_url = f"/api/v1/bpm/processes/{pid}/elements/{elems['data_order']['id']}"
        resp = await client.put(
            data_url, json={"business_process_id": str(env["credit"].id)}, headers=headers
        )
        assert resp.status_code == 400
        assert await _calls_relations(db, pid) == set()

        # A plain task links like any other step, and mints the relation.
        resp = await client.put(
            task_url, json={"business_process_id": str(env["credit"].id)}, headers=headers
        )
        assert resp.status_code == 200, resp.text
        elems = await _elements(client, env)
        assert elems["task_quote"]["business_process_name"] == "Credit Check"
        assert await _calls_relations(db, pid) == {env["credit"].id}

    async def test_a_process_ref_in_the_xml_links_a_plain_task_on_save(self, client, db, env):
        credit, pid = env["credit"], env["process"].id
        await _save(client, env, _bpmn(task_ref=str(credit.id)))
        elems = await _elements(client, env)
        assert elems["task_quote"]["called_element"] == str(credit.id)
        assert elems["task_quote"]["business_process_id"] == str(credit.id)
        assert elems["task_quote"]["business_process_name"] == "Credit Check"
        assert elems["call_credit"]["business_process_id"] is None
        assert elems["data_order"]["business_process_id"] is None
        assert await _calls_relations(db, pid) == {credit.id}

    async def test_the_xml_wins_over_a_manual_link(self, client, db, env):
        credit, other, pid = env["credit"], env["other"], env["process"].id
        await _save(client, env, _bpmn())
        elems = await _elements(client, env)
        resp = await client.put(
            f"/api/v1/bpm/processes/{pid}/elements/{elems['call_credit']['id']}",
            json={"business_process_id": str(other.id)},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        # The modeler then picks Credit Check: the XML carries its UUID.
        await _save(client, env, _bpmn(str(credit.id)))
        elems = await _elements(client, env)
        assert elems["call_credit"]["business_process_id"] == str(credit.id)
        assert await _calls_relations(db, pid) == {other.id, credit.id}


class TestDraftPreLink:
    async def _draft(self, client, env, xml):
        resp = await client.post(
            f"/api/v1/bpm/processes/{env['process'].id}/flow/drafts",
            json={"bpmn_xml": xml},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code in (200, 201), resp.text
        return resp.json()["id"]

    async def test_prelink_validates_and_publishes(self, client, db, env):
        credit_id, pid = env["credit"].id, env["process"].id
        headers = auth_headers(env["admin"])
        draft_id = await self._draft(client, env, _bpmn("Process_Credit"))
        base = f"/api/v1/bpm/processes/{pid}/flow/versions/{draft_id}"

        # An artefact cannot link a process; the process cannot call itself; a
        # non-process card is refused — all at write time.
        resp = await client.put(
            f"{base}/draft-elements/data_order",
            json={"business_process_id": str(credit_id)},
            headers=headers,
        )
        assert resp.status_code == 400
        resp = await client.put(
            f"{base}/draft-elements/call_credit",
            json={"business_process_id": str(pid)},
            headers=headers,
        )
        assert resp.status_code == 400
        resp = await client.put(
            f"{base}/draft-elements/call_credit",
            json={"business_process_id": str(env["app"].id)},
            headers=headers,
        )
        assert resp.status_code == 404

        resp = await client.put(
            f"{base}/draft-elements/call_credit",
            json={"business_process_id": str(credit_id)},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text

        draft_elems = {
            e["bpmn_element_id"]: e
            for e in (await client.get(f"{base}/draft-elements", headers=headers)).json()
        }
        assert draft_elems["call_credit"]["business_process_id"] == str(credit_id)
        assert draft_elems["call_credit"]["business_process_name"] == "Credit Check"
        assert draft_elems["call_credit"]["called_element"] == "Process_Credit"
        assert draft_elems["task_quote"]["business_process_id"] is None

        # A plain task pre-links like any other step.
        resp = await client.put(
            f"{base}/draft-elements/task_quote",
            json={"business_process_id": str(credit_id)},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        draft_elems = {
            e["bpmn_element_id"]: e
            for e in (await client.get(f"{base}/draft-elements", headers=headers)).json()
        }
        assert draft_elems["task_quote"]["business_process_name"] == "Credit Check"
        assert draft_elems["data_order"]["business_process_id"] is None

        assert (await client.post(f"{base}/submit", headers=headers)).status_code == 200
        assert (await client.post(f"{base}/approve", headers=headers)).status_code == 200

        db.expire_all()
        elems = await _elements(client, env, pid, headers)
        assert elems["call_credit"]["business_process_id"] == str(credit_id)
        assert await _calls_relations(db, pid) == {credit_id}

    async def test_a_draft_link_wins_over_the_xml_reference(self, client, db, env):
        """The draft is where the user works, so what it says wins.

        The XML reference is the fallback for a step the draft says nothing
        about — it is not an override of a deliberate pick.
        """
        # Ids captured before `db.expire_all()` below: touching an ORM object
        # after that re-loads it and needs a greenlet context the test lacks.
        credit_id, other_id, pid = env["credit"].id, env["other"].id, env["process"].id
        headers = auth_headers(env["admin"])
        draft_id = await self._draft(client, env, _bpmn(str(credit_id)))
        base = f"/api/v1/bpm/processes/{pid}/flow/versions/{draft_id}"

        # With no pre-link, the draft table shows what the XML says.
        draft_elems = {
            e["bpmn_element_id"]: e
            for e in (await client.get(f"{base}/draft-elements", headers=headers)).json()
        }
        assert draft_elems["call_credit"]["business_process_name"] == "Credit Check"

        # Picking another process in the draft overrides it, in the read …
        resp = await client.put(
            f"{base}/draft-elements/call_credit",
            json={"business_process_id": str(other_id)},
            headers=headers,
        )
        assert resp.status_code == 200
        draft_elems = {
            e["bpmn_element_id"]: e
            for e in (await client.get(f"{base}/draft-elements", headers=headers)).json()
        }
        assert draft_elems["call_credit"]["business_process_name"] == "Invoicing"

        # … and at publish.
        assert (await client.post(f"{base}/submit", headers=headers)).status_code == 200
        assert (await client.post(f"{base}/approve", headers=headers)).status_code == 200

        db.expire_all()
        row = (
            await db.execute(
                select(ProcessElement).where(
                    ProcessElement.process_id == pid,
                    ProcessElement.bpmn_element_id == "call_credit",
                )
            )
        ).scalar_one()
        assert row.business_process_id == other_id

    async def test_clearing_in_a_draft_beats_the_xml_reference(self, client, db, env):
        """An explicit clear is a decision, not an absence.

        Without it the XML reference would come back at publish and the user
        would be unable to unlink a step the diagram still references.
        """
        credit_id, pid = env["credit"].id, env["process"].id
        headers = auth_headers(env["admin"])
        draft_id = await self._draft(client, env, _bpmn(str(credit_id)))
        base = f"/api/v1/bpm/processes/{pid}/flow/versions/{draft_id}"

        resp = await client.put(
            f"{base}/draft-elements/call_credit",
            json={"business_process_id": ""},
            headers=headers,
        )
        assert resp.status_code == 200
        draft_elems = {
            e["bpmn_element_id"]: e
            for e in (await client.get(f"{base}/draft-elements", headers=headers)).json()
        }
        assert draft_elems["call_credit"]["business_process_id"] is None

        assert (await client.post(f"{base}/submit", headers=headers)).status_code == 200
        assert (await client.post(f"{base}/approve", headers=headers)).status_code == 200

        db.expire_all()
        row = (
            await db.execute(
                select(ProcessElement).where(
                    ProcessElement.process_id == pid,
                    ProcessElement.bpmn_element_id == "call_credit",
                )
            )
        ).scalar_one()
        assert row.business_process_id is None

    async def test_a_published_link_reaches_a_draft_made_afterwards(self, client, db, env):
        """The sync point: a new draft starts from the published rows.

        A link made in the published elements table is metadata on top of an
        approved flow; the draft created next picks it up, which is what makes
        it visible in the modeler.
        """
        credit, pid = env["credit"], env["process"].id
        headers = auth_headers(env["admin"])

        # Publish a flow whose XML references nothing …
        first = await self._draft(client, env, _bpmn())
        first_base = f"/api/v1/bpm/processes/{pid}/flow/versions/{first}"
        assert (await client.post(f"{first_base}/submit", headers=headers)).status_code == 200
        assert (await client.post(f"{first_base}/approve", headers=headers)).status_code == 200

        # … then link a process in the published elements table.
        elems = await _elements(client, env, pid, headers)
        resp = await client.put(
            f"/api/v1/bpm/processes/{pid}/elements/{elems['task_quote']['id']}",
            json={"business_process_id": str(credit.id)},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text

        # A draft based on the published version starts from that link.
        resp = await client.post(
            f"/api/v1/bpm/processes/{pid}/flow/drafts",
            json={"bpmn_xml": "", "based_on_id": first},
            headers=headers,
        )
        assert resp.status_code in (200, 201), resp.text
        second = resp.json()["id"]
        draft_elems = {
            e["bpmn_element_id"]: e
            for e in (
                await client.get(
                    f"/api/v1/bpm/processes/{pid}/flow/versions/{second}/draft-elements",
                    headers=headers,
                )
            ).json()
        }
        assert draft_elems["task_quote"]["business_process_name"] == "Credit Check"

    async def test_a_process_can_be_linked_before_the_shape_is_saved(self, client, db, env):
        """The modeler links a shape the moment it is placed.

        Its 5s autosave has not run yet, so the element is not in the draft's
        stored XML — the link still has to be accepted, or the pick is lost.
        """
        credit_id, pid = env["credit"].id, env["process"].id
        headers = auth_headers(env["admin"])
        draft_id = await self._draft(client, env, _bpmn())
        resp = await client.put(
            f"/api/v1/bpm/processes/{pid}/flow/versions/{draft_id}"
            "/draft-elements/task_not_yet_in_the_xml",
            json={"business_process_id": str(credit_id)},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
