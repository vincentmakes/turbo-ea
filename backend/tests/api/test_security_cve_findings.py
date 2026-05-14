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
