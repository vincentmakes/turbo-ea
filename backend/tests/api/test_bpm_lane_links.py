"""Integration tests for BPM lane → Organization linking and per-step
Organization overrides (hybrid lane + step model).

Covers:
- GET /bpm/processes/{id}/lanes (distinct lanes + bindings)
- PUT /bpm/processes/{id}/lane-links (bind / clear / validation / relation sync
  / override normalization)
- PUT /bpm/processes/{id}/elements/{element_id} with organization_id
  (explicit override, normalization against the lane binding)
- Lane-link pruning on PUT /bpm/processes/{id}/diagram
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.process_element import ProcessElement
from app.models.process_lane_link import ProcessLaneLink
from app.models.relation import Relation
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation_type,
    create_role,
    create_user,
)

LANED_BPMN = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             id="definitions_1">
  <process id="Process_1" isExecutable="false">
    <laneSet id="ls_1">
      <lane id="lane_sales" name="Sales">
        <flowNodeRef>task_quote</flowNodeRef>
      </lane>
      <lane id="lane_finance" name="Finance">
        <flowNodeRef>task_invoice</flowNodeRef>
      </lane>
    </laneSet>
    <task id="task_quote" name="Create Quote" />
    <task id="task_invoice" name="Send Invoice" />
  </process>
</definitions>
"""

LANELESS_BPMN = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             id="definitions_1">
  <process id="Process_1" isExecutable="false">
    <task id="task_quote" name="Create Quote" />
  </process>
</definitions>
"""


@pytest.fixture
async def lane_env(db):
    """Roles, types, users, a BusinessProcess with two laned elements."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={"bpm.view": True, "bpm.edit": False},
    )
    await create_card_type(db, key="BusinessProcess", label="Business Process")
    await create_card_type(db, key="Organization", label="Organization")
    await create_card_type(db, key="Application", label="Application")
    await create_relation_type(
        db,
        key="relProcessToOrg",
        label="is owned by",
        source_type_key="BusinessProcess",
        target_type_key="Organization",
    )

    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")

    process = await create_card(
        db, card_type="BusinessProcess", name="Order to Cash", user_id=admin.id
    )
    org_sales = await create_card(db, card_type="Organization", name="Sales", user_id=admin.id)
    org_finance = await create_card(db, card_type="Organization", name="Finance", user_id=admin.id)
    app = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)

    elem_quote = ProcessElement(
        process_id=process.id,
        bpmn_element_id="task_quote",
        element_type="task",
        name="Create Quote",
        lane_name="Sales",
        sequence_order=0,
    )
    elem_invoice = ProcessElement(
        process_id=process.id,
        bpmn_element_id="task_invoice",
        element_type="task",
        name="Send Invoice",
        lane_name="Finance",
        sequence_order=1,
    )
    db.add(elem_quote)
    db.add(elem_invoice)
    await db.flush()

    return {
        "admin": admin,
        "viewer": viewer,
        "process": process,
        "org_sales": org_sales,
        "org_finance": org_finance,
        "app": app,
        "elem_quote": elem_quote,
        "elem_invoice": elem_invoice,
    }


class TestLanesEndpoint:
    async def test_lists_distinct_lanes_unbound(self, client, lane_env):
        resp = await client.get(
            f"/api/v1/bpm/processes/{lane_env['process'].id}/lanes",
            headers=auth_headers(lane_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert [lane["lane_name"] for lane in data] == ["Finance", "Sales"]
        assert all(lane["organization_id"] is None for lane in data)

    async def test_viewer_can_read_lanes(self, client, lane_env):
        resp = await client.get(
            f"/api/v1/bpm/processes/{lane_env['process'].id}/lanes",
            headers=auth_headers(lane_env["viewer"]),
        )
        assert resp.status_code == 200


class TestLaneLinkUpdate:
    async def test_bind_lane_creates_relation(self, client, db, lane_env):
        process, org = lane_env["process"], lane_env["org_sales"]
        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/lane-links",
            json={"lane_name": "Sales", "organization_id": str(org.id)},
            headers=auth_headers(lane_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["organization_id"] == str(org.id)

        lanes = (
            await client.get(
                f"/api/v1/bpm/processes/{process.id}/lanes",
                headers=auth_headers(lane_env["admin"]),
            )
        ).json()
        sales = next(lane for lane in lanes if lane["lane_name"] == "Sales")
        assert sales["organization_id"] == str(org.id)
        assert sales["organization_name"] == "Sales"

        rel = await db.execute(
            select(Relation).where(
                Relation.type == "relProcessToOrg",
                Relation.source_id == process.id,
                Relation.target_id == org.id,
            )
        )
        assert rel.scalar_one_or_none() is not None

    async def test_unknown_lane_404(self, client, lane_env):
        resp = await client.put(
            f"/api/v1/bpm/processes/{lane_env['process'].id}/lane-links",
            json={
                "lane_name": "Nonexistent",
                "organization_id": str(lane_env["org_sales"].id),
            },
            headers=auth_headers(lane_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_non_organization_card_404(self, client, lane_env):
        resp = await client.put(
            f"/api/v1/bpm/processes/{lane_env['process'].id}/lane-links",
            json={"lane_name": "Sales", "organization_id": str(lane_env["app"].id)},
            headers=auth_headers(lane_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_clear_binding(self, client, db, lane_env):
        process, org = lane_env["process"], lane_env["org_sales"]
        headers = auth_headers(lane_env["admin"])
        await client.put(
            f"/api/v1/bpm/processes/{process.id}/lane-links",
            json={"lane_name": "Sales", "organization_id": str(org.id)},
            headers=headers,
        )
        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/lane-links",
            json={"lane_name": "Sales", "organization_id": None},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["organization_id"] is None

        links = await db.execute(
            select(ProcessLaneLink).where(ProcessLaneLink.process_id == process.id)
        )
        assert links.scalars().all() == []

        # Relation is additive-only: clearing the binding keeps it.
        rel = await db.execute(
            select(Relation).where(
                Relation.type == "relProcessToOrg",
                Relation.source_id == process.id,
            )
        )
        assert rel.scalar_one_or_none() is not None

    async def test_binding_normalizes_redundant_step_overrides(self, client, db, lane_env):
        """A step explicitly carrying the newly bound org reverts to inherited."""
        process, org = lane_env["process"], lane_env["org_sales"]
        elem = lane_env["elem_quote"]
        elem.organization_id = org.id
        await db.flush()

        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/lane-links",
            json={"lane_name": "Sales", "organization_id": str(org.id)},
            headers=auth_headers(lane_env["admin"]),
        )
        assert resp.status_code == 200

        await db.refresh(elem)
        assert elem.organization_id is None

    async def test_viewer_cannot_bind(self, client, lane_env):
        resp = await client.put(
            f"/api/v1/bpm/processes/{lane_env['process'].id}/lane-links",
            json={
                "lane_name": "Sales",
                "organization_id": str(lane_env["org_sales"].id),
            },
            headers=auth_headers(lane_env["viewer"]),
        )
        assert resp.status_code == 403


class TestElementOrganizationOverride:
    async def test_explicit_org_link(self, client, db, lane_env):
        process, org, elem = lane_env["process"], lane_env["org_finance"], lane_env["elem_quote"]
        process_id, org_id, elem_id = process.id, org.id, elem.id
        headers = auth_headers(lane_env["admin"])
        resp = await client.put(
            f"/api/v1/bpm/processes/{process_id}/elements/{elem_id}",
            json={"organization_id": str(org_id)},
            headers=headers,
        )
        assert resp.status_code == 200

        # Expire the shared test session so the GET's selectinload repopulates
        # the (noload) organization relationship on the identity-mapped row.
        db.expire_all()
        elems = (
            await client.get(
                f"/api/v1/bpm/processes/{process_id}/elements",
                headers=headers,
            )
        ).json()
        quote = next(e for e in elems if e["bpmn_element_id"] == "task_quote")
        assert quote["organization_id"] == str(org_id)
        assert quote["organization_name"] == "Finance"

        rel = await db.execute(
            select(Relation).where(
                Relation.type == "relProcessToOrg",
                Relation.source_id == process_id,
                Relation.target_id == org_id,
            )
        )
        assert rel.scalar_one_or_none() is not None

    async def test_org_equal_to_lane_binding_normalized_to_inherited(self, client, db, lane_env):
        process, org, elem = lane_env["process"], lane_env["org_sales"], lane_env["elem_quote"]
        headers = auth_headers(lane_env["admin"])
        await client.put(
            f"/api/v1/bpm/processes/{process.id}/lane-links",
            json={"lane_name": "Sales", "organization_id": str(org.id)},
            headers=headers,
        )
        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/elements/{elem.id}",
            json={"organization_id": str(org.id)},
            headers=headers,
        )
        assert resp.status_code == 200

        await db.refresh(elem)
        assert elem.organization_id is None  # stored as inherited, not duplicated

        # The relation still exists even though the override was normalized.
        rel = await db.execute(
            select(Relation).where(
                Relation.type == "relProcessToOrg",
                Relation.source_id == process.id,
                Relation.target_id == org.id,
            )
        )
        assert rel.scalar_one_or_none() is not None

    async def test_clear_explicit_org(self, client, db, lane_env):
        process, org, elem = lane_env["process"], lane_env["org_finance"], lane_env["elem_quote"]
        headers = auth_headers(lane_env["admin"])
        await client.put(
            f"/api/v1/bpm/processes/{process.id}/elements/{elem.id}",
            json={"organization_id": str(org.id)},
            headers=headers,
        )
        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/elements/{elem.id}",
            json={"organization_id": ""},
            headers=headers,
        )
        assert resp.status_code == 200
        await db.refresh(elem)
        assert elem.organization_id is None


class TestLaneLinkPruningOnDiagramSave:
    async def test_stale_lane_links_pruned(self, client, db, lane_env):
        process, org = lane_env["process"], lane_env["org_sales"]
        headers = auth_headers(lane_env["admin"])

        # Establish the laned diagram, then bind the Sales lane.
        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/diagram",
            json={"bpmn_xml": LANED_BPMN},
            headers=headers,
        )
        assert resp.status_code == 200
        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/lane-links",
            json={"lane_name": "Sales", "organization_id": str(org.id)},
            headers=headers,
        )
        assert resp.status_code == 200

        # Re-save without any lanes: the binding's lane vanished → pruned.
        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/diagram",
            json={"bpmn_xml": LANELESS_BPMN},
            headers=headers,
        )
        assert resp.status_code == 200

        links = await db.execute(
            select(ProcessLaneLink).where(ProcessLaneLink.process_id == process.id)
        )
        assert links.scalars().all() == []
