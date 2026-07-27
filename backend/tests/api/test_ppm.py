"""Integration tests for the PPM module (status reports, costs, budgets,
risks, tasks, task comments, WBS, and completion).

Tests cover CRUD operations, permission checks, business logic (risk_score
auto-calculation, cost sync, cycle detection, completion averaging), and
edge cases (404s, empty states).
"""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)

BASE = "/api/v1/ppm"


@pytest.fixture
async def ppm_env(db):
    """Prerequisite data for PPM tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions={**VIEWER_PERMISSIONS})
    await create_card_type(db, key="Initiative", label="Initiative")
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    card = await create_card(db, card_type="Initiative", name="Test Project", user_id=admin.id)
    return {"admin": admin, "viewer": viewer, "initiative": card}


# ── Status Reports ────────────────────────────────────────────────


class TestStatusReports:
    async def test_list_empty(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/reports",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_create_report(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        payload = {
            "report_date": "2026-03-01",
            "schedule_health": "onTrack",
            "cost_health": "atRisk",
            "scope_health": "offTrack",
            "summary": "Week 1 summary",
            "accomplishments": "Kicked off",
            "next_steps": "Start sprint 2",
        }
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/reports",
            json=payload,
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["initiative_id"] == init_id
        assert data["report_date"] == "2026-03-01"
        assert data["schedule_health"] == "onTrack"
        assert data["cost_health"] == "atRisk"
        assert data["scope_health"] == "offTrack"
        assert data["summary"] == "Week 1 summary"
        assert data["reporter"]["display_name"] == "Test User"

    async def test_update_report(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        create_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/reports",
            json={"report_date": "2026-03-01"},
            headers=auth_headers(ppm_env["admin"]),
        )
        report_id = create_resp.json()["id"]

        resp = await client.patch(
            f"{BASE}/reports/{report_id}",
            json={"summary": "Updated summary", "schedule_health": "atRisk"},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["summary"] == "Updated summary"
        assert resp.json()["schedule_health"] == "atRisk"

    async def test_delete_report(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        create_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/reports",
            json={"report_date": "2026-03-01"},
            headers=auth_headers(ppm_env["admin"]),
        )
        report_id = create_resp.json()["id"]

        resp = await client.delete(
            f"{BASE}/reports/{report_id}",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 204

        # Verify deleted
        list_resp = await client.get(
            f"{BASE}/initiatives/{init_id}/reports",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert len(list_resp.json()) == 0

    async def test_viewer_can_list_reports(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/reports",
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 200

    async def test_viewer_cannot_create_report(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/reports",
            json={"report_date": "2026-03-01"},
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_404_for_bad_initiative(self, client, ppm_env):
        bad_id = str(uuid.uuid4())
        resp = await client.get(
            f"{BASE}/initiatives/{bad_id}/reports",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_update_nonexistent_report(self, client, ppm_env):
        resp = await client.patch(
            f"{BASE}/reports/{uuid.uuid4()}",
            json={"summary": "nope"},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_delete_nonexistent_report(self, client, ppm_env):
        resp = await client.delete(
            f"{BASE}/reports/{uuid.uuid4()}",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 404


# ── Cost Lines ────────────────────────────────────────────────────


class TestCostLines:
    async def test_list_empty(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/costs",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_create_cost_line(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        payload = {
            "description": "Contractor fees",
            "category": "opex",
            "planned": 10000,
            "actual": 8000,
            "date": "2026-03-15",
        }
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/costs",
            json=payload,
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["description"] == "Contractor fees"
        assert data["category"] == "opex"
        assert data["planned"] == 10000
        assert data["actual"] == 8000
        assert data["date"] == "2026-03-15"

    async def test_update_cost_line(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        create_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/costs",
            json={"description": "HW", "category": "capex", "actual": 500},
            headers=auth_headers(ppm_env["admin"]),
        )
        cost_id = create_resp.json()["id"]

        resp = await client.patch(
            f"{BASE}/costs/{cost_id}",
            json={"actual": 750},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["actual"] == 750

    async def test_delete_cost_line(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        create_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/costs",
            json={"description": "Temp", "category": "opex"},
            headers=auth_headers(ppm_env["admin"]),
        )
        cost_id = create_resp.json()["id"]

        resp = await client.delete(
            f"{BASE}/costs/{cost_id}",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 204

    async def test_cost_sync_updates_initiative(self, client, ppm_env):
        """Creating cost lines should update the initiative card attributes."""
        init_id = str(ppm_env["initiative"].id)
        await client.post(
            f"{BASE}/initiatives/{init_id}/costs",
            json={
                "description": "Line A",
                "category": "capex",
                "actual": 1000,
            },
            headers=auth_headers(ppm_env["admin"]),
        )
        await client.post(
            f"{BASE}/initiatives/{init_id}/costs",
            json={
                "description": "Line B",
                "category": "opex",
                "actual": 2000,
            },
            headers=auth_headers(ppm_env["admin"]),
        )

        # Fetch the card to check synced attributes
        card_resp = await client.get(
            f"/api/v1/cards/{init_id}",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert card_resp.status_code == 200
        attrs = card_resp.json()["attributes"]
        assert attrs.get("costActual") == 3000

    async def test_404_for_nonexistent_cost(self, client, ppm_env):
        resp = await client.patch(
            f"{BASE}/costs/{uuid.uuid4()}",
            json={"actual": 1},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 404


# ── Budget Lines ──────────────────────────────────────────────────


class TestBudgetLines:
    async def test_list_empty(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/budgets",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_create_budget_line(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        payload = {
            "fiscal_year": 2026,
            "category": "capex",
            "amount": 50000,
        }
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/budgets",
            json=payload,
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["fiscal_year"] == 2026
        assert data["category"] == "capex"
        assert data["amount"] == 50000

    async def test_update_budget_line(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        create_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/budgets",
            json={"fiscal_year": 2026, "category": "opex", "amount": 10000},
            headers=auth_headers(ppm_env["admin"]),
        )
        budget_id = create_resp.json()["id"]

        resp = await client.patch(
            f"{BASE}/budgets/{budget_id}",
            json={"amount": 15000},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["amount"] == 15000

    async def test_delete_budget_line(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        create_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/budgets",
            json={"fiscal_year": 2026, "category": "capex", "amount": 5000},
            headers=auth_headers(ppm_env["admin"]),
        )
        budget_id = create_resp.json()["id"]

        resp = await client.delete(
            f"{BASE}/budgets/{budget_id}",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 204

    async def test_budget_sync_updates_initiative(self, client, ppm_env):
        """Creating budget lines should update the initiative costBudget."""
        init_id = str(ppm_env["initiative"].id)
        await client.post(
            f"{BASE}/initiatives/{init_id}/budgets",
            json={"fiscal_year": 2026, "category": "capex", "amount": 20000},
            headers=auth_headers(ppm_env["admin"]),
        )
        await client.post(
            f"{BASE}/initiatives/{init_id}/budgets",
            json={"fiscal_year": 2026, "category": "opex", "amount": 5000},
            headers=auth_headers(ppm_env["admin"]),
        )

        card_resp = await client.get(
            f"/api/v1/cards/{init_id}",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert card_resp.status_code == 200
        attrs = card_resp.json()["attributes"]
        assert attrs.get("costBudget") == 25000

    async def test_404_for_nonexistent_budget(self, client, ppm_env):
        resp = await client.delete(
            f"{BASE}/budgets/{uuid.uuid4()}",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 404


# ── Has Costs ─────────────────────────────────────────────────────


class TestHasCosts:
    async def test_returns_false_when_empty(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/has-costs",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_budget_lines"] is False
        assert data["has_cost_lines"] is False

    async def test_returns_true_after_cost_line(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        await client.post(
            f"{BASE}/initiatives/{init_id}/costs",
            json={"description": "Licence", "category": "opex", "actual": 100},
            headers=auth_headers(ppm_env["admin"]),
        )
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/has-costs",
            headers=auth_headers(ppm_env["admin"]),
        )
        data = resp.json()
        assert data["has_cost_lines"] is True
        assert data["has_budget_lines"] is False

    async def test_returns_true_after_budget_line(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        await client.post(
            f"{BASE}/initiatives/{init_id}/budgets",
            json={"fiscal_year": 2026, "category": "capex", "amount": 1000},
            headers=auth_headers(ppm_env["admin"]),
        )
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/has-costs",
            headers=auth_headers(ppm_env["admin"]),
        )
        data = resp.json()
        assert data["has_budget_lines"] is True
        assert data["has_cost_lines"] is False

    async def test_404_for_bad_initiative(self, client, ppm_env):
        resp = await client.get(
            f"{BASE}/initiatives/{uuid.uuid4()}/has-costs",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 404


# ── Risks ─────────────────────────────────────────────────────────


class TestRisks:
    async def test_list_empty(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/risks",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_create_risk(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        payload = {
            "title": "Key person dependency",
            "description": "Single point of failure",
            "probability": 4,
            "impact": 5,
            "mitigation": "Cross-train team members",
            "status": "open",
        }
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/risks",
            json=payload,
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Key person dependency"
        assert data["probability"] == 4
        assert data["impact"] == 5
        assert data["risk_score"] == 20  # 4 * 5
        assert data["status"] == "open"

    async def test_risk_score_auto_calculation(self, client, ppm_env):
        """risk_score should be probability * impact on create."""
        init_id = str(ppm_env["initiative"].id)
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/risks",
            json={"title": "Budget risk", "probability": 2, "impact": 3},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.json()["risk_score"] == 6

    async def test_risk_score_recalculated_on_update(self, client, ppm_env):
        """Updating probability or impact should recompute risk_score."""
        init_id = str(ppm_env["initiative"].id)
        create_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/risks",
            json={"title": "Scope creep", "probability": 3, "impact": 3},
            headers=auth_headers(ppm_env["admin"]),
        )
        risk_id = create_resp.json()["id"]
        assert create_resp.json()["risk_score"] == 9

        resp = await client.patch(
            f"{BASE}/risks/{risk_id}",
            json={"probability": 5},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["risk_score"] == 15  # 5 * 3

    async def test_update_risk(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        create_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/risks",
            json={"title": "Risk A"},
            headers=auth_headers(ppm_env["admin"]),
        )
        risk_id = create_resp.json()["id"]

        resp = await client.patch(
            f"{BASE}/risks/{risk_id}",
            json={"status": "mitigated", "mitigation": "Resolved"},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "mitigated"

    async def test_delete_risk(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        create_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/risks",
            json={"title": "Temporary risk"},
            headers=auth_headers(ppm_env["admin"]),
        )
        risk_id = create_resp.json()["id"]

        resp = await client.delete(
            f"{BASE}/risks/{risk_id}",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 204

    async def test_risk_with_owner(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        owner_id = str(ppm_env["admin"].id)
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/risks",
            json={"title": "Owned risk", "owner_id": owner_id},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["owner_id"] == owner_id
        assert data["owner_name"] == "Test User"

    async def test_404_for_nonexistent_risk(self, client, ppm_env):
        resp = await client.patch(
            f"{BASE}/risks/{uuid.uuid4()}",
            json={"title": "nope"},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 404


# ── Tasks ─────────────────────────────────────────────────────────


class TestTasks:
    async def test_list_empty(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/tasks",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_create_task(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        payload = {
            "title": "Design review",
            "description": "Review architecture docs",
            "status": "todo",
            "priority": "high",
            "due_date": "2026-04-01",
            "tags": ["architecture"],
        }
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/tasks",
            json=payload,
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Design review"
        assert data["status"] == "todo"
        assert data["priority"] == "high"
        assert data["due_date"] == "2026-04-01"
        assert data["tags"] == ["architecture"]
        assert data["comment_count"] == 0

    async def test_update_task_status(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        create_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/tasks",
            json={"title": "Implement feature"},
            headers=auth_headers(ppm_env["admin"]),
        )
        task_id = create_resp.json()["id"]

        resp = await client.patch(
            f"{BASE}/tasks/{task_id}",
            json={"status": "in_progress"},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "in_progress"

    async def test_delete_task(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        create_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/tasks",
            json={"title": "Temp task"},
            headers=auth_headers(ppm_env["admin"]),
        )
        task_id = create_resp.json()["id"]

        resp = await client.delete(
            f"{BASE}/tasks/{task_id}",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 204

    async def test_task_with_assignee(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        assignee_id = str(ppm_env["admin"].id)
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/tasks",
            json={"title": "Assigned task", "assignee_id": assignee_id},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["assignee_id"] == assignee_id
        assert data["assignee_name"] == "Test User"

    async def test_404_for_nonexistent_task(self, client, ppm_env):
        resp = await client.patch(
            f"{BASE}/tasks/{uuid.uuid4()}",
            json={"title": "nope"},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 404


# ── Task Comments ─────────────────────────────────────────────────


class TestTaskComments:
    async def _create_task(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/tasks",
            json={"title": "Comment test task"},
            headers=auth_headers(ppm_env["admin"]),
        )
        return resp.json()["id"]

    async def test_list_empty(self, client, ppm_env):
        task_id = await self._create_task(client, ppm_env)
        resp = await client.get(
            f"{BASE}/tasks/{task_id}/comments",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_create_comment(self, client, ppm_env):
        task_id = await self._create_task(client, ppm_env)
        resp = await client.post(
            f"{BASE}/tasks/{task_id}/comments",
            json={"content": "Looks good!"},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["content"] == "Looks good!"
        assert data["user_id"] == str(ppm_env["admin"].id)
        assert data["user_display_name"] == "Test User"

    async def test_update_own_comment(self, client, db, ppm_env):
        """A member who authored a comment can update it."""
        await create_role(
            db,
            key="member",
            label="Member",
            permissions={"ppm.view": True, "ppm.manage": True},
        )
        member = await create_user(db, email="member@test.com", role="member")
        task_id = await self._create_task(client, ppm_env)

        create_resp = await client.post(
            f"{BASE}/tasks/{task_id}/comments",
            json={"content": "Original"},
            headers=auth_headers(member),
        )
        comment_id = create_resp.json()["id"]

        resp = await client.patch(
            f"{BASE}/task-comments/{comment_id}",
            json={"content": "Edited"},
            headers=auth_headers(member),
        )
        assert resp.status_code == 200
        assert resp.json()["content"] == "Edited"

    async def test_admin_can_edit_others_comment(self, client, db, ppm_env):
        """Admin (ppm.manage) can edit any comment."""
        await create_role(
            db,
            key="member",
            label="Member",
            permissions={"ppm.view": True, "ppm.manage": True},
        )
        member = await create_user(db, email="member@test.com", role="member")
        task_id = await self._create_task(client, ppm_env)

        create_resp = await client.post(
            f"{BASE}/tasks/{task_id}/comments",
            json={"content": "Member comment"},
            headers=auth_headers(member),
        )
        comment_id = create_resp.json()["id"]

        # Admin edits member's comment
        resp = await client.patch(
            f"{BASE}/task-comments/{comment_id}",
            json={"content": "Admin-edited"},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["content"] == "Admin-edited"

    async def test_viewer_cannot_edit_others_comment(self, client, ppm_env):
        """Viewer (no ppm.manage) cannot edit another user's comment."""
        task_id = await self._create_task(client, ppm_env)

        create_resp = await client.post(
            f"{BASE}/tasks/{task_id}/comments",
            json={"content": "Admin comment"},
            headers=auth_headers(ppm_env["admin"]),
        )
        comment_id = create_resp.json()["id"]

        resp = await client.patch(
            f"{BASE}/task-comments/{comment_id}",
            json={"content": "Hacked"},
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_delete_own_comment(self, client, ppm_env):
        task_id = await self._create_task(client, ppm_env)
        create_resp = await client.post(
            f"{BASE}/tasks/{task_id}/comments",
            json={"content": "Delete me"},
            headers=auth_headers(ppm_env["admin"]),
        )
        comment_id = create_resp.json()["id"]

        resp = await client.delete(
            f"{BASE}/task-comments/{comment_id}",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 204

    async def test_viewer_cannot_delete_others_comment(self, client, ppm_env):
        task_id = await self._create_task(client, ppm_env)
        create_resp = await client.post(
            f"{BASE}/tasks/{task_id}/comments",
            json={"content": "Protected"},
            headers=auth_headers(ppm_env["admin"]),
        )
        comment_id = create_resp.json()["id"]

        resp = await client.delete(
            f"{BASE}/task-comments/{comment_id}",
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_comment_on_nonexistent_task(self, client, ppm_env):
        resp = await client.post(
            f"{BASE}/tasks/{uuid.uuid4()}/comments",
            json={"content": "orphan"},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_404_for_nonexistent_comment(self, client, ppm_env):
        resp = await client.patch(
            f"{BASE}/task-comments/{uuid.uuid4()}",
            json={"content": "nope"},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_task_comment_count(self, client, ppm_env):
        """The task's comment_count should reflect the number of comments."""
        init_id = str(ppm_env["initiative"].id)
        task_id = await self._create_task(client, ppm_env)

        for i in range(3):
            await client.post(
                f"{BASE}/tasks/{task_id}/comments",
                json={"content": f"Comment {i}"},
                headers=auth_headers(ppm_env["admin"]),
            )

        # Get the task list and check comment_count
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/tasks",
            headers=auth_headers(ppm_env["admin"]),
        )
        tasks = resp.json()
        task = next(t for t in tasks if t["id"] == task_id)
        assert task["comment_count"] == 3


# ── WBS (Work Breakdown Structure) ────────────────────────────────


class TestWbs:
    async def test_list_empty(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/wbs",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_create_wbs(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        payload = {
            "title": "Phase 1 - Discovery",
            "description": "Initial research",
            "start_date": "2026-03-01",
            "end_date": "2026-04-30",
            "sort_order": 1,
            "is_milestone": False,
            "completion": 25.0,
        }
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json=payload,
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Phase 1 - Discovery"
        assert data["completion"] == 25.0
        assert data["parent_id"] is None
        assert data["task_count"] == 0
        assert data["progress"] == 0

    async def test_create_child_wbs(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        parent_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json={"title": "Phase 1"},
            headers=auth_headers(ppm_env["admin"]),
        )
        parent_id = parent_resp.json()["id"]

        child_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json={"title": "Phase 1.1", "parent_id": parent_id},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert child_resp.status_code == 200
        assert child_resp.json()["parent_id"] == parent_id

    async def test_update_wbs(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        create_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json={"title": "Phase 1"},
            headers=auth_headers(ppm_env["admin"]),
        )
        wbs_id = create_resp.json()["id"]

        resp = await client.patch(
            f"{BASE}/wbs/{wbs_id}",
            json={"title": "Phase 1 (Updated)", "completion": 50.0},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Phase 1 (Updated)"
        assert resp.json()["completion"] == 50.0

    async def test_delete_wbs(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        create_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json={"title": "Temp"},
            headers=auth_headers(ppm_env["admin"]),
        )
        wbs_id = create_resp.json()["id"]

        resp = await client.delete(
            f"{BASE}/wbs/{wbs_id}",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 204

    async def test_cycle_detection_self_parent(self, client, ppm_env):
        """A WBS item cannot be its own parent."""
        init_id = str(ppm_env["initiative"].id)
        create_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json={"title": "Cycle test"},
            headers=auth_headers(ppm_env["admin"]),
        )
        wbs_id = create_resp.json()["id"]

        resp = await client.patch(
            f"{BASE}/wbs/{wbs_id}",
            json={"parent_id": wbs_id},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 400
        assert "own parent" in resp.json()["detail"].lower()

    async def test_cycle_detection_indirect(self, client, ppm_env):
        """Detect an indirect cycle (A -> B -> C, then C -> A)."""
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])

        a_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json={"title": "A"},
            headers=hdrs,
        )
        a_id = a_resp.json()["id"]

        b_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json={"title": "B", "parent_id": a_id},
            headers=hdrs,
        )
        b_id = b_resp.json()["id"]

        c_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json={"title": "C", "parent_id": b_id},
            headers=hdrs,
        )
        c_id = c_resp.json()["id"]

        # Try to set A's parent to C — creates a cycle
        resp = await client.patch(
            f"{BASE}/wbs/{a_id}",
            json={"parent_id": c_id},
            headers=hdrs,
        )
        assert resp.status_code == 400
        assert "circular" in resp.json()["detail"].lower()

    async def test_parent_must_be_in_same_initiative(self, client, db, ppm_env):
        """Parent WBS must belong to the same initiative."""
        admin = ppm_env["admin"]
        other_card = await create_card(
            db,
            card_type="Initiative",
            name="Other Project",
            user_id=admin.id,
        )
        init_id = str(ppm_env["initiative"].id)
        other_id = str(other_card.id)
        hdrs = auth_headers(admin)

        # Create WBS in other initiative
        other_wbs_resp = await client.post(
            f"{BASE}/initiatives/{other_id}/wbs",
            json={"title": "Other WBS"},
            headers=hdrs,
        )
        other_wbs_id = other_wbs_resp.json()["id"]

        # Try to create WBS in first initiative with parent from other
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json={"title": "Cross-init child", "parent_id": other_wbs_id},
            headers=hdrs,
        )
        assert resp.status_code == 400
        assert "not found" in resp.json()["detail"].lower()

    async def test_404_for_nonexistent_wbs(self, client, ppm_env):
        resp = await client.patch(
            f"{BASE}/wbs/{uuid.uuid4()}",
            json={"title": "nope"},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_wbs_with_assignee(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        assignee_id = str(ppm_env["admin"].id)
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json={"title": "Assigned WBS", "assignee_id": assignee_id},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["assignee_id"] == assignee_id
        assert data["assignee_name"] == "Test User"

    async def test_wbs_milestone(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json={"title": "Go-Live", "is_milestone": True},
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["is_milestone"] is True


# ── WBS date rollup from tasks ────────────────────────────────────


class TestWbsDateRollup:
    """A WBS work package's start_date / end_date must widen to encompass
    all tasks underneath. Widen-only — never narrow a manually-set range —
    and the rule is a no-op for WBS items that have no tasks."""

    async def _create_wbs(self, client, hdrs, init_id, **kwargs):
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json=kwargs,
            headers=hdrs,
        )
        assert resp.status_code == 200, resp.text
        return resp.json()

    async def _create_task(self, client, hdrs, init_id, **kwargs):
        body = {"title": "T"}
        body.update(kwargs)
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/tasks",
            json=body,
            headers=hdrs,
        )
        assert resp.status_code == 200, resp.text
        return resp.json()

    async def _get_wbs(self, client, hdrs, init_id, wbs_id):
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/wbs",
            headers=hdrs,
        )
        assert resp.status_code == 200
        return next(w for w in resp.json() if w["id"] == wbs_id)

    async def test_create_task_outside_wbs_range_widens_wbs(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])
        wbs = await self._create_wbs(
            client,
            hdrs,
            init_id,
            title="WP",
            start_date="2026-03-10",
            end_date="2026-03-20",
        )
        await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=wbs["id"],
            start_date="2026-03-05",
            due_date="2026-03-25",
        )
        updated = await self._get_wbs(client, hdrs, init_id, wbs["id"])
        assert updated["start_date"] == "2026-03-05"
        assert updated["end_date"] == "2026-03-25"

    async def test_patch_task_due_extends_wbs_end(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])
        wbs = await self._create_wbs(client, hdrs, init_id, title="WP")
        task = await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=wbs["id"],
            start_date="2026-03-12",
            due_date="2026-03-15",
        )
        # WBS now matches the task (Mar 12 – Mar 15).
        resp = await client.patch(
            f"{BASE}/tasks/{task['id']}",
            json={"due_date": "2026-03-30"},
            headers=hdrs,
        )
        assert resp.status_code == 200
        updated = await self._get_wbs(client, hdrs, init_id, wbs["id"])
        assert updated["start_date"] == "2026-03-12"
        assert updated["end_date"] == "2026-03-30"

    async def test_patch_task_start_extends_wbs_start(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])
        wbs = await self._create_wbs(client, hdrs, init_id, title="WP")
        task = await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=wbs["id"],
            start_date="2026-03-12",
            due_date="2026-03-15",
        )
        resp = await client.patch(
            f"{BASE}/tasks/{task['id']}",
            json={"start_date": "2026-03-01"},
            headers=hdrs,
        )
        assert resp.status_code == 200
        updated = await self._get_wbs(client, hdrs, init_id, wbs["id"])
        assert updated["start_date"] == "2026-03-01"
        assert updated["end_date"] == "2026-03-15"

    async def test_task_move_inside_shrinks_wbs(self, client, ppm_env):
        """Moving a task to a tighter range shrinks the WBS to the new bounds."""
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])
        wbs = await self._create_wbs(client, hdrs, init_id, title="WP")
        task = await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=wbs["id"],
            start_date="2026-03-05",
            due_date="2026-03-25",
        )
        # WBS is now exactly the task's range.
        widened = await self._get_wbs(client, hdrs, init_id, wbs["id"])
        assert widened["start_date"] == "2026-03-05"
        assert widened["end_date"] == "2026-03-25"
        # Move the task inward — WBS shrinks to match.
        resp = await client.patch(
            f"{BASE}/tasks/{task['id']}",
            json={"start_date": "2026-03-13", "due_date": "2026-03-17"},
            headers=hdrs,
        )
        assert resp.status_code == 200
        updated = await self._get_wbs(client, hdrs, init_id, wbs["id"])
        assert updated["start_date"] == "2026-03-13"
        assert updated["end_date"] == "2026-03-17"

    async def test_patch_unrelated_field_is_noop(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])
        wbs = await self._create_wbs(
            client,
            hdrs,
            init_id,
            title="WP",
            start_date="2026-03-10",
            end_date="2026-03-20",
        )
        task = await self._create_task(client, hdrs, init_id, wbs_id=wbs["id"], title="Original")
        resp = await client.patch(
            f"{BASE}/tasks/{task['id']}",
            json={"title": "Renamed"},
            headers=hdrs,
        )
        assert resp.status_code == 200
        updated = await self._get_wbs(client, hdrs, init_id, wbs["id"])
        assert updated["start_date"] == "2026-03-10"
        assert updated["end_date"] == "2026-03-20"

    async def test_empty_wbs_keeps_user_dates(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])
        empty_wbs = await self._create_wbs(
            client,
            hdrs,
            init_id,
            title="Empty WP",
            start_date="2026-03-10",
            end_date="2026-03-20",
        )
        other_wbs = await self._create_wbs(client, hdrs, init_id, title="Other WP")
        # Add a task on the OTHER wbs with extreme dates — must not affect the empty one.
        await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=other_wbs["id"],
            start_date="2026-01-01",
            due_date="2026-12-31",
        )
        empty_after = await self._get_wbs(client, hdrs, init_id, empty_wbs["id"])
        assert empty_after["start_date"] == "2026-03-10"
        assert empty_after["end_date"] == "2026-03-20"

    async def test_delete_only_task_keeps_last_dates(self, client, ppm_env):
        """Deleting the *only* task on a WBS leaves the WBS dates as they
        last were — the rule is ignored when there are no tasks."""
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])
        wbs = await self._create_wbs(client, hdrs, init_id, title="WP")
        task = await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=wbs["id"],
            start_date="2026-03-05",
            due_date="2026-03-25",
        )
        # WBS now matches the task's range.
        widened = await self._get_wbs(client, hdrs, init_id, wbs["id"])
        assert widened["start_date"] == "2026-03-05"
        assert widened["end_date"] == "2026-03-25"
        # Delete the only task — WBS keeps its last computed dates.
        resp = await client.delete(
            f"{BASE}/tasks/{task['id']}",
            headers=hdrs,
        )
        assert resp.status_code == 204
        after_delete = await self._get_wbs(client, hdrs, init_id, wbs["id"])
        assert after_delete["start_date"] == "2026-03-05"
        assert after_delete["end_date"] == "2026-03-25"

    async def test_delete_outer_task_shrinks_wbs(self, client, ppm_env):
        """When one of several tasks is deleted, the WBS shrinks to the
        bounds of the remaining tasks."""
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])
        wbs = await self._create_wbs(client, hdrs, init_id, title="WP")
        outer = await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=wbs["id"],
            start_date="2026-03-05",
            due_date="2026-03-25",
        )
        await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=wbs["id"],
            start_date="2026-03-10",
            due_date="2026-03-20",
        )
        before = await self._get_wbs(client, hdrs, init_id, wbs["id"])
        assert before["start_date"] == "2026-03-05"
        assert before["end_date"] == "2026-03-25"
        resp = await client.delete(
            f"{BASE}/tasks/{outer['id']}",
            headers=hdrs,
        )
        assert resp.status_code == 204
        after = await self._get_wbs(client, hdrs, init_id, wbs["id"])
        assert after["start_date"] == "2026-03-10"
        assert after["end_date"] == "2026-03-20"

    async def test_cascades_up_parent_chain(self, client, ppm_env):
        """Adding a task on a leaf WBS widens its parent and grandparent."""
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])
        grandparent = await self._create_wbs(
            client,
            hdrs,
            init_id,
            title="GP",
            start_date="2026-03-10",
            end_date="2026-03-20",
        )
        parent = await self._create_wbs(
            client,
            hdrs,
            init_id,
            title="P",
            parent_id=grandparent["id"],
            start_date="2026-03-12",
            end_date="2026-03-18",
        )
        leaf = await self._create_wbs(
            client,
            hdrs,
            init_id,
            title="L",
            parent_id=parent["id"],
            start_date="2026-03-13",
            end_date="2026-03-15",
        )
        await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=leaf["id"],
            start_date="2026-03-01",
            due_date="2026-03-31",
        )
        leaf_after = await self._get_wbs(client, hdrs, init_id, leaf["id"])
        parent_after = await self._get_wbs(client, hdrs, init_id, parent["id"])
        gp_after = await self._get_wbs(client, hdrs, init_id, grandparent["id"])
        assert leaf_after["start_date"] == "2026-03-01"
        assert leaf_after["end_date"] == "2026-03-31"
        assert parent_after["start_date"] == "2026-03-01"
        assert parent_after["end_date"] == "2026-03-31"
        assert gp_after["start_date"] == "2026-03-01"
        assert gp_after["end_date"] == "2026-03-31"

    async def test_parent_shrinks_to_children_bounds(self, client, ppm_env):
        """Parent with a manually wider range than its child's task collapses
        to the child's task bounds, since the rule is bidirectional."""
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])
        parent = await self._create_wbs(
            client,
            hdrs,
            init_id,
            title="P",
            start_date="2026-01-01",
            end_date="2026-12-31",
        )
        child = await self._create_wbs(
            client,
            hdrs,
            init_id,
            title="C",
            parent_id=parent["id"],
            start_date="2026-06-01",
            end_date="2026-06-30",
        )
        await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=child["id"],
            start_date="2026-06-10",
            due_date="2026-06-20",
        )
        # Child shrinks to its task bounds; parent shrinks to its child's bounds.
        child_after = await self._get_wbs(client, hdrs, init_id, child["id"])
        parent_after = await self._get_wbs(client, hdrs, init_id, parent["id"])
        assert child_after["start_date"] == "2026-06-10"
        assert child_after["end_date"] == "2026-06-20"
        assert parent_after["start_date"] == "2026-06-10"
        assert parent_after["end_date"] == "2026-06-20"


# ── Completion ────────────────────────────────────────────────────


class TestCompletion:
    async def test_zero_with_no_wbs(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/completion",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["completion"] == 0

    async def test_averages_root_wbs_completions(self, client, ppm_env):
        """Completion is the average of root-level WBS completions."""
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])

        await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json={"title": "Phase 1", "completion": 80},
            headers=hdrs,
        )
        await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json={"title": "Phase 2", "completion": 40},
            headers=hdrs,
        )

        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/completion",
            headers=hdrs,
        )
        assert resp.status_code == 200
        assert resp.json()["completion"] == 60.0  # (80 + 40) / 2

    async def test_only_root_items_count(self, client, ppm_env):
        """Child WBS items should not directly affect the completion calc."""
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])

        parent_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json={"title": "Root", "completion": 50},
            headers=hdrs,
        )
        parent_id = parent_resp.json()["id"]

        # Child with 100% should not skew the result
        await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json={
                "title": "Child",
                "parent_id": parent_id,
                "completion": 100,
            },
            headers=hdrs,
        )

        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/completion",
            headers=hdrs,
        )
        # Only the root item (50%) is averaged
        assert resp.json()["completion"] == 50.0

    async def test_404_for_bad_initiative(self, client, ppm_env):
        resp = await client.get(
            f"{BASE}/initiatives/{uuid.uuid4()}/completion",
            headers=auth_headers(ppm_env["admin"]),
        )
        assert resp.status_code == 404


# ── Duration-weighted completion rollup ───────────────────────────


class TestCompletionDurationWeighting:
    """Tasks contribute to their WBS's completion proportionally to their
    duration in days, not as a flat 1/N fraction. A 5-day task counts
    5x as much as a 1-day task; tasks with no dates default to 1 day."""

    async def _create_wbs(self, client, hdrs, init_id, **kwargs):
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json=kwargs,
            headers=hdrs,
        )
        assert resp.status_code == 200, resp.text
        return resp.json()

    async def _create_task(self, client, hdrs, init_id, **kwargs):
        body = {"title": "T"}
        body.update(kwargs)
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/tasks",
            json=body,
            headers=hdrs,
        )
        assert resp.status_code == 200, resp.text
        return resp.json()

    async def _get_wbs(self, client, hdrs, init_id, wbs_id):
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/wbs",
            headers=hdrs,
        )
        return next(w for w in resp.json() if w["id"] == wbs_id)

    async def test_short_done_long_open_yields_low_completion(self, client, ppm_env):
        """1 day done out of 5 total days = 20%, not 50% (which a count-
        based ratio of 1-of-2 tasks would have produced)."""
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])
        wbs = await self._create_wbs(client, hdrs, init_id, title="WP")
        await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=wbs["id"],
            status="done",
            start_date="2026-03-01",
            due_date="2026-03-01",  # 1 day inclusive
        )
        await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=wbs["id"],
            status="todo",
            start_date="2026-03-02",
            due_date="2026-03-05",  # 4 days inclusive
        )
        # PATCH a task so the rollup runs (creation already triggers it,
        # but we re-trigger to make the assertion explicit).
        updated = await self._get_wbs(client, hdrs, init_id, wbs["id"])
        # 1 done day / (1 + 4) total days = 20%
        assert updated["completion"] == 20.0

    async def test_long_done_short_open_yields_high_completion(self, client, ppm_env):
        """4 days done out of 5 total = 80% even though only 1-of-2 tasks
        is done, because the long task carries more weight."""
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])
        wbs = await self._create_wbs(client, hdrs, init_id, title="WP")
        await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=wbs["id"],
            status="done",
            start_date="2026-03-01",
            due_date="2026-03-04",  # 4 days
        )
        await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=wbs["id"],
            status="todo",
            start_date="2026-03-05",
            due_date="2026-03-05",  # 1 day
        )
        updated = await self._get_wbs(client, hdrs, init_id, wbs["id"])
        assert updated["completion"] == 80.0

    async def test_dateless_tasks_each_weight_one_day(self, client, ppm_env):
        """Tasks with no dates default to 1 day each, so a WBS with all
        date-less tasks behaves like the old count-based ratio."""
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])
        wbs = await self._create_wbs(client, hdrs, init_id, title="WP")
        # 1 done, 3 not done — no dates anywhere.
        await self._create_task(client, hdrs, init_id, wbs_id=wbs["id"], status="done")
        for _ in range(3):
            await self._create_task(client, hdrs, init_id, wbs_id=wbs["id"], status="todo")
        updated = await self._get_wbs(client, hdrs, init_id, wbs["id"])
        # 1 day done / 4 total days = 25%
        assert updated["completion"] == 25.0

    async def test_parent_aggregates_subtree_durations(self, client, ppm_env):
        """A parent WBS's completion is the duration-weighted aggregate of
        its whole subtree, not a flat average of its children. A child
        with a single short done task and a child with one long open task
        produce a low parent completion, not 50%."""
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])
        parent = await self._create_wbs(client, hdrs, init_id, title="Parent")
        a = await self._create_wbs(client, hdrs, init_id, title="A", parent_id=parent["id"])
        b = await self._create_wbs(client, hdrs, init_id, title="B", parent_id=parent["id"])
        # A: 1-day done task
        await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=a["id"],
            status="done",
            start_date="2026-03-01",
            due_date="2026-03-01",
        )
        # B: 9-day open task
        await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=b["id"],
            status="todo",
            start_date="2026-03-02",
            due_date="2026-03-10",
        )
        a_after = await self._get_wbs(client, hdrs, init_id, a["id"])
        b_after = await self._get_wbs(client, hdrs, init_id, b["id"])
        parent_after = await self._get_wbs(client, hdrs, init_id, parent["id"])
        assert a_after["completion"] == 100.0
        assert b_after["completion"] == 0.0
        # Subtree: 1 day done / 10 total days = 10% (NOT (100 + 0)/2 = 50%)
        assert parent_after["completion"] == 10.0

    async def test_in_progress_task_contributes_50_percent(self, client, ppm_env):
        """An `in_progress` task counts at 50% credit, mirroring the
        frontend's task-bar fill. Previously these contributed 0%, which
        produced a WBS at 0% even when work had visibly started."""
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])
        wbs = await self._create_wbs(client, hdrs, init_id, title="WP")
        # 1 in-progress 4-day task + 1 todo 1-day task
        # → (4 × 0.5 + 1 × 0) / 5 = 40%
        await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=wbs["id"],
            status="in_progress",
            start_date="2026-03-01",
            due_date="2026-03-04",
        )
        await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=wbs["id"],
            status="todo",
            start_date="2026-03-05",
            due_date="2026-03-05",
        )
        updated = await self._get_wbs(client, hdrs, init_id, wbs["id"])
        assert updated["completion"] == 40.0

    async def test_all_in_progress_yields_50_percent(self, client, ppm_env):
        """The previously-broken case: a WBS whose tasks are all
        in_progress used to report 0%; with the fix it reports 50%."""
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])
        wbs = await self._create_wbs(client, hdrs, init_id, title="WP")
        for _ in range(3):
            await self._create_task(
                client,
                hdrs,
                init_id,
                wbs_id=wbs["id"],
                status="in_progress",
            )
        updated = await self._get_wbs(client, hdrs, init_id, wbs["id"])
        assert updated["completion"] == 50.0

    async def test_mixed_status_durations_aggregate(self, client, ppm_env):
        """Done + in_progress + todo with varying durations: the WBS reports
        the duration-weighted average where done=1.0, in_progress=0.5,
        todo=0.0."""
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])
        wbs = await self._create_wbs(client, hdrs, init_id, title="WP")
        # done 2-day + in_progress 4-day + todo 4-day
        # numerator   = 2 × 1.0 + 4 × 0.5 + 4 × 0.0 = 4.0
        # denominator = 2 + 4 + 4 = 10
        # → 40%
        await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=wbs["id"],
            status="done",
            start_date="2026-03-01",
            due_date="2026-03-02",
        )
        await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=wbs["id"],
            status="in_progress",
            start_date="2026-03-03",
            due_date="2026-03-06",
        )
        await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=wbs["id"],
            status="todo",
            start_date="2026-03-07",
            due_date="2026-03-10",
        )
        updated = await self._get_wbs(client, hdrs, init_id, wbs["id"])
        assert updated["completion"] == 40.0

    async def test_subtree_with_no_tasks_preserves_manual_completion(self, client, ppm_env):
        """A WBS whose entire subtree has no tasks keeps whatever
        completion the user manually set."""
        init_id = str(ppm_env["initiative"].id)
        hdrs = auth_headers(ppm_env["admin"])
        empty = await self._create_wbs(client, hdrs, init_id, title="Empty", completion=42)
        # Trigger a rollup via a task on a *different* WBS.
        other = await self._create_wbs(client, hdrs, init_id, title="Other")
        await self._create_task(
            client,
            hdrs,
            init_id,
            wbs_id=other["id"],
            status="done",
            start_date="2026-03-01",
            due_date="2026-03-01",
        )
        empty_after = await self._get_wbs(client, hdrs, init_id, empty["id"])
        assert empty_after["completion"] == 42


# ── Permissions ───────────────────────────────────────────────────


class TestPermissions:
    """Viewer has ppm.view=True but ppm.manage=False.
    All mutating endpoints should return 403 for viewers.
    """

    async def test_viewer_cannot_create_cost(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/costs",
            json={"description": "X", "category": "opex"},
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_viewer_cannot_create_budget(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/budgets",
            json={"fiscal_year": 2026, "category": "capex", "amount": 1},
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_viewer_cannot_create_risk(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/risks",
            json={"title": "X"},
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_viewer_cannot_create_task(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/tasks",
            json={"title": "X"},
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_viewer_cannot_create_wbs(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json={"title": "X"},
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_viewer_cannot_create_task_comment(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        # Create a task as admin first
        task_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/tasks",
            json={"title": "Task for viewer test"},
            headers=auth_headers(ppm_env["admin"]),
        )
        task_id = task_resp.json()["id"]

        resp = await client.post(
            f"{BASE}/tasks/{task_id}/comments",
            json={"content": "blocked"},
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_viewer_can_list_costs(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/costs",
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 200

    async def test_viewer_can_list_budgets(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/budgets",
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 200

    async def test_viewer_can_list_risks(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/risks",
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 200

    async def test_viewer_can_list_tasks(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/tasks",
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 200

    async def test_viewer_can_list_wbs(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/wbs",
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 200

    async def test_viewer_can_get_completion(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/completion",
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 200

    async def test_viewer_can_get_has_costs(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/has-costs",
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 200

    async def test_unauthenticated_rejected(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/reports",
        )
        assert resp.status_code in (401, 403)

    async def test_viewer_cannot_delete_cost(self, client, ppm_env):
        """Viewer cannot delete even if they somehow know the cost ID."""
        init_id = str(ppm_env["initiative"].id)
        create_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/costs",
            json={"description": "Admin cost", "category": "opex"},
            headers=auth_headers(ppm_env["admin"]),
        )
        cost_id = create_resp.json()["id"]

        resp = await client.delete(
            f"{BASE}/costs/{cost_id}",
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_viewer_cannot_update_risk(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        create_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/risks",
            json={"title": "Admin risk"},
            headers=auth_headers(ppm_env["admin"]),
        )
        risk_id = create_resp.json()["id"]

        resp = await client.patch(
            f"{BASE}/risks/{risk_id}",
            json={"status": "closed"},
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_viewer_cannot_delete_wbs(self, client, ppm_env):
        init_id = str(ppm_env["initiative"].id)
        create_resp = await client.post(
            f"{BASE}/initiatives/{init_id}/wbs",
            json={"title": "Admin WBS"},
            headers=auth_headers(ppm_env["admin"]),
        )
        wbs_id = create_resp.json()["id"]

        resp = await client.delete(
            f"{BASE}/wbs/{wbs_id}",
            headers=auth_headers(ppm_env["viewer"]),
        )
        assert resp.status_code == 403
