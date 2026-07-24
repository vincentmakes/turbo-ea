"""Integration tests for the M:N step ↔ Organization links on process flows.

Covers:
- PUT /bpm/processes/{id}/elements/{element_id} with organization_ids
  (set, extend, clear, validation)
- GET /bpm/processes/{id}/elements serialization of `organizations`
- Draft pre-linking (draft-elements PUT/GET) and publish applying the links
- Step ↔ Organization links are informative only: no relProcessToOrg
  card-to-card relation is ever created from them
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.process_element import ProcessElement, ProcessElementOrganization
from app.models.relation import Relation
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation_type,
    create_role,
    create_user,
)

SIMPLE_BPMN = """\
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             id="definitions_1">
  <process id="Process_1" isExecutable="false">
    <task id="task_quote" name="Create Quote" />
    <task id="task_invoice" name="Send Invoice" />
  </process>
</definitions>
"""


@pytest.fixture
async def org_env(db):
    """Roles, types, users, a BusinessProcess with two extracted elements."""
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

    elem = ProcessElement(
        process_id=process.id,
        bpmn_element_id="task_quote",
        element_type="task",
        name="Create Quote",
        lane_name="Sales",
        sequence_order=0,
    )
    db.add(elem)
    await db.flush()

    return {
        "admin": admin,
        "viewer": viewer,
        "process": process,
        "org_sales": org_sales,
        "org_finance": org_finance,
        "app": app,
        "elem": elem,
    }


async def _junction_org_ids(db, element_id):
    rows = await db.execute(
        select(ProcessElementOrganization.organization_id).where(
            ProcessElementOrganization.element_id == element_id
        )
    )
    return {row[0] for row in rows.all()}


class TestElementOrganizationLinks:
    async def test_link_multiple_orgs_to_one_step(self, client, db, org_env):
        process, elem = org_env["process"], org_env["elem"]
        sales, finance = org_env["org_sales"], org_env["org_finance"]
        process_id, elem_id = process.id, elem.id
        sales_id, finance_id = sales.id, finance.id
        headers = auth_headers(org_env["admin"])

        resp = await client.put(
            f"/api/v1/bpm/processes/{process_id}/elements/{elem_id}",
            json={"organization_ids": [str(sales_id), str(finance_id)]},
            headers=headers,
        )
        assert resp.status_code == 200
        assert await _junction_org_ids(db, elem_id) == {sales_id, finance_id}

        # Expire the shared test session so the GET's selectinload repopulates
        # the (noload) organizations relationship on the identity-mapped row.
        db.expire_all()
        elems = (
            await client.get(f"/api/v1/bpm/processes/{process_id}/elements", headers=headers)
        ).json()
        quote = next(e for e in elems if e["bpmn_element_id"] == "task_quote")
        assert {o["name"] for o in quote["organizations"]} == {"Sales", "Finance"}

        # Informative only: linking a step never creates a card-to-card
        # relation (process <-> Organization relations live on the card).
        rels = await db.execute(
            select(Relation).where(
                Relation.type == "relProcessToOrg",
                Relation.source_id == process_id,
            )
        )
        assert rels.scalars().all() == []

    async def test_replace_and_clear_org_links(self, client, db, org_env):
        process, elem = org_env["process"], org_env["elem"]
        sales, finance = org_env["org_sales"], org_env["org_finance"]
        headers = auth_headers(org_env["admin"])

        await client.put(
            f"/api/v1/bpm/processes/{process.id}/elements/{elem.id}",
            json={"organization_ids": [str(sales.id), str(finance.id)]},
            headers=headers,
        )
        # Remove one (chip delete sends the remaining list).
        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/elements/{elem.id}",
            json={"organization_ids": [str(finance.id)]},
            headers=headers,
        )
        assert resp.status_code == 200
        assert await _junction_org_ids(db, elem.id) == {finance.id}

        # Clear all.
        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/elements/{elem.id}",
            json={"organization_ids": []},
            headers=headers,
        )
        assert resp.status_code == 200
        assert await _junction_org_ids(db, elem.id) == set()

    async def test_non_organization_card_404(self, client, db, org_env):
        resp = await client.put(
            f"/api/v1/bpm/processes/{org_env['process'].id}/elements/{org_env['elem'].id}",
            json={"organization_ids": [str(org_env["app"].id)]},
            headers=auth_headers(org_env["admin"]),
        )
        assert resp.status_code == 404
        assert await _junction_org_ids(db, org_env["elem"].id) == set()

    async def test_viewer_cannot_edit(self, client, org_env):
        resp = await client.put(
            f"/api/v1/bpm/processes/{org_env['process'].id}/elements/{org_env['elem'].id}",
            json={"organization_ids": [str(org_env["org_sales"].id)]},
            headers=auth_headers(org_env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_omitting_field_keeps_links(self, client, db, org_env):
        """A PUT that doesn't mention organization_ids leaves the links alone."""
        process, elem, sales = org_env["process"], org_env["elem"], org_env["org_sales"]
        headers = auth_headers(org_env["admin"])
        await client.put(
            f"/api/v1/bpm/processes/{process.id}/elements/{elem.id}",
            json={"organization_ids": [str(sales.id)]},
            headers=headers,
        )
        resp = await client.put(
            f"/api/v1/bpm/processes/{process.id}/elements/{elem.id}",
            json={"custom_fields": {"tcode": "SE16"}},
            headers=headers,
        )
        assert resp.status_code == 200
        assert await _junction_org_ids(db, elem.id) == {sales.id}


class TestDraftOrganizationPreLinking:
    async def test_draft_prelink_and_publish(self, client, db, org_env):
        """Pre-link organizations on a draft, publish, and the junction rows +
        relations land on the extracted elements."""
        process = org_env["process"]
        sales, finance = org_env["org_sales"], org_env["org_finance"]
        process_id = process.id
        sales_id, finance_id = sales.id, finance.id
        headers = auth_headers(org_env["admin"])

        draft = (
            await client.post(
                f"/api/v1/bpm/processes/{process_id}/flow/drafts",
                json={"bpmn_xml": SIMPLE_BPMN},
                headers=headers,
            )
        ).json()
        draft_id = draft["id"]

        resp = await client.put(
            f"/api/v1/bpm/processes/{process_id}/flow/versions/{draft_id}"
            "/draft-elements/task_quote",
            json={"organization_ids": [str(sales_id), str(finance_id)]},
            headers=headers,
        )
        assert resp.status_code == 200

        # The draft merge view resolves the linked org names.
        draft_elems = (
            await client.get(
                f"/api/v1/bpm/processes/{process_id}/flow/versions/{draft_id}/draft-elements",
                headers=headers,
            )
        ).json()
        quote = next(e for e in draft_elems if e["bpmn_element_id"] == "task_quote")
        assert {o["name"] for o in quote["organizations"]} == {"Sales", "Finance"}

        # Submit + approve → published; links applied to the elements table.
        resp = await client.post(
            f"/api/v1/bpm/processes/{process_id}/flow/versions/{draft_id}/submit",
            headers=headers,
        )
        assert resp.status_code == 200
        resp = await client.post(
            f"/api/v1/bpm/processes/{process_id}/flow/versions/{draft_id}/approve",
            headers=headers,
        )
        assert resp.status_code == 200

        db.expire_all()
        elems = (
            await client.get(f"/api/v1/bpm/processes/{process_id}/elements", headers=headers)
        ).json()
        quote = next(e for e in elems if e["bpmn_element_id"] == "task_quote")
        assert {o["name"] for o in quote["organizations"]} == {"Sales", "Finance"}

        # Publishing applies the informative step links but never creates
        # card-to-card relations for organizations.
        rels = await db.execute(
            select(Relation).where(
                Relation.type == "relProcessToOrg",
                Relation.source_id == process_id,
            )
        )
        assert rels.scalars().all() == []
