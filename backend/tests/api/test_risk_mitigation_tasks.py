"""Integration tests for the risk mitigation tasks API.

Covers the full task lifecycle including:

* Create / patch / delete on tasks.
* Per-occurrence complete + skip (one-shot vs. recurring rollover).
* The "assignee can complete their own occurrence without risks.manage" carve-out.
* System Todo lifecycle: created on task create, reassigned on owner change,
  closed on completion, recreated for the next recurring occurrence.
* Owner-at-time snapshot on the audit history when the owner is rotated mid-cycle.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.risk import Risk
from app.models.risk_mitigation_task import (
    RiskMitigationTask,
    RiskMitigationTaskOccurrence,
)
from app.models.todo import Todo
from tests.conftest import auth_headers, create_role, create_user

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


async def _make_risk(db, owner_id=None, title="A risk"):
    risk = Risk(
        id=uuid.uuid4(),
        reference="R-000001",
        title=title,
        description="",
        category="operational",
        source_type="manual",
        initial_probability="medium",
        initial_impact="medium",
        initial_level="medium",
        owner_id=owner_id,
        status="identified",
    )
    db.add(risk)
    await db.flush()
    return risk


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@example.com", role="admin")
    member = await create_user(db, email="member@example.com", role="member")
    viewer = await create_user(db, email="viewer@example.com", role="viewer")
    risk = await _make_risk(db, owner_id=admin.id)
    return {
        "admin": admin,
        "member": member,
        "viewer": viewer,
        "risk": risk,
    }


def _api(risk):
    return f"/api/v1/risks/{risk.id}/mitigation-tasks"


# ---------------------------------------------------------------------------
# Create / list
# ---------------------------------------------------------------------------


async def test_create_one_shot_task_seeds_first_occurrence(client, db, env):
    risk = env["risk"]
    resp = await client.post(
        _api(risk),
        json={
            "title": "Apply MFA to all admins",
            "description": "Roll MFA out per finding 42",
            "owner_id": str(env["admin"].id),
            "due_date": "2026-06-30",
        },
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Apply MFA to all admins"
    assert body["recurrence_unit"] == "none"
    assert body["recurrence_interval"] == 1
    assert body["is_active"] is True
    assert body["owner_id"] == str(env["admin"].id)
    # Reference is allocated on create — T-NNNNNN, zero-padded to 6 digits.
    assert body["reference"].startswith("T-")
    assert len(body["reference"]) >= len("T-000001")
    assert len(body["occurrences"]) == 1
    occ = body["occurrences"][0]
    assert occ["sequence"] == 1
    assert occ["status"] == "open"
    assert occ["assigned_owner_id"] == str(env["admin"].id)
    assert occ["due_date"] == "2026-06-30"


async def test_create_two_tasks_get_distinct_sequential_references(client, db, env):
    """T-000001 → T-000002 → ... — same shape as risk references."""
    risk = env["risk"]
    first = await client.post(
        _api(risk),
        json={"title": "First", "owner_id": str(env["admin"].id)},
        headers=auth_headers(env["admin"]),
    )
    second = await client.post(
        _api(risk),
        json={"title": "Second", "owner_id": str(env["admin"].id)},
        headers=auth_headers(env["admin"]),
    )
    a = first.json()["reference"]
    b = second.json()["reference"]
    assert a != b
    assert a.startswith("T-") and b.startswith("T-")
    # Monotonic.
    assert int(b.split("-")[1]) == int(a.split("-")[1]) + 1


async def test_export_endpoint_returns_tasks_for_filtered_risks(client, db, env):
    risk = env["risk"]
    # Create two tasks across the (single) risk.
    await client.post(
        _api(risk),
        json={"title": "Audit MFA", "owner_id": str(env["admin"].id)},
        headers=auth_headers(env["admin"]),
    )
    await client.post(
        _api(risk),
        json={
            "title": "Quarterly review",
            "owner_id": str(env["admin"].id),
            "recurrence_unit": "months",
            "recurrence_interval": 3,
        },
        headers=auth_headers(env["admin"]),
    )

    resp = await client.get(
        "/api/v1/risks/mitigation-tasks/export",
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 2
    titles = {t["title"] for t in rows}
    assert titles == {"Audit MFA", "Quarterly review"}
    # Each task carries its occurrence history.
    assert all(len(t["occurrences"]) >= 1 for t in rows)


async def test_export_endpoint_honours_status_filter(client, db, env):
    """A status filter that excludes the risk should yield zero tasks."""
    risk = env["risk"]
    await client.post(
        _api(risk),
        json={"title": "Some task", "owner_id": str(env["admin"].id)},
        headers=auth_headers(env["admin"]),
    )
    # Risk is in "identified" — filter for "closed" should drop everything.
    resp = await client.get(
        "/api/v1/risks/mitigation-tasks/export?status=closed",
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_create_recurring_task_persists_recurrence_rule(client, db, env):
    risk = env["risk"]
    resp = await client.post(
        _api(risk),
        json={
            "title": "Review access rights",
            "owner_id": str(env["member"].id),
            "due_date": "2026-06-01",
            "recurrence_unit": "months",
            "recurrence_interval": 6,
        },
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["recurrence_unit"] == "months"
    assert body["recurrence_interval"] == 6
    assert len(body["occurrences"]) == 1


async def test_create_task_creates_system_todo_for_assignee(client, db, env):
    risk = env["risk"]
    resp = await client.post(
        _api(risk),
        json={
            "title": "Audit something",
            "owner_id": str(env["member"].id),
        },
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    todos = (
        (
            await db.execute(
                select(Todo).where(Todo.is_system.is_(True), Todo.assigned_to == env["member"].id)
            )
        )
        .scalars()
        .all()
    )
    assert len(todos) == 1
    assert "[Risk R-000001]" in todos[0].description
    assert todos[0].status == "open"


async def test_list_mitigation_tasks_returns_full_history(client, db, env):
    risk = env["risk"]
    await client.post(
        _api(risk),
        json={"title": "First task", "owner_id": str(env["admin"].id)},
        headers=auth_headers(env["admin"]),
    )
    await client.post(
        _api(risk),
        json={"title": "Second task", "owner_id": str(env["admin"].id)},
        headers=auth_headers(env["admin"]),
    )
    resp = await client.get(_api(risk), headers=auth_headers(env["admin"]))
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    titles = {t["title"] for t in data}
    assert titles == {"First task", "Second task"}


async def test_viewer_cannot_create_task(client, db, env):
    risk = env["risk"]
    resp = await client.post(
        _api(risk),
        json={"title": "No permission"},
        headers=auth_headers(env["viewer"]),
    )
    assert resp.status_code == 403


async def test_cannot_create_task_on_closed_risk(client, db, env):
    risk = env["risk"]
    risk.status = "closed"
    await db.flush()
    await db.commit()
    resp = await client.post(
        _api(risk),
        json={"title": "Blocked"},
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Complete + recurrence rollover
# ---------------------------------------------------------------------------


async def test_complete_one_shot_deactivates_task_and_keeps_done_todo(client, db, env):
    risk = env["risk"]
    create = await client.post(
        _api(risk),
        json={"title": "One and done", "owner_id": str(env["admin"].id)},
        headers=auth_headers(env["admin"]),
    )
    task = create.json()
    occurrence = task["occurrences"][0]

    resp = await client.post(
        f"/api/v1/mitigation-tasks/{task['id']}/occurrences/{occurrence['id']}/complete",
        json={"notes": "Rolled out"},
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["is_active"] is False
    assert len(body["occurrences"]) == 1
    closed_occ = body["occurrences"][0]
    assert closed_occ["status"] == "done"
    assert closed_occ["completion_notes"] == "Rolled out"
    assert closed_occ["completed_by"] == str(env["admin"].id)
    assert closed_occ["owner_at_completion"] == str(env["admin"].id)

    # The system Todo stays around with status="done" so the assignee's
    # Done tab on /todos shows the completed mitigation cycle. It only
    # gets purged if the task itself is deleted (delete_task_todo).
    todos = (
        (
            await db.execute(
                select(Todo).where(Todo.is_system.is_(True), Todo.assigned_to == env["admin"].id)
            )
        )
        .scalars()
        .all()
    )
    assert len(todos) == 1
    assert todos[0].status == "done"


async def test_complete_recurring_rolls_next_occurrence_forward(client, db, env):
    risk = env["risk"]
    create = await client.post(
        _api(risk),
        json={
            "title": "Quarterly review",
            "owner_id": str(env["admin"].id),
            "due_date": "2026-01-15",
            "recurrence_unit": "months",
            "recurrence_interval": 3,
        },
        headers=auth_headers(env["admin"]),
    )
    task = create.json()
    first = task["occurrences"][0]

    resp = await client.post(
        f"/api/v1/mitigation-tasks/{task['id']}/occurrences/{first['id']}/complete",
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    # Task stays active (recurring), now has 2 occurrences.
    assert body["is_active"] is True
    assert len(body["occurrences"]) == 2
    by_seq = sorted(body["occurrences"], key=lambda o: o["sequence"])
    assert by_seq[0]["status"] == "done"
    assert by_seq[1]["status"] == "open"
    # Next due date = Jan 15 + 3 months = Apr 15.
    assert by_seq[1]["due_date"] == "2026-04-15"
    # New occurrence is re-assigned to the current task owner.
    assert by_seq[1]["assigned_owner_id"] == str(env["admin"].id)

    # Owner now has two Todos: the previous cycle marked done (kept for
    # the Done tab) and a fresh open Todo for the next cycle.
    todos = (
        (
            await db.execute(
                select(Todo).where(Todo.is_system.is_(True), Todo.assigned_to == env["admin"].id)
            )
        )
        .scalars()
        .all()
    )
    statuses = sorted(t.status for t in todos)
    assert statuses == ["done", "open"]


async def test_complete_recurring_clamps_short_month_correctly(client, db, env):
    """Jan 31 + 1 month → Feb 28 (not March 3)."""
    risk = env["risk"]
    create = await client.post(
        _api(risk),
        json={
            "title": "Monthly review",
            "owner_id": str(env["admin"].id),
            "due_date": "2026-01-31",
            "recurrence_unit": "months",
            "recurrence_interval": 1,
        },
        headers=auth_headers(env["admin"]),
    )
    task = create.json()
    first = task["occurrences"][0]
    resp = await client.post(
        f"/api/v1/mitigation-tasks/{task['id']}/occurrences/{first['id']}/complete",
        headers=auth_headers(env["admin"]),
    )
    body = resp.json()
    new_occ = next(o for o in body["occurrences"] if o["status"] == "open")
    assert new_occ["due_date"] == "2026-02-28"


async def test_cannot_complete_twice(client, db, env):
    risk = env["risk"]
    create = await client.post(
        _api(risk),
        json={"title": "One shot", "owner_id": str(env["admin"].id)},
        headers=auth_headers(env["admin"]),
    )
    task = create.json()
    occ = task["occurrences"][0]
    first = await client.post(
        f"/api/v1/mitigation-tasks/{task['id']}/occurrences/{occ['id']}/complete",
        headers=auth_headers(env["admin"]),
    )
    assert first.status_code == 200
    second = await client.post(
        f"/api/v1/mitigation-tasks/{task['id']}/occurrences/{occ['id']}/complete",
        headers=auth_headers(env["admin"]),
    )
    assert second.status_code == 409


# ---------------------------------------------------------------------------
# Owner-can-complete-own carve-out
# ---------------------------------------------------------------------------


async def test_assignee_without_manage_can_complete_their_own_occurrence(client, db, env):
    """A viewer assigned to an occurrence can still close it without risks.manage."""
    risk = env["risk"]
    # Admin creates the task and assigns it to the viewer (read-only user).
    create = await client.post(
        _api(risk),
        json={
            "title": "Sign off control",
            "owner_id": str(env["viewer"].id),
        },
        headers=auth_headers(env["admin"]),
    )
    task = create.json()
    occ = task["occurrences"][0]

    resp = await client.post(
        f"/api/v1/mitigation-tasks/{task['id']}/occurrences/{occ['id']}/complete",
        headers=auth_headers(env["viewer"]),
    )
    assert resp.status_code == 200


async def test_other_users_cannot_complete_unassigned_occurrence(client, db, env):
    risk = env["risk"]
    create = await client.post(
        _api(risk),
        json={"title": "Not your task", "owner_id": str(env["admin"].id)},
        headers=auth_headers(env["admin"]),
    )
    task = create.json()
    occ = task["occurrences"][0]
    resp = await client.post(
        f"/api/v1/mitigation-tasks/{task['id']}/occurrences/{occ['id']}/complete",
        headers=auth_headers(env["viewer"]),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Owner rotation captures owner_at_completion separately from assignee
# ---------------------------------------------------------------------------


async def test_owner_change_mid_cycle_snapshots_both_owners_on_completion(client, db, env):
    risk = env["risk"]
    create = await client.post(
        _api(risk),
        json={"title": "Audit X", "owner_id": str(env["admin"].id)},
        headers=auth_headers(env["admin"]),
    )
    task = create.json()
    occ = task["occurrences"][0]
    # Admin originally assigned. Now rotate ownership to member.
    patch_resp = await client.patch(
        f"/api/v1/mitigation-tasks/{task['id']}",
        json={"owner_id": str(env["member"].id)},
        headers=auth_headers(env["admin"]),
    )
    assert patch_resp.status_code == 200
    # Member completes the open occurrence.
    resp = await client.post(
        f"/api/v1/mitigation-tasks/{task['id']}/occurrences/{occ['id']}/complete",
        headers=auth_headers(env["member"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    closed = body["occurrences"][0]
    # owner_at_completion is the current owner (member), not the original (admin).
    assert closed["owner_at_completion"] == str(env["member"].id)
    assert closed["completed_by"] == str(env["member"].id)
    # The system Todo follows the owner change.
    todos = (
        (
            await db.execute(
                select(Todo).where(Todo.is_system.is_(True), Todo.assigned_to == env["admin"].id)
            )
        )
        .scalars()
        .all()
    )
    assert todos == []


# ---------------------------------------------------------------------------
# Skip path
# ---------------------------------------------------------------------------


async def test_skip_requires_manage_permission(client, db, env):
    risk = env["risk"]
    create = await client.post(
        _api(risk),
        json={"title": "Skippable", "owner_id": str(env["viewer"].id)},
        headers=auth_headers(env["admin"]),
    )
    task = create.json()
    occ = task["occurrences"][0]
    # Viewer is the assignee but skip needs full risks.manage.
    resp = await client.post(
        f"/api/v1/mitigation-tasks/{task['id']}/occurrences/{occ['id']}/skip",
        headers=auth_headers(env["viewer"]),
    )
    assert resp.status_code == 403


async def test_skip_recurring_still_rolls_next_occurrence(client, db, env):
    risk = env["risk"]
    create = await client.post(
        _api(risk),
        json={
            "title": "Quarterly review",
            "owner_id": str(env["admin"].id),
            "due_date": "2026-01-15",
            "recurrence_unit": "months",
            "recurrence_interval": 3,
        },
        headers=auth_headers(env["admin"]),
    )
    task = create.json()
    occ = task["occurrences"][0]
    resp = await client.post(
        f"/api/v1/mitigation-tasks/{task['id']}/occurrences/{occ['id']}/skip",
        json={"notes": "Out of scope this quarter"},
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    sequences = sorted(o["status"] for o in body["occurrences"])
    assert sequences == ["open", "skipped"]


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


async def test_delete_task_cascades_occurrences_and_removes_todo(client, db, env):
    risk = env["risk"]
    create = await client.post(
        _api(risk),
        json={"title": "Temporary", "owner_id": str(env["admin"].id)},
        headers=auth_headers(env["admin"]),
    )
    task_id = create.json()["id"]
    resp = await client.delete(
        f"/api/v1/mitigation-tasks/{task_id}",
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200

    # Task row gone.
    remaining = (
        await db.execute(select(RiskMitigationTask).where(RiskMitigationTask.id == task_id))
    ).scalar_one_or_none()
    assert remaining is None
    # Occurrences cascade-deleted.
    occ_rows = (
        (
            await db.execute(
                select(RiskMitigationTaskOccurrence).where(
                    RiskMitigationTaskOccurrence.task_id == task_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert occ_rows == []
    # System Todo cleaned up.
    todos = (await db.execute(select(Todo).where(Todo.is_system.is_(True)))).scalars().all()
    assert todos == []


# ---------------------------------------------------------------------------
# Risk delete cascades to mitigation tasks
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Lead-time gating + scheduled occurrences + promotion
# ---------------------------------------------------------------------------


async def test_recurring_task_creates_with_smart_default_lead_time(client, db, env):
    """Server picks the smart per-unit lead time when none is supplied."""
    risk = env["risk"]
    resp = await client.post(
        _api(risk),
        json={
            "title": "Quarterly review",
            "owner_id": str(env["admin"].id),
            "due_date": "2026-09-15",
            "recurrence_unit": "months",
            "recurrence_interval": 3,
        },
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    # Monthly + 3-month cap = floor(3 × 30 / 2) = 45 → default of 7
    # wins. The frontend hint MUST match this.
    assert body["lead_time_days"] == 7


async def test_one_shot_task_lead_time_defaults_to_zero(client, db, env):
    risk = env["risk"]
    resp = await client.post(
        _api(risk),
        json={"title": "One-shot", "owner_id": str(env["admin"].id)},
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    assert resp.json()["lead_time_days"] == 0


async def test_recurring_far_out_due_date_lands_as_scheduled_with_no_todo(client, db, env):
    """Due 6 months out + 14-day lead → first occurrence is scheduled.

    The whole point of the iteration: an assignee should NOT see the
    yearly re-attest in their Todo list 364 days in advance.
    """
    from datetime import date, timedelta

    far_future = (date.today() + timedelta(days=180)).isoformat()
    risk = env["risk"]
    resp = await client.post(
        _api(risk),
        json={
            "title": "Annual re-attest",
            "owner_id": str(env["member"].id),
            "due_date": far_future,
            "recurrence_unit": "years",
            "recurrence_interval": 1,
            "lead_time_days": 14,
        },
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    occ = body["occurrences"][0]
    assert occ["status"] == "scheduled"
    assert occ["activated_at"] is None

    # No Todo on the assignee — the cycle is dormant.
    todos = (
        (
            await db.execute(
                select(Todo).where(
                    Todo.is_system.is_(True),
                    Todo.assigned_to == env["member"].id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert todos == []


async def test_zero_lead_time_with_due_today_lands_as_open(client, db, env):
    from datetime import date

    risk = env["risk"]
    resp = await client.post(
        _api(risk),
        json={
            "title": "Due now",
            "owner_id": str(env["admin"].id),
            "due_date": date.today().isoformat(),
            "lead_time_days": 0,
        },
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    occ = resp.json()["occurrences"][0]
    assert occ["status"] == "open"


async def test_complete_recurring_when_next_cycle_outside_window_yields_scheduled(client, db, env):
    """The roll-forward applies the same lead-time gate as initial create.

    Complete a cycle whose next due date is six months out with a 7-day
    lead → next cycle lands as ``scheduled``, no Todo created.
    """
    from datetime import date, timedelta

    soon = (date.today() + timedelta(days=2)).isoformat()
    risk = env["risk"]
    create = await client.post(
        _api(risk),
        json={
            "title": "Quarterly review",
            "owner_id": str(env["admin"].id),
            "due_date": soon,
            "recurrence_unit": "months",
            "recurrence_interval": 6,
            "lead_time_days": 7,
        },
        headers=auth_headers(env["admin"]),
    )
    task = create.json()
    first = task["occurrences"][0]
    # The first cycle is within the 7-day window (due in 2 days), so it
    # opened normally — confirm the precondition before completing.
    assert first["status"] == "open"

    resp = await client.post(
        f"/api/v1/mitigation-tasks/{task['id']}/occurrences/{first['id']}/complete",
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    by_seq = sorted(body["occurrences"], key=lambda o: o["sequence"])
    # Cycle 2 is now ~6 months out, well outside the 7-day window.
    assert by_seq[1]["status"] == "scheduled"
    assert by_seq[1]["activated_at"] is None

    # Exactly one Todo survives: the closed cycle's row, kept as
    # status="done" so the assignee's Done tab shows it. The scheduled
    # cycle owns no Todo (cycle is dormant until the lead window opens).
    todos = (await db.execute(select(Todo).where(Todo.is_system.is_(True)))).scalars().all()
    assert len(todos) == 1
    assert todos[0].status == "done"


async def test_cannot_complete_scheduled_occurrence(client, db, env):
    """Scheduled cycles must be activated first — the error message is
    clearer than the generic "already {status}" the other terminals get.
    """
    from datetime import date, timedelta

    far = (date.today() + timedelta(days=180)).isoformat()
    risk = env["risk"]
    create = await client.post(
        _api(risk),
        json={
            "title": "Far future task",
            "owner_id": str(env["admin"].id),
            "due_date": far,
            "recurrence_unit": "years",
            "recurrence_interval": 1,
            "lead_time_days": 14,
        },
        headers=auth_headers(env["admin"]),
    )
    task = create.json()
    occ = task["occurrences"][0]
    assert occ["status"] == "scheduled"

    resp = await client.post(
        f"/api/v1/mitigation-tasks/{task['id']}/occurrences/{occ['id']}/complete",
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 409
    assert "activate" in resp.json()["detail"].lower()


async def test_promote_endpoint_flips_scheduled_to_open(client, db, env):
    """Manual ``Activate now`` short-circuits the daily promotion loop."""
    from datetime import date, timedelta

    far = (date.today() + timedelta(days=180)).isoformat()
    risk = env["risk"]
    create = await client.post(
        _api(risk),
        json={
            "title": "Annual re-attest",
            "owner_id": str(env["member"].id),
            "due_date": far,
            "recurrence_unit": "years",
            "recurrence_interval": 1,
            "lead_time_days": 14,
        },
        headers=auth_headers(env["admin"]),
    )
    task = create.json()
    occ = task["occurrences"][0]
    assert occ["status"] == "scheduled"

    resp = await client.post(
        f"/api/v1/mitigation-tasks/{task['id']}/occurrences/{occ['id']}/promote",
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    activated = body["occurrences"][0]
    assert activated["status"] == "open"
    assert activated["activated_at"] is not None

    # Todo now lands on the assignee (member, not admin).
    todos = (
        (
            await db.execute(
                select(Todo).where(
                    Todo.is_system.is_(True),
                    Todo.assigned_to == env["member"].id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(todos) == 1


async def test_promote_endpoint_requires_manage_permission(client, db, env):
    from datetime import date, timedelta

    far = (date.today() + timedelta(days=180)).isoformat()
    risk = env["risk"]
    create = await client.post(
        _api(risk),
        json={
            "title": "Annual re-attest",
            "owner_id": str(env["viewer"].id),
            "due_date": far,
            "recurrence_unit": "years",
            "recurrence_interval": 1,
            "lead_time_days": 14,
        },
        headers=auth_headers(env["admin"]),
    )
    task = create.json()
    occ = task["occurrences"][0]
    # The viewer is the assignee but still can't promote — promotion
    # is a planning action, not a closure action like complete.
    resp = await client.post(
        f"/api/v1/mitigation-tasks/{task['id']}/occurrences/{occ['id']}/promote",
        headers=auth_headers(env["viewer"]),
    )
    assert resp.status_code == 403


async def test_promote_is_idempotent_on_already_open_occurrence(client, db, env):
    """Double-clicking ``Activate now`` must not double-fire side effects."""
    risk = env["risk"]
    create = await client.post(
        _api(risk),
        json={"title": "Already open", "owner_id": str(env["admin"].id)},
        headers=auth_headers(env["admin"]),
    )
    task = create.json()
    occ = task["occurrences"][0]
    assert occ["status"] == "open"

    resp = await client.post(
        f"/api/v1/mitigation-tasks/{task['id']}/occurrences/{occ['id']}/promote",
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    occ_after = resp.json()["occurrences"][0]
    assert occ_after["status"] == "open"
    # activated_at stays NULL — the cycle was never gated.
    assert occ_after["activated_at"] is None


async def test_shortening_lead_time_promotes_scheduled_cycle_immediately(client, db, env):
    """PATCH that widens the window should not require waiting for the daily loop."""
    from datetime import date, timedelta

    # Due in 20 days, 7-day lead → outside window today.
    near = (date.today() + timedelta(days=20)).isoformat()
    risk = env["risk"]
    create = await client.post(
        _api(risk),
        json={
            "title": "Quarterly review",
            "owner_id": str(env["admin"].id),
            "due_date": near,
            "recurrence_unit": "months",
            "recurrence_interval": 3,
            "lead_time_days": 7,
        },
        headers=auth_headers(env["admin"]),
    )
    task = create.json()
    occ = task["occurrences"][0]
    assert occ["status"] == "scheduled"

    # Bump lead time to 30 days — now today >= due - 30 → in window.
    patch = await client.patch(
        f"/api/v1/mitigation-tasks/{task['id']}",
        json={"lead_time_days": 30},
        headers=auth_headers(env["admin"]),
    )
    assert patch.status_code == 200
    promoted = patch.json()["occurrences"][0]
    assert promoted["status"] == "open"
    assert promoted["activated_at"] is not None


async def test_background_promotion_lifts_eligible_scheduled_cycles(client, db, env):
    """``promote_scheduled_occurrences`` is what the daily loop calls."""
    from datetime import date, timedelta

    from app.services.risk_mitigation_task_service import promote_scheduled_occurrences

    risk = env["risk"]
    create = await client.post(
        _api(risk),
        json={
            "title": "Annual re-attest",
            "owner_id": str(env["member"].id),
            "due_date": (date.today() + timedelta(days=180)).isoformat(),
            "recurrence_unit": "years",
            "recurrence_interval": 1,
            "lead_time_days": 14,
        },
        headers=auth_headers(env["admin"]),
    )
    task_id = create.json()["id"]

    # Simulate the daily loop running on a future day inside the window.
    future_today = date.today() + timedelta(days=170)
    promoted = await promote_scheduled_occurrences(db, today=future_today)
    await db.commit()
    assert promoted == 1

    # Re-fetch — the cycle is now open and carries activated_at.
    refreshed = await client.get(_api(risk), headers=auth_headers(env["admin"]))
    body = refreshed.json()
    occ = next(t for t in body if t["id"] == task_id)["occurrences"][0]
    assert occ["status"] == "open"
    assert occ["activated_at"] is not None

    # The promotion creates the assignee's Todo.
    todos = (
        (
            await db.execute(
                select(Todo).where(
                    Todo.is_system.is_(True),
                    Todo.assigned_to == env["member"].id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(todos) == 1


async def test_background_promotion_skips_cycles_outside_window(client, db, env):
    """A daily run that fires before any cycle's window has opened is a no-op."""
    from datetime import date, timedelta

    from app.services.risk_mitigation_task_service import promote_scheduled_occurrences

    risk = env["risk"]
    await client.post(
        _api(risk),
        json={
            "title": "Annual re-attest",
            "owner_id": str(env["member"].id),
            "due_date": (date.today() + timedelta(days=365)).isoformat(),
            "recurrence_unit": "years",
            "recurrence_interval": 1,
            "lead_time_days": 14,
        },
        headers=auth_headers(env["admin"]),
    )
    promoted = await promote_scheduled_occurrences(db, today=date.today())
    await db.commit()
    assert promoted == 0


async def test_risk_delete_cascades_to_mitigation_tasks(client, db, env):
    risk = env["risk"]
    create = await client.post(
        _api(risk),
        json={"title": "Will be cascaded", "owner_id": str(env["admin"].id)},
        headers=auth_headers(env["admin"]),
    )
    task_id = create.json()["id"]
    resp = await client.delete(
        f"/api/v1/risks/{risk.id}",
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200
    remaining = (
        await db.execute(select(RiskMitigationTask).where(RiskMitigationTask.id == task_id))
    ).scalar_one_or_none()
    assert remaining is None
