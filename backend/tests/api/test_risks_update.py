"""``PATCH /risks/{id}`` and ``DELETE /risks/{id}``: scalar edits and the
derived levels, the owner → system Todo → notification loop, every
status transition the register allows (and one it does not), acceptance,
the closed-risk read-only rule, the status-change notification and the
back-propagation to a promoted compliance finding.

``_notify_status_change`` runs as a background task that opens its own
session; ``patched_async_session`` points it at the test's, so the
notification row is there when the request returns.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.event import Event
from app.models.notification import Notification
from app.models.todo import Todo
from app.services.risk_service import _ALLOWED_TRANSITIONS, derive_level, link_cards
from tests.conftest import (
    auth_headers,
    create_analysis_run,
    create_card,
    create_compliance_finding,
    create_risk,
    create_role,
    create_user,
)

RISKS = "/api/v1/risks"


@pytest.fixture
async def env(db, patched_async_session):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin", display_name="Ada")
    owner = await create_user(db, email="owner@test.com", role="member", display_name="Olivia")
    other = await create_user(db, email="other@test.com", role="member", display_name="Omar")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "owner": owner, "other": other, "viewer": viewer}


async def _patch(client, user, risk_id, body):
    return await client.patch(f"{RISKS}/{risk_id}", json=body, headers=auth_headers(user))


async def _todos(db, risk):
    rows = (
        await db.execute(
            select(Todo).where(
                Todo.link == f"/ea-delivery/risks/{risk.id}", Todo.is_system.is_(True)
            )
        )
    ).scalars()
    return list(rows)


async def _notifications(db, user, notif_type):
    rows = (
        await db.execute(
            select(Notification).where(
                Notification.user_id == user.id, Notification.type == notif_type
            )
        )
    ).scalars()
    return list(rows)


class TestScalarEdits:
    async def test_probability_and_impact_recompute_both_levels(self, client, db, env):
        risk = await create_risk(db, title="R")
        resp = await _patch(
            client,
            env["admin"],
            risk.id,
            {
                "initial_probability": "very_high",
                "initial_impact": "critical",
                "residual_probability": "low",
                "residual_impact": "low",
                "title": "Renamed",
                "description": "d",
                "category": "security",
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["initial_level"] == derive_level("very_high", "critical")
        assert body["residual_level"] == derive_level("low", "low")
        assert body["title"] == "Renamed" and body["category"] == "security"

    async def test_clearing_the_residual_assessment_clears_its_level(self, client, db, env):
        risk = await create_risk(db, title="R", residual_probability="low", residual_impact="low")
        assert risk.residual_level is not None
        body = (await _patch(client, env["admin"], risk.id, {"residual_probability": None})).json()
        assert body["residual_probability"] is None and body["residual_level"] is None

    async def test_malformed_and_unknown_ids(self, client, db, env):
        assert (await _patch(client, env["admin"], "not-a-uuid", {"title": "x"})).status_code == 400
        assert (await _patch(client, env["admin"], uuid.uuid4(), {"title": "x"})).status_code == 404

    async def test_viewer_cannot_edit(self, client, db, env):
        risk = await create_risk(db, title="R")
        assert (await _patch(client, env["viewer"], risk.id, {"title": "x"})).status_code == 403

    async def test_an_edit_on_a_linked_risk_is_recorded_on_the_card(self, client, db, env):
        card = await create_card(db, card_type="Application", name="Billing")
        risk = await create_risk(db, title="Old")
        await link_cards(db, risk.id, [card.id])

        await _patch(client, env["admin"], risk.id, {"title": "New", "description": "why"})

        events = (
            (
                await db.execute(
                    select(Event).where(
                        Event.card_id == card.id, Event.event_type == "risk.updated"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(events) == 1
        payload = events[0].data
        assert payload["fields"] == ["description", "title"]
        assert payload["changes"]["title"] == {"old": "Old", "new": "New"}
        assert payload["reference"] == risk.reference and payload["summary"]


class TestOwner:
    async def test_assigning_an_owner_creates_the_todo_and_notifies(self, client, db, env):
        risk = await create_risk(db, title="Patch the firewall")
        resp = await _patch(client, env["admin"], risk.id, {"owner_id": str(env["owner"].id)})
        assert resp.status_code == 200
        assert resp.json()["owner_name"] == "Olivia"

        (todo,) = await _todos(db, risk)
        assert todo.assigned_to == env["owner"].id and todo.status == "open"
        assert todo.description == f"[Risk {risk.reference}] Patch the firewall"
        assert todo.created_by == env["admin"].id
        (note,) = await _notifications(db, env["owner"], "risk_assigned")
        assert note.title == f"Risk {risk.reference} assigned to you"
        assert note.data["reference"] == risk.reference

    async def test_changing_the_owner_moves_the_single_todo(self, client, db, env):
        risk = await create_risk(db, title="R")
        await _patch(client, env["admin"], risk.id, {"owner_id": str(env["owner"].id)})
        await _patch(client, env["admin"], risk.id, {"owner_id": str(env["other"].id)})

        (todo,) = await _todos(db, risk)
        assert todo.assigned_to == env["other"].id
        assert len(await _notifications(db, env["other"], "risk_assigned")) == 1

    async def test_an_unrelated_edit_does_not_notify_the_owner_again(self, client, db, env):
        risk = await create_risk(db, title="R")
        await _patch(client, env["admin"], risk.id, {"owner_id": str(env["owner"].id)})
        due = date.today() + timedelta(days=30)
        await _patch(client, env["admin"], risk.id, {"target_resolution_date": due.isoformat()})

        (todo,) = await _todos(db, risk)
        assert todo.due_date == due
        assert len(await _notifications(db, env["owner"], "risk_assigned")) == 1

    async def test_clearing_the_owner_removes_the_todo_silently(self, client, db, env):
        risk = await create_risk(db, title="R")
        await _patch(client, env["admin"], risk.id, {"owner_id": str(env["owner"].id)})
        resp = await _patch(client, env["admin"], risk.id, {"owner_id": None})
        assert resp.json()["owner_id"] is None
        assert await _todos(db, risk) == []
        assert len(await _notifications(db, env["owner"], "risk_assigned")) == 1

    async def test_a_malformed_owner_id_is_400(self, client, db, env):
        risk = await create_risk(db, title="R")
        resp = await _patch(client, env["admin"], risk.id, {"owner_id": "nobody"})
        assert resp.status_code == 400 and resp.json()["detail"] == "Invalid owner_id"

    async def test_the_todo_closes_when_the_risk_is_mitigated(self, client, db, env):
        risk = await create_risk(db, title="R", status="in_progress", owner_id=env["owner"].id)
        await _patch(client, env["admin"], risk.id, {"title": "seed the todo"})
        await _patch(client, env["admin"], risk.id, {"status": "mitigated"})
        (todo,) = await _todos(db, risk)
        assert todo.status == "done"


_LEGAL = sorted(
    (current, new) for current, targets in _ALLOWED_TRANSITIONS.items() for new in targets
)


class TestTransitions:
    @pytest.mark.parametrize("current,new", _LEGAL, ids=[f"{c}->{n}" for c, n in _LEGAL])
    async def test_every_allowed_transition(self, client, db, env, current, new):
        risk = await create_risk(
            db, title="R", status=current, acceptance_rationale="Residual cost is acceptable."
        )
        resp = await _patch(client, env["admin"], risk.id, {"status": new})
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == new

    async def test_an_illegal_transition_is_400(self, client, db, env):
        risk = await create_risk(db, title="R", status="identified")
        resp = await _patch(client, env["admin"], risk.id, {"status": "closed"})
        assert resp.status_code == 400
        assert "Illegal status transition: identified → closed" in resp.json()["detail"]

    async def test_restating_the_current_status_is_a_no_op(self, client, db, env):
        risk = await create_risk(db, title="R", status="analysed")
        resp = await _patch(client, env["admin"], risk.id, {"status": "analysed"})
        assert resp.status_code == 200 and resp.json()["status"] == "analysed"

    async def test_accepting_needs_a_rationale(self, client, db, env):
        risk = await create_risk(db, title="R")
        resp = await _patch(client, env["admin"], risk.id, {"status": "accepted"})
        assert resp.status_code == 400
        assert "acceptance_rationale is required" in resp.json()["detail"]
        resp = await _patch(
            client, env["admin"], risk.id, {"status": "accepted", "acceptance_rationale": "   "}
        )
        assert resp.status_code == 400

    async def test_accepting_records_who_and_when(self, client, db, env):
        risk = await create_risk(db, title="R")
        resp = await _patch(
            client,
            env["admin"],
            risk.id,
            {"status": "accepted", "acceptance_rationale": "Cheaper than the control."},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "accepted"
        assert body["accepted_by"] == str(env["admin"].id) and body["accepted_at"]

    async def test_reopening_an_accepted_risk_clears_the_attribution(self, client, db, env):
        risk = await create_risk(db, title="R", acceptance_rationale="ok")
        await _patch(client, env["admin"], risk.id, {"status": "accepted"})
        body = (await _patch(client, env["admin"], risk.id, {"status": "in_progress"})).json()
        assert body["status"] == "in_progress"
        assert body["accepted_by"] is None and body["accepted_at"] is None


class TestClosedRisks:
    async def test_fields_are_read_only_and_the_refusal_names_them(self, client, db, env):
        risk = await create_risk(db, title="R", status="closed")
        resp = await _patch(client, env["admin"], risk.id, {"title": "x", "category": "security"})
        assert resp.status_code == 409
        assert "['category', 'title']" in resp.json()["detail"]

    async def test_only_the_reopen_transition_is_accepted(self, client, db, env):
        risk = await create_risk(db, title="R", status="closed")
        resp = await _patch(client, env["admin"], risk.id, {"status": "analysed"})
        assert resp.status_code == 409 and "only be reopened" in resp.json()["detail"]
        resp = await _patch(client, env["admin"], risk.id, {"status": "in_progress"})
        assert resp.status_code == 200 and resp.json()["status"] == "in_progress"


class TestStatusChangeNotification:
    async def test_the_owner_is_told_when_someone_else_moves_the_risk(self, client, db, env):
        risk = await create_risk(db, title="Rotate keys", owner_id=env["owner"].id)
        resp = await _patch(client, env["admin"], risk.id, {"status": "analysed"})
        assert resp.status_code == 200
        (note,) = await _notifications(db, env["owner"], "risk_status_changed")
        assert note.title == f"Risk {risk.reference} moved to analysed"
        assert note.message == "Rotate keys" and note.actor_id == env["admin"].id
        assert note.data == {"risk_id": str(risk.id), "status": "analysed"}

    async def test_the_owner_moving_it_themselves_is_not_notified(self, client, db, env):
        risk = await create_risk(db, title="R", owner_id=env["owner"].id)
        await _patch(client, env["owner"], risk.id, {"status": "analysed"})
        assert await _notifications(db, env["owner"], "risk_status_changed") == []


class TestLinkedFinding:
    async def _promoted(self, db, env, status="in_progress"):
        risk = await create_risk(db, title="R", status=status, source_type="compliance")
        run = await create_analysis_run(db, user_id=env["admin"].id)
        finding = await create_compliance_finding(
            db, run.id, risk_id=risk.id, decision="risk_tracked"
        )
        return risk, finding

    async def test_mitigating_the_risk_mitigates_the_finding(self, client, db, env):
        risk, finding = await self._promoted(db, env)
        await _patch(client, env["admin"], risk.id, {"status": "mitigated"})
        await db.refresh(finding)
        assert finding.decision == "mitigated"
        assert "Auto-mitigated" in finding.review_note and risk.reference in finding.review_note
        assert finding.reviewed_by == env["admin"].id

    async def test_deleting_the_risk_reopens_the_finding_and_removes_the_todo(
        self, client, db, env
    ):
        risk, finding = await self._promoted(db, env, status="identified")
        await _patch(client, env["admin"], risk.id, {"owner_id": str(env["owner"].id)})
        assert len(await _todos(db, risk)) == 1

        resp = await client.delete(f"{RISKS}/{risk.id}", headers=auth_headers(env["admin"]))
        assert resp.status_code == 200 and resp.json() == {"ok": True}

        await db.refresh(finding)
        assert finding.decision == "in_review" and finding.risk_id is None
        assert "was deleted" in finding.review_note
        assert await _todos(db, risk) == []
        assert (
            await client.get(f"{RISKS}/{risk.id}", headers=auth_headers(env["admin"]))
        ).status_code == 404

    async def test_delete_of_an_unknown_risk_is_404(self, client, db, env):
        resp = await client.delete(f"{RISKS}/{uuid.uuid4()}", headers=auth_headers(env["admin"]))
        assert resp.status_code == 404


class TestSourceType:
    async def test_an_extension_filed_risk_keeps_its_source(self, client, db, env):
        risk = await create_risk(db, title="R", source_type="extension", source_ref="acme:42")
        body = (await client.get(f"{RISKS}/{risk.id}", headers=auth_headers(env["admin"]))).json()
        assert body["source_type"] == "extension" and body["source_ref"] == "acme:42"

    async def test_a_retired_source_value_reads_as_manual(self, client, db, env):
        risk = await create_risk(db, title="R", source_type="ppm")
        body = (await client.get(f"{RISKS}/{risk.id}", headers=auth_headers(env["admin"]))).json()
        assert body["source_type"] == "manual"
