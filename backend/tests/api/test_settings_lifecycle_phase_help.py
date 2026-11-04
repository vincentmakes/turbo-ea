"""``/settings/lifecycle-phase-help`` — admin-written help per lifecycle phase.

DB-backed: skipped locally without PostgreSQL, run in CI.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.audit_log import AuditLogEntry
from tests.conftest import auth_headers, create_role, create_user

URL = "/api/v1/settings/lifecycle-phase-help"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"h": auth_headers(admin), "viewer_h": auth_headers(viewer)}


async def _audit_rows(db) -> list[AuditLogEntry]:
    await db.rollback()
    result = await db.execute(
        select(AuditLogEntry)
        .where(
            AuditLogEntry.action == "admin.settings.updated",
            AuditLogEntry.target_id == "lifecycle-phase-help",
        )
        .order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars().all())


async def test_default_is_empty(client, db, env):
    resp = await client.get(URL, headers=env["viewer_h"])
    assert resp.status_code == 200
    assert resp.json() == {"phases": {}}

    boot = await client.get("/api/v1/settings/bootstrap")
    assert boot.json()["lifecycle_phase_help"] == {}


async def test_get_requires_sign_in(client, db, env):
    resp = await client.get(URL)
    assert resp.status_code == 401


async def test_admin_patch_round_trips_and_bootstrap_carries_it(client, db, env):
    body = {
        "phases": {
            "phaseOut": {"en": "  Being replaced; no new users.  ", "de": "Wird abgelöst."},
            "active": {"en": "In production use.", "xx": "dropped"},
            "plan": {"en": "   "},
        }
    }
    resp = await client.patch(URL, json=body, headers=env["h"])
    assert resp.status_code == 200
    expected = {
        "active": {"en": "In production use."},
        "phaseOut": {"en": "Being replaced; no new users.", "de": "Wird abgelöst."},
    }
    assert resp.json() == {"phases": expected}

    got = await client.get(URL, headers=env["viewer_h"])
    assert got.json() == {"phases": expected}
    boot = await client.get("/api/v1/settings/bootstrap")
    assert boot.json()["lifecycle_phase_help"] == expected


async def test_viewer_cannot_patch(client, db, env):
    resp = await client.patch(
        URL, json={"phases": {"active": {"en": "x"}}}, headers=env["viewer_h"]
    )
    assert resp.status_code == 403
    got = await client.get(URL, headers=env["viewer_h"])
    assert got.json() == {"phases": {}}


async def test_unknown_phase_is_rejected(client, db, env):
    resp = await client.patch(URL, json={"phases": {"retired": {"en": "x"}}}, headers=env["h"])
    assert resp.status_code == 400
    assert "retired" in resp.json()["detail"]


async def test_malformed_body_is_rejected(client, db, env):
    resp = await client.patch(URL, json={"phases": {"active": "not a map"}}, headers=env["h"])
    assert resp.status_code == 422


async def test_audit_row_names_the_phase_text_that_moved(client, db, env):
    first = {"phases": {"active": {"en": "In use"}, "plan": {"en": "Idea"}}}
    assert (await client.patch(URL, json=first, headers=env["h"])).status_code == 200
    second = {"phases": {"active": {"en": "In production"}, "plan": {"en": "Idea"}}}
    assert (await client.patch(URL, json=second, headers=env["h"])).status_code == 200
    # Re-sending the same texts changes nothing and records nothing.
    assert (await client.patch(URL, json=second, headers=env["h"])).status_code == 200

    rows = await _audit_rows(db)
    assert len(rows) == 2
    assert rows[0].details == {
        "changes": {
            "active_en": {"old": None, "new": "In use"},
            "plan_en": {"old": None, "new": "Idea"},
        }
    }
    assert rows[1].details == {
        "changes": {"active_en": {"old": "In use", "new": "In production"}},
    }
    assert (rows[1].target_type, rows[1].target_id) == ("setting", "lifecycle-phase-help")
