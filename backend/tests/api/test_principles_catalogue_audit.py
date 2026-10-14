"""``POST /principles-catalogue/import`` records an ``admin.principle.imported``
row in the Security & admin audit log.

DB-backed: skipped locally without PostgreSQL, run in CI.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.audit_log import AuditLogEntry
from tests.conftest import auth_headers, create_role, create_user

URL = "/api/v1/principles-catalogue/import"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "viewer": viewer}


async def _audit_rows(db) -> list[AuditLogEntry]:
    """Discard what a request flushed but never committed, then read the log."""
    await db.rollback()
    result = await db.execute(
        select(AuditLogEntry)
        .where(AuditLogEntry.action.like("admin.principle.%"))
        .order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars().all())


async def test_import_is_recorded_with_its_count(client, db, env):
    admin_id = env["admin"].id
    headers = auth_headers(env["admin"])
    resp = await client.post(URL, json={"catalogue_ids": ["PR-001", "PR-002"]}, headers=headers)
    assert resp.status_code == 200, resp.text
    # A re-import creates nothing new but is still the admin's action.
    resp = await client.post(URL, json={"catalogue_ids": ["PR-001", "PR-404"]}, headers=headers)
    assert resp.status_code == 200

    first, second = await _audit_rows(db)
    assert first.action == "admin.principle.imported"
    assert first.category == "admin" and first.actor_user_id == admin_id
    assert first.details == {"count": 2, "skipped": 0, "catalogue_ids": ["PR-001", "PR-002"]}
    assert first.target_type == "principles_catalogue"
    assert second.details == {"count": 0, "skipped": 2, "catalogue_ids": []}


async def test_viewer_is_refused_and_nothing_is_recorded(client, db, env):
    resp = await client.post(
        URL, json={"catalogue_ids": ["PR-001"]}, headers=auth_headers(env["viewer"])
    )
    assert resp.status_code == 403
    assert await _audit_rows(db) == []
