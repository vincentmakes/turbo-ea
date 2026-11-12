"""What a draft step link may point at.

``PUT /bpm/processes/{pid}/flow/versions/{vid}/draft-elements/{bpmn_element_id}``
used to store whatever it was sent: a value that was not a card id (which then
made publishing fail on ``uuid.UUID``), or a card of the wrong type (an IT
Component in the Application slot). Every NEW link is now checked before
anything is stored: a malformed id or a card of another type is a 400, a card
that does not exist or is archived a 404, and a card hidden from the caller
stays a 404. Clears, links kept for a caller who never saw them, and a draft
that already holds a link to a card archived since all keep working.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.models.process_flow_version import ProcessFlowVersion
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)

BPMN = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="definitions_1">
  <process id="Process_1" isExecutable="false">
    <task id="task_quote" name="Create Quote" />
    <task id="task_invoice" name="Send Invoice" />
  </process>
</definitions>
"""

#: slot → the card (by fixture name) it takes, and one of another type.
SLOTS = {
    "application_id": ("app", "itc"),
    "data_object_id": ("data", "app"),
    "it_component_id": ("itc", "data"),
    "business_process_id": ("callee", "org"),
}
TYPES = {
    "application_id": "Application",
    "data_object_id": "DataObject",
    "it_component_id": "ITComponent",
    "business_process_id": "BusinessProcess",
}
NAMES = {
    "application_id": "application_name",
    "data_object_id": "data_object_name",
    "it_component_id": "it_component_name",
    "business_process_id": "business_process_name",
}


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="editor",
        label="Editor",
        permissions={"bpm.view": True, "bpm.edit": True, "inventory.view": True},
    )
    await create_card_type(db, key="BusinessProcess", label="Business Process")
    # Applications are hidden from the editor role.
    await create_card_type(
        db,
        key="Application",
        label="Application",
        role_permissions={"editor": {"inventory.view": False}},
    )
    await create_card_type(db, key="DataObject", label="Data Object")
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_card_type(db, key="Organization", label="Organization")
    PermissionService.invalidate_type_permission_cache()
    admin = await create_user(db, email="admin@test.com", role="admin")
    editor = await create_user(db, email="editor@test.com", role="editor")
    cards = {
        "process": await create_card(db, card_type="BusinessProcess", name="Order to Cash"),
        "callee": await create_card(db, card_type="BusinessProcess", name="Credit Check"),
        "app": await create_card(db, card_type="Application", name="ERP"),
        "data": await create_card(db, card_type="DataObject", name="Order"),
        "itc": await create_card(db, card_type="ITComponent", name="PostgreSQL"),
        "org": await create_card(db, card_type="Organization", name="Sales"),
        "org2": await create_card(db, card_type="Organization", name="Finance"),
        "archived_data": await create_card(
            db, card_type="DataObject", name="Old order", status="ARCHIVED"
        ),
        "archived_org": await create_card(
            db, card_type="Organization", name="Old team", status="ARCHIVED"
        ),
    }
    return {"admin": admin, "editor": editor, **{k: str(c.id) for k, c in cards.items()}}


@pytest.fixture
async def draft(client, env):
    resp = await client.post(
        f"/api/v1/bpm/processes/{env['process']}/flow/drafts",
        json={"bpmn_xml": BPMN},
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code in (200, 201), resp.text
    vid = resp.json()["id"]
    return f"/api/v1/bpm/processes/{env['process']}/flow/versions/{vid}"


async def _put(client, user, base, body, element="task_quote"):
    return await client.put(
        f"{base}/draft-elements/{element}", json=body, headers=auth_headers(user)
    )


async def _step(client, user, base, element="task_quote"):
    resp = await client.get(f"{base}/draft-elements", headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    return next(e for e in resp.json() if e["bpmn_element_id"] == element)


async def _stored(db, base):
    vid = uuid.UUID(base.rsplit("/", 1)[1])
    links = (
        await db.execute(
            select(ProcessFlowVersion.draft_element_links).where(ProcessFlowVersion.id == vid)
        )
    ).scalar_one()
    return links or {}


class TestEachSlotTakesItsType:
    @pytest.mark.parametrize("slot", list(SLOTS))
    async def test_a_card_of_the_slots_type_is_linked(self, client, db, env, draft, slot):
        card = env[SLOTS[slot][0]]
        resp = await _put(client, env["admin"], draft, {slot: card})
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"status": "updated", "bpmn_element_id": "task_quote"}
        step = await _step(client, env["admin"], draft)
        assert step[slot] == card
        assert step[NAMES[slot]]

    @pytest.mark.parametrize("slot", list(SLOTS))
    async def test_a_card_of_another_type_is_a_400(self, client, db, env, draft, slot):
        good, wrong = SLOTS[slot]
        assert (await _put(client, env["admin"], draft, {slot: env[good]})).status_code == 200
        wrong_type = {"app": "Application", "itc": "ITComponent", "data": "DataObject"}.get(
            wrong, "Organization"
        )
        resp = await _put(client, env["admin"], draft, {slot: env[wrong]})
        assert resp.status_code == 400
        assert resp.json()["detail"] == (
            f"{slot} takes a card of type {TYPES[slot]}, not {wrong_type}"
        )
        # Nothing was stored: the good link is still there.
        assert (await _stored(db, draft))["task_quote"][slot] == env[good]

    async def test_organizations_take_organization_cards(self, client, db, env, draft):
        resp = await _put(
            client, env["admin"], draft, {"organization_ids": [env["org"], env["org2"]]}
        )
        assert resp.status_code == 200, resp.text
        step = await _step(client, env["admin"], draft)
        assert {o["name"] for o in step["organizations"]} == {"Sales", "Finance"}

        resp = await _put(
            client, env["admin"], draft, {"organization_ids": [env["org"], env["app"]]}
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == (
            "organization_ids takes a card of type Organization, not Application"
        )
        stored = (await _stored(db, draft))["task_quote"]["organization_ids"]
        assert sorted(stored) == sorted([env["org"], env["org2"]])

    async def test_an_id_in_another_spelling_is_stored_canonical(self, client, db, env, draft):
        resp = await _put(
            client,
            env["admin"],
            draft,
            {
                "application_id": env["app"].upper(),
                "organization_ids": ["{" + env["org"] + "}", ""],
            },
        )
        assert resp.status_code == 200, resp.text
        stored = (await _stored(db, draft))["task_quote"]
        assert stored["application_id"] == env["app"]
        assert stored["organization_ids"] == [env["org"]]
        step = await _step(client, env["admin"], draft)
        assert step["application_name"] == "ERP"


class TestMalformedIds:
    @pytest.mark.parametrize("slot", list(SLOTS))
    @pytest.mark.parametrize("value", ["not-a-uuid", 42, ["x"]])
    async def test_a_value_that_is_not_a_card_id_is_a_400(
        self, client, db, env, draft, slot, value
    ):
        resp = await _put(client, env["admin"], draft, {slot: value})
        assert resp.status_code == 400
        assert resp.json()["detail"] == f"{slot} must be a card id (UUID)"
        assert "task_quote" not in await _stored(db, draft)

    async def test_organizations_must_be_a_list(self, client, db, env, draft):
        resp = await _put(client, env["admin"], draft, {"organization_ids": env["org"]})
        assert resp.status_code == 400
        assert resp.json()["detail"] == "organization_ids must be a list of card ids"

    async def test_a_malformed_organization_is_a_400(self, client, db, env, draft):
        resp = await _put(client, env["admin"], draft, {"organization_ids": [env["org"], "Sales"]})
        assert resp.status_code == 400
        assert resp.json()["detail"] == "organization_ids must be a card id (UUID)"
        assert "task_quote" not in await _stored(db, draft)

    async def test_a_bad_value_in_one_slot_stores_none_of_the_others(self, client, db, env, draft):
        resp = await _put(
            client, env["admin"], draft, {"application_id": env["app"], "data_object_id": "x"}
        )
        assert resp.status_code == 400
        assert "task_quote" not in await _stored(db, draft)


class TestMissingArchivedAndHidden:
    async def test_a_card_that_does_not_exist_is_a_404(self, client, db, env, draft):
        resp = await _put(client, env["admin"], draft, {"data_object_id": str(uuid.uuid4())})
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Card not found"

    async def test_an_archived_card_is_a_404(self, client, db, env, draft):
        resp = await _put(client, env["admin"], draft, {"data_object_id": env["archived_data"]})
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Card not found"
        resp = await _put(client, env["admin"], draft, {"organization_ids": [env["archived_org"]]})
        assert resp.status_code == 404
        assert "task_quote" not in await _stored(db, draft)

    async def test_an_archived_process_is_a_404(self, client, db, env, draft):
        callee = await db.get(Card, uuid.UUID(env["callee"]))
        callee.status = "ARCHIVED"
        await db.flush()
        resp = await _put(client, env["admin"], draft, {"business_process_id": env["callee"]})
        assert resp.status_code == 404

    async def test_a_hidden_card_is_still_a_404(self, client, db, env, draft):
        resp = await _put(client, env["editor"], draft, {"application_id": env["app"]})
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Card not found"
        # In another slot too: the type is never named for a card the caller
        # may not see.
        resp = await _put(client, env["editor"], draft, {"it_component_id": env["app"]})
        assert resp.status_code == 404
        resp = await _put(client, env["editor"], draft, {"organization_ids": [env["app"]]})
        assert resp.status_code == 404

    async def test_the_editor_may_link_the_types_they_can_see(self, client, db, env, draft):
        resp = await _put(client, env["editor"], draft, {"it_component_id": env["itc"]})
        assert resp.status_code == 200, resp.text

    async def test_a_clear_keeps_a_link_the_caller_never_saw(self, client, db, env, draft):
        assert (
            await _put(client, env["admin"], draft, {"application_id": env["app"]})
        ).status_code == 200
        resp = await _put(client, env["editor"], draft, {"application_id": ""})
        assert resp.status_code == 200, resp.text
        assert (await _stored(db, draft))["task_quote"]["application_id"] == env["app"]


class TestClearsAndStaleLinks:
    @pytest.mark.parametrize("slot", list(SLOTS))
    @pytest.mark.parametrize("empty", ["", None])
    async def test_an_empty_value_clears_the_link(self, client, db, env, draft, slot, empty):
        assert (
            await _put(client, env["admin"], draft, {slot: env[SLOTS[slot][0]]})
        ).status_code == 200
        resp = await _put(client, env["admin"], draft, {slot: empty})
        assert resp.status_code == 200, resp.text
        assert (await _stored(db, draft))["task_quote"][slot] is None

    async def test_an_empty_organization_list_clears_them(self, client, db, env, draft):
        await _put(client, env["admin"], draft, {"organization_ids": [env["org"]]})
        resp = await _put(client, env["admin"], draft, {"organization_ids": []})
        assert resp.status_code == 200
        assert (await _stored(db, draft))["task_quote"]["organization_ids"] == []

    async def test_a_link_archived_since_does_not_block_the_draft(self, client, db, env, draft):
        """A draft keeps working when a card it links is archived after the
        link was made: re-sending the step's links (the editor sends the whole
        organisation list) and editing its other links succeed, and the draft
        still publishes, dropping the stale links with a warning as before."""
        await _put(
            client,
            env["admin"],
            draft,
            {"data_object_id": env["data"], "organization_ids": [env["org"]]},
        )
        for key in ("data", "org"):
            card = await db.get(Card, uuid.UUID(env[key]))
            card.status = "ARCHIVED"
        await db.flush()

        resp = await _put(client, env["admin"], draft, {"data_object_id": env["data"]})
        assert resp.status_code == 200, resp.text
        resp = await _put(
            client, env["admin"], draft, {"organization_ids": [env["org"], env["org2"]]}
        )
        assert resp.status_code == 200, resp.text
        resp = await _put(client, env["admin"], draft, {"it_component_id": env["itc"]})
        assert resp.status_code == 200, resp.text
        # A NEW archived card is still refused next to the stale one.
        resp = await _put(
            client,
            env["admin"],
            draft,
            {"organization_ids": [env["org"], env["archived_org"]]},
        )
        assert resp.status_code == 404

        headers = auth_headers(env["admin"])
        assert (await client.post(f"{draft}/submit", headers=headers)).status_code == 200
        resp = await client.post(f"{draft}/approve", headers=headers)
        assert resp.status_code == 200, resp.text

    async def test_a_stored_process_link_is_not_re_validated(self, client, db, env, draft):
        await _put(client, env["admin"], draft, {"business_process_id": env["callee"]})
        callee = await db.get(Card, uuid.UUID(env["callee"]))
        callee.status = "ARCHIVED"
        await db.flush()
        resp = await _put(client, env["admin"], draft, {"business_process_id": env["callee"]})
        assert resp.status_code == 200, resp.text
