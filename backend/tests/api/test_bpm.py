"""Integration tests for the /bpm endpoints (templates, assessments)."""

from __future__ import annotations

import uuid

import pytest

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
