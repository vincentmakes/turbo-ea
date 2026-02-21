"""Integration tests for the /surveys endpoints."""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import (
    auth_headers,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def surveys_env(db):
    """Prerequisite data for survey tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={"inventory.view": True},
    )
    await create_card_type(db, key="Application", label="Application")
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "viewer": viewer}


class TestCreateSurvey:
    async def test_admin_can_create_survey(self, client, db, surveys_env):
        admin = surveys_env["admin"]
        resp = await client.post(
            "/api/v1/surveys",
            json={
                "name": "Annual Review",
                "description": "Check app data",
                "target_type_key": "Application",
                "fields": [
                    {
                        "key": "costTotalAnnual",
                        "label": "Annual Cost",
                        "type": "cost",
                        "action": "maintain",
                    }
                ],
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Annual Review"
        assert data["status"] == "draft"
        assert data["target_type_key"] == "Application"
        assert len(data["fields"]) == 1

    async def test_create_survey_invalid_type(self, client, db, surveys_env):
        admin = surveys_env["admin"]
        resp = await client.post(
            "/api/v1/surveys",
            json={
                "name": "Bad Survey",
                "target_type_key": "NonExistent",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_viewer_cannot_create_survey(self, client, db, surveys_env):
        viewer = surveys_env["viewer"]
        resp = await client.post(
            "/api/v1/surveys",
            json={
                "name": "Blocked",
                "target_type_key": "Application",
            },
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


class TestListAndGetSurvey:
    async def test_list_surveys(self, client, db, surveys_env):
        admin = surveys_env["admin"]
        # Create two surveys
        for name in ("Survey A", "Survey B"):
            await client.post(
                "/api/v1/surveys",
                json={
                    "name": name,
                    "target_type_key": "Application",
                },
                headers=auth_headers(admin),
            )

        resp = await client.get(
            "/api/v1/surveys",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 2
        names = [s["name"] for s in data]
        assert "Survey A" in names
        assert "Survey B" in names

    async def test_get_survey_by_id(self, client, db, surveys_env):
        admin = surveys_env["admin"]
        create_resp = await client.post(
            "/api/v1/surveys",
            json={
                "name": "Fetch Me",
                "target_type_key": "Application",
            },
            headers=auth_headers(admin),
        )
        survey_id = create_resp.json()["id"]

        resp = await client.get(
            f"/api/v1/surveys/{survey_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Fetch Me"

    async def test_get_nonexistent_survey(self, client, db, surveys_env):
        admin = surveys_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.get(
            f"/api/v1/surveys/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


class TestUpdateSurvey:
    async def test_update_draft_survey(self, client, db, surveys_env):
        admin = surveys_env["admin"]
        create_resp = await client.post(
            "/api/v1/surveys",
            json={
                "name": "Original Name",
                "target_type_key": "Application",
            },
            headers=auth_headers(admin),
        )
        survey_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/surveys/{survey_id}",
            json={"name": "Updated Name"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated Name"


class TestDeleteSurvey:
    async def test_delete_draft_survey(self, client, db, surveys_env):
        admin = surveys_env["admin"]
        create_resp = await client.post(
            "/api/v1/surveys",
            json={
                "name": "Delete Me",
                "target_type_key": "Application",
            },
            headers=auth_headers(admin),
        )
        survey_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/surveys/{survey_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        # Verify it is gone
        resp = await client.get(
            f"/api/v1/surveys/{survey_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_delete_nonexistent_survey(self, client, db, surveys_env):
        admin = surveys_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.delete(
            f"/api/v1/surveys/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404
