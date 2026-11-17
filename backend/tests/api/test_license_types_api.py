from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.audit_log import AuditLogEntry
from tests.conftest import auth_headers, create_license_metric, create_role, create_user

BASE = "/api/v1/metamodel/license-types"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    await create_license_metric(db)
    await create_license_metric(db, "installations", "Installations")
    return {"admin": admin, "viewer": viewer}


async def test_list_open_to_any_signed_in_user(client, env):
    r = await client.get(BASE, headers=auth_headers(env["viewer"]))
    assert r.status_code == 200 and r.json() == []
    assert (await client.get(BASE)).status_code == 401


async def test_create_requires_admin_metamodel(client, env):
    h = auth_headers(env["viewer"])
    assert (
        await client.post(BASE, json={"metric_key": "users", "key": "a", "label": "A"}, headers=h)
    ).status_code == 403
    assert (
        await client.patch(f"{BASE}/a?metric_key=users", json={"label": "B"}, headers=h)
    ).status_code == 403


async def test_create_and_duplicate(client, env):
    h = auth_headers(env["admin"])
    r = await client.post(
        BASE, json={"metric_key": "users", "key": "admin", "label": " Admin "}, headers=h
    )
    assert r.status_code == 201 and r.json()["label"] == "Admin"
    r = await client.post(
        BASE, json={"metric_key": "users", "key": "admin", "label": "Again"}, headers=h
    )
    assert r.status_code == 409


async def test_create_rejects_invalid_key(client, env):
    r = await client.post(
        BASE,
        json={"metric_key": "users", "key": "1abc", "label": "L"},
        headers=auth_headers(env["admin"]),
    )
    assert r.status_code == 422


async def test_patch_archives_and_audits(client, env, db):
    h = auth_headers(env["admin"])
    await client.post(BASE, json={"metric_key": "users", "key": "dev", "label": "Dev"}, headers=h)
    r = await client.patch(f"{BASE}/dev?metric_key=users", json={"archived": True}, headers=h)
    assert r.status_code == 200 and r.json()["archived"] is True
    rows = (
        (
            await db.execute(
                select(AuditLogEntry).where(
                    AuditLogEntry.action == "admin.metamodel.license_type.updated"
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert "archived" in str(rows[0].details)


async def test_patch_unknown_key_404(client, env):
    r = await client.patch(
        f"{BASE}/nope?metric_key=users", json={"label": "x"}, headers=auth_headers(env["admin"])
    )
    assert r.status_code == 404


async def test_no_delete_route(client, env):
    r = await client.delete(f"{BASE}/dev", headers=auth_headers(env["admin"]))
    assert r.status_code == 405


async def test_same_key_under_two_metrics_and_patch_is_scoped(client, env):
    h = auth_headers(env["admin"])
    for metric in ("users", "installations"):
        body = {"metric_key": metric, "key": "prod", "label": "Prod"}
        r = await client.post(BASE, json=body, headers=h)
        assert r.status_code == 201 and r.json()["metric_key"] == metric
    r = await client.patch(
        f"{BASE}/prod?metric_key=installations", json={"archived": True}, headers=h
    )
    assert r.status_code == 200 and r.json()["metric_key"] == "installations"
    listed = {(t["metric_key"], t["archived"]) for t in (await client.get(BASE, headers=h)).json()}
    assert listed == {("users", False), ("installations", True)}


async def test_create_rejects_unknown_metric_and_missing_metric(client, env):
    h = auth_headers(env["admin"])
    r = await client.post(BASE, json={"metric_key": "nope", "key": "a", "label": "A"}, headers=h)
    assert r.status_code == 422 and r.json()["detail"]["error"] == "unknown_metric"
    assert (await client.post(BASE, json={"key": "a", "label": "A"}, headers=h)).status_code == 422
    # A type of another metric is not found under this one.
    await client.post(BASE, json={"metric_key": "users", "key": "dev", "label": "Dev"}, headers=h)
    r = await client.patch(f"{BASE}/dev?metric_key=installations", json={"label": "x"}, headers=h)
    assert r.status_code == 404
