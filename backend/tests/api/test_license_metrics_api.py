from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.audit_log import AuditLogEntry
from tests.conftest import (
    auth_headers,
    create_license_metric,
    create_license_type,
    create_role,
    create_user,
)

BASE = "/api/v1/metamodel/license-metrics"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    await create_license_metric(db, "users", "Users", sort_order=0)
    await create_license_metric(db, "installations", "Installations", sort_order=1)
    return {"admin": admin, "viewer": viewer, "h": auth_headers(admin)}


async def _audit(db, action):
    q = select(AuditLogEntry).where(AuditLogEntry.action == action)
    return list((await db.execute(q)).scalars().all())


async def test_list_is_open_and_nests_types_archived_included(client, env, db):
    await create_license_type(db, "a", "A", metric_key="users")
    await create_license_type(db, "old", "Old", metric_key="users", archived=True, sort_order=1)
    r = await client.get(BASE, headers=auth_headers(env["viewer"]))
    assert r.status_code == 200
    body = r.json()
    assert [m["key"] for m in body] == ["users", "installations"]
    assert set(body[0]) >= {"id", "key", "label", "sort_order", "archived", "translations", "types"}
    assert [(t["key"], t["archived"]) for t in body[0]["types"]] == [("a", False), ("old", True)]
    assert body[0]["types"][0]["metric_key"] == "users"
    assert body[1]["types"] == []
    assert (await client.get(BASE)).status_code == 401


async def test_writes_need_admin_metamodel(client, env):
    h = auth_headers(env["viewer"])
    calls = [
        client.post(BASE, json={"key": "seats", "label": "Seats"}, headers=h),
        client.patch(f"{BASE}/users", json={"label": "X"}, headers=h),
        client.post(f"{BASE}/users/types", json={"key": "a", "label": "A"}, headers=h),
        client.patch(f"{BASE}/users/types/a", json={"label": "B"}, headers=h),
    ]
    for call in calls:
        assert (await call).status_code == 403


async def test_create_metric_audits_with_labels(client, env, db):
    r = await client.post(
        BASE,
        json={"key": "seats", "label": " Seats ", "translations": {"it": "Posti"}},
        headers=env["h"],
    )
    assert r.status_code == 201
    body = r.json()
    assert (body["key"], body["label"], body["types"]) == ("seats", "Seats", [])
    assert body["sort_order"] == 2
    (entry,) = await _audit(db, "admin.metamodel.license_metric.created")
    assert (entry.target_type, entry.target_id, entry.target_label) == (
        "license_metric",
        "seats",
        "Seats",
    )


async def test_create_metric_rejects_duplicate_and_bad_key(client, env):
    r = await client.post(BASE, json={"key": "users", "label": "U"}, headers=env["h"])
    assert r.status_code == 409 and r.json()["detail"]["error"] == "duplicate_key"
    r = await client.post(BASE, json={"key": "1abc", "label": "U"}, headers=env["h"])
    assert r.status_code == 422


async def test_patch_metric_updates_and_audits(client, env, db):
    r = await client.patch(
        f"{BASE}/users",
        json={"label": "Named users", "archived": True, "sort_order": 5},
        headers=env["h"],
    )
    assert r.status_code == 200
    body = r.json()
    assert (body["label"], body["archived"], body["sort_order"]) == ("Named users", True, 5)
    (entry,) = await _audit(db, "admin.metamodel.license_metric.updated")
    assert entry.target_label == "Users"
    assert "archived" in str(entry.details)
    # Restore.
    r = await client.patch(f"{BASE}/users", json={"archived": False}, headers=env["h"])
    assert r.json()["archived"] is False


async def test_patch_unknown_metric_404(client, env):
    r = await client.patch(f"{BASE}/nope", json={"label": "x"}, headers=env["h"])
    assert r.status_code == 404


async def test_create_type_under_metric_and_duplicate_rules(client, env, db):
    h = env["h"]
    r = await client.post(f"{BASE}/users/types", json={"key": "prod", "label": " Prod "}, headers=h)
    assert r.status_code == 201
    assert (r.json()["metric_key"], r.json()["label"]) == ("users", "Prod")
    # Same key under another metric is fine, inside one it is a 409.
    r = await client.post(
        f"{BASE}/installations/types", json={"key": "prod", "label": "P"}, headers=h
    )
    assert r.status_code == 201 and r.json()["metric_key"] == "installations"
    r = await client.post(f"{BASE}/users/types", json={"key": "prod", "label": "Again"}, headers=h)
    assert r.status_code == 409 and r.json()["detail"]["error"] == "duplicate_key"
    r = await client.post(f"{BASE}/nope/types", json={"key": "a", "label": "A"}, headers=h)
    assert r.status_code == 404
    r = await client.post(f"{BASE}/users/types", json={"key": "1abc", "label": "A"}, headers=h)
    assert r.status_code == 422
    # The audit entry names the metric (by label) and the type.
    entries = await _audit(db, "admin.metamodel.license_type.created")
    assert {(e.target_id, e.target_label) for e in entries} == {
        ("users/prod", "Users / Prod"),
        ("installations/prod", "Installations / P"),
    }


async def test_patch_type_archives_restores_and_cannot_move_metric(client, env, db):
    h = env["h"]
    await client.post(f"{BASE}/users/types", json={"key": "dev", "label": "Dev"}, headers=h)
    url = f"{BASE}/users/types/dev"
    r = await client.patch(url, json={"archived": True, "metric_key": "installations"}, headers=h)
    assert r.status_code == 200
    assert (r.json()["archived"], r.json()["metric_key"]) == (True, "users")
    r = await client.patch(url, json={"archived": False}, headers=h)
    assert r.json()["archived"] is False
    entries = await _audit(db, "admin.metamodel.license_type.updated")
    assert len(entries) == 2
    assert all(e.target_id == "users/dev" and e.target_label == "Users / Dev" for e in entries)
    assert "archived" in str(entries[0].details)


async def test_patch_type_is_scoped_to_its_metric(client, env):
    h = env["h"]
    await client.post(f"{BASE}/users/types", json={"key": "dev", "label": "Dev"}, headers=h)
    r = await client.patch(f"{BASE}/installations/types/dev", json={"label": "x"}, headers=h)
    assert r.status_code == 404
    r = await client.patch(f"{BASE}/nope/types/dev", json={"label": "x"}, headers=h)
    assert r.status_code == 404


async def test_old_license_types_routes_are_gone(client, env):
    h = env["h"]
    assert (await client.get("/api/v1/metamodel/license-types", headers=h)).status_code == 404
    r = await client.post(
        "/api/v1/metamodel/license-types",
        json={"metric_key": "users", "key": "a", "label": "A"},
        headers=h,
    )
    assert r.status_code in (404, 405)
