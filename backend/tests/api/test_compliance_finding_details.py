"""Detail-edit endpoint for a single compliance finding.

PATCH /compliance/compliance-findings/{id}/details — edit the
human-authored content (status, severity, requirement, gap/evidence/
remediation, category, article, regulation, linked card) WITHOUT
touching the lifecycle ``decision``. Gated by ``compliance.manage``.

This is the gap surfaced by discussion #717: a user who marked a card
"Compliant" had no way to change it to "Partial" after creation.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.turbolens import (
    TurboLensAnalysisRun,
    TurboLensComplianceFinding,
)
from tests.conftest import auth_headers, create_role, create_user


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")

    run = TurboLensAnalysisRun(
        id=uuid.uuid4(),
        analysis_type="compliance",
        status="completed",
        started_at=datetime.now(timezone.utc),
        created_by=admin.id,
    )
    db.add(run)
    await db.flush()
    return {"admin": admin, "viewer": viewer, "run_id": run.id}


async def _make_finding(
    db, run_id: uuid.UUID, *, decision: str = "verified"
) -> TurboLensComplianceFinding:
    row = TurboLensComplianceFinding(
        id=uuid.uuid4(),
        run_id=run_id,
        regulation="gdpr",
        regulation_article="Art. 35",
        card_id=None,
        scope_type="landscape",
        category="privacy",
        requirement="A DPIA is required.",
        status="compliant",
        severity="high",
        gap_description="",
        evidence=None,
        remediation=None,
        ai_detected=False,
        finding_key=f"k-{uuid.uuid4().hex}",
        decision=decision,
    )
    db.add(row)
    await db.flush()
    return row


def _url(finding_id) -> str:
    return f"/api/v1/compliance/compliance-findings/{finding_id}/details"


class TestComplianceFindingDetails:
    async def test_admin_changes_status_and_severity(self, client, db, env):
        row = await _make_finding(db, env["run_id"], decision="verified")
        await db.commit()

        # ``regulation`` is intentionally omitted: the endpoint validates it
        # against the regulation catalogue, which this lightweight fixture
        # does not seed. Omitting it leaves the finding's regulation unchanged
        # and still exercises the status/severity/content edit.
        r = await client.patch(
            _url(row.id),
            json={
                "regulation_article": "Art. 35",
                "card_id": None,
                "category": "privacy",
                "requirement": "A DPIA is required.",
                "status": "partial",
                "severity": "low",
                "gap_description": "Partial coverage.",
                "evidence": "Reviewed Q2.",
                "remediation": "Finish the DPIA.",
            },
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "partial"
        assert body["severity"] == "low"
        assert body["gap_description"] == "Partial coverage."
        # Lifecycle decision is untouched by the details edit.
        assert body["decision"] == "verified"

        await db.refresh(row)
        assert row.status == "partial"
        assert row.severity == "low"
        assert row.decision == "verified"

    async def test_invalid_status_rejected(self, client, db, env):
        row = await _make_finding(db, env["run_id"])
        await db.commit()

        r = await client.patch(
            _url(row.id),
            json={"status": "totally_compliant"},
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 400
        await db.refresh(row)
        assert row.status == "compliant"

    async def test_invalid_severity_rejected(self, client, db, env):
        row = await _make_finding(db, env["run_id"])
        await db.commit()

        r = await client.patch(
            _url(row.id),
            json={"severity": "apocalyptic"},
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 400
        await db.refresh(row)
        assert row.severity == "high"

    async def test_blank_requirement_rejected(self, client, db, env):
        row = await _make_finding(db, env["run_id"])
        await db.commit()

        r = await client.patch(
            _url(row.id),
            json={"requirement": "   "},
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 400

    async def test_missing_finding_404(self, client, db, env):
        r = await client.patch(
            _url(uuid.uuid4()),
            json={"status": "partial"},
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 404

    async def test_viewer_forbidden(self, client, db, env):
        row = await _make_finding(db, env["run_id"])
        await db.commit()

        r = await client.patch(
            _url(row.id),
            json={"status": "partial"},
            headers=auth_headers(env["viewer"]),
        )
        assert r.status_code == 403
        await db.refresh(row)
        assert row.status == "compliant"
