"""Stakeholder role definition writes record ``admin.stakeholder_role.*`` rows.

``_rows`` rolls the session back before reading, so only what the route
committed is seen; ids and headers are captured before the request.

DB-backed: skipped locally without PostgreSQL, run in CI.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLogEntry
from tests.conftest import (
    auth_headers,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

BASE = "/api/v1/metamodel/types/Application/stakeholder-roles"


async def _rows(db) -> list[AuditLogEntry]:
    await db.rollback()
    result = await db.execute(
        select(AuditLogEntry)
        .where(AuditLogEntry.action.like("admin.stakeholder_role.%"))
        .order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars().all())


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    # A label that differs from the key, so the target label proves it names
    # the type by its label.
    await create_card_type(db, key="Application", label="Business App")
    await create_stakeholder_role_def(
        db,
        card_type_key="Application",
        key="responsible",
        label="Responsible",
        permissions={"card.view": True, "card.edit": True},
    )
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="observer", label="Observer"
    )
    return {"admin_id": admin.id, "h": auth_headers(admin)}


def _target(row, key: str, label: str):
    assert (row.target_type, row.target_id, row.target_label) == (
        "stakeholder_role",
        f"Application:{key}",
        f"{label} (Business App)",
    )


async def test_create_records(client, db, env):
    resp = await client.post(
        BASE,
        json={"key": "reviewer", "label": "Reviewer", "permissions": {"card.view": True}},
        headers=env["h"],
    )
    assert resp.status_code == 201

    [row] = await _rows(db)
    assert (row.action, row.category, row.outcome) == (
        "admin.stakeholder_role.created",
        "admin",
        "success",
    )
    assert row.actor_user_id == env["admin_id"]
    _target(row, "reviewer", "Reviewer")
    assert row.details == {
        "context": {
            "color": "#757575",
            "counts_for_quality": True,
            "card_type": "Business App",
        },
        "items": [{"kind": "permission.granted", "permission": "card.view"}],
    }


async def test_update_records_rekey_and_permission_diff(client, db, env):
    resp = await client.patch(
        f"{BASE}/observer",
        json={
            "key": "watcher",
            "label": "Watcher",
            "permissions": {"card.view": True},
        },
        headers=env["h"],
    )
    assert resp.status_code == 200

    [row] = await _rows(db)
    assert row.action == "admin.stakeholder_role.updated"
    _target(row, "watcher", "Watcher")
    assert row.details == {
        "changes": {
            "label": {"old": "Observer", "new": "Watcher"},
            "key": {"old": "observer", "new": "watcher"},
        },
        "items": [{"kind": "permission.granted", "permission": "card.view"}],
        "context": {"card_type": "Business App"},
    }


async def test_no_op_update_records_nothing(client, db, env):
    resp = await client.patch(
        f"{BASE}/responsible",
        json={"label": "Responsible", "permissions": {"card.view": True, "card.edit": True}},
        headers=env["h"],
    )
    assert resp.status_code == 200

    assert await _rows(db) == []


async def test_update_records_plain_fields_and_a_revoked_permission(client, db, env):
    resp = await client.patch(
        f"{BASE}/responsible",
        json={
            "color": "#ff0000",
            "counts_for_quality": False,
            "sort_order": 7,
            "permissions": {"card.view": True},
        },
        headers=env["h"],
    )
    assert resp.status_code == 200

    [row] = await _rows(db)
    _target(row, "responsible", "Responsible")
    assert row.details == {
        "changes": {
            "color": {"old": "#757575", "new": "#ff0000"},
            "sort_order": {"old": 0, "new": 7},
            "counts_for_quality": {"old": True, "new": False},
        },
        "items": [{"kind": "permission.revoked", "permission": "card.edit"}],
        "context": {"card_type": "Business App"},
    }


async def test_an_unknown_type_label_falls_back_to_the_key(client, db, env):
    await create_card_type(db, key="Gizmo", label="")
    await create_stakeholder_role_def(db, card_type_key="Gizmo", key="owner", label="Owner")
    await create_stakeholder_role_def(db, card_type_key="Gizmo", key="helper", label="Helper")
    resp = await client.post(
        "/api/v1/metamodel/types/Gizmo/stakeholder-roles/helper/archive", headers=env["h"]
    )
    assert resp.status_code == 200

    [row] = await _rows(db)
    assert (row.target_id, row.target_label) == ("Gizmo:helper", "Helper (Gizmo)")
    assert row.details == {"context": {"affected_stakeholders": 0, "card_type": "Gizmo"}}


async def test_delete_archive_restore_record(client, db, env):
    assert (await client.post(f"{BASE}/observer/archive", headers=env["h"])).status_code == 200
    assert (await client.post(f"{BASE}/observer/restore", headers=env["h"])).status_code == 200
    assert (await client.delete(f"{BASE}/observer", headers=env["h"])).status_code == 204

    rows = await _rows(db)
    assert [r.action for r in rows] == [
        "admin.stakeholder_role.archived",
        "admin.stakeholder_role.restored",
        "admin.stakeholder_role.deleted",
    ]
    assert rows[0].details == {"context": {"affected_stakeholders": 0, "card_type": "Business App"}}
    assert rows[1].details == {"context": {"card_type": "Business App"}}
    assert rows[2].details == {"context": {"card_type": "Business App"}}
    for row in rows:
        _target(row, "observer", "Observer")
        assert row.actor_user_id == env["admin_id"]


async def test_refused_write_records_nothing(client, db, env):
    await create_role(db, key="viewer", label="Viewer", permissions={"inventory.view": True})
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    resp = await client.post(
        BASE, json={"key": "sneaky", "label": "Sneaky"}, headers=auth_headers(viewer)
    )
    assert resp.status_code == 403
    assert await _rows(db) == []
