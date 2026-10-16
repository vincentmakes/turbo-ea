"""A ``boolean`` attribute is true, false or not set (#1266).

Every reader treats a boolean as three-valued — card detail shows ``—`` / ✗ /
✓, the inventory filters Empty / No / Yes — and the editors now offer
Yes / No / Not set, so clearing a boolean back to ``null`` is a legal write.
Anything else (the string ``"yes"``) used to be stored as given and read as
unset everywhere; it is refused on every write path a client can reach, while
a legacy value a card already carries stays editable.
"""

from __future__ import annotations

import pytest

from app.core.permissions import MEMBER_PERMISSIONS
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

SCHEMA = [
    {
        "section": "Details",
        "fields": [
            {"key": "commercial", "label": "Commercial", "type": "boolean", "weight": 1},
            {"key": "notes", "label": "Notes", "type": "text", "weight": 1},
        ],
    }
]
DETAIL = "Field 'commercial' must be true or false"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions={"inventory.view": True})
    await create_card_type(db, key="Application", label="Application", fields_schema=SCHEMA)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"headers": auth_headers(admin), "viewer": auth_headers(viewer)}


class TestPatch:
    async def test_a_boolean_can_be_cleared_back_to_not_set(self, client, db, env):
        card = await create_card(db, name="CRM", attributes={"commercial": False})
        await db.commit()
        resp = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"attributes": {"commercial": None}},
            headers=env["headers"],
        )
        assert resp.status_code == 200
        assert resp.json()["attributes"].get("commercial") is None

    async def test_false_is_stored_as_false(self, client, db, env):
        card = await create_card(db, name="CRM")
        await db.commit()
        resp = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"attributes": {"commercial": False}},
            headers=env["headers"],
        )
        assert resp.status_code == 200
        assert resp.json()["attributes"]["commercial"] is False

    async def test_a_string_is_refused(self, client, db, env):
        card = await create_card(db, name="CRM")
        await db.commit()
        resp = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"attributes": {"commercial": "yes"}},
            headers=env["headers"],
        )
        assert resp.status_code == 422
        assert resp.json()["detail"] == DETAIL

    async def test_a_stored_legacy_string_does_not_block_another_edit(self, client, db, env):
        card = await create_card(db, name="CRM", attributes={"commercial": "yes"})
        await db.commit()
        resp = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"attributes": {"commercial": "yes", "notes": "still editable"}},
            headers=env["headers"],
        )
        assert resp.status_code == 200
        assert resp.json()["attributes"]["notes"] == "still editable"

    async def test_a_reader_without_edit_rights_is_refused_before_validation(self, client, db, env):
        card = await create_card(db, name="CRM")
        await db.commit()
        resp = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"attributes": {"commercial": True}},
            headers=env["viewer"],
        )
        assert resp.status_code == 403


class TestOtherWritePaths:
    async def test_create_refuses_a_string_and_accepts_a_boolean(self, client, env):
        bad = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "Bad", "attributes": {"commercial": "true"}},
            headers=env["headers"],
        )
        assert bad.status_code == 422
        assert bad.json()["detail"] == DETAIL
        good = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "Good", "attributes": {"commercial": False}},
            headers=env["headers"],
        )
        assert good.status_code == 201
        assert good.json()["attributes"]["commercial"] is False

    async def test_bulk_update_refuses_a_number(self, client, db, env):
        card = await create_card(db, name="CRM")
        await db.commit()
        resp = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(card.id)], "updates": {"attributes": {"commercial": 1}}},
            headers=env["headers"],
        )
        assert resp.status_code == 422
        assert resp.json()["detail"] == DETAIL

    async def test_bulk_update_can_clear(self, client, db, env):
        card = await create_card(db, name="CRM", attributes={"commercial": True})
        await db.commit()
        resp = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(card.id)], "updates": {"attributes": {"commercial": None}}},
            headers=env["headers"],
        )
        assert resp.status_code == 200

    async def test_bulk_create_reports_the_row(self, client, env):
        resp = await client.post(
            "/api/v1/cards/bulk-create",
            json={
                "cards": [
                    {
                        "row_index": 1,
                        "type": "Application",
                        "name": "Bulk",
                        "attributes": {"commercial": "no"},
                    }
                ]
            },
            headers=env["headers"],
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["created"] == 0 and body["failed"] == 1
        assert DETAIL in body["results"][0]["error"]
