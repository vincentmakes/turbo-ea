"""Integration tests for the stakeholder role definition endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)


async def _assign(db, *, card, user, role):
    """Give ``user`` the stakeholder ``role`` on ``card``."""
    from app.models.stakeholder import Stakeholder

    stakeholder = Stakeholder(card_id=card.id, user_id=user.id, role=role)
    db.add(stakeholder)
    await db.flush()
    return stakeholder


# ---------------------------------------------------------------------------
# GET /metamodel/types/{type_key}/stakeholder-roles
# ---------------------------------------------------------------------------


class TestListStakeholderRoles:
    async def test_list_roles_for_type(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="observer", label="Observer"
        )

        response = await client.get(
            "/api/v1/metamodel/types/Application/stakeholder-roles",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        keys = [r["key"] for r in response.json()]
        assert "responsible" in keys
        assert "observer" in keys

    async def test_excludes_archived_by_default(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="archivedRole",
            label="Archived",
            is_archived=True,
        )

        response = await client.get(
            "/api/v1/metamodel/types/Application/stakeholder-roles",
            headers=auth_headers(admin),
        )
        keys = [r["key"] for r in response.json()]
        assert "archivedRole" not in keys

    async def test_nonexistent_type_returns_404(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.get(
            "/api/v1/metamodel/types/Nonexistent/stakeholder-roles",
            headers=auth_headers(admin),
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST /metamodel/types/{type_key}/stakeholder-roles
# ---------------------------------------------------------------------------


class TestCreateStakeholderRole:
    async def test_create_role(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles",
            json={
                "key": "technicalOwner",
                "label": "Technical Owner",
                "permissions": {"card.view": True, "card.edit": True},
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 201
        data = response.json()
        assert data["key"] == "technicalOwner"
        assert data["card_type_key"] == "Application"
        assert data["stakeholder_count"] == 0

    async def test_duplicate_key_returns_409(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles",
            json={"key": "responsible", "label": "Duplicate"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 409

    async def test_invalid_key_pattern_rejected(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles",
            json={"key": "BAD-KEY!", "label": "Bad"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 422

    async def test_unknown_permission_key_rejected(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles",
            json={
                "key": "badPerms",
                "label": "Bad",
                "permissions": {"fake.permission": True},
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 422

    async def test_wildcard_not_allowed(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles",
            json={
                "key": "wildcardRole",
                "label": "Wildcard",
                "permissions": {"*": True},
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 422

    async def test_nonexistent_type_returns_404(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.post(
            "/api/v1/metamodel/types/Nonexistent/stakeholder-roles",
            json={"key": "testRole", "label": "Test"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# PATCH /metamodel/types/{type_key}/stakeholder-roles/{role_key}
# ---------------------------------------------------------------------------


class TestUpdateStakeholderRole:
    async def test_update_label(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )

        response = await client.patch(
            "/api/v1/metamodel/types/Application/stakeholder-roles/responsible",
            json={"label": "Primary Owner"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["label"] == "Primary Owner"

    async def test_null_translations_normalised(self, client, db):
        """`translations` is NOT NULL — clearing every translation must not 500.

        Asserted on the stored column: the response serializer masks a NULL with
        ``or {}``, so asserting on the response would be vacuous.
        """
        from sqlalchemy import select

        from app.models.stakeholder_role_definition import StakeholderRoleDefinition

        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )

        response = await client.patch(
            "/api/v1/metamodel/types/Application/stakeholder-roles/responsible",
            json={"translations": None},
            headers=auth_headers(admin),
        )

        assert response.status_code == 200
        stored = await db.execute(
            select(StakeholderRoleDefinition.translations).where(
                StakeholderRoleDefinition.card_type_key == "Application",
                StakeholderRoleDefinition.key == "responsible",
            )
        )
        assert stored.scalar_one() == {}

    async def test_cannot_update_archived(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="oldRole",
            label="Old",
            is_archived=True,
        )

        response = await client.patch(
            "/api/v1/metamodel/types/Application/stakeholder-roles/oldRole",
            json={"label": "Updated"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_nonexistent_returns_404(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")

        response = await client.patch(
            "/api/v1/metamodel/types/Application/stakeholder-roles/nonexistent",
            json={"label": "Nope"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST .../archive + .../restore
# ---------------------------------------------------------------------------


class TestArchiveRestoreStakeholderRole:
    async def test_archive_role(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="observer", label="Observer"
        )

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles/observer/archive",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["is_archived"] is True

    async def test_cannot_archive_last_active_role(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="onlyRole", label="Only Role"
        )

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles/onlyRole/archive",
            headers=auth_headers(admin),
        )
        assert response.status_code == 409

    async def test_cannot_archive_already_archived(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="already",
            label="Already",
            is_archived=True,
        )

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles/already/archive",
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_restore_role(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="archivedRole",
            label="Archived",
            is_archived=True,
        )

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles/archivedRole/restore",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["is_archived"] is False

    async def test_archive_affected_count_is_scoped_to_the_card_type(self, client, db):
        """Regression: the reported impact used to include every card type."""
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        member = await create_user(db, email="member@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        for type_key in ("Application", "ITComponent"):
            await create_stakeholder_role_def(
                db, card_type_key=type_key, key="responsible", label="Responsible"
            )
            await create_stakeholder_role_def(
                db, card_type_key=type_key, key="observer", label="Observer"
            )

        app_card = await create_card(db, card_type="Application", name="App")
        itc_card = await create_card(db, card_type="ITComponent", name="ITC")
        await _assign(db, card=app_card, user=member, role="responsible")
        await _assign(db, card=itc_card, user=member, role="responsible")

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles/responsible/archive",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["affected_stakeholders_count"] == 1

    async def test_restore_non_archived_returns_400(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="activeRole", label="Active"
        )

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles/activeRole/restore",
            headers=auth_headers(admin),
        )
        assert response.status_code == 400


# ---------------------------------------------------------------------------
# Key grammar — camelCase, matching every other metamodel key (#907)
# ---------------------------------------------------------------------------


class TestRoleKeyGrammar:
    async def test_camel_case_key_accepted(self, client, db):
        """The shared KeyInput component produces camelCase; the API must take it.

        This is the exact key shape the reporter in #907 typed and had rejected.
        """
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles",
            json={"key": "businessArchitect", "label": "Business Architect"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 201
        assert response.json()["key"] == "businessArchitect"

    async def test_underscore_key_rejected(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles",
            json={"key": "business_architect", "label": "Business Architect"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 422

    async def test_too_short_key_rejected(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")

        response = await client.post(
            "/api/v1/metamodel/types/Application/stakeholder-roles",
            json={"key": "ab", "label": "Too short"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# GET .../stakeholder-roles/{role_key}/usage
# ---------------------------------------------------------------------------


class TestStakeholderRoleUsage:
    async def test_unused_role_can_be_deleted(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="dataSteward", label="Data Steward"
        )

        response = await client.get(
            "/api/v1/metamodel/types/Application/stakeholder-roles/dataSteward/usage",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["stakeholder_count"] == 0
        assert data["card_count"] == 0
        assert data["survey_count"] == 0
        assert data["is_last_active"] is False
        assert data["can_delete"] is True

    async def test_usage_counts_are_scoped_to_the_card_type(self, client, db):
        """A role key shared by two card types must not pool their counts.

        ``stakeholders.role`` is a bare string with no foreign key, and
        ``responsible`` is defined on every card type — counting by role key
        alone reported every assignment in the instance.
        """
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        member = await create_user(db, email="member@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        for type_key in ("Application", "ITComponent"):
            await create_stakeholder_role_def(
                db, card_type_key=type_key, key="responsible", label="Responsible"
            )
            await create_stakeholder_role_def(
                db, card_type_key=type_key, key="observer", label="Observer"
            )

        app_card = await create_card(db, card_type="Application", name="App")
        itc_card = await create_card(db, card_type="ITComponent", name="ITC")
        await _assign(db, card=app_card, user=member, role="responsible")
        await _assign(db, card=itc_card, user=member, role="responsible")

        response = await client.get(
            "/api/v1/metamodel/types/Application/stakeholder-roles/responsible/usage",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        data = response.json()
        # Only the Application assignment counts, not the ITComponent one.
        assert data["stakeholder_count"] == 1
        assert data["card_count"] == 1
        assert data["can_delete"] is False


# ---------------------------------------------------------------------------
# DELETE /metamodel/types/{type_key}/stakeholder-roles/{role_key}
# ---------------------------------------------------------------------------


class TestDeleteStakeholderRole:
    async def test_delete_unused_role(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="typoRole", label="Typo"
        )

        response = await client.delete(
            "/api/v1/metamodel/types/Application/stakeholder-roles/typoRole",
            headers=auth_headers(admin),
        )
        assert response.status_code == 204

        listing = await client.get(
            "/api/v1/metamodel/types/Application/stakeholder-roles?include_archived=true",
            headers=auth_headers(admin),
        )
        assert "typoRole" not in [r["key"] for r in listing.json()]

    async def test_delete_prunes_legacy_jsonb_mirror(self, client, db):
        """The JSONB mirror must lose the entry too, or the role can reappear.

        ``_roles_for_type`` falls back to ``card_types.stakeholder_roles``
        whenever the definition table has no rows for a type.
        """
        from sqlalchemy import select

        from app.models.card_type import CardType

        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(
            db,
            key="Application",
            label="Application",
            stakeholder_roles=[
                {"key": "responsible", "label": "Responsible"},
                {"key": "typoRole", "label": "Typo"},
            ],
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="typoRole", label="Typo"
        )

        response = await client.delete(
            "/api/v1/metamodel/types/Application/stakeholder-roles/typoRole",
            headers=auth_headers(admin),
        )
        assert response.status_code == 204

        card_type = (
            await db.execute(select(CardType).where(CardType.key == "Application"))
        ).scalar_one()
        await db.refresh(card_type)
        assert [r["key"] for r in card_type.stakeholder_roles] == ["responsible"]

    async def test_cannot_delete_role_in_use(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        member = await create_user(db, email="member@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="dataSteward", label="Data Steward"
        )
        card = await create_card(db, card_type="Application", name="App")
        await _assign(db, card=card, user=member, role="dataSteward")

        response = await client.delete(
            "/api/v1/metamodel/types/Application/stakeholder-roles/dataSteward",
            headers=auth_headers(admin),
        )
        assert response.status_code == 409
        assert "archive" in response.json()["detail"].lower()

    async def test_cannot_delete_role_targeted_by_survey(self, client, db):
        from app.models.survey import Survey

        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="dataSteward", label="Data Steward"
        )
        db.add(
            Survey(
                name="Annual review",
                message="",
                target_type_key="Application",
                target_roles=["dataSteward"],
            )
        )
        await db.flush()

        response = await client.delete(
            "/api/v1/metamodel/types/Application/stakeholder-roles/dataSteward",
            headers=auth_headers(admin),
        )
        assert response.status_code == 409
        assert "survey" in response.json()["detail"].lower()

    async def test_cannot_delete_last_active_role(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="onlyRole", label="Only Role"
        )

        response = await client.delete(
            "/api/v1/metamodel/types/Application/stakeholder-roles/onlyRole",
            headers=auth_headers(admin),
        )
        assert response.status_code == 409

    async def test_nonexistent_returns_404(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")

        response = await client.delete(
            "/api/v1/metamodel/types/Application/stakeholder-roles/ghostRole",
            headers=auth_headers(admin),
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# PATCH — re-keying an unused role
# ---------------------------------------------------------------------------


class TestReKeyStakeholderRole:
    async def test_rekey_unused_role(self, client, db):
        """The reporter's case in #907: a just-created role with a typo'd key."""
        from sqlalchemy import select

        from app.models.card_type import CardType

        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(
            db,
            key="Application",
            label="Application",
            stakeholder_roles=[
                {"key": "responsible", "label": "Responsible"},
                {"key": "bsnessArchitect", "label": "Business Architect"},
            ],
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="bsnessArchitect", label="Business Architect"
        )

        response = await client.patch(
            "/api/v1/metamodel/types/Application/stakeholder-roles/bsnessArchitect",
            json={"key": "businessArchitect"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["key"] == "businessArchitect"

        # The legacy JSONB mirror follows the rename.
        card_type = (
            await db.execute(select(CardType).where(CardType.key == "Application"))
        ).scalar_one()
        await db.refresh(card_type)
        assert "businessArchitect" in [r["key"] for r in card_type.stakeholder_roles]
        assert "bsnessArchitect" not in [r["key"] for r in card_type.stakeholder_roles]

    async def test_cannot_rekey_role_in_use(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        member = await create_user(db, email="member@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="dataSteward", label="Data Steward"
        )
        card = await create_card(db, card_type="Application", name="App")
        await _assign(db, card=card, user=member, role="dataSteward")

        response = await client.patch(
            "/api/v1/metamodel/types/Application/stakeholder-roles/dataSteward",
            json={"key": "dataOwner"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 409

    async def test_cannot_rekey_onto_existing_key(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="dataSteward", label="Data Steward"
        )

        response = await client.patch(
            "/api/v1/metamodel/types/Application/stakeholder-roles/dataSteward",
            json={"key": "responsible"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 409

    async def test_can_rekey_the_last_active_role(self, client, db):
        """Renaming keeps the role, so the active-role count is unchanged.

        Being the type's only role blocks a *delete*, never a rename — gating
        both on the same flag made single-role types permanently un-renamable.
        """
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="onlyRole", label="Only Role"
        )

        usage = await client.get(
            "/api/v1/metamodel/types/Application/stakeholder-roles/onlyRole/usage",
            headers=auth_headers(admin),
        )
        assert usage.json()["is_last_active"] is True
        assert usage.json()["can_delete"] is False
        assert usage.json()["can_rekey"] is True

        response = await client.patch(
            "/api/v1/metamodel/types/Application/stakeholder-roles/onlyRole",
            json={"key": "theOnlyRole"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["key"] == "theOnlyRole"

    async def test_rekey_carries_survey_targets_with_it(self, client, db):
        """A survey targeting the role must not block the rename — it follows.

        `surveys.target_roles` is a bare JSONB array of key strings, so without
        this the survey would silently target a key that no longer exists.
        """
        from sqlalchemy import select

        from app.models.survey import Survey

        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="dataSteward", label="Data Steward"
        )
        survey = Survey(
            name="Annual review",
            message="",
            target_type_key="Application",
            target_roles=["responsible", "dataSteward"],
        )
        db.add(survey)
        await db.flush()

        usage = await client.get(
            "/api/v1/metamodel/types/Application/stakeholder-roles/dataSteward/usage",
            headers=auth_headers(admin),
        )
        assert usage.json()["survey_count"] == 1
        # Blocks a delete, but not a rename.
        assert usage.json()["can_delete"] is False
        assert usage.json()["can_rekey"] is True

        response = await client.patch(
            "/api/v1/metamodel/types/Application/stakeholder-roles/dataSteward",
            json={"key": "dataOwner"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200

        refreshed = (await db.execute(select(Survey).where(Survey.id == survey.id))).scalar_one()
        await db.refresh(refreshed)
        assert refreshed.target_roles == ["responsible", "dataOwner"]

    async def test_legacy_snake_case_key_is_grandfathered(self, client, db):
        """A pre-camelCase key keeps working; only *new* keys are validated.

        Snake_case roles can exist from an older release, a direct API call, or
        a workspace-transfer import. Editing such a role's label must not force
        the admin to re-key it.
        """
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="data_steward", label="Data Steward"
        )

        response = await client.patch(
            "/api/v1/metamodel/types/Application/stakeholder-roles/data_steward",
            json={"label": "Data Custodian"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["label"] == "Data Custodian"
        assert response.json()["key"] == "data_steward"

    async def test_legacy_key_can_be_corrected_to_camel_case(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="data_steward", label="Data Steward"
        )

        response = await client.patch(
            "/api/v1/metamodel/types/Application/stakeholder-roles/data_steward",
            json={"key": "dataSteward"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["key"] == "dataSteward"

    async def test_rekey_to_invalid_key_rejected(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="dataSteward", label="Data Steward"
        )

        response = await client.patch(
            "/api/v1/metamodel/types/Application/stakeholder-roles/dataSteward",
            json={"key": "data_steward"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# GET /stakeholder-roles/permissions-schema
# ---------------------------------------------------------------------------


class TestCardPermissionsSchema:
    async def test_returns_schema(self, client, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        response = await client.get(
            "/api/v1/stakeholder-roles/permissions-schema",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
        assert len(data) > 0
