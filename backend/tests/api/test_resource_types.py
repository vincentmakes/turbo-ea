"""Integration tests for admin-managed resource types.

Covers the ``/metamodel/resource-types`` CRUD surface (link types & file
categories), the ``kind`` discriminator, built-in-protection, permission
gating, and the bootstrap surface that the card Resources tab reads from.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.resource_type import ResourceType
from tests.conftest import auth_headers, create_role, create_user


@pytest.fixture
async def rt_env(db):
    """Admin + viewer + one built-in link type to mirror seeded state."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")

    builtin = ResourceType(
        id=uuid.uuid4(),
        kind="link_type",
        key="contract",
        label="Contract",
        icon="contract",
        is_enabled=True,
        built_in=True,
        sort_order=20,
        translations={"fr": "Contrat"},
    )
    db.add(builtin)
    await db.flush()
    return {"admin": admin, "viewer": viewer, "builtin": builtin}


class TestListAndCreate:
    async def test_list_returns_seeded_builtin(self, client, db, rt_env):
        r = await client.get(
            "/api/v1/metamodel/resource-types",
            headers=auth_headers(rt_env["admin"]),
        )
        assert r.status_code == 200
        keys = [(rt["kind"], rt["key"]) for rt in r.json()]
        assert ("link_type", "contract") in keys

    async def test_list_authenticated_read(self, client, db, rt_env):
        """Read is open to any authenticated user (not just admin)."""
        r = await client.get(
            "/api/v1/metamodel/resource-types",
            headers=auth_headers(rt_env["viewer"]),
        )
        assert r.status_code == 200

    async def test_kind_filter(self, client, db, rt_env):
        db.add(
            ResourceType(
                id=uuid.uuid4(),
                kind="file_category",
                key="design",
                label="Design",
                is_enabled=True,
                built_in=False,
                sort_order=60,
                translations={},
            )
        )
        await db.flush()
        r = await client.get(
            "/api/v1/metamodel/resource-types?kind=file_category",
            headers=auth_headers(rt_env["admin"]),
        )
        assert r.status_code == 200
        kinds = {rt["kind"] for rt in r.json()}
        assert kinds == {"file_category"}

    async def test_enabled_only_filter(self, client, db, rt_env):
        db.add(
            ResourceType(
                id=uuid.uuid4(),
                kind="link_type",
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
            "/api/v1/metamodel/resource-types",
            headers=auth_headers(rt_env["admin"]),
        )
        enabled_resp = await client.get(
            "/api/v1/metamodel/resource-types?enabled_only=true",
            headers=auth_headers(rt_env["admin"]),
        )
        assert "custom_a" in [r["key"] for r in all_resp.json()]
        assert "custom_a" not in [r["key"] for r in enabled_resp.json()]

    async def test_create_custom_link_type(self, client, db, rt_env):
        r = await client.post(
            "/api/v1/metamodel/resource-types",
            json={
                "kind": "link_type",
                "key": "runbook",
                "label": "Runbook",
                "icon": "menu_book",
                "sort_order": 200,
            },
            headers=auth_headers(rt_env["admin"]),
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["key"] == "runbook"
        assert body["kind"] == "link_type"
        assert body["icon"] == "menu_book"
        assert body["built_in"] is False

    async def test_create_lowercases_key(self, client, db, rt_env):
        r = await client.post(
            "/api/v1/metamodel/resource-types",
            json={"kind": "file_category", "key": "  Invoices  ", "label": "Invoices"},
            headers=auth_headers(rt_env["admin"]),
        )
        assert r.status_code == 201
        assert r.json()["key"] == "invoices"

    async def test_create_rejects_bad_kind(self, client, db, rt_env):
        r = await client.post(
            "/api/v1/metamodel/resource-types",
            json={"kind": "nonsense", "key": "x", "label": "X"},
            headers=auth_headers(rt_env["admin"]),
        )
        assert r.status_code == 400

    async def test_create_allows_same_key_across_kinds(self, client, db, rt_env):
        """Uniqueness is per (kind, key) — 'security' can exist in both lists."""
        r1 = await client.post(
            "/api/v1/metamodel/resource-types",
            json={"kind": "link_type", "key": "security", "label": "Security"},
            headers=auth_headers(rt_env["admin"]),
        )
        r2 = await client.post(
            "/api/v1/metamodel/resource-types",
            json={"kind": "file_category", "key": "security", "label": "Security"},
            headers=auth_headers(rt_env["admin"]),
        )
        assert r1.status_code == 201
        assert r2.status_code == 201

    async def test_create_rejects_duplicate_kind_key(self, client, db, rt_env):
        r = await client.post(
            "/api/v1/metamodel/resource-types",
            json={"kind": "link_type", "key": "contract", "label": "Duplicate"},
            headers=auth_headers(rt_env["admin"]),
        )
        assert r.status_code == 400

    async def test_create_requires_admin(self, client, db, rt_env):
        r = await client.post(
            "/api/v1/metamodel/resource-types",
            json={"kind": "link_type", "key": "blocked", "label": "Blocked"},
            headers=auth_headers(rt_env["viewer"]),
        )
        assert r.status_code == 403


class TestUpdateAndDelete:
    async def test_disable_builtin_succeeds(self, client, db, rt_env):
        builtin = rt_env["builtin"]
        r = await client.patch(
            f"/api/v1/metamodel/resource-types/{builtin.id}",
            json={"is_enabled": False},
            headers=auth_headers(rt_env["admin"]),
        )
        assert r.status_code == 200
        assert r.json()["is_enabled"] is False

    async def test_edit_builtin_label_and_icon(self, client, db, rt_env):
        builtin = rt_env["builtin"]
        r = await client.patch(
            f"/api/v1/metamodel/resource-types/{builtin.id}",
            json={"label": "Agreement", "icon": "gavel"},
            headers=auth_headers(rt_env["admin"]),
        )
        assert r.status_code == 200
        assert r.json()["label"] == "Agreement"
        assert r.json()["icon"] == "gavel"

    async def test_delete_builtin_refused(self, client, db, rt_env):
        builtin = rt_env["builtin"]
        r = await client.delete(
            f"/api/v1/metamodel/resource-types/{builtin.id}",
            headers=auth_headers(rt_env["admin"]),
        )
        assert r.status_code == 400

    async def test_delete_custom_succeeds(self, client, db, rt_env):
        created = await client.post(
            "/api/v1/metamodel/resource-types",
            json={"kind": "file_category", "key": "invoices", "label": "Invoices"},
            headers=auth_headers(rt_env["admin"]),
        )
        rt_id = created.json()["id"]
        r = await client.delete(
            f"/api/v1/metamodel/resource-types/{rt_id}",
            headers=auth_headers(rt_env["admin"]),
        )
        assert r.status_code == 204


class TestBootstrapSurface:
    async def test_bootstrap_includes_resource_types(self, client, db, rt_env):
        r = await client.get("/api/v1/settings/bootstrap", headers=auth_headers(rt_env["admin"]))
        assert r.status_code == 200
        body = r.json()
        assert "resource_types" in body
        keys = [(rt["kind"], rt["key"]) for rt in body["resource_types"]]
        assert ("link_type", "contract") in keys
