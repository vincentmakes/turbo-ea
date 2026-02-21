"""Integration tests for BPM process assessment CRUD endpoints.

Covers all 4 endpoints in bpm_assessments.py: list, create, update, delete.
Tests score clamping, assessor auto-assignment, partial updates, and
permission checks.

Integration tests requiring a PostgreSQL test database.
"""

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
async def assess_env(db):
    """Set up types and users for assessment tests."""
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={"bpm.assessments": False},
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    await create_card_type(db, key="BusinessProcess", label="Business Process")
    process = await create_card(
        db,
        card_type="BusinessProcess",
        name="Order Fulfillment",
        user_id=admin.id,
    )
    return {"admin": admin, "viewer": viewer, "process": process}


def _assessment_body(**overrides):
    """Default valid assessment body."""
    body = {
        "assessment_date": "2026-01-15",
        "overall_score": 4,
        "efficiency": 3,
        "effectiveness": 4,
        "compliance": 5,
        "automation": 2,
    }
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


class TestCreateAssessment:
    async def test_create_success(self, client, assess_env):
        pid = assess_env["process"].id
        resp = await client.post(
            f"/api/v1/bpm/processes/{pid}/assessments",
            json=_assessment_body(),
            headers=auth_headers(assess_env["admin"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["overall_score"] == 4
        assert data["process_id"] == str(pid)
        assert "id" in data

    async def test_score_clamped_low(self, client, assess_env):
        """Scores below 1 are clamped to 1."""
        pid = assess_env["process"].id
        resp = await client.post(
            f"/api/v1/bpm/processes/{pid}/assessments",
            json=_assessment_body(overall_score=0, efficiency=-5),
            headers=auth_headers(assess_env["admin"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["overall_score"] == 1

    async def test_score_clamped_high(self, client, assess_env):
        """Scores above 5 are clamped to 5."""
        pid = assess_env["process"].id
        resp = await client.post(
            f"/api/v1/bpm/processes/{pid}/assessments",
            json=_assessment_body(overall_score=10, efficiency=99),
            headers=auth_headers(assess_env["admin"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["overall_score"] == 5

    async def test_assessor_auto_assigned(self, client, assess_env):
        """Assessor should be the authenticated user."""
        pid = assess_env["process"].id
        admin = assess_env["admin"]
        resp = await client.post(
            f"/api/v1/bpm/processes/{pid}/assessments",
            json=_assessment_body(),
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201

        # List and verify assessor
        list_resp = await client.get(
            f"/api/v1/bpm/processes/{pid}/assessments",
            headers=auth_headers(admin),
        )
        items = list_resp.json()
        assert items[0]["assessor_id"] == str(admin.id)
        assert items[0]["assessor_name"] == admin.display_name

    async def test_with_notes_and_action_items(self, client, assess_env):
        pid = assess_env["process"].id
        resp = await client.post(
            f"/api/v1/bpm/processes/{pid}/assessments",
            json=_assessment_body(
                notes="Needs improvement",
                action_items=[{"task": "Review controls"}],
            ),
            headers=auth_headers(assess_env["admin"]),
        )
        assert resp.status_code == 201

        # Verify via list
        list_resp = await client.get(
            f"/api/v1/bpm/processes/{pid}/assessments",
            headers=auth_headers(assess_env["admin"]),
        )
        item = list_resp.json()[0]
        assert item["notes"] == "Needs improvement"
        assert item["action_items"] == [{"task": "Review controls"}]

    async def test_null_action_items_defaults_to_empty(self, client, assess_env):
        pid = assess_env["process"].id
        resp = await client.post(
            f"/api/v1/bpm/processes/{pid}/assessments",
            json=_assessment_body(action_items=None),
            headers=auth_headers(assess_env["admin"]),
        )
        assert resp.status_code == 201

        list_resp = await client.get(
            f"/api/v1/bpm/processes/{pid}/assessments",
            headers=auth_headers(assess_env["admin"]),
        )
        assert list_resp.json()[0]["action_items"] == []

    async def test_nonexistent_process_404(self, client, assess_env):
        fake_id = uuid.uuid4()
        resp = await client.post(
            f"/api/v1/bpm/processes/{fake_id}/assessments",
            json=_assessment_body(),
            headers=auth_headers(assess_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_permission_denied(self, client, assess_env):
        pid = assess_env["process"].id
        resp = await client.post(
            f"/api/v1/bpm/processes/{pid}/assessments",
            json=_assessment_body(),
            headers=auth_headers(assess_env["viewer"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------


class TestListAssessments:
    async def test_empty_list(self, client, assess_env):
        pid = assess_env["process"].id
        resp = await client.get(
            f"/api/v1/bpm/processes/{pid}/assessments",
            headers=auth_headers(assess_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_ordered_by_date_desc(self, client, assess_env):
        """Most recent assessment should appear first."""
        pid = assess_env["process"].id
        admin = assess_env["admin"]
        for date in ["2026-01-01", "2026-06-15", "2026-03-10"]:
            await client.post(
                f"/api/v1/bpm/processes/{pid}/assessments",
                json=_assessment_body(assessment_date=date),
                headers=auth_headers(admin),
            )

        resp = await client.get(
            f"/api/v1/bpm/processes/{pid}/assessments",
            headers=auth_headers(admin),
        )
        items = resp.json()
        assert len(items) == 3
        dates = [item["assessment_date"] for item in items]
        assert dates == ["2026-06-15", "2026-03-10", "2026-01-01"]

    async def test_includes_all_fields(self, client, assess_env):
        pid = assess_env["process"].id
        admin = assess_env["admin"]
        await client.post(
            f"/api/v1/bpm/processes/{pid}/assessments",
            json=_assessment_body(notes="Test"),
            headers=auth_headers(admin),
        )

        resp = await client.get(
            f"/api/v1/bpm/processes/{pid}/assessments",
            headers=auth_headers(admin),
        )
        item = resp.json()[0]
        expected_fields = {
            "id",
            "process_id",
            "assessor_id",
            "assessor_name",
            "assessment_date",
            "overall_score",
            "efficiency",
            "effectiveness",
            "compliance",
            "automation",
            "notes",
            "action_items",
            "created_at",
        }
        assert expected_fields.issubset(set(item.keys()))

    async def test_nonexistent_process_404(self, client, assess_env):
        resp = await client.get(
            f"/api/v1/bpm/processes/{uuid.uuid4()}/assessments",
            headers=auth_headers(assess_env["admin"]),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------


class TestUpdateAssessment:
    async def _create_one(self, client, assess_env):
        pid = assess_env["process"].id
        resp = await client.post(
            f"/api/v1/bpm/processes/{pid}/assessments",
            json=_assessment_body(),
            headers=auth_headers(assess_env["admin"]),
        )
        return resp.json()["id"]

    async def test_partial_update(self, client, assess_env):
        aid = await self._create_one(client, assess_env)
        pid = assess_env["process"].id
        admin = assess_env["admin"]

        resp = await client.put(
            f"/api/v1/bpm/processes/{pid}/assessments/{aid}",
            json={"notes": "Updated notes"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "updated"

        # Verify the note changed but scores didn't
        list_resp = await client.get(
            f"/api/v1/bpm/processes/{pid}/assessments",
            headers=auth_headers(admin),
        )
        item = list_resp.json()[0]
        assert item["notes"] == "Updated notes"
        assert item["overall_score"] == 4  # unchanged

    async def test_update_score_clamped(self, client, assess_env):
        aid = await self._create_one(client, assess_env)
        pid = assess_env["process"].id
        admin = assess_env["admin"]

        resp = await client.put(
            f"/api/v1/bpm/processes/{pid}/assessments/{aid}",
            json={"overall_score": 99},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        list_resp = await client.get(
            f"/api/v1/bpm/processes/{pid}/assessments",
            headers=auth_headers(admin),
        )
        assert list_resp.json()[0]["overall_score"] == 5

    async def test_update_nonexistent_assessment_404(self, client, assess_env):
        pid = assess_env["process"].id
        resp = await client.put(
            f"/api/v1/bpm/processes/{pid}/assessments/{uuid.uuid4()}",
            json={"notes": "nope"},
            headers=auth_headers(assess_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_update_wrong_process_404(self, client, db, assess_env):
        """Assessment from one process can't be updated via another."""
        aid = await self._create_one(client, assess_env)
        admin = assess_env["admin"]
        other = await create_card(db, card_type="BusinessProcess", name="Other", user_id=admin.id)
        resp = await client.put(
            f"/api/v1/bpm/processes/{other.id}/assessments/{aid}",
            json={"notes": "cross-process"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_update_permission_denied(self, client, assess_env):
        aid = await self._create_one(client, assess_env)
        pid = assess_env["process"].id
        resp = await client.put(
            f"/api/v1/bpm/processes/{pid}/assessments/{aid}",
            json={"notes": "denied"},
            headers=auth_headers(assess_env["viewer"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


class TestDeleteAssessment:
    async def _create_one(self, client, assess_env):
        pid = assess_env["process"].id
        resp = await client.post(
            f"/api/v1/bpm/processes/{pid}/assessments",
            json=_assessment_body(),
            headers=auth_headers(assess_env["admin"]),
        )
        return resp.json()["id"]

    async def test_delete_success(self, client, assess_env):
        aid = await self._create_one(client, assess_env)
        pid = assess_env["process"].id
        admin = assess_env["admin"]

        resp = await client.delete(
            f"/api/v1/bpm/processes/{pid}/assessments/{aid}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        # Verify deletion
        list_resp = await client.get(
            f"/api/v1/bpm/processes/{pid}/assessments",
            headers=auth_headers(admin),
        )
        assert list_resp.json() == []

    async def test_delete_nonexistent_404(self, client, assess_env):
        pid = assess_env["process"].id
        resp = await client.delete(
            f"/api/v1/bpm/processes/{pid}/assessments/{uuid.uuid4()}",
            headers=auth_headers(assess_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_delete_idempotent(self, client, assess_env):
        """Deleting twice: first 204, second 404."""
        aid = await self._create_one(client, assess_env)
        pid = assess_env["process"].id
        admin = assess_env["admin"]

        resp1 = await client.delete(
            f"/api/v1/bpm/processes/{pid}/assessments/{aid}",
            headers=auth_headers(admin),
        )
        assert resp1.status_code == 204

        resp2 = await client.delete(
            f"/api/v1/bpm/processes/{pid}/assessments/{aid}",
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 404

    async def test_delete_permission_denied(self, client, assess_env):
        aid = await self._create_one(client, assess_env)
        pid = assess_env["process"].id
        resp = await client.delete(
            f"/api/v1/bpm/processes/{pid}/assessments/{aid}",
            headers=auth_headers(assess_env["viewer"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Archived process
# ---------------------------------------------------------------------------


class TestArchivedProcess:
    async def test_archived_process_returns_404(self, client, db, assess_env):
        """Assessments on archived processes should not be accessible."""
        admin = assess_env["admin"]
        archived = await create_card(
            db,
            card_type="BusinessProcess",
            name="Old",
            user_id=admin.id,
            status="ARCHIVED",
        )
        resp = await client.get(
            f"/api/v1/bpm/processes/{archived.id}/assessments",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404
