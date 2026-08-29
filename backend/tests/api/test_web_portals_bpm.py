"""Integration tests for the account-less Process Navigator portal.

The load-bearing assertions here are the negative ones. Two things must never
reach an anonymous visitor whatever the portal is configured to show: the
application and data landscape behind a process (with its costs), and any BPMN
that has not been *published*. A third — the linked-system names on each step —
must stay withheld until an administrator switches it on.

The scope tests matter as much: process ids are handed out freely by portals'
own maps, so a portal narrowed to one branch of the house must refuse to serve
any other process's flow even when asked for it by id.
"""

from __future__ import annotations

import json
import re

import pytest
from sqlalchemy import select

from app.models.app_settings import AppSettings
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

MAP = "/api/v1/web-portals/public/house/bpm/process-map"
FLOW = "/api/v1/web-portals/public/house/bpm/processes/{pid}/flow"

# Any 8-4 hex prefix — catches a raw UUID wherever it appears in the payload.
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-", re.IGNORECASE)

# Markers seeded into data the portal must never publish. Asserting on the
# marker rather than on a field name catches a leak through a field nobody
# thought to check.
SECRET_APP = "SecretERP"
SECRET_COST = 987654
PUBLISHED_XML = "<definitions id='published-rev'/>"
DRAFT_XML = "<definitions id='draft-rev-SHOULD-NOT-LEAK'/>"


async def _set_module(db, key: str, enabled: bool):
    row = (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one_or_none()
    if row is None:
        db.add(AppSettings(id="default", general_settings={key: enabled}))
    else:
        row.general_settings = {**(row.general_settings or {}), key: enabled}
    await db.flush()


async def _add_relation(db, rel_type, source, target):
    from app.models.relation import Relation

    rel = Relation(type=rel_type, source_id=source.id, target_id=target.id, attributes={})
    db.add(rel)
    await db.flush()
    return rel


async def _add_flow_version(db, process, *, status="published", revision=1, xml=PUBLISHED_XML):
    from app.models.process_flow_version import ProcessFlowVersion

    v = ProcessFlowVersion(
        process_id=process.id,
        status=status,
        revision=revision,
        bpmn_xml=xml,
        svg_thumbnail="<svg/>",
    )
    db.add(v)
    await db.flush()
    return v


async def _add_element(db, process, *, bpmn_id="Task_1", name="Approve order", **kwargs):
    from app.models.process_element import ProcessElement, ProcessElementOrganization

    el = ProcessElement(
        process_id=process.id,
        bpmn_element_id=bpmn_id,
        element_type=kwargs.get("element_type", "task"),
        name=name,
        documentation=kwargs.get("documentation", "How the step works"),
        lane_name=kwargs.get("lane_name", "Finance"),
        is_automated=kwargs.get("is_automated", False),
        sequence_order=kwargs.get("sequence_order", 0),
        application_id=kwargs.get("application_id"),
        data_object_id=kwargs.get("data_object_id"),
        it_component_id=kwargs.get("it_component_id"),
        custom_fields=kwargs.get("custom_fields", {"tcode": "SE16"}),
    )
    db.add(el)
    await db.flush()
    for org in kwargs.get("organizations", []) or []:
        db.add(ProcessElementOrganization(element_id=el.id, organization_id=org.id))
    await db.flush()
    return el


@pytest.fixture
async def bpm_portal_env(db, client):
    """An admin, a published navigator portal, and a two-level process house."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    for key in ("BusinessProcess", "Application", "DataObject", "Organization"):
        await create_card_type(db, key=key, label=key)
    await _set_module(db, "bpmEnabled", True)
    admin = await create_user(db, email="admin@test.com", role="admin")

    org = await create_card(db, card_type="Organization", name="Finance Dept")
    app = await create_card(
        db,
        card_type="Application",
        name=SECRET_APP,
        attributes={"costTotalAnnual": SECRET_COST},
    )
    data_obj = await create_card(db, card_type="DataObject", name="Purchase Order")

    parent = await create_card(
        db,
        card_type="BusinessProcess",
        name="Order to Cash",
        subtype="core",
        description="How money reaches the company",
        lifecycle={"active": "2026-01-01"},
        attributes={
            "processType": "core",
            "maturity": "managed",
            "automationLevel": "partial",
            "riskLevel": "medium",
            "sortOrder": 1,
            # Neither is an overlay key, so neither may be published. The second
            # is what an administrator adding a cost field to the type looks like.
            "internalNote": "Do not publish me",
            "costEstimate": SECRET_COST,
        },
    )
    child = await create_card(
        db,
        card_type="BusinessProcess",
        name="Invoice Customer",
        subtype="core",
        parent_id=parent.id,
        attributes={"processType": "core"},
    )

    await _add_relation(db, "relProcessToApp", parent, app)
    await _add_relation(db, "relProcessToDataObj", parent, data_obj)
    await _add_relation(db, "relProcessToOrg", parent, org)

    await _add_flow_version(db, parent, status="published", revision=1)
    await _add_element(
        db,
        parent,
        application_id=app.id,
        data_object_id=data_obj.id,
        organizations=[org],
    )

    resp = await client.post(
        "/api/v1/web-portals",
        json={
            "name": "Process House",
            "slug": "house",
            "card_type": "BusinessProcess",
            "view": "process_navigator",
            "is_published": True,
        },
        headers=auth_headers(admin),
    )
    assert resp.status_code == 201, resp.text
    return {
        "admin": admin,
        "portal_id": resp.json()["id"],
        "parent": parent,
        "child": child,
        "org": org,
        "app": app,
    }


async def _set_bpm_config(client, admin, portal_id, **cfg):
    resp = await client.patch(
        f"/api/v1/web-portals/{portal_id}",
        json={"card_config": {"bpm": cfg}},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200, resp.text


class TestPortalTypeAdmin:
    async def test_navigator_view_accepted(self, client, bpm_portal_env):
        resp = await client.get(
            f"/api/v1/web-portals/{bpm_portal_env['portal_id']}",
            headers=auth_headers(bpm_portal_env["admin"]),
        )
        assert resp.json()["view"] == "process_navigator"

    async def test_navigator_view_pins_card_type(self, client, bpm_portal_env):
        """The request asks for Application; the server pins BusinessProcess."""
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Pinned",
                "slug": "pinned",
                "card_type": "Application",
                "view": "process_navigator",
            },
            headers=auth_headers(bpm_portal_env["admin"]),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["card_type"] == "BusinessProcess"

    async def test_patch_cannot_repoint_card_type(self, client, bpm_portal_env):
        resp = await client.patch(
            f"/api/v1/web-portals/{bpm_portal_env['portal_id']}",
            json={"card_type": "Application"},
            headers=auth_headers(bpm_portal_env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["card_type"] == "BusinessProcess"

    async def test_requires_bpm_enabled(self, client, db, bpm_portal_env):
        """`bpmEnabled` defaults to True, so this must switch it off explicitly.

        A copy of the PPM test that relied on the key being absent would pass
        vacuously here — absent means *on* for BPM.
        """
        await _set_module(db, "bpmEnabled", False)
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Off",
                "slug": "off",
                "card_type": "BusinessProcess",
                "view": "process_navigator",
            },
            headers=auth_headers(bpm_portal_env["admin"]),
        )
        assert resp.status_code == 400
        assert "BPM" in resp.json()["detail"]

    async def test_navigator_creatable_when_toggle_absent(self, client, db, bpm_portal_env):
        """An install that never touched the BPM toggle can still publish one."""
        row = (
            await db.execute(select(AppSettings).where(AppSettings.id == "default"))
        ).scalar_one_or_none()
        if row is not None:
            general = dict(row.general_settings or {})
            general.pop("bpmEnabled", None)
            row.general_settings = general
            await db.flush()
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Default On",
                "slug": "default-on",
                "card_type": "BusinessProcess",
                "view": "process_navigator",
            },
            headers=auth_headers(bpm_portal_env["admin"]),
        )
        assert resp.status_code == 201, resp.text


class TestPublicProcessMap:
    async def test_served_without_a_cookie(self, client, bpm_portal_env):
        resp = await client.get(MAP)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        names = {i["name"] for i in body["items"]}
        assert names == {"Order to Cash", "Invoice Customer"}

    async def test_publishes_the_house_shape(self, client, bpm_portal_env):
        body = (await client.get(MAP)).json()
        parent = next(i for i in body["items"] if i["name"] == "Order to Cash")
        child = next(i for i in body["items"] if i["name"] == "Invoice Customer")
        assert child["parent_id"] == parent["id"]
        assert parent["subtype"] == "core"
        assert parent["description"] == "How money reaches the company"
        assert parent["lifecycle"] == {"active": "2026-01-01"}
        assert parent["has_flow"] is True
        assert parent["step_count"] == 1
        assert child["has_flow"] is False
        assert body["row_order"]

    async def test_attributes_are_whitelisted(self, client, bpm_portal_env):
        """Only the four overlay keys and the sort order — never a custom field."""
        body = (await client.get(MAP)).json()
        parent = next(i for i in body["items"] if i["name"] == "Order to Cash")
        assert set(parent["attributes"]) == {
            "processType",
            "maturity",
            "automationLevel",
            "riskLevel",
            "sortOrder",
        }
        assert "internalNote" not in parent["attributes"]
        assert "costEstimate" not in parent["attributes"]

    async def test_no_application_or_data_landscape(self, client, bpm_portal_env):
        """The systems behind a process, and their costs, are never published."""
        raw = json.dumps((await client.get(MAP)).json())
        assert SECRET_APP not in raw
        assert str(SECRET_COST) not in raw
        assert "Purchase Order" not in raw
        body = (await client.get(MAP)).json()
        for item in body["items"]:
            for banned in (
                "apps",
                "data_objects",
                "app_count",
                "total_cost",
                "ctx_ids",
                "org_ids",
                "data_quality",
                "approval_status",
            ):
                assert banned not in item, banned
        assert "business_contexts" not in body

    async def test_organizations_are_opaque_tokens(self, client, bpm_portal_env):
        body = (await client.get(MAP)).json()
        assert [o["name"] for o in body["organizations"]] == ["Finance Dept"]
        token = body["organizations"][0]["token"]
        assert not UUID_RE.search(token)
        assert str(bpm_portal_env["org"].id) not in json.dumps(body["organizations"])
        parent = next(i for i in body["items"] if i["name"] == "Order to Cash")
        assert parent["org_tokens"] == [token]

    async def test_only_the_process_id_is_a_uuid(self, client, bpm_portal_env):
        """Strip the one identifier published by design; no other may remain."""
        body = (await client.get(MAP)).json()
        for item in body["items"]:
            item.pop("id")
            item.pop("parent_id")
        assert not UUID_RE.search(json.dumps(body))

    async def test_archived_processes_excluded(self, client, db, bpm_portal_env):
        await create_card(
            db, card_type="BusinessProcess", name="Retired Process", status="ARCHIVED"
        )
        body = (await client.get(MAP)).json()
        assert "Retired Process" not in json.dumps(body)


class TestPublicFlow:
    async def test_serves_the_published_revision(self, client, bpm_portal_env):
        resp = await client.get(FLOW.format(pid=bpm_portal_env["parent"].id))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["bpmn_xml"] == PUBLISHED_XML
        assert body["revision"] == 1
        assert len(body["steps"]) == 1

    async def test_step_shape_is_whitelisted(self, client, bpm_portal_env):
        step = (await client.get(FLOW.format(pid=bpm_portal_env["parent"].id))).json()["steps"][0]
        assert step["bpmn_element_id"] == "Task_1"
        assert step["name"] == "Approve order"
        assert step["lane_name"] == "Finance"
        assert step["documentation"] == "How the step works"
        for banned in ("id", "process_id", "application_id", "custom_fields"):
            assert banned not in step, banned

    async def test_element_links_withheld_by_default(self, client, bpm_portal_env):
        """`show_element_links` is off unless an administrator turns it on."""
        body = (await client.get(FLOW.format(pid=bpm_portal_env["parent"].id))).json()
        step = body["steps"][0]
        assert step["application_name"] is None
        assert step["data_object_name"] is None
        assert step["it_component_name"] is None
        assert step["organizations"] == []
        assert SECRET_APP not in json.dumps(body)

    async def test_element_links_published_when_enabled(self, client, bpm_portal_env):
        await _set_bpm_config(
            client,
            bpm_portal_env["admin"],
            bpm_portal_env["portal_id"],
            show_element_links=True,
        )
        body = (await client.get(FLOW.format(pid=bpm_portal_env["parent"].id))).json()
        step = body["steps"][0]
        assert step["application_name"] == SECRET_APP
        assert step["data_object_name"] == "Purchase Order"
        assert [o["name"] for o in step["organizations"]] == ["Finance Dept"]
        # Names only — still no identifiers, and still no cost.
        assert str(bpm_portal_env["app"].id) not in json.dumps(body)
        assert str(SECRET_COST) not in json.dumps(body)

    async def test_draft_never_served(self, client, db, bpm_portal_env):
        await _add_flow_version(
            db, bpm_portal_env["parent"], status="draft", revision=2, xml=DRAFT_XML
        )
        body = (await client.get(FLOW.format(pid=bpm_portal_env["parent"].id))).json()
        assert body["bpmn_xml"] == PUBLISHED_XML
        assert "SHOULD-NOT-LEAK" not in json.dumps(body)

    @pytest.mark.parametrize("status", ["draft", "pending", "archived", "withdrawn"])
    async def test_unpublished_only_yields_empty_flow(self, client, db, bpm_portal_env, status):
        """A process whose only version is unpublished has no flow at all."""
        proc = await create_card(db, card_type="BusinessProcess", name=f"Only {status}")
        await _add_flow_version(db, proc, status=status, revision=1, xml=DRAFT_XML)
        body = (await client.get(FLOW.format(pid=proc.id))).json()
        assert body["bpmn_xml"] is None
        assert body["steps"] == []
        assert "SHOULD-NOT-LEAK" not in json.dumps(body)

    async def test_newest_published_revision_wins(self, client, db, bpm_portal_env):
        await _add_flow_version(
            db,
            bpm_portal_env["parent"],
            status="published",
            revision=3,
            xml="<definitions id='rev3'/>",
        )
        body = (await client.get(FLOW.format(pid=bpm_portal_env["parent"].id))).json()
        assert body["revision"] == 3
        assert "rev3" in body["bpmn_xml"]

    async def test_legacy_diagram_elements_are_not_published(self, client, db, bpm_portal_env):
        """Elements exist without any published version — they must stay hidden.

        `PUT /bpm/processes/{id}/diagram` parses the XML and writes
        `process_elements` rows itself, with no approval involved. Counting that
        table instead of gating on a published version would publish the shape of
        an unapproved flow.
        """
        proc = await create_card(db, card_type="BusinessProcess", name="Legacy Only")
        await _add_element(db, proc, bpmn_id="Task_L", name="Unapproved step")
        body = (await client.get(FLOW.format(pid=proc.id))).json()
        assert body["bpmn_xml"] is None
        assert body["steps"] == []
        assert "Unapproved step" not in json.dumps(body)

        mapped = (await client.get(MAP)).json()
        item = next(i for i in mapped["items"] if i["name"] == "Legacy Only")
        assert item["has_flow"] is False
        assert item["step_count"] == 0

    async def test_audit_trail_never_published(self, client, db, bpm_portal_env):
        approver = await create_user(db, email="approver@test.com", role="admin")
        v = await _add_flow_version(db, bpm_portal_env["parent"], status="published", revision=5)
        v.approved_by = approver.id
        v.created_by = approver.id
        await db.flush()
        raw = json.dumps((await client.get(FLOW.format(pid=bpm_portal_env["parent"].id))).json())
        assert "approver@test.com" not in raw
        assert str(approver.id) not in raw
        for banned in ("approved_by", "created_by", "withdrawal_reason", "draft_element_links"):
            assert banned not in raw, banned


class TestFlowScope:
    """A portal narrowed by filters must refuse every process outside its set."""

    async def _narrow(self, client, admin, portal_id, filters):
        resp = await client.patch(
            f"/api/v1/web-portals/{portal_id}",
            json={"filters": filters},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text

    async def test_subtype_filter_blocks_out_of_scope_flow(self, client, db, bpm_portal_env):
        other = await create_card(
            db, card_type="BusinessProcess", name="Payroll", subtype="support"
        )
        await _add_flow_version(db, other, status="published", revision=1, xml=DRAFT_XML)
        await self._narrow(
            client, bpm_portal_env["admin"], bpm_portal_env["portal_id"], {"subtypes": ["core"]}
        )

        assert "Payroll" not in json.dumps((await client.get(MAP)).json())
        resp = await client.get(FLOW.format(pid=other.id))
        assert resp.status_code == 404
        assert "SHOULD-NOT-LEAK" not in resp.text
        # The in-scope process still resolves.
        assert (await client.get(FLOW.format(pid=bpm_portal_env["parent"].id))).status_code == 200

    async def test_approval_filter_blocks_out_of_scope_flow(self, client, db, bpm_portal_env):
        other = await create_card(
            db, card_type="BusinessProcess", name="Draft Process", approval_status="DRAFT"
        )
        await _add_flow_version(db, other, status="published", revision=1, xml=DRAFT_XML)
        await self._narrow(
            client,
            bpm_portal_env["admin"],
            bpm_portal_env["portal_id"],
            {"approval_statuses": ["APPROVED"]},
        )
        resp = await client.get(FLOW.format(pid=other.id))
        assert resp.status_code == 404
        assert "SHOULD-NOT-LEAK" not in resp.text

    async def test_archived_process_flow_refused(self, client, db, bpm_portal_env):
        proc = await create_card(db, card_type="BusinessProcess", name="Retired", status="ARCHIVED")
        await _add_flow_version(db, proc, status="published", revision=1, xml=DRAFT_XML)
        assert (await client.get(FLOW.format(pid=proc.id))).status_code == 404

    async def test_non_process_card_refused(self, client, bpm_portal_env):
        assert (await client.get(FLOW.format(pid=bpm_portal_env["app"].id))).status_code == 404

    async def test_unknown_id_refused(self, client, bpm_portal_env):
        unknown = "11111111-1111-1111-1111-111111111111"
        assert (await client.get(FLOW.format(pid=unknown))).status_code == 404

    async def test_malformed_id_is_a_404_not_a_500(self, client, bpm_portal_env):
        assert (await client.get(FLOW.format(pid="not-a-uuid"))).status_code == 404

    async def test_malformed_tag_filter_does_not_500(self, client, bpm_portal_env):
        await self._narrow(
            client,
            bpm_portal_env["admin"],
            bpm_portal_env["portal_id"],
            {"tag_ids": ["nonsense", 42]},
        )
        assert (await client.get(MAP)).status_code == 200


class TestGuards:
    async def test_unpublished_portal_is_dark(self, client, bpm_portal_env):
        await client.patch(
            f"/api/v1/web-portals/{bpm_portal_env['portal_id']}",
            json={"is_published": False},
            headers=auth_headers(bpm_portal_env["admin"]),
        )
        assert (await client.get(MAP)).status_code == 404
        assert (await client.get(FLOW.format(pid=bpm_portal_env["parent"].id))).status_code == 404

    async def test_disabling_bpm_takes_the_portal_dark(self, client, db, bpm_portal_env):
        """No admin should have to unpublish portals one by one to switch BPM off."""
        await _set_module(db, "bpmEnabled", False)
        assert (await client.get(MAP)).status_code == 404
        assert (await client.get(FLOW.format(pid=bpm_portal_env["parent"].id))).status_code == 404

    async def test_routes_404_on_a_cards_portal(self, client, bpm_portal_env):
        """A card portal's slug must not confirm these routes exist."""
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Catalog",
                "slug": "catalog",
                "card_type": "BusinessProcess",
                "is_published": True,
            },
            headers=auth_headers(bpm_portal_env["admin"]),
        )
        assert resp.status_code == 201
        base = "/api/v1/web-portals/public/catalog/bpm"
        assert (await client.get(f"{base}/process-map")).status_code == 404
        pid = bpm_portal_env["parent"].id
        assert (await client.get(f"{base}/processes/{pid}/flow")).status_code == 404

    async def test_unknown_slug_404s(self, client, bpm_portal_env):
        assert (
            await client.get("/api/v1/web-portals/public/nope/bpm/process-map")
        ).status_code == 404


class TestQueryCount:
    async def test_map_does_not_load_the_landscape_it_never_publishes(
        self, client, db, bpm_portal_env, test_engine
    ):
        """The public map skips the Application / DataObject / context queries.

        The authenticated route loads every one of those cards to compute its
        application counts and cost rollups. The portal publishes none of it, so
        loading them would put an anonymous page-load one query away from the
        whole inventory for nothing. The house's organization filter is the only
        related data it still needs.
        """
        from sqlalchemy import event

        for n in range(20):
            await create_card(db, card_type="Application", name=f"Hidden App {n}")
            await create_card(db, card_type="DataObject", name=f"Hidden Data {n}")

        statements: list[str] = []

        def _capture(conn, cursor, statement, params, context, executemany):
            statements.append(statement)

        event.listen(test_engine.sync_engine, "before_cursor_execute", _capture)
        try:
            resp = await client.get(MAP)
        finally:
            event.remove(test_engine.sync_engine, "before_cursor_execute", _capture)

        assert resp.status_code == 200
        joined = " ".join(statements)
        assert "Hidden App" not in json.dumps(resp.json())
        # No SELECT went looking for Application or DataObject cards at all.
        assert "'Application'" not in joined and '"Application"' not in joined
        assert len(statements) < 12, f"{len(statements)} queries: {statements}"


class TestCardPortalUnaffected:
    async def test_card_portal_still_serves_cards(self, client, bpm_portal_env):
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Processes",
                "slug": "proc-cards",
                "card_type": "BusinessProcess",
                "is_published": True,
            },
            headers=auth_headers(bpm_portal_env["admin"]),
        )
        assert resp.status_code == 201
        cards = await client.get("/api/v1/web-portals/public/proc-cards/cards")
        assert cards.status_code == 200
        assert cards.json()["total"] >= 2
