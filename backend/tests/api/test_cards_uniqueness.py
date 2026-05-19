"""Integration tests: sibling-name uniqueness across the three write paths.

Covers `POST /cards`, `POST /cards/bulk-create`, and `PATCH /cards/{id}`.
The constraint is application-level (no DB unique index), so the helpers
that bypass the API and seed cards directly are deliberately used to set
up pre-existing duplicate state for the regression tests.
"""

from __future__ import annotations

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def uniq_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_card_type(db, key="Application", label="Application", has_hierarchy=True)
    await create_card_type(db, key="Organization", label="Organization", has_hierarchy=True)
    admin = await create_user(db, email="admin@test.com", role="admin")
    return {"admin": admin}


# ---------------------------------------------------------------------------
# POST /cards
# ---------------------------------------------------------------------------


async def test_post_cards_rejects_duplicate(client, db, uniq_env):
    admin = uniq_env["admin"]
    resp = await client.post(
        "/api/v1/cards",
        json={"type": "Application", "name": "ERP"},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 201
    dup = await client.post(
        "/api/v1/cards",
        json={"type": "Application", "name": "ERP"},
        headers=auth_headers(admin),
    )
    assert dup.status_code == 409
    assert "ERP" in dup.json()["detail"]


async def test_post_cards_same_name_different_parent_allowed(client, db, uniq_env):
    admin = uniq_env["admin"]
    eu = await create_card(db, card_type="Organization", name="Europe", user_id=admin.id)
    us = await create_card(db, card_type="Organization", name="Americas", user_id=admin.id)
    await db.commit()
    for parent in (eu, us):
        resp = await client.post(
            "/api/v1/cards",
            json={
                "type": "Organization",
                "name": "Marketing",
                "parent_id": str(parent.id),
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201, resp.text


# ---------------------------------------------------------------------------
# POST /cards/bulk-create
# ---------------------------------------------------------------------------


async def test_bulk_create_per_row_duplicate_fails_that_row(client, db, uniq_env):
    """One duplicate row in a 3-row batch must fail *only* that row;
    the other two go through and we see a clear per-row error message."""
    admin = uniq_env["admin"]
    await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    await db.commit()
    payload = {
        "cards": [
            {"row_index": 1, "type": "Application", "name": "Cache"},
            # ERP already exists at root — this row must fail.
            {"row_index": 2, "type": "Application", "name": "ERP"},
            {"row_index": 3, "type": "Application", "name": "Salesforce"},
        ]
    }
    resp = await client.post("/api/v1/cards/bulk-create", json=payload, headers=auth_headers(admin))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["created"] == 2
    assert body["failed"] == 1
    failed = next(r for r in body["results"] if r["row_index"] == 2)
    assert failed["status"] == "failed"
    assert "ERP" in (failed["error"] or "")


async def test_bulk_create_two_rows_with_same_tuple_only_first_succeeds(client, db, uniq_env):
    """Two rows in the same batch with identical (type, parent, name):
    the first creates, the second sees its sibling already in the DB
    and fails."""
    admin = uniq_env["admin"]
    payload = {
        "cards": [
            {"row_index": 1, "type": "Application", "name": "Twin"},
            {"row_index": 2, "type": "Application", "name": "Twin"},
        ]
    }
    resp = await client.post("/api/v1/cards/bulk-create", json=payload, headers=auth_headers(admin))
    body = resp.json()
    assert body["created"] == 1
    assert body["failed"] == 1


# ---------------------------------------------------------------------------
# PATCH /cards/{id}
# ---------------------------------------------------------------------------


async def test_patch_rename_into_collision_rejected(client, db, uniq_env):
    admin = uniq_env["admin"]
    a = await create_card(db, card_type="Application", name="App A", user_id=admin.id)
    b = await create_card(db, card_type="Application", name="App B", user_id=admin.id)
    await db.commit()
    resp = await client.patch(
        f"/api/v1/cards/{a.id}", json={"name": "App B"}, headers=auth_headers(admin)
    )
    assert resp.status_code == 409
    assert "App B" in resp.json()["detail"]
    # The card was not renamed.
    assert b.name == "App B"


async def test_patch_reparent_into_collision_rejected(client, db, uniq_env):
    admin = uniq_env["admin"]
    parent_a = await create_card(db, card_type="Organization", name="Parent A", user_id=admin.id)
    parent_b = await create_card(db, card_type="Organization", name="Parent B", user_id=admin.id)
    a_marketing = await create_card(
        db,
        card_type="Organization",
        name="Marketing",
        parent_id=parent_a.id,
        user_id=admin.id,
    )
    await create_card(
        db,
        card_type="Organization",
        name="Marketing",
        parent_id=parent_b.id,
        user_id=admin.id,
    )
    await db.commit()
    # Reparenting a_marketing under parent_b would collide with its existing Marketing.
    resp = await client.patch(
        f"/api/v1/cards/{a_marketing.id}",
        json={"parent_id": str(parent_b.id)},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 409


async def test_patch_rename_to_same_name_is_noop(client, db, uniq_env):
    """Saving the form without touching the name field sends the same
    name back to the server; the uniqueness check must not false-positive
    on a card matching itself."""
    admin = uniq_env["admin"]
    a = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    await db.commit()
    resp = await client.patch(
        f"/api/v1/cards/{a.id}",
        json={"name": "ERP", "description": "Now with description"},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200, resp.text


async def test_patch_other_fields_on_preexisting_duplicate_pair_succeeds(client, db, uniq_env):
    """When two cards already share `(type, parent_id, name)` from before
    the constraint was added, editing **other** fields on either of them
    must still succeed. The check only fires for name / parent changes."""
    admin = uniq_env["admin"]
    dup_a = await create_card(db, card_type="Application", name="CentOS v8.0", user_id=admin.id)
    await create_card(db, card_type="Application", name="CentOS v8.0", user_id=admin.id)
    await db.commit()
    resp = await client.patch(
        f"/api/v1/cards/{dup_a.id}",
        json={"description": "Edited despite the pre-existing duplicate"},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200, resp.text
