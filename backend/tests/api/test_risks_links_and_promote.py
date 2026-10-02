"""Card linking on a risk and promotion of a compliance finding.

``POST /risks/{id}/cards`` and ``DELETE /risks/{id}/cards/{card_id}`` are
idempotent and silent on a no-op; a hidden card (per-type View deny) is a
404, a closed risk a 409. ``POST /risks/promote/compliance/{finding_id}``
seeds the risk from the finding, links its card, writes the back-link on
the finding, spawns a mitigation task from the remediation text and
returns the same risk on a second call.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.card_type import CardType
from app.models.event import Event
from app.models.risk import Risk, RiskCard
from app.models.risk_mitigation_task import RiskMitigationTask
from app.models.todo import Todo
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_analysis_run,
    create_card,
    create_card_type,
    create_compliance_finding,
    create_risk,
    create_role,
    create_user,
)

RISKS = "/api/v1/risks"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_role(
        db,
        key="riskonly",
        label="Risk only",
        permissions={
            **VIEWER_PERMISSIONS,
            "risks.view": True,
            "risks.manage": True,
            "compliance.view": False,
        },
        is_system=False,
    )
    admin = await create_user(db, email="admin@test.com", role="admin", display_name="Ada")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    riskonly = await create_user(db, email="riskonly@test.com", role="riskonly")
    await create_card_type(db, key="Application", label="Application")
    app_a = await create_card(db, card_type="Application", name="Billing", user_id=admin.id)
    app_b = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
    return {
        "admin": admin,
        "member": member,
        "viewer": viewer,
        "riskonly": riskonly,
        "app_a": app_a,
        "app_b": app_b,
    }


async def _events(db, card, event_type):
    rows = (
        await db.execute(
            select(Event).where(Event.card_id == card.id, Event.event_type == event_type)
        )
    ).scalars()
    return list(rows)


async def _links(db, risk) -> set:
    rows = (await db.execute(select(RiskCard.card_id).where(RiskCard.risk_id == risk.id))).all()
    return {cid for (cid,) in rows}


class TestLink:
    async def test_linking_adds_the_cards_and_records_an_event_on_each(self, client, db, env):
        risk = await create_risk(db, title="R")
        resp = await client.post(
            f"{RISKS}/{risk.id}/cards",
            json={"card_ids": [str(env["app_a"].id), str(env["app_b"].id)], "role": "affected"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        assert {c["card_name"] for c in resp.json()["cards"]} == {"Billing", "CRM"}
        assert await _links(db, risk) == {env["app_a"].id, env["app_b"].id}
        (event,) = await _events(db, env["app_a"], "risk.added")
        assert event.data["risk_id"] == str(risk.id) and event.user_id == env["admin"].id

    async def test_relinking_is_idempotent_and_silent(self, client, db, env):
        risk = await create_risk(db, title="R")
        body = {"card_ids": [str(env["app_a"].id)]}
        await client.post(f"{RISKS}/{risk.id}/cards", json=body, headers=auth_headers(env["admin"]))
        resp = await client.post(
            f"{RISKS}/{risk.id}/cards", json=body, headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 200
        assert await _links(db, risk) == {env["app_a"].id}
        assert len(await _events(db, env["app_a"], "risk.added")) == 1

    async def test_malformed_ids_are_skipped_not_refused(self, client, db, env):
        risk = await create_risk(db, title="R")
        resp = await client.post(
            f"{RISKS}/{risk.id}/cards",
            json={"card_ids": ["stale-id", str(env["app_b"].id)]},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        assert await _links(db, risk) == {env["app_b"].id}

    async def test_a_closed_risk_refuses_links(self, client, db, env):
        risk = await create_risk(db, title="R", status="closed")
        resp = await client.post(
            f"{RISKS}/{risk.id}/cards",
            json={"card_ids": [str(env["app_a"].id)]},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 409

    async def test_a_card_the_caller_cannot_see_is_404(self, client, db, env):
        ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
        ct.role_permissions = {"member": {"inventory.view": False}}
        await db.flush()
        PermissionService.invalidate_type_permission_cache()
        risk = await create_risk(db, title="R")
        resp = await client.post(
            f"{RISKS}/{risk.id}/cards",
            json={"card_ids": [str(env["app_a"].id)]},
            headers=auth_headers(env["member"]),
        )
        assert resp.status_code == 404
        assert await _links(db, risk) == set()

    async def test_viewer_cannot_link(self, client, db, env):
        risk = await create_risk(db, title="R")
        resp = await client.post(
            f"{RISKS}/{risk.id}/cards",
            json={"card_ids": [str(env["app_a"].id)]},
            headers=auth_headers(env["viewer"]),
        )
        assert resp.status_code == 403


class TestUnlink:
    async def _linked(self, client, db, env):
        risk = await create_risk(db, title="R")
        await client.post(
            f"{RISKS}/{risk.id}/cards",
            json={"card_ids": [str(env["app_a"].id), str(env["app_b"].id)]},
            headers=auth_headers(env["admin"]),
        )
        return risk

    async def test_unlinking_removes_the_card_and_records_it(self, client, db, env):
        risk = await self._linked(client, db, env)
        resp = await client.delete(
            f"{RISKS}/{risk.id}/cards/{env['app_a'].id}", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 200
        assert {c["card_name"] for c in resp.json()["cards"]} == {"CRM"}
        assert await _links(db, risk) == {env["app_b"].id}
        assert len(await _events(db, env["app_a"], "risk.removed")) == 1

    async def test_unlinking_twice_is_silent(self, client, db, env):
        risk = await self._linked(client, db, env)
        for _ in range(2):
            resp = await client.delete(
                f"{RISKS}/{risk.id}/cards/{env['app_a'].id}", headers=auth_headers(env["admin"])
            )
            assert resp.status_code == 200
        assert len(await _events(db, env["app_a"], "risk.removed")) == 1

    async def test_malformed_card_id_is_400(self, client, db, env):
        risk = await create_risk(db, title="R")
        resp = await client.delete(
            f"{RISKS}/{risk.id}/cards/nope", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 400

    async def test_a_closed_risk_refuses_unlinks(self, client, db, env):
        risk = await self._linked(client, db, env)
        risk.status = "closed"
        await db.flush()
        resp = await client.delete(
            f"{RISKS}/{risk.id}/cards/{env['app_a'].id}", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 409


@pytest.fixture
async def finding(db, env):
    run = await create_analysis_run(db, user_id=env["admin"].id)
    return await create_compliance_finding(
        db,
        run.id,
        card_id=env["app_a"].id,
        regulation="gdpr",
        regulation_article="Art. 35",
        status="non_compliant",
        severity="critical",
        requirement="A DPIA is required.",
        gap_description="No DPIA on file.",
        remediation="Run and document a DPIA.",
    )


async def _promote(client, user, finding_id, body=None):
    return await client.post(
        f"{RISKS}/promote/compliance/{finding_id}", json=body, headers=auth_headers(user)
    )


class TestPromote:
    async def test_the_finding_becomes_a_risk_with_a_task_and_a_back_link(
        self, client, db, env, finding
    ):
        resp = await _promote(client, env["admin"], finding.id)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["title"] == "Art. 35: Billing"
        assert body["description"] == "A DPIA is required.\n\nNo DPIA on file."
        assert body["category"] == "compliance" and body["source_type"] == "compliance"
        assert body["source_ref"] == "gdpr" and body["status"] == "identified"
        assert body["initial_probability"] == "high"  # non_compliant escalates
        assert body["initial_impact"] == "critical"  # severity carries over
        assert [c["card_name"] for c in body["cards"]] == ["Billing"]

        await db.refresh(finding)
        assert finding.risk_id == uuid.UUID(body["id"])
        assert finding.decision == "risk_tracked" and finding.reviewed_by == env["admin"].id

        (task,) = (
            (
                await db.execute(
                    select(RiskMitigationTask).where(
                        RiskMitigationTask.risk_id == uuid.UUID(body["id"])
                    )
                )
            )
            .scalars()
            .all()
        )
        assert task.title == "Remediate: Art. 35"
        assert task.description == "Run and document a DPIA."
        assert task.recurrence_unit == "none"

        (event,) = await _events(db, env["app_a"], "risk.added")
        assert event.data["promoted_from"] == "compliance"

    async def test_promoting_again_returns_the_same_risk(self, client, db, env, finding):
        first = (await _promote(client, env["admin"], finding.id)).json()
        second = (await _promote(client, env["admin"], finding.id)).json()
        assert second["id"] == first["id"]
        assert (await db.execute(select(Risk))).scalars().all().__len__() == 1

    async def test_a_landscape_finding_is_titled_landscape(self, client, db, env):
        run = await create_analysis_run(db, user_id=env["admin"].id)
        f = await create_compliance_finding(
            db, run.id, regulation_article="Art. 35", status="partial", severity="low"
        )
        body = (await _promote(client, env["admin"], f.id)).json()
        assert body["title"] == "Art. 35: landscape" and body["cards"] == []
        assert body["initial_probability"] == "medium" and body["initial_impact"] == "low"

    async def test_without_an_article_the_regulation_names_it(self, client, db, env):
        run = await create_analysis_run(db, user_id=env["admin"].id)
        f = await create_compliance_finding(db, run.id, regulation_article="", remediation=None)
        body = (await _promote(client, env["admin"], f.id)).json()
        assert body["title"] == "GDPR: landscape"
        assert (
            await db.execute(
                select(RiskMitigationTask).where(
                    RiskMitigationTask.risk_id == uuid.UUID(body["id"])
                )
            )
        ).scalars().all() == []

    async def test_overrides_take_precedence_and_reach_the_task(self, client, db, env, finding):
        due = date.today() + timedelta(days=14)
        member = env["member"]
        resp = await _promote(
            client,
            env["admin"],
            finding.id,
            {
                "title": "Custom title",
                "description": "Custom description",
                "category": "security",
                "initial_probability": "low",
                "initial_impact": "medium",
                "owner_id": str(member.id),
                "target_resolution_date": due.isoformat(),
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["title"] == "Custom title" and body["description"] == "Custom description"
        assert body["category"] == "security"
        assert body["initial_probability"] == "low" and body["initial_impact"] == "medium"
        assert body["owner_id"] == str(member.id)
        assert body["target_resolution_date"] == due.isoformat()

        (task,) = (
            (
                await db.execute(
                    select(RiskMitigationTask).where(
                        RiskMitigationTask.risk_id == uuid.UUID(body["id"])
                    )
                )
            )
            .scalars()
            .all()
        )
        assert task.owner_id == member.id
        # The owner also got the risk's own system todo.
        todo = (
            await db.execute(
                select(Todo).where(
                    Todo.link == f"/ea-delivery/risks/{body['id']}", Todo.is_system.is_(True)
                )
            )
        ).scalar_one()
        assert todo.assigned_to == member.id and todo.due_date == due

    async def test_a_malformed_owner_override_is_400(self, client, db, env, finding):
        resp = await _promote(client, env["admin"], finding.id, {"owner_id": "nobody"})
        assert resp.status_code == 400 and resp.json()["detail"] == "Invalid owner_id"

    async def test_malformed_and_unknown_finding_ids(self, client, db, env):
        assert (await _promote(client, env["admin"], "nope")).status_code == 400
        assert (await _promote(client, env["admin"], uuid.uuid4())).status_code == 404

    async def test_needs_both_permissions(self, client, db, env, finding):
        assert (await _promote(client, env["viewer"], finding.id)).status_code == 403
        # risks.manage without compliance.view is still refused.
        assert (await _promote(client, env["riskonly"], finding.id)).status_code == 403


class TestCardRisks:
    async def test_malformed_card_id_is_400(self, client, db, env):
        resp = await client.get("/api/v1/cards/nope/risks", headers=auth_headers(env["admin"]))
        assert resp.status_code == 400

    async def test_lists_the_risks_linked_to_the_card(self, client, db, env):
        risk = await create_risk(db, title="Linked")
        await create_risk(db, title="Unlinked")
        await client.post(
            f"{RISKS}/{risk.id}/cards",
            json={"card_ids": [str(env["app_a"].id)]},
            headers=auth_headers(env["admin"]),
        )
        resp = await client.get(
            f"/api/v1/cards/{env['app_a'].id}/risks", headers=auth_headers(env["member"])
        )
        assert resp.status_code == 200
        assert [r["title"] for r in resp.json()] == ["Linked"]
