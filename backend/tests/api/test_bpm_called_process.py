"""A call activity's link to the Business Process it invokes.

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


def _bpmn(called: str | None = None) -> str:
    attr = f' calledElement="{called}"' if called else ""
    return f"""\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="definitions_1">
  <process id="Process_1" isExecutable="false">
    <task id="task_quote" name="Create Quote" />
    <callActivity id="call_credit" name="Run credit check"{attr} />
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
        # Only a call activity calls a process.
        resp = await client.put(
            task_url, json={"business_process_id": str(env["credit"].id)}, headers=headers
        )
        assert resp.status_code == 400
        assert await _calls_relations(db, pid) == set()

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

        # A task cannot call a process; the process cannot call itself; a
        # non-process card is refused — all at write time.
        resp = await client.put(
            f"{base}/draft-elements/task_quote",
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

        assert (await client.post(f"{base}/submit", headers=headers)).status_code == 200
        assert (await client.post(f"{base}/approve", headers=headers)).status_code == 200

        db.expire_all()
        elems = await _elements(client, env, pid, headers)
        assert elems["call_credit"]["business_process_id"] == str(credit_id)
        assert await _calls_relations(db, pid) == {credit_id}

    async def test_the_xml_wins_over_a_prelink(self, client, db, env):
        credit_id, other, pid = env["credit"].id, env["other"], env["process"].id
        headers = auth_headers(env["admin"])
        draft_id = await self._draft(client, env, _bpmn(str(credit_id)))
        base = f"/api/v1/bpm/processes/{pid}/flow/versions/{draft_id}"

        # The draft table already shows what the XML says.
        draft_elems = {
            e["bpmn_element_id"]: e
            for e in (await client.get(f"{base}/draft-elements", headers=headers)).json()
        }
        assert draft_elems["call_credit"]["business_process_name"] == "Credit Check"

        # A stale pre-link to another process is overruled at publish.
        resp = await client.put(
            f"{base}/draft-elements/call_credit",
            json={"business_process_id": str(other.id)},
            headers=headers,
        )
        assert resp.status_code == 200
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
        assert row.business_process_id == credit_id
