"""The compliance-finding routes the GRC grid and the Card Detail
Compliance tab call: the per-regulation bundle, manual creation, the
lifecycle decision, single delete, the AI verdict on a card and the
per-card list — with the card read scope applied where a finding names
a card, and the ``compliance.manage`` denial on every write."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.permissions import ALL_APP_PERMISSION_KEYS
from app.models.card import Card
from app.models.compliance_regulation import ComplianceRegulation
from app.models.event import Event
from app.models.turbolens import TurboLensComplianceFinding
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

API = "/api/v1/compliance"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions={"compliance.view": True})
    await create_role(db, key="nobody", label="Nobody", permissions={})
    everything = {k: True for k in ALL_APP_PERMISSION_KEYS if not k.startswith("admin.")}
    await create_role(db, key="restricted", label="Restricted", permissions=everything)
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(
        db,
        key="Secret",
        label="Secret",
        role_permissions={"restricted": {"inventory.view": False}},
    )
    PermissionService.invalidate_type_permission_cache()
    db.add_all(
        [
            ComplianceRegulation(key="gdpr", label="GDPR", is_enabled=True, sort_order=2),
            ComplianceRegulation(key="nis2", label="NIS2", is_enabled=True, sort_order=1),
            ComplianceRegulation(key="dora", label="DORA", is_enabled=False, sort_order=3),
            ComplianceRegulation(key="soc2", label="SOC 2", is_enabled=False, sort_order=4),
        ]
    )
    users = {
        role: await create_user(db, email=f"{role}@cf.test", role=role, display_name=role.title())
        for role in ("admin", "viewer", "nobody", "restricted")
    }
    app = await create_card(
        db, card_type="Application", name="App A", attributes={"hasAiFeatures": "yes"}
    )
    secret = await create_card(db, card_type="Secret", name="Secret One")
    run = await create_analysis_run(db, analysis_type="compliance", status="completed")
    await db.flush()
    return {**users, "app": app, "secret": secret, "run": run}


# ── GET /compliance ───────────────────────────────────────────────────────


class TestListCompliance:
    async def test_bundles_in_catalogue_order_with_orphans_last(self, db, client, env):
        run = env["run"]
        await create_compliance_finding(db, run.id, regulation="gdpr", status="non_compliant")
        stale = await create_compliance_finding(db, run.id, regulation="gdpr", status="compliant")
        stale.auto_resolved = True
        await create_compliance_finding(db, run.id, regulation="dora", status="partial")
        await create_compliance_finding(db, run.id, regulation="zzz", status="compliant")

        resp = await client.get(f"{API}/compliance", headers=auth_headers(env["viewer"]))
        assert resp.status_code == 200, resp.text
        bundles = {b["regulation"]: b for b in resp.json()}
        # Enabled regulations always; a disabled one only while it carries
        # findings (DORA yes, SOC 2 no); an unknown key renders last.
        assert [b["regulation"] for b in resp.json()] == ["nis2", "gdpr", "dora", "zzz"]
        assert bundles["nis2"] == {
            "regulation": "nis2",
            "label": "NIS2",
            "is_enabled": True,
            "is_known": True,
            "score": 100,
            "findings": [],
        }
        assert bundles["gdpr"]["score"] == 0 and len(bundles["gdpr"]["findings"]) == 1
        assert bundles["dora"]["is_enabled"] is False and bundles["dora"]["score"] == 50
        assert bundles["zzz"]["label"] == "zzz" and bundles["zzz"]["is_known"] is False

    async def test_filters_and_auto_resolved_opt_in(self, db, client, env):
        run = env["run"]
        await create_compliance_finding(db, run.id, regulation="gdpr", status="non_compliant")
        hidden = await create_compliance_finding(db, run.id, regulation="gdpr", status="compliant")
        hidden.auto_resolved = True
        await db.flush()
        headers = auth_headers(env["viewer"])

        resp = await client.get(f"{API}/compliance?regulation=gdpr", headers=headers)
        assert [b["regulation"] for b in resp.json()] == ["gdpr"]
        assert len(resp.json()[0]["findings"]) == 1

        resp = await client.get(
            f"{API}/compliance?regulation=gdpr&include_auto_resolved=true", headers=headers
        )
        ids = {f["id"] for f in resp.json()[0]["findings"]}
        assert str(hidden.id) in ids and len(ids) == 2

        resp = await client.get(
            f"{API}/compliance?regulation=gdpr&status=compliant&include_auto_resolved=true",
            headers=headers,
        )
        assert [f["id"] for f in resp.json()[0]["findings"]] == [str(hidden.id)]

    async def test_a_finding_carries_its_card_risk_and_reviewer(self, db, client, env):
        run = env["run"]
        risk = await create_risk(db, title="Tracked", reference="R-000042")
        row = await create_compliance_finding(
            db,
            run.id,
            regulation="gdpr",
            card_id=env["app"].id,
            risk_id=risk.id,
            decision="risk_tracked",
            reviewed_by=env["admin"].id,
        )
        row.reviewed_by = env["admin"].id
        await db.flush()
        resp = await client.get(
            f"{API}/compliance?regulation=gdpr", headers=auth_headers(env["admin"])
        )
        (finding,) = resp.json()[0]["findings"]
        assert finding["id"] == str(row.id) and finding["scope_type"] == "card"
        assert finding["card_name"] == "App A" and finding["card_type"] == "Application"
        assert finding["card_has_ai_features"] is True  # "yes" on the card
        assert finding["risk_reference"] == "R-000042" and finding["decision"] == "risk_tracked"
        assert finding["reviewer_name"] == "Admin"

    async def test_a_hidden_card_s_finding_is_left_out(self, db, client, env):
        run = env["run"]
        await create_compliance_finding(db, run.id, regulation="gdpr", card_id=env["secret"].id)
        await create_compliance_finding(db, run.id, regulation="gdpr")  # landscape-wide
        resp = await client.get(
            f"{API}/compliance?regulation=gdpr", headers=auth_headers(env["restricted"])
        )
        findings = resp.json()[0]["findings"]
        assert len(findings) == 1 and findings[0]["card_id"] is None
        resp = await client.get(
            f"{API}/compliance?regulation=gdpr", headers=auth_headers(env["admin"])
        )
        assert len(resp.json()[0]["findings"]) == 2

    async def test_requires_compliance_view(self, client, env):
        resp = await client.get(f"{API}/compliance", headers=auth_headers(env["nobody"]))
        assert resp.status_code == 403


# ── POST /compliance-findings ─────────────────────────────────────────────


def _create_body(**overrides) -> dict:
    return {
        "regulation": "gdpr",
        "regulation_article": "Art. 30",
        "requirement": "Keep a record of processing.",
        "status": "non_compliant",
        "severity": "high",
        "category": "privacy",
        "gap_description": "No register.",
        "remediation": "Create one.",
        **overrides,
    }


class TestCreateFinding:
    async def test_creates_a_landscape_finding_on_a_synthetic_run(self, db, client, env):
        resp = await client.post(
            f"{API}/compliance-findings", json=_create_body(), headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["scope_type"] == "landscape" and body["card_id"] is None
        assert body["decision"] == "new" and body["ai_detected"] is False
        assert body["review_note"] == "Manually created finding."
        assert body["reviewed_by"] == str(env["admin"].id)
        row = await db.get(TurboLensComplianceFinding, uuid.UUID(body["id"]))
        assert row.finding_key and row.last_seen_run_id == row.run_id
        run = (await db.execute(select(Card))).scalars()  # keep the session warm
        assert run is not None
        from app.models.turbolens import TurboLensAnalysisRun

        synthetic = await db.get(TurboLensAnalysisRun, row.run_id)
        assert synthetic.results == {"manual": True} and synthetic.created_by == env["admin"].id

    async def test_creates_a_card_finding(self, client, env):
        resp = await client.post(
            f"{API}/compliance-findings",
            json=_create_body(card_id=str(env["app"].id), regulation="dora"),
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["scope_type"] == "card" and body["card_name"] == "App A"
        assert body["card_type"] == "Application" and body["card_has_ai_features"] is True
        assert body["regulation"] == "dora"  # a disabled regulation is still accepted

    @pytest.mark.parametrize(
        ("overrides", "status", "detail"),
        [
            ({"regulation": "  "}, 400, "regulation is required"),
            ({"regulation": "nope"}, 400, "Unknown regulation"),
            ({"status": "bogus"}, 400, "status must be one of"),
            ({"severity": "bogus"}, 400, "severity must be one of"),
            ({"requirement": "   "}, 400, "requirement is required"),
            ({"card_id": "not-a-uuid"}, 400, "Invalid card_id"),
            ({"card_id": str(uuid.uuid4())}, 404, "Card not found"),
        ],
    )
    async def test_rejected_input(self, client, env, overrides, status, detail):
        resp = await client.post(
            f"{API}/compliance-findings",
            json=_create_body(**overrides),
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == status, resp.text
        assert detail in resp.json()["detail"]

    async def test_requires_compliance_manage(self, client, env):
        resp = await client.post(
            f"{API}/compliance-findings", json=_create_body(), headers=auth_headers(env["viewer"])
        )
        assert resp.status_code == 403


# ── PATCH /compliance-findings/{id} ───────────────────────────────────────


class TestDecision:
    async def test_a_legal_transition_records_the_reviewer(self, db, client, env):
        row = await create_compliance_finding(
            db, env["run"].id, decision="new", card_id=env["app"].id
        )
        resp = await client.patch(
            f"{API}/compliance-findings/{row.id}",
            json={"decision": "in_review", "review_note": "  looking  "},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["decision"] == "in_review" and body["review_note"] == "looking"
        assert body["reviewer_name"] == "Admin" and body["reviewed_at"] is not None
        assert body["card_name"] == "App A" and body["card_has_ai_features"] is True
        assert row.decision == "in_review" and row.reviewed_by == env["admin"].id

    async def test_accepting_needs_a_note(self, db, client, env):
        row = await create_compliance_finding(db, env["run"].id, decision="new")
        resp = await client.patch(
            f"{API}/compliance-findings/{row.id}",
            json={"decision": "accepted", "review_note": " "},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400 and "review_note is required" in resp.json()["detail"]
        resp = await client.patch(
            f"{API}/compliance-findings/{row.id}",
            json={"decision": "accepted", "review_note": "Business accepts it."},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200 and resp.json()["decision"] == "accepted"

    async def test_rejected_decisions(self, db, client, env):
        headers = auth_headers(env["admin"])
        row = await create_compliance_finding(db, env["run"].id, decision="verified")
        resp = await client.patch(
            f"{API}/compliance-findings/{row.id}",
            json={"decision": "risk_tracked"},
            headers=headers,
        )
        assert resp.status_code == 400 and "decision must be one of" in resp.json()["detail"]
        resp = await client.patch(
            f"{API}/compliance-findings/{row.id}", json={"decision": "mitigated"}, headers=headers
        )
        assert resp.status_code == 409
        assert "Illegal lifecycle transition: verified → mitigated" in resp.json()["detail"]
        resp = await client.patch(
            f"{API}/compliance-findings/{uuid.uuid4()}", json={"decision": "new"}, headers=headers
        )
        assert resp.status_code == 404

    async def test_a_risk_tracked_finding_follows_its_risk(self, db, client, env):
        risk = await create_risk(db, title="Tracked", reference="R-000001")
        row = await create_compliance_finding(
            db, env["run"].id, decision="risk_tracked", risk_id=risk.id
        )
        resp = await client.patch(
            f"{API}/compliance-findings/{row.id}",
            json={"decision": "in_review"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 409 and "tracked by a Risk" in resp.json()["detail"]

    async def test_requires_compliance_manage(self, db, client, env):
        row = await create_compliance_finding(db, env["run"].id, decision="new")
        resp = await client.patch(
            f"{API}/compliance-findings/{row.id}",
            json={"decision": "in_review"},
            headers=auth_headers(env["viewer"]),
        )
        assert resp.status_code == 403


# ── DELETE /compliance-findings/{id} ──────────────────────────────────────


class TestDeleteFinding:
    async def test_deletes_the_row_but_never_the_risk(self, db, client, env):
        risk = await create_risk(db, title="Kept", reference="R-000002")
        row = await create_compliance_finding(db, env["run"].id, risk_id=risk.id)
        resp = await client.delete(
            f"{API}/compliance-findings/{row.id}", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 204
        assert await db.get(TurboLensComplianceFinding, row.id) is None
        from app.models.risk import Risk

        assert await db.get(Risk, risk.id) is not None

    async def test_unknown_and_forbidden(self, db, client, env):
        resp = await client.delete(
            f"{API}/compliance-findings/{uuid.uuid4()}", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 404
        row = await create_compliance_finding(db, env["run"].id)
        resp = await client.delete(
            f"{API}/compliance-findings/{row.id}", headers=auth_headers(env["viewer"])
        )
        assert resp.status_code == 403


# ── POST /compliance-findings/{id}/ai-verdict ─────────────────────────────


class TestAiVerdict:
    async def test_a_confirmed_verdict_lands_on_the_card_and_the_finding(self, db, client, env):
        card = await create_card(db, card_type="Application", name="Maybe AI")
        row = await create_compliance_finding(
            db, env["run"].id, card_id=card.id, decision="new", ai_detected=True
        )
        resp = await client.post(
            f"{API}/compliance-findings/{row.id}/ai-verdict",
            json={"verdict": "confirmed"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["decision"] == "in_review" and body["review_note"] == "AI verdict: confirmed"
        assert body["card_has_ai_features"] is True and body["reviewer_name"] == "Admin"
        assert card.attributes == {"hasAiFeatures": True} and card.updated_by == env["admin"].id
        event = (
            await db.execute(
                select(Event).where(Event.card_id == card.id, Event.event_type == "card.updated")
            )
        ).scalar_one()
        assert event.data["changes"]["attributes"] == {
            "old": {"hasAiFeatures": None},
            "new": {"hasAiFeatures": True},
        }

    async def test_a_rejected_verdict_on_an_approved_card_breaks_the_approval(
        self, db, client, env
    ):
        card = await create_card(
            db,
            card_type="Application",
            name="Approved",
            approval_status="APPROVED",
            attributes={"hasAiFeatures": True},
        )
        row = await create_compliance_finding(
            db, env["run"].id, card_id=card.id, decision="verified"
        )
        resp = await client.post(
            f"{API}/compliance-findings/{row.id}/ai-verdict",
            json={"verdict": "rejected"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        assert card.attributes["hasAiFeatures"] is False and card.approval_status == "BROKEN"
        # A decision the user chose explicitly is kept; only the note moves.
        assert resp.json()["decision"] == "verified"
        assert resp.json()["review_note"] == "AI verdict: rejected"

    async def test_an_unchanged_value_writes_no_event(self, db, client, env):
        card = await create_card(
            db, card_type="Application", name="Known", attributes={"hasAiFeatures": True}
        )
        row = await create_compliance_finding(db, env["run"].id, card_id=card.id, decision="new")
        resp = await client.post(
            f"{API}/compliance-findings/{row.id}/ai-verdict",
            json={"verdict": "confirmed"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200 and resp.json()["decision"] == "in_review"
        events = (await db.execute(select(Event).where(Event.card_id == card.id))).scalars().all()
        assert events == []

    async def test_rejected_input(self, db, client, env):
        headers = auth_headers(env["admin"])
        landscape = await create_compliance_finding(db, env["run"].id)
        resp = await client.post(
            f"{API}/compliance-findings/{landscape.id}/ai-verdict",
            json={"verdict": "maybe"},
            headers=headers,
        )
        assert resp.status_code == 400 and "confirmed" in resp.json()["detail"]
        resp = await client.post(
            f"{API}/compliance-findings/{landscape.id}/ai-verdict",
            json={"verdict": "confirmed"},
            headers=headers,
        )
        assert resp.status_code == 400 and "not scoped to a specific card" in resp.json()["detail"]
        resp = await client.post(
            f"{API}/compliance-findings/{uuid.uuid4()}/ai-verdict",
            json={"verdict": "confirmed"},
            headers=headers,
        )
        assert resp.status_code == 404
        resp = await client.post(
            f"{API}/compliance-findings/{landscape.id}/ai-verdict",
            json={"verdict": "confirmed"},
            headers=auth_headers(env["viewer"]),
        )
        assert resp.status_code == 403


# ── GET /cards/{id}/compliance-findings ───────────────────────────────────


class TestCardFindings:
    async def test_ordered_by_severity_then_regulation_and_article(self, db, client, env):
        run, card = env["run"], env["app"]
        await create_compliance_finding(
            db, run.id, card_id=card.id, severity="low", regulation="gdpr", regulation_article="A"
        )
        await create_compliance_finding(
            db, run.id, card_id=card.id, severity="critical", regulation="nis2"
        )
        await create_compliance_finding(
            db,
            run.id,
            card_id=card.id,
            severity="critical",
            regulation="gdpr",
            regulation_article="B",
        )
        await create_compliance_finding(
            db,
            run.id,
            card_id=card.id,
            severity="critical",
            regulation="gdpr",
            regulation_article="A",
        )
        stale = await create_compliance_finding(db, run.id, card_id=card.id)
        stale.auto_resolved = True
        await create_compliance_finding(db, run.id)  # landscape-wide: not this card's
        await db.flush()

        resp = await client.get(
            f"/api/v1/cards/{card.id}/compliance-findings", headers=auth_headers(env["viewer"])
        )
        assert resp.status_code == 200, resp.text
        assert [(f["severity"], f["regulation"], f["regulation_article"]) for f in resp.json()] == [
            ("critical", "gdpr", "A"),
            ("critical", "gdpr", "B"),
            ("critical", "nis2", "Art. 35"),
            ("low", "gdpr", "A"),
        ]
        assert resp.json()[0]["card_name"] == "App A"
        assert resp.json()[0]["card_has_ai_features"] is True

        resp = await client.get(
            f"/api/v1/cards/{card.id}/compliance-findings?include_auto_resolved=true",
            headers=auth_headers(env["viewer"]),
        )
        assert len(resp.json()) == 5

    async def test_invalid_hidden_and_forbidden(self, db, client, env):
        resp = await client.get(
            "/api/v1/cards/not-a-uuid/compliance-findings", headers=auth_headers(env["viewer"])
        )
        assert resp.status_code == 400
        resp = await client.get(
            f"/api/v1/cards/{env['secret'].id}/compliance-findings",
            headers=auth_headers(env["restricted"]),
        )
        assert resp.status_code == 404  # hidden, not forbidden: it does not exist for them
        resp = await client.get(
            f"/api/v1/cards/{env['secret'].id}/compliance-findings",
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200 and resp.json() == []
        resp = await client.get(
            f"/api/v1/cards/{env['app'].id}/compliance-findings",
            headers=auth_headers(env["nobody"]),
        )
        assert resp.status_code == 403
