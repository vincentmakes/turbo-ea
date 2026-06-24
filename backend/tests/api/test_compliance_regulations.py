"""Integration tests for admin-managed compliance regulations.

Covers the new ``/metamodel/compliance-regulations`` CRUD surface, the
built-in-protection rule, and the orphan-tolerant ``/security/compliance``
rollup.
"""

from __future__ import annotations

import uuid

import pytest

from app.api.v1.turbolens import AnalysisStatus, AnalysisType
from app.core.permissions import VIEWER_PERMISSIONS
from app.models.compliance_regulation import ComplianceRegulation
from app.models.turbolens import TurboLensAnalysisRun, TurboLensComplianceFinding
from tests.conftest import auth_headers, create_role, create_user


@pytest.fixture
async def reg_env(db):
    """Admin + viewer + one built-in regulation to mirror seeded state."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")

    builtin = ComplianceRegulation(
        id=uuid.uuid4(),
        key="gdpr",
        label="GDPR (Regulation (EU) 2016/679)",
        description="Seeded built-in.",
        is_enabled=True,
        built_in=True,
        sort_order=20,
        translations={},
    )
    db.add(builtin)
    await db.flush()
    return {"admin": admin, "viewer": viewer, "builtin": builtin}


class TestListAndCreate:
    async def test_list_returns_seeded_builtin(self, client, db, reg_env):
        admin = reg_env["admin"]
        r = await client.get(
            "/api/v1/metamodel/compliance-regulations",
            headers=auth_headers(admin),
        )
        assert r.status_code == 200
        keys = [reg["key"] for reg in r.json()]
        assert "gdpr" in keys

    async def test_list_authenticated_read(self, client, db, reg_env):
        """Read is open to any authenticated user (not just admin)."""
        viewer = reg_env["viewer"]
        r = await client.get(
            "/api/v1/metamodel/compliance-regulations",
            headers=auth_headers(viewer),
        )
        assert r.status_code == 200

    async def test_enabled_only_filter(self, client, db, reg_env):
        admin = reg_env["admin"]
        # Add a disabled custom row
        db.add(
            ComplianceRegulation(
                id=uuid.uuid4(),
                key="custom_a",
                label="Custom A",
                is_enabled=False,
                built_in=False,
                sort_order=100,
                translations={},
            )
        )
        await db.flush()

        all_resp = await client.get(
            "/api/v1/metamodel/compliance-regulations",
            headers=auth_headers(admin),
        )
        enabled_resp = await client.get(
            "/api/v1/metamodel/compliance-regulations?enabled_only=true",
            headers=auth_headers(admin),
        )
        all_keys = [r["key"] for r in all_resp.json()]
        enabled_keys = [r["key"] for r in enabled_resp.json()]
        assert "custom_a" in all_keys
        assert "custom_a" not in enabled_keys

    async def test_create_custom(self, client, db, reg_env):
        admin = reg_env["admin"]
        r = await client.post(
            "/api/v1/metamodel/compliance-regulations",
            json={
                "key": "iso9001",
                "label": "ISO 9001",
                "description": "Quality management.",
                "is_enabled": True,
                "sort_order": 200,
            },
            headers=auth_headers(admin),
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["key"] == "iso9001"
        assert body["built_in"] is False

    async def test_create_lowercases_key(self, client, db, reg_env):
        admin = reg_env["admin"]
        r = await client.post(
            "/api/v1/metamodel/compliance-regulations",
            json={"key": "  HIPAA  ", "label": "HIPAA"},
            headers=auth_headers(admin),
        )
        assert r.status_code == 201
        assert r.json()["key"] == "hipaa"

    async def test_create_rejects_duplicate_key(self, client, db, reg_env):
        admin = reg_env["admin"]
        r = await client.post(
            "/api/v1/metamodel/compliance-regulations",
            json={"key": "gdpr", "label": "Duplicate"},
            headers=auth_headers(admin),
        )
        assert r.status_code == 400

    async def test_create_requires_admin(self, client, db, reg_env):
        viewer = reg_env["viewer"]
        r = await client.post(
            "/api/v1/metamodel/compliance-regulations",
            json={"key": "blocked", "label": "Blocked"},
            headers=auth_headers(viewer),
        )
        assert r.status_code == 403


class TestUpdateAndDelete:
    async def test_disable_builtin_succeeds(self, client, db, reg_env):
        admin = reg_env["admin"]
        builtin = reg_env["builtin"]
        r = await client.patch(
            f"/api/v1/metamodel/compliance-regulations/{builtin.id}",
            json={"is_enabled": False},
            headers=auth_headers(admin),
        )
        assert r.status_code == 200
        assert r.json()["is_enabled"] is False

    async def test_delete_builtin_refused(self, client, db, reg_env):
        admin = reg_env["admin"]
        builtin = reg_env["builtin"]
        r = await client.delete(
            f"/api/v1/metamodel/compliance-regulations/{builtin.id}",
            headers=auth_headers(admin),
        )
        assert r.status_code == 400
        # Confirm the row is still there.
        r2 = await client.get(
            "/api/v1/metamodel/compliance-regulations",
            headers=auth_headers(admin),
        )
        assert "gdpr" in [reg["key"] for reg in r2.json()]

    async def test_delete_custom_succeeds(self, client, db, reg_env):
        admin = reg_env["admin"]
        created = await client.post(
            "/api/v1/metamodel/compliance-regulations",
            json={"key": "hipaa", "label": "HIPAA"},
            headers=auth_headers(admin),
        )
        reg_id = created.json()["id"]
        r = await client.delete(
            f"/api/v1/metamodel/compliance-regulations/{reg_id}",
            headers=auth_headers(admin),
        )
        assert r.status_code == 204


class TestComplianceRollupOrphans:
    """`/security/compliance` must continue to surface findings whose
    regulation has been disabled or deleted (orphans) — with metadata
    flagging the regulation's known/enabled state so the frontend can
    render a muted tab."""

    async def _make_run_and_finding(self, db, regulation_key: str) -> None:
        run = TurboLensAnalysisRun(
            id=uuid.uuid4(),
            analysis_type=AnalysisType.COMPLIANCE,
            status=AnalysisStatus.COMPLETED,
        )
        db.add(run)
        await db.flush()
        db.add(
            TurboLensComplianceFinding(
                id=uuid.uuid4(),
                run_id=run.id,
                regulation=regulation_key,
                regulation_article=None,
                card_id=None,
                scope_type="landscape",
                category="test",
                requirement="Test requirement.",
                status="non_compliant",
                severity="high",
                gap_description="Gap.",
                evidence=None,
                remediation=None,
                ai_detected=False,
                finding_key=f"k-{regulation_key}-{uuid.uuid4().hex}",
                decision="new",
            )
        )
        await db.flush()

    async def test_disabled_regulation_still_shows_in_rollup(self, client, db, reg_env):
        admin = reg_env["admin"]
        builtin = reg_env["builtin"]
        await self._make_run_and_finding(db, "gdpr")

        # Disable the regulation
        builtin.is_enabled = False
        await db.flush()

        r = await client.get(
            "/api/v1/compliance/compliance",
            headers=auth_headers(admin),
        )
        assert r.status_code == 200
        bundles = {b["regulation"]: b for b in r.json()}
        assert "gdpr" in bundles
        assert bundles["gdpr"]["is_enabled"] is False
        assert bundles["gdpr"]["is_known"] is True
        assert len(bundles["gdpr"]["findings"]) == 1

    async def test_disabled_regulation_without_findings_is_hidden(self, client, db, reg_env):
        """Issue #668: a disabled regulation with no findings must not clutter
        the slider — it's dropped from the rollup entirely."""
        admin = reg_env["admin"]
        # A disabled custom regulation that has no findings attached.
        db.add(
            ComplianceRegulation(
                id=uuid.uuid4(),
                key="custom_disabled",
                label="Custom Disabled",
                is_enabled=False,
                built_in=False,
                sort_order=100,
                translations={},
            )
        )
        await db.flush()

        r = await client.get(
            "/api/v1/compliance/compliance",
            headers=auth_headers(admin),
        )
        assert r.status_code == 200
        keys = [b["regulation"] for b in r.json()]
        assert "custom_disabled" not in keys
        # The enabled built-in stays visible even with no findings.
        assert "gdpr" in keys

    async def test_enabled_regulation_without_findings_stays_visible(self, client, db, reg_env):
        """A normal enabled regulation with no findings must still appear so
        the user can see its (empty) compliance state."""
        admin = reg_env["admin"]
        r = await client.get(
            "/api/v1/compliance/compliance",
            headers=auth_headers(admin),
        )
        assert r.status_code == 200
        bundles = {b["regulation"]: b for b in r.json()}
        assert "gdpr" in bundles
        assert bundles["gdpr"]["is_enabled"] is True
        assert bundles["gdpr"]["findings"] == []

    async def test_unknown_regulation_orphan_visible(self, client, db, reg_env):
        admin = reg_env["admin"]
        # Insert a finding pointing at a regulation that doesn't exist in
        # the regulations table (e.g. one that was hard-deleted).
        await self._make_run_and_finding(db, "removed_regulation")

        r = await client.get(
            "/api/v1/compliance/compliance",
            headers=auth_headers(admin),
        )
        assert r.status_code == 200
        bundles = {b["regulation"]: b for b in r.json()}
        assert "removed_regulation" in bundles
        assert bundles["removed_regulation"]["is_known"] is False
        assert bundles["removed_regulation"]["is_enabled"] is False


class TestManualFindingValidation:
    async def test_manual_finding_accepts_custom_regulation(self, client, db, reg_env):
        admin = reg_env["admin"]
        # Create a custom regulation first
        await client.post(
            "/api/v1/metamodel/compliance-regulations",
            json={"key": "internal_policy", "label": "Internal Policy"},
            headers=auth_headers(admin),
        )
        r = await client.post(
            "/api/v1/compliance/compliance-findings",
            json={
                "regulation": "internal_policy",
                "requirement": "Must follow internal change-control policy.",
                "status": "review_needed",
                "severity": "medium",
            },
            headers=auth_headers(admin),
        )
        assert r.status_code == 200, r.text
        assert r.json()["regulation"] == "internal_policy"

    async def test_manual_finding_rejects_unknown_regulation(self, client, db, reg_env):
        admin = reg_env["admin"]
        r = await client.post(
            "/api/v1/compliance/compliance-findings",
            json={
                "regulation": "definitely_not_a_real_regulation",
                "requirement": "Test.",
                "status": "review_needed",
                "severity": "medium",
            },
            headers=auth_headers(admin),
        )
        assert r.status_code == 400


class TestBootstrapSurface:
    async def test_bootstrap_includes_regulations(self, client, db, reg_env):
        admin = reg_env["admin"]
        r = await client.get("/api/v1/settings/bootstrap", headers=auth_headers(admin))
        assert r.status_code == 200
        body = r.json()
        assert "compliance_regulations" in body
        keys = [reg["key"] for reg in body["compliance_regulations"]]
        assert "gdpr" in keys


class TestRescanPreservesUserWork:
    """A re-scan must NOT erase hand-curated state.

    Pre-fix behaviour:
      1. Re-emitted findings had their body fields (status, severity,
         category, gap, evidence, remediation) overwritten by whatever
         the AI emitted on the new run.
      2. Findings the new scan didn't re-emit were force-transitioned
         to ``decision="verified"`` + ``auto_resolved=True``, which
         (a) wiped the user's lifecycle decision and (b) hid manual
         findings under the default register filter.

    Post-fix:
      * Re-emitted findings: only ``run_id`` / ``last_seen_run_id`` /
        ``auto_resolved=False`` are updated. Body + decision intact.
      * Vanished findings with ``reviewed_by IS NOT NULL`` (manual
        findings, acknowledged findings, accepted findings, promoted-
        to-risk findings) are left ENTIRELY alone.
      * Vanished, never-touched AI findings still get
        ``auto_resolved=True`` flagged so the UI can show "AI no longer
        reports this", but decision is never changed.
    """

    async def _run_scan(self, db, regulations: list[str]) -> None:
        """Execute ``run_compliance_scan`` directly.

        AI is not configured in the test env, so ``assess_regulation``
        emits one synthetic "AI not configured" landscape finding per
        regulation — but its ``finding_key`` is distinct from the rows
        seeded in the tests, so the seeded rows always land in the
        ``vanished`` branch and exercise the preservation logic.
        """
        from app.api.v1.turbolens import AnalysisStatus, AnalysisType
        from app.services.compliance_scanner import run_compliance_scan

        scan_run = TurboLensAnalysisRun(
            id=uuid.uuid4(),
            analysis_type=AnalysisType.COMPLIANCE,
            status=AnalysisStatus.RUNNING,
        )
        db.add(scan_run)
        await db.flush()
        await run_compliance_scan(db, scan_run.id, None, regulations=regulations)
        await db.flush()

    async def _seed_finding(
        self,
        db,
        user_id,
        *,
        regulation: str,
        decision: str,
        reviewed_by,
        severity: str = "high",
        status: str = "non_compliant",
        gap_description: str = "Original AI gap text.",
    ):
        """Insert a finding with a fixed finding_key + lifecycle state."""
        prev_run = TurboLensAnalysisRun(
            id=uuid.uuid4(),
            analysis_type=AnalysisType.COMPLIANCE,
            status=AnalysisStatus.COMPLETED,
        )
        db.add(prev_run)
        await db.flush()
        finding_id = uuid.uuid4()
        db.add(
            TurboLensComplianceFinding(
                id=finding_id,
                run_id=prev_run.id,
                regulation=regulation,
                regulation_article=None,
                card_id=None,
                scope_type="landscape",
                category="Original category",
                requirement="Original requirement that the user has curated.",
                status=status,
                severity=severity,
                gap_description=gap_description,
                evidence="Original evidence.",
                remediation="Original remediation.",
                ai_detected=False,
                finding_key=f"k-{regulation}-{finding_id.hex}",
                decision=decision,
                reviewed_by=reviewed_by,
            )
        )
        await db.flush()
        return finding_id

    async def test_manual_finding_survives_rescan(self, client, db, reg_env):
        """Manual finding with reviewed_by set must be left entirely alone."""
        admin = reg_env["admin"]
        finding_id = await self._seed_finding(
            db,
            admin.id,
            regulation="gdpr",
            decision="new",
            reviewed_by=admin.id,
            severity="critical",
            gap_description="My hand-written gap.",
        )

        await self._run_scan(db, ["gdpr"])

        row = await db.get(TurboLensComplianceFinding, finding_id)
        assert row is not None
        # Everything intact: decision, body, auto_resolved=False
        assert row.decision == "new"
        assert row.severity == "critical"
        assert row.gap_description == "My hand-written gap."
        assert row.evidence == "Original evidence."
        assert row.remediation == "Original remediation."
        assert row.auto_resolved is False  # untouched

    async def test_acknowledged_ai_finding_preserved(self, client, db, reg_env):
        """An AI finding the user acknowledged must keep its decision + body."""
        admin = reg_env["admin"]
        finding_id = await self._seed_finding(
            db,
            admin.id,
            regulation="gdpr",
            decision="in_review",
            reviewed_by=admin.id,
            severity="medium",
        )

        await self._run_scan(db, ["gdpr"])

        row = await db.get(TurboLensComplianceFinding, finding_id)
        assert row is not None
        assert row.decision == "in_review"  # was NOT force-transitioned
        assert row.severity == "medium"  # body untouched
        assert row.auto_resolved is False  # reviewed_by set → untouched

    async def test_promoted_to_risk_finding_preserved(self, client, db, reg_env):
        """A finding promoted to Risk (decision=risk_tracked) is preserved."""
        admin = reg_env["admin"]
        finding_id = await self._seed_finding(
            db,
            admin.id,
            regulation="gdpr",
            decision="risk_tracked",
            reviewed_by=admin.id,
        )

        await self._run_scan(db, ["gdpr"])

        row = await db.get(TurboLensComplianceFinding, finding_id)
        assert row is not None
        assert row.decision == "risk_tracked"
        assert row.auto_resolved is False

    async def test_vanished_untouched_ai_finding_stays_visible(self, client, db, reg_env):
        """A finding the LLM didn't re-emit must still be visible.

        Pre-fix: vanished untouched AI findings were flipped to
        ``auto_resolved=True``, which the default Compliance grid filter
        hides. Combined with LLM non-determinism, that silently shrank
        the visible-findings count every scan. New behaviour: rescan is
        purely additive — body, decision, and auto_resolved flag are all
        preserved (and auto_resolved is explicitly cleared so stale
        ``True`` from prior scans no longer hides anything).
        """
        finding_id = await self._seed_finding(
            db,
            None,
            regulation="gdpr",
            decision="new",
            reviewed_by=None,  # never touched
        )

        await self._run_scan(db, ["gdpr"])

        row = await db.get(TurboLensComplianceFinding, finding_id)
        assert row is not None
        assert row.auto_resolved is False  # NOT hidden
        assert row.decision == "new"  # NOT force-transitioned
        # Body intact.
        assert row.severity == "high"
        assert row.gap_description == "Original AI gap text."

    async def test_stale_auto_resolved_row_unsticks_on_rescan(self, client, db, reg_env):
        """Rows stuck at ``auto_resolved=True`` from earlier scans
        (running against the old auto-resolve logic) must come back into
        view after any subsequent scan of the same regulation. The
        explicit clear inside ``run_compliance_scan`` is the fix."""
        # Seed a row that's currently flagged auto_resolved=True (the
        # state the old code would have left it in).
        prev_run = TurboLensAnalysisRun(
            id=uuid.uuid4(),
            analysis_type=AnalysisType.COMPLIANCE,
            status=AnalysisStatus.COMPLETED,
        )
        db.add(prev_run)
        await db.flush()
        finding_id = uuid.uuid4()
        db.add(
            TurboLensComplianceFinding(
                id=finding_id,
                run_id=prev_run.id,
                regulation="gdpr",
                regulation_article=None,
                card_id=None,
                scope_type="landscape",
                category="x",
                requirement="x",
                status="non_compliant",
                severity="high",
                gap_description="x",
                evidence=None,
                remediation=None,
                ai_detected=True,
                finding_key=f"k-stale-{finding_id.hex}",
                decision="new",
                reviewed_by=None,
                auto_resolved=True,  # stale flag from old scanner behaviour
            )
        )
        await db.flush()

        await self._run_scan(db, ["gdpr"])

        row = await db.get(TurboLensComplianceFinding, finding_id)
        assert row is not None
        assert row.auto_resolved is False  # un-stuck → visible again
