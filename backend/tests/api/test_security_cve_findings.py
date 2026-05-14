"""Tests for the CVE finding endpoints — specifically field-level schema coverage."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.turbolens import AnalysisStatus, AnalysisType
from app.models.turbolens import TurboLensAnalysisRun, TurboLensCveFinding
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user


@pytest.fixture
async def seed_env(db: AsyncSession):
    """Admin role + user + one Application card type (needed for FK)."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    return {"admin": admin}


@pytest.fixture
async def seed_one_cve_finding(db: AsyncSession, seed_env):
    """Insert one analysis run + one CVE finding linked to an Application card."""
    admin = seed_env["admin"]
    card = await create_card(db, card_type="Application", name="Test app", user_id=admin.id)
    run = TurboLensAnalysisRun(
        id=uuid.uuid4(),
        analysis_type=AnalysisType.SECURITY_CVE,
        status=AnalysisStatus.COMPLETED,
        started_at=datetime.now(timezone.utc),
        completed_at=datetime.now(timezone.utc),
        created_by=admin.id,
        results={"manual": False},
    )
    db.add(run)
    await db.flush()
    now = datetime.now(timezone.utc)
    finding = TurboLensCveFinding(
        run_id=run.id,
        card_id=card.id,
        card_type="Application",
        cve_id="CVE-2024-0001",
        severity="high",
        cvss_score=7.5,
        created_at=now,
        updated_at=now,
    )
    db.add(finding)
    await db.commit()
    await db.refresh(finding)
    return finding


async def test_create_cve_finding_manual_happy_path(client, db, seed_env) -> None:
    """Admin can manually log a CVE finding for a card. Required fields only."""
    admin = seed_env["admin"]
    card = await create_card(db, card_type="Application", name="Demo app", user_id=admin.id)
    body = {
        "cve_id": "CVE-2024-9999",
        "card_id": str(card.id),
        "severity": "critical",
    }
    resp = await client.post(
        "/api/v1/turbolens/security/cve-findings",
        json=body,
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["cve_id"] == "CVE-2024-9999"
    assert out["card_id"] == str(card.id)
    assert out["severity"] == "critical"
    assert out["status"] == "open"
    assert out["priority"] == "medium"
    assert out["probability"] == "medium"
    assert out["risk_id"] is None
    assert out["run_id"]


async def test_create_cve_finding_manual_viewer_forbidden(client, db, seed_env) -> None:
    """Viewer gets 403 — only security_compliance.manage users may create findings."""
    admin = seed_env["admin"]
    card = await create_card(db, card_type="Application", name="Demo app 2", user_id=admin.id)
    await create_role(db, key="viewer", label="Viewer", permissions={}, is_system=False)
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    body = {
        "cve_id": "CVE-2024-0002",
        "card_id": str(card.id),
        "severity": "high",
    }
    resp = await client.post(
        "/api/v1/turbolens/security/cve-findings",
        json=body,
        headers=auth_headers(viewer),
    )
    assert resp.status_code == 403, resp.text


async def test_create_cve_finding_manual_card_not_found(client, db, seed_env) -> None:
    """Admin POSTs with a random UUID card_id — expects 404."""
    admin = seed_env["admin"]
    body = {
        "cve_id": "CVE-2024-0003",
        "card_id": str(uuid.uuid4()),
        "severity": "medium",
    }
    resp = await client.post(
        "/api/v1/turbolens/security/cve-findings",
        json=body,
        headers=auth_headers(admin),
    )
    assert resp.status_code == 404, resp.text


async def test_create_cve_finding_manual_bad_severity(client, db, seed_env) -> None:
    """Admin POSTs with an invalid severity — expects 400 or 422."""
    admin = seed_env["admin"]
    card = await create_card(db, card_type="Application", name="Demo app 3", user_id=admin.id)
    body = {
        "cve_id": "CVE-2024-0004",
        "card_id": str(card.id),
        "severity": "ULTRA-CRITICAL",
    }
    resp = await client.post(
        "/api/v1/turbolens/security/cve-findings",
        json=body,
        headers=auth_headers(admin),
    )
    assert resp.status_code in (400, 422), resp.text


async def test_cve_finding_response_includes_updated_at(
    client, seed_one_cve_finding, seed_env
) -> None:
    """CveFindingOut must expose updated_at so the grid can show a Modified column."""
    admin = seed_env["admin"]
    resp = await client.get(
        "/api/v1/turbolens/security/findings",
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["items"], "Expected the seeded finding to be returned"
    row = payload["items"][0]
    assert "updated_at" in row
    assert "created_at" in row
    assert row["updated_at"] is not None
