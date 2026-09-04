"""Route-level enforcement of per-card-type permission overrides (discussion #1068).

A card type may override `inventory.create` / `edit` / `archive` / `delete` per
role. These tests pin the behaviour at the HTTP boundary: a deny removes a
role's landscape-wide grant for that type only, an allow grants above the role,
admin is immune, and a stakeholder's per-card authority survives a type deny.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import (
    MEMBER_PERMISSIONS,
    RESPONSIBLE_CARD_PERMISSIONS,
    VIEWER_PERMISSIONS,
)
from app.models.card import Card
from app.models.card_type import CardType
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)


async def set_overrides(db, type_key: str, overrides: dict) -> None:
    """Write a type's override map and drop the per-process permission cache."""
    ct = (await db.execute(select(CardType).where(CardType.key == type_key))).scalar_one()
    ct.role_permissions = overrides
    await db.flush()
    PermissionService.invalidate_type_permission_cache(type_key)


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    app_type = await create_card_type(db, key="Application", label="Application")
    itc_type = await create_card_type(db, key="ITComponent", label="IT Component")
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    PermissionService.invalidate_type_permission_cache()
    return {
        "app_type": app_type,
        "itc_type": itc_type,
        "admin": admin,
        "member": member,
        "viewer": viewer,
    }


# ---------------------------------------------------------------------------
# POST /cards
# ---------------------------------------------------------------------------


class TestCreateGate:
    async def test_denied_type_returns_403(self, client, db, env):
        await set_overrides(db, "Application", {"member": {"inventory.create": False}})
        response = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "Blocked"},
            headers=auth_headers(env["member"]),
        )
        assert response.status_code == 403

    async def test_other_type_still_allowed(self, client, db, env):
        await set_overrides(db, "Application", {"member": {"inventory.create": False}})
        response = await client.post(
            "/api/v1/cards",
            json={"type": "ITComponent", "name": "Allowed"},
            headers=auth_headers(env["member"]),
        )
        assert response.status_code == 201

    async def test_allow_grants_a_role_that_lacks_the_global_permission(self, client, db, env):
        await set_overrides(db, "Application", {"viewer": {"inventory.create": True}})
        response = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "Viewer App"},
            headers=auth_headers(env["viewer"]),
        )
        assert response.status_code == 201

    async def test_allow_is_scoped_to_the_granted_type(self, client, db, env):
        await set_overrides(db, "Application", {"viewer": {"inventory.create": True}})
        response = await client.post(
            "/api/v1/cards",
            json={"type": "ITComponent", "name": "Still Blocked"},
            headers=auth_headers(env["viewer"]),
        )
        assert response.status_code == 403

    async def test_admin_is_immune(self, client, db, env):
        await set_overrides(db, "Application", {"member": {"inventory.create": False}})
        response = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "Admin App"},
            headers=auth_headers(env["admin"]),
        )
        assert response.status_code == 201


# ---------------------------------------------------------------------------
# POST /cards/bulk-create
# ---------------------------------------------------------------------------


class TestBulkCreateGate:
    async def test_mixed_batch_is_refused_and_creates_nothing(self, client, db, env):
        await set_overrides(db, "Application", {"member": {"inventory.create": False}})
        response = await client.post(
            "/api/v1/cards/bulk-create",
            json={
                "cards": [
                    {"row_index": 1, "type": "ITComponent", "name": "Fine"},
                    {"row_index": 2, "type": "Application", "name": "Denied"},
                ]
            },
            headers=auth_headers(env["member"]),
        )
        assert response.status_code == 403
        # The denied type is named so an importer can point at the right sheet.
        assert "Application" in response.json()["detail"]

        remaining = (await db.execute(select(Card).where(Card.name == "Fine"))).scalars().all()
        assert remaining == []

    async def test_batch_of_permitted_types_succeeds(self, client, db, env):
        await set_overrides(db, "Application", {"member": {"inventory.create": False}})
        response = await client.post(
            "/api/v1/cards/bulk-create",
            json={"cards": [{"row_index": 1, "type": "ITComponent", "name": "Fine"}]},
            headers=auth_headers(env["member"]),
        )
        assert response.status_code == 200

    async def test_allow_override_reaches_bulk_create(self, client, db, env):
        await set_overrides(db, "Application", {"viewer": {"inventory.create": True}})
        response = await client.post(
            "/api/v1/cards/bulk-create",
            json={"cards": [{"row_index": 1, "type": "Application", "name": "Viewer Bulk"}]},
            headers=auth_headers(env["viewer"]),
        )
        assert response.status_code == 200


# ---------------------------------------------------------------------------
# PATCH /cards/{id}, archive, delete
# ---------------------------------------------------------------------------


class TestWriteGates:
    async def test_edit_denied_for_type(self, client, db, env):
        card = await create_card(db, card_type="Application", name="App", user_id=env["admin"].id)
        await set_overrides(db, "Application", {"member": {"inventory.edit": False}})
        response = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"name": "Renamed"},
            headers=auth_headers(env["member"]),
        )
        assert response.status_code == 403

    async def test_edit_allowed_on_another_type(self, client, db, env):
        card = await create_card(db, card_type="ITComponent", name="C", user_id=env["admin"].id)
        await set_overrides(db, "Application", {"member": {"inventory.edit": False}})
        response = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"name": "Renamed"},
            headers=auth_headers(env["member"]),
        )
        assert response.status_code == 200

    async def test_stakeholder_can_still_edit_a_denied_type(self, client, db, env):
        """A type deny removes the landscape-wide grant, never the authority
        someone holds as the responsible owner of one specific card."""
        card = await create_card(db, card_type="Application", name="App", user_id=env["admin"].id)
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="responsible",
            permissions=RESPONSIBLE_CARD_PERMISSIONS,
        )
        from app.models.stakeholder import Stakeholder

        db.add(Stakeholder(card_id=card.id, user_id=env["member"].id, role="responsible"))
        await db.flush()
        await set_overrides(db, "Application", {"member": {"inventory.edit": False}})
        PermissionService.invalidate_srd_cache()

        response = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"name": "Owner Renamed"},
            headers=auth_headers(env["member"]),
        )
        assert response.status_code == 200

    async def test_archive_denied_for_type(self, client, db, env):
        card = await create_card(db, card_type="Application", name="App", user_id=env["admin"].id)
        await set_overrides(db, "Application", {"member": {"inventory.archive": False}})
        response = await client.post(
            f"/api/v1/cards/{card.id}/archive", json={}, headers=auth_headers(env["member"])
        )
        assert response.status_code == 403

    async def test_delete_allowed_by_override(self, client, db, env):
        card = await create_card(db, card_type="Application", name="App", user_id=env["admin"].id)
        # Member has no `inventory.delete` globally; the type grants it.
        await set_overrides(db, "Application", {"member": {"inventory.delete": True}})
        response = await client.delete(
            f"/api/v1/cards/{card.id}", headers=auth_headers(env["member"])
        )
        assert response.status_code in (200, 204)

    async def test_bulk_archive_refuses_when_one_card_is_denied(self, client, db, env):
        allowed = await create_card(db, card_type="ITComponent", name="C", user_id=env["admin"].id)
        denied = await create_card(db, card_type="Application", name="App", user_id=env["admin"].id)
        await set_overrides(db, "Application", {"member": {"inventory.archive": False}})
        response = await client.post(
            "/api/v1/cards/bulk-archive",
            json={"card_ids": [str(allowed.id), str(denied.id)]},
            headers=auth_headers(env["member"]),
        )
        assert response.status_code == 403


class TestBulkUpdateGate:
    """Bulk edit is asymmetric: a type deny blocks, a type allow grants nothing."""

    async def test_denied_type_blocks_the_batch(self, client, db, env):
        card = await create_card(db, card_type="Application", name="App", user_id=env["admin"].id)
        await set_overrides(db, "Application", {"member": {"inventory.edit": False}})
        response = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(card.id)], "updates": {"description": "x"}},
            headers=auth_headers(env["member"]),
        )
        assert response.status_code == 403
        assert "Application" in response.json()["detail"]

    async def test_permitted_types_still_pass(self, client, db, env):
        card = await create_card(db, card_type="ITComponent", name="C", user_id=env["admin"].id)
        await set_overrides(db, "Application", {"member": {"inventory.edit": False}})
        response = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(card.id)], "updates": {"description": "x"}},
            headers=auth_headers(env["member"]),
        )
        assert response.status_code == 200

    async def test_type_allow_does_not_grant_bulk_edit(self, client, db, env):
        """`inventory.bulk_edit` remains the authority to edit in bulk at all —
        a per-type allow must not silently confer it."""
        card = await create_card(db, card_type="Application", name="App", user_id=env["admin"].id)
        await set_overrides(db, "Application", {"viewer": {"inventory.edit": True}})
        response = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(card.id)], "updates": {"description": "x"}},
            headers=auth_headers(env["viewer"]),
        )
        assert response.status_code == 403


# ---------------------------------------------------------------------------
# GET /cards/{id}/my-permissions
# ---------------------------------------------------------------------------


class TestMyPermissions:
    async def test_reflects_the_override(self, client, db, env):
        card = await create_card(db, card_type="Application", name="App", user_id=env["admin"].id)
        await set_overrides(db, "Application", {"member": {"inventory.edit": False}})
        response = await client.get(
            f"/api/v1/cards/{card.id}/my-permissions", headers=auth_headers(env["member"])
        )
        assert response.status_code == 200
        body = response.json()
        assert body["effective"]["can_edit"] is False
        assert body["effective"]["can_view"] is True

    async def test_unaffected_type_keeps_its_permissions(self, client, db, env):
        card = await create_card(db, card_type="ITComponent", name="C", user_id=env["admin"].id)
        await set_overrides(db, "Application", {"member": {"inventory.edit": False}})
        response = await client.get(
            f"/api/v1/cards/{card.id}/my-permissions", headers=auth_headers(env["member"])
        )
        assert response.json()["effective"]["can_edit"] is True


# ---------------------------------------------------------------------------
# GET /auth/me
# ---------------------------------------------------------------------------


class TestAuthMeTypePermissions:
    async def test_member_receives_only_their_own_cells(self, client, db, env):
        await set_overrides(
            db,
            "Application",
            {"member": {"inventory.create": False}, "viewer": {"inventory.edit": True}},
        )
        response = await client.get("/api/v1/auth/me", headers=auth_headers(env["member"]))
        assert response.status_code == 200
        assert response.json()["type_permissions"] == {"Application": {"inventory.create": False}}

    async def test_admin_receives_an_empty_map(self, client, db, env):
        await set_overrides(db, "Application", {"member": {"inventory.create": False}})
        response = await client.get("/api/v1/auth/me", headers=auth_headers(env["admin"]))
        assert response.json()["type_permissions"] == {}

    async def test_absent_overrides_yield_an_empty_map(self, client, db, env):
        response = await client.get("/api/v1/auth/me", headers=auth_headers(env["member"]))
        assert response.json()["type_permissions"] == {}


# ---------------------------------------------------------------------------
# Reference-catalogue importers (fixed card type per route)
# ---------------------------------------------------------------------------


class TestCatalogueImporterGate:
    """The importers create one known type, so they are gated on that type."""

    async def test_import_refused_when_the_type_denies_create(self, client, db, env):
        await create_card_type(db, key="BusinessCapability", label="Business Capability")
        PermissionService.invalidate_type_permission_cache()
        await set_overrides(db, "BusinessCapability", {"member": {"inventory.create": False}})

        response = await client.post(
            "/api/v1/capability-catalogue/import",
            json={"ids": ["anything"]},
            headers=auth_headers(env["member"]),
        )
        assert response.status_code == 403

    async def test_import_allowed_when_the_type_grants_create(self, client, db, env):
        """A viewer with no global create permission may still import when the
        capability type explicitly allows it."""
        await create_card_type(db, key="BusinessCapability", label="Business Capability")
        PermissionService.invalidate_type_permission_cache()
        await set_overrides(db, "BusinessCapability", {"viewer": {"inventory.create": True}})

        response = await client.post(
            "/api/v1/capability-catalogue/import",
            json={"ids": []},
            headers=auth_headers(env["viewer"]),
        )
        # Past the permission gate — whatever the importer then makes of an
        # empty selection is not this test's concern.
        assert response.status_code != 403
