"""Integration tests for `POST /relations/bulk`."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.relation import Relation
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)


@pytest.fixture
async def rel_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_relation_type(
        db,
        key="app_to_itc",
        label="depends on",
        source_type_key="Application",
        target_type_key="ITComponent",
        cardinality="n:m",
    )
    await create_relation_type(
        db,
        key="primary_owner",
        label="primarily owns",
        source_type_key="Application",
        target_type_key="ITComponent",
        cardinality="1:1",
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    app1 = await create_card(db, card_type="Application", name="App One", user_id=admin.id)
    app2 = await create_card(db, card_type="Application", name="App Two", user_id=admin.id)
    itc1 = await create_card(db, card_type="ITComponent", name="DB", user_id=admin.id)
    itc2 = await create_card(db, card_type="ITComponent", name="Cache", user_id=admin.id)
    await db.commit()
    return {
        "admin": admin,
        "viewer": viewer,
        "app1": app1,
        "app2": app2,
        "itc1": itc1,
        "itc2": itc2,
    }


async def test_bulk_upsert_creates_new_relation(client, db, rel_env):
    admin = rel_env["admin"]
    payload = {
        "operations": [
            {
                "row_index": 1,
                "action": "upsert",
                "type": "app_to_itc",
                "source": {"id": str(rel_env["app1"].id)},
                "target": {"id": str(rel_env["itc1"].id)},
            }
        ]
    }
    resp = await client.post("/api/v1/relations/bulk", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["upserted"] == 1
    assert body["failed"] == 0


async def test_bulk_resolves_source_and_target_by_name(client, db, rel_env):
    admin = rel_env["admin"]
    payload = {
        "operations": [
            {
                "row_index": 1,
                "action": "upsert",
                "type": "app_to_itc",
                "source": {"type": "Application", "name": "App One"},
                "target": {"type": "ITComponent", "name": "DB"},
            }
        ]
    }
    resp = await client.post("/api/v1/relations/bulk", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200, resp.text
    assert resp.json()["upserted"] == 1
    rows = await db.execute(select(Relation).where(Relation.type == "app_to_itc"))
    rels = list(rows.scalars().all())
    assert len(rels) == 1
    assert rels[0].source_id == rel_env["app1"].id
    assert rels[0].target_id == rel_env["itc1"].id


async def test_bulk_delete_removes_relation(client, db, rel_env):
    admin = rel_env["admin"]
    rel = await create_relation(
        db,
        type_key="app_to_itc",
        source_id=rel_env["app1"].id,
        target_id=rel_env["itc1"].id,
    )
    await db.commit()
    payload = {
        "operations": [
            {
                "row_index": 1,
                "action": "delete",
                "type": "app_to_itc",
                "source": {"id": str(rel_env["app1"].id)},
                "target": {"id": str(rel_env["itc1"].id)},
            }
        ]
    }
    resp = await client.post("/api/v1/relations/bulk", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 1
    existing = await db.get(Relation, rel.id)
    assert existing is None


async def test_bulk_cardinality_violation_fails_row(client, db, rel_env):
    """1:1 relation type forbids a second relation from the same source."""
    admin = rel_env["admin"]
    payload = {
        "operations": [
            {
                "row_index": 1,
                "action": "upsert",
                "type": "primary_owner",
                "source": {"id": str(rel_env["app1"].id)},
                "target": {"id": str(rel_env["itc1"].id)},
            },
            {
                "row_index": 2,
                "action": "upsert",
                "type": "primary_owner",
                "source": {"id": str(rel_env["app1"].id)},
                "target": {"id": str(rel_env["itc2"].id)},
            },
        ]
    }
    resp = await client.post("/api/v1/relations/bulk", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200
    body = resp.json()
    assert body["upserted"] == 1
    assert body["failed"] == 1
    failed = next(r for r in body["results"] if r["row_index"] == 2)
    assert "Cardinality" in (failed["error"] or "")


async def test_bulk_unknown_relation_type_fails_row(client, db, rel_env):
    admin = rel_env["admin"]
    payload = {
        "operations": [
            {
                "row_index": 1,
                "action": "upsert",
                "type": "not_a_real_type",
                "source": {"id": str(rel_env["app1"].id)},
                "target": {"id": str(rel_env["itc1"].id)},
            }
        ]
    }
    resp = await client.post("/api/v1/relations/bulk", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200
    body = resp.json()
    assert body["failed"] == 1
    assert "Unknown relation type" in (body["results"][0]["error"] or "")


async def test_bulk_viewer_forbidden(client, db, rel_env):
    viewer = rel_env["viewer"]
    payload = {
        "operations": [
            {
                "row_index": 1,
                "action": "upsert",
                "type": "app_to_itc",
                "source": {"id": str(rel_env["app1"].id)},
                "target": {"id": str(rel_env["itc1"].id)},
            }
        ]
    }
    resp = await client.post("/api/v1/relations/bulk", json=payload, headers=auth_headers(viewer))
    assert resp.status_code == 403
