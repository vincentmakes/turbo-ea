"""Integration tests for the /metamodel endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.card_type import CardType
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
async def metamodel_env(db):
    """Prerequisite data shared by all metamodel tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "viewer": viewer}


# ---------------------------------------------------------------------------
# Card types — CRUD
# ---------------------------------------------------------------------------


class TestListTypes:
    async def test_list_types(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")

        response = await client.get(
            "/api/v1/metamodel/types",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        keys = [t["key"] for t in response.json()]
        assert "Application" in keys

    async def test_hidden_types_excluded_by_default(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        ct = await create_card_type(db, key="HiddenType", label="Hidden")
        ct.is_hidden = True
        await db.flush()

        response = await client.get(
            "/api/v1/metamodel/types",
            headers=auth_headers(admin),
        )
        keys = [t["key"] for t in response.json()]
        assert "HiddenType" not in keys

    async def test_include_hidden(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        ct = await create_card_type(db, key="HiddenType", label="Hidden")
        ct.is_hidden = True
        await db.flush()

        response = await client.get(
            "/api/v1/metamodel/types?include_hidden=true",
            headers=auth_headers(admin),
        )
        keys = [t["key"] for t in response.json()]
        assert "HiddenType" in keys


class TestCreateType:
    async def test_create_custom_type(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        response = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "CustomWidget", "label": "Custom Widget"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 201
        data = response.json()
        assert data["key"] == "CustomWidget"
        assert data["built_in"] is False
        # Default stakeholder roles injected
        role_keys = [r["key"] for r in data["stakeholder_roles"]]
        assert "responsible" in role_keys
        assert "observer" in role_keys

    async def test_duplicate_key_rejected(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")

        response = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "Application", "label": "Duplicate"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_viewer_cannot_create(self, client, db, metamodel_env):
        viewer = metamodel_env["viewer"]
        response = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "Blocked", "label": "Blocked"},
            headers=auth_headers(viewer),
        )
        assert response.status_code == 403


class TestUpdateType:
    async def test_update_label(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")

        response = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"label": "Enterprise Application"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["label"] == "Enterprise Application"

    async def test_update_nonexistent_returns_404(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        response = await client.patch(
            "/api/v1/metamodel/types/Nonexistent",
            json={"label": "Nope"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 404

    async def test_null_translations_normalised(self, client, db, metamodel_env):
        """`translations` is NOT NULL — clearing every translation must not 500.

        Asserted on the stored column: the response serializer masks a NULL with
        ``or {}``, so asserting on the response would be vacuous.
        """
        admin = metamodel_env["admin"]
        await create_card_type(
            db, key="Application", label="Application", translations={"label": {"en": "App"}}
        )

        response = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"translations": None},
            headers=auth_headers(admin),
        )

        assert response.status_code == 200
        stored = await db.execute(
            select(CardType.translations).where(CardType.key == "Application")
        )
        assert stored.scalar_one() == {}


class TestTypeColor:
    async def test_recolor_builtin_type(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application", built_in=True)

        response = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"color": "#B5D5FF"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["color"] == "#B5D5FF"

    @pytest.mark.parametrize("bad", ["blue", "#12345", "#12345g", "#1234567", 123, None])
    async def test_invalid_color_rejected_on_update(self, client, db, metamodel_env, bad):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application", built_in=True)

        response = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"color": bad},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_invalid_color_rejected_on_create(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        response = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "BadColor", "label": "Bad Color", "color": "not-a-color"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_default_color_serialized_for_builtin(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application", built_in=True)

        response = await client.get(
            "/api/v1/metamodel/types/Application",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        # Seed default for Application, regardless of the current color
        assert response.json()["default_color"] == "#0f7eb5"

    async def test_default_color_none_for_custom_type(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        response = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "CustomWidget", "label": "Custom Widget", "color": "#123456"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 201
        assert response.json()["default_color"] is None

    async def test_reset_roundtrip(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application", built_in=True)

        await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"color": "#FFFFB5"},
            headers=auth_headers(admin),
        )
        response = await client.get(
            "/api/v1/metamodel/types/Application", headers=auth_headers(admin)
        )
        default = response.json()["default_color"]

        response = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"color": default},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["color"] == "#0f7eb5"


class TestDeleteType:
    async def test_soft_delete_builtin(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        ct = await create_card_type(db, key="Application", label="Application")
        ct.built_in = True
        await db.flush()

        response = await client.delete(
            "/api/v1/metamodel/types/Application",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["status"] == "hidden"

    async def test_hard_delete_custom_no_cards(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Custom", label="Custom")

        response = await client.delete(
            "/api/v1/metamodel/types/Custom",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["status"] == "deleted"

    async def test_cannot_delete_custom_with_cards(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Custom", label="Custom")
        await create_card(db, card_type="Custom", name="A Card", user_id=admin.id)

        response = await client.delete(
            "/api/v1/metamodel/types/Custom",
            headers=auth_headers(admin),
        )
        # A conflict the caller can resolve with `delete_cards=true`
        # (test_metamodel_delete_type.py covers that path).
        assert response.status_code == 409
        assert response.json()["detail"]["error"] == "cards_present"


# ---------------------------------------------------------------------------
# Removing stakeholder roles via PATCH /types/{key}
# ---------------------------------------------------------------------------


class TestRemoveStakeholderRolesViaPatch:
    """The whole-column overwrite of ``stakeholder_roles`` has an in-use guard."""

    async def test_can_remove_unused_role(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(
            db,
            key="Custom",
            label="Custom",
            stakeholder_roles=[
                {"key": "responsible", "label": "Responsible"},
                {"key": "dataSteward", "label": "Data Steward"},
            ],
        )

        response = await client.patch(
            "/api/v1/metamodel/types/Custom",
            json={"stakeholder_roles": [{"key": "responsible", "label": "Responsible"}]},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert [r["key"] for r in response.json()["stakeholder_roles"]] == ["responsible"]

    async def test_cannot_remove_role_in_use(self, client, db, metamodel_env):
        from app.models.stakeholder import Stakeholder

        admin = metamodel_env["admin"]
        await create_card_type(
            db,
            key="Custom",
            label="Custom",
            stakeholder_roles=[
                {"key": "responsible", "label": "Responsible"},
                {"key": "dataSteward", "label": "Data Steward"},
            ],
        )
        card = await create_card(db, card_type="Custom", name="A Card", user_id=admin.id)
        db.add(Stakeholder(card_id=card.id, user_id=admin.id, role="dataSteward"))
        await db.flush()

        response = await client.patch(
            "/api/v1/metamodel/types/Custom",
            json={"stakeholder_roles": [{"key": "responsible", "label": "Responsible"}]},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400
        assert "dataSteward" in response.json()["detail"]


# ---------------------------------------------------------------------------
# Field / section / option usage
# ---------------------------------------------------------------------------


class TestFieldUsage:
    async def test_field_usage_counts_cards(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(
            db,
            key="Application",
            label="Application",
            fields_schema=[
                {"section": "General", "fields": [{"key": "cost", "type": "number", "weight": 1}]}
            ],
        )
        await create_card(
            db,
            card_type="Application",
            name="App1",
            user_id=admin.id,
            attributes={"cost": 100},
        )
        await create_card(
            db,
            card_type="Application",
            name="App2",
            user_id=admin.id,
            attributes={},
        )

        response = await client.get(
            "/api/v1/metamodel/types/Application/field-usage?field_key=cost",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["card_count"] == 1

    async def test_section_usage(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(
            db,
            key="Application",
            label="Application",
            fields_schema=[
                {
                    "section": "General",
                    "fields": [
                        {"key": "cost", "type": "number", "weight": 1},
                        {"key": "risk", "type": "text", "weight": 1},
                    ],
                }
            ],
        )
        await create_card(
            db,
            card_type="Application",
            name="App1",
            user_id=admin.id,
            attributes={"risk": "high"},
        )

        response = await client.get(
            "/api/v1/metamodel/types/Application/section-usage?field_keys=cost,risk",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["card_count"] == 1

    async def test_option_usage_single_select(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(
            db,
            key="Application",
            label="Application",
            fields_schema=[
                {
                    "section": "General",
                    "fields": [
                        {
                            "key": "risk",
                            "type": "single_select",
                            "weight": 1,
                            "options": [
                                {"key": "low", "label": "Low"},
                                {"key": "high", "label": "High"},
                            ],
                        }
                    ],
                }
            ],
        )
        await create_card(
            db,
            card_type="Application",
            name="App1",
            user_id=admin.id,
            attributes={"risk": "high"},
        )

        response = await client.get(
            "/api/v1/metamodel/types/Application/option-usage?field_key=risk&option_key=high",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["card_count"] == 1


# ---------------------------------------------------------------------------
# Relation types — CRUD
# ---------------------------------------------------------------------------


class TestRelationTypeCRUD:
    async def test_create_relation_type(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")

        response = await client.post(
            "/api/v1/metamodel/relation-types",
            json={
                "key": "app_to_itc",
                "label": "Uses",
                "source_type_key": "Application",
                "target_type_key": "ITComponent",
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 201
        data = response.json()
        assert data["key"] == "app_to_itc"
        assert data["source_type_key"] == "Application"
        assert data["target_type_key"] == "ITComponent"

    async def test_multiple_relation_types_per_pair_allowed(self, client, db, metamodel_env):
        """Several relation types may connect the same ordered card-type pair.

        An Organization that *owns* an Application and one that *uses* it are
        different relationships, each with its own verb and attribute schema —
        modelling them as one type qualified by an attribute is a choice, not a
        constraint the metamodel imposes.
        """
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )

        response = await client.post(
            "/api/v1/metamodel/relation-types",
            json={
                "key": "app_to_itc_2",
                "label": "Also Uses",
                "source_type_key": "Application",
                "target_type_key": "ITComponent",
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 201

        listing = await client.get("/api/v1/metamodel/relation-types", headers=auth_headers(admin))
        assert listing.status_code == 200
        pair_keys = {
            rt["key"]
            for rt in listing.json()
            if rt["source_type_key"] == "Application" and rt["target_type_key"] == "ITComponent"
        }
        assert {"app_to_itc", "app_to_itc_2"} <= pair_keys

    async def test_duplicate_key_still_rejected_on_occupied_pair(self, client, db, metamodel_env):
        """Lifting the pair rule must not weaken key uniqueness."""
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )

        response = await client.post(
            "/api/v1/metamodel/relation-types",
            json={
                "key": "app_to_itc",
                "label": "Also Uses",
                "source_type_key": "Application",
                "target_type_key": "ITComponent",
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_self_relation_allowed_alongside_successor(self, client, db, metamodel_env):
        # A built-in successor self-relation must not block a custom self-relation
        # on the same pair (regression for discussion #690).
        admin = metamodel_env["admin"]
        await create_card_type(db, key="DataObject", label="Data Object")
        await create_relation_type(
            db,
            key="relDataObjectSuccessor",
            label="succeeds",
            source_type_key="DataObject",
            target_type_key="DataObject",
            built_in=True,
        )

        response = await client.post(
            "/api/v1/metamodel/relation-types",
            json={
                "key": "do_to_do",
                "label": "Derived From",
                "source_type_key": "DataObject",
                "target_type_key": "DataObject",
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 201

        # A second non-successor self-relation on the same pair is fine too.
        response = await client.post(
            "/api/v1/metamodel/relation-types",
            json={
                "key": "do_to_do_2",
                "label": "Also Derived From",
                "source_type_key": "DataObject",
                "target_type_key": "DataObject",
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 201

    async def test_invalid_source_type_rejected(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")

        response = await client.post(
            "/api/v1/metamodel/relation-types",
            json={
                "key": "bad_rel",
                "label": "Bad",
                "source_type_key": "Nonexistent",
                "target_type_key": "Application",
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_list_relation_types(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )

        response = await client.get(
            "/api/v1/metamodel/relation-types",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        keys = [r["key"] for r in response.json()]
        assert "app_to_itc" in keys

    async def test_filter_by_type_key(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_card_type(db, key="DataObject", label="Data Object")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )
        await create_relation_type(
            db,
            key="app_to_data",
            source_type_key="Application",
            target_type_key="DataObject",
        )

        response = await client.get(
            "/api/v1/metamodel/relation-types?type_key=ITComponent",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        keys = [r["key"] for r in response.json()]
        assert "app_to_itc" in keys
        assert "app_to_data" not in keys

    async def test_update_relation_type(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )

        response = await client.patch(
            "/api/v1/metamodel/relation-types/app_to_itc",
            json={"label": "Runs On"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["label"] == "Runs On"

    # ------------------------------------------------------------------
    # #912 — `translations[property]["en"]` shadows the raw column everywhere
    # the frontend resolves a relation verb, and every seeded relation type
    # carries one. A rename that writes only the column changed nothing a user
    # could see. The API keeps the English entry in step for callers that do
    # not manage translations themselves.
    # ------------------------------------------------------------------

    async def _rel_with_translations(self, db, translations):
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            label="uses",
            reverse_label="is used by",
            source_type_key="Application",
            target_type_key="ITComponent",
            translations=translations,
        )

    async def test_rename_syncs_english_translation(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await self._rel_with_translations(
            db,
            {
                "label": {"en": "uses", "fr": "utilise"},
                "reverse_label": {"en": "is used by", "fr": "est utilisé par"},
            },
        )

        response = await client.patch(
            "/api/v1/metamodel/relation-types/app_to_itc",
            json={"label": "runs on", "reverse_label": "runs"},
            headers=auth_headers(admin),
        )

        assert response.status_code == 200
        trans = response.json()["translations"]
        # English follows the column; every other locale is left alone.
        assert trans["label"] == {"en": "runs on", "fr": "utilise"}
        assert trans["reverse_label"] == {"en": "runs", "fr": "est utilisé par"}

    async def test_rename_does_not_mint_english_translation(self, client, db, metamodel_env):
        """A row with no English entry already resolves via the column fallback."""
        admin = metamodel_env["admin"]
        await self._rel_with_translations(db, {"label": {"fr": "utilise"}})

        response = await client.patch(
            "/api/v1/metamodel/relation-types/app_to_itc",
            json={"label": "runs on"},
            headers=auth_headers(admin),
        )

        assert response.status_code == 200
        assert response.json()["translations"]["label"] == {"fr": "utilise"}

    async def test_client_supplied_translations_win(self, client, db, metamodel_env):
        """The admin UI sends its own per-locale map — the sync must not fight it."""
        admin = metamodel_env["admin"]
        await self._rel_with_translations(db, {"label": {"en": "uses"}})

        response = await client.patch(
            "/api/v1/metamodel/relation-types/app_to_itc",
            json={"label": "runs on", "translations": {"label": {"en": "hosts"}}},
            headers=auth_headers(admin),
        )

        assert response.status_code == 200
        assert response.json()["translations"]["label"] == {"en": "hosts"}

    async def test_null_translations_normalised(self, client, db, metamodel_env):
        """`translations` is NOT NULL in the real schema — clearing it must not 500.

        The response serializer masks a NULL with ``or {}``, so assert on the
        persisted column: it is the stored NULL that violates the constraint on a
        migrated database.
        """
        from app.models.relation_type import RelationType

        admin = metamodel_env["admin"]
        await self._rel_with_translations(db, {"label": {"en": "uses"}})

        response = await client.patch(
            "/api/v1/metamodel/relation-types/app_to_itc",
            json={"translations": None},
            headers=auth_headers(admin),
        )

        assert response.status_code == 200
        stored = await db.execute(
            select(RelationType.translations).where(RelationType.key == "app_to_itc")
        )
        assert stored.scalar_one() == {}

    async def test_cannot_change_endpoints_with_instances(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_card_type(db, key="DataObject", label="Data Object")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )
        c1 = await create_card(db, card_type="Application", name="App", user_id=admin.id)
        c2 = await create_card(db, card_type="ITComponent", name="ITC", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=c1.id, target_id=c2.id)

        response = await client.patch(
            "/api/v1/metamodel/relation-types/app_to_itc",
            json={"target_type_key": "DataObject"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_delete_relation_type_no_instances(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )

        response = await client.delete(
            "/api/v1/metamodel/relation-types/app_to_itc",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["status"] == "deleted"

    async def test_delete_with_instances_returns_409(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )
        c1 = await create_card(db, card_type="Application", name="App", user_id=admin.id)
        c2 = await create_card(db, card_type="ITComponent", name="ITC", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=c1.id, target_id=c2.id)

        response = await client.delete(
            "/api/v1/metamodel/relation-types/app_to_itc",
            headers=auth_headers(admin),
        )
        assert response.status_code == 409

    async def test_force_delete_with_instances(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )
        c1 = await create_card(db, card_type="Application", name="App", user_id=admin.id)
        c2 = await create_card(db, card_type="ITComponent", name="ITC", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=c1.id, target_id=c2.id)

        response = await client.delete(
            "/api/v1/metamodel/relation-types/app_to_itc?force=true",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200

    async def test_instance_count(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )
        c1 = await create_card(db, card_type="Application", name="App", user_id=admin.id)
        c2 = await create_card(db, card_type="ITComponent", name="ITC", user_id=admin.id)
        await create_relation(db, type_key="app_to_itc", source_id=c1.id, target_id=c2.id)

        response = await client.get(
            "/api/v1/metamodel/relation-types/app_to_itc/instance-count",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["instance_count"] == 1


class TestRestoreRelationType:
    async def test_restore_hidden(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
            built_in=True,
            is_hidden=True,
        )

        response = await client.post(
            "/api/v1/metamodel/relation-types/app_to_itc/restore",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["is_hidden"] is False

    async def test_restore_non_hidden_returns_400(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )

        response = await client.post(
            "/api/v1/metamodel/relation-types/app_to_itc/restore",
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_restore_onto_occupied_pair_succeeds(self, client, db, metamodel_env):
        """A hidden relation type restores even when another type holds its pair."""
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
            built_in=True,
            is_hidden=True,
        )
        await create_relation_type(
            db,
            key="app_to_itc_live",
            source_type_key="Application",
            target_type_key="ITComponent",
        )

        response = await client.post(
            "/api/v1/metamodel/relation-types/app_to_itc/restore",
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["is_hidden"] is False

    async def test_two_successor_types_do_not_break_card_type_save(self, client, db, metamodel_env):
        """Two `*Successor` types on one self-pair must not 500 a card-type save.

        `_ensure_successor_relation_type` runs on every create/update with
        `has_successors` and used `scalar_one_or_none()`, which raises
        MultipleResultsFound once a second one exists. Successors were always
        exempt from the old pair check, so this was reachable before the lift too.
        """
        admin = metamodel_env["admin"]
        await create_card_type(db, key="DataObject", label="Data Object", has_successors=True)
        for key in ("relDataObjectSuccessor", "relDataObjectLegacySuccessor"):
            await create_relation_type(
                db,
                key=key,
                label="succeeds",
                source_type_key="DataObject",
                target_type_key="DataObject",
            )

        response = await client.patch(
            "/api/v1/metamodel/types/DataObject",
            json={"has_successors": True, "label": "Data Object v2"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["label"] == "Data Object v2"

    async def test_repoint_endpoints_onto_occupied_pair_succeeds(self, client, db, metamodel_env):
        """Moving a relation type's endpoints onto an occupied pair is allowed.

        The "no instances exist" guard still applies — only the pair check is gone.
        """
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_card_type(db, key="DataObject", label="Data Object")
        await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
        )
        await create_relation_type(
            db,
            key="app_to_do",
            source_type_key="Application",
            target_type_key="DataObject",
        )

        response = await client.patch(
            "/api/v1/metamodel/relation-types/app_to_do",
            json={"source_type_key": "Application", "target_type_key": "ITComponent"},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["target_type_key"] == "ITComponent"


class TestRelationAttributeValues:
    """Manage the relation 'type' picker (attributes_schema options).

    Built-in fields/options are locked-but-hideable; custom ones are fully
    editable; clients can never mint built-in entries.
    """

    BUILTIN_SCHEMA = [
        {
            "key": "usageType",
            "label": "Usage Type",
            "type": "single_select",
            "built_in": True,
            "options": [
                {"key": "owner", "label": "Owner", "color": "#1976d2", "built_in": True},
                {"key": "user", "label": "User", "color": "#66bb6a", "built_in": True},
            ],
        },
    ]

    async def _make_builtin_rel(self, db):
        await create_card_type(db, key="Organization", label="Organization")
        await create_card_type(db, key="Application", label="Application")
        rt = await create_relation_type(
            db,
            key="relOrgToApp",
            source_type_key="Organization",
            target_type_key="Application",
            built_in=True,
        )
        rt.attributes_schema = [dict(f) for f in self.BUILTIN_SCHEMA]
        await db.flush()
        return rt

    def _schema_with(self, options):
        return [
            {
                "key": "usageType",
                "label": "Usage Type",
                "type": "single_select",
                "built_in": True,
                "options": options,
            }
        ]

    async def test_add_custom_value_to_builtin_field(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await self._make_builtin_rel(db)

        new_opts = [
            {"key": "owner", "label": "Owner", "color": "#1976d2", "built_in": True},
            {"key": "user", "label": "User", "color": "#66bb6a", "built_in": True},
            {"key": "operator", "label": "Operator", "color": "#9c27b0"},
        ]
        response = await client.patch(
            "/api/v1/metamodel/relation-types/relOrgToApp",
            json={"attributes_schema": self._schema_with(new_opts)},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        opts = response.json()["attributes_schema"][0]["options"]
        by_key = {o["key"]: o for o in opts}
        assert by_key["operator"]["built_in"] is False
        assert by_key["owner"]["built_in"] is True
        assert {"owner", "user", "operator"} <= set(by_key)

    async def test_edit_builtin_value_label_rejected(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await self._make_builtin_rel(db)

        bad_opts = [
            {"key": "owner", "label": "Proprietor", "color": "#1976d2", "built_in": True},
            {"key": "user", "label": "User", "color": "#66bb6a", "built_in": True},
        ]
        response = await client.patch(
            "/api/v1/metamodel/relation-types/relOrgToApp",
            json={"attributes_schema": self._schema_with(bad_opts)},
            headers=auth_headers(admin),
        )
        assert response.status_code == 403

    async def test_remove_builtin_value_rejected(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await self._make_builtin_rel(db)

        response = await client.patch(
            "/api/v1/metamodel/relation-types/relOrgToApp",
            json={
                "attributes_schema": self._schema_with(
                    [{"key": "owner", "label": "Owner", "color": "#1976d2", "built_in": True}]
                )
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 403

    async def test_remove_builtin_field_rejected(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await self._make_builtin_rel(db)

        response = await client.patch(
            "/api/v1/metamodel/relation-types/relOrgToApp",
            json={"attributes_schema": []},
            headers=auth_headers(admin),
        )
        assert response.status_code == 403

    async def test_hide_builtin_value_allowed(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await self._make_builtin_rel(db)

        hidden_opts = [
            {"key": "owner", "label": "Owner", "color": "#1976d2", "built_in": True},
            {
                "key": "user",
                "label": "User",
                "color": "#66bb6a",
                "built_in": True,
                "hidden": True,
            },
        ]
        response = await client.patch(
            "/api/v1/metamodel/relation-types/relOrgToApp",
            json={"attributes_schema": self._schema_with(hidden_opts)},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        opts = {o["key"]: o for o in response.json()["attributes_schema"][0]["options"]}
        assert opts["user"]["hidden"] is True
        assert opts["owner"].get("hidden", False) is False

    async def test_add_new_dimension_to_relation_without_one(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="BusinessCapability", label="Business Capability")
        await create_relation_type(
            db,
            key="relAppToBC",
            source_type_key="Application",
            target_type_key="BusinessCapability",
            built_in=True,
        )

        response = await client.patch(
            "/api/v1/metamodel/relation-types/relAppToBC",
            json={
                "attributes_schema": [
                    {
                        "key": "supportType",
                        "label": "Support Type",
                        "type": "single_select",
                        "options": [{"key": "primary", "label": "Primary"}],
                    }
                ]
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        schema = response.json()["attributes_schema"]
        assert schema[0]["key"] == "supportType"
        assert schema[0]["built_in"] is False
        assert schema[0]["options"][0]["built_in"] is False

    async def test_client_cannot_mint_builtin_value(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="BusinessCapability", label="Business Capability")
        await create_relation_type(
            db,
            key="relAppToBC",
            source_type_key="Application",
            target_type_key="BusinessCapability",
            built_in=True,
        )

        response = await client.patch(
            "/api/v1/metamodel/relation-types/relAppToBC",
            json={
                "attributes_schema": [
                    {
                        "key": "supportType",
                        "label": "Support Type",
                        "type": "single_select",
                        "built_in": True,
                        "options": [{"key": "primary", "label": "Primary", "built_in": True}],
                    }
                ]
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        schema = response.json()["attributes_schema"]
        assert schema[0]["built_in"] is False
        assert schema[0]["options"][0]["built_in"] is False

    async def test_custom_relation_values_fully_editable(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        rt = await create_relation_type(
            db,
            key="app_to_itc",
            source_type_key="Application",
            target_type_key="ITComponent",
            built_in=False,
        )
        rt.attributes_schema = [
            {
                "key": "tier",
                "label": "Tier",
                "type": "single_select",
                "built_in": False,
                "options": [{"key": "a", "label": "A", "built_in": False}],
            }
        ]
        await db.flush()

        # Rename + remove the custom option freely.
        response = await client.patch(
            "/api/v1/metamodel/relation-types/app_to_itc",
            json={
                "attributes_schema": [
                    {
                        "key": "tier",
                        "label": "Renamed Tier",
                        "type": "single_select",
                        "options": [{"key": "b", "label": "B"}],
                    }
                ]
            },
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        schema = response.json()["attributes_schema"]
        assert schema[0]["label"] == "Renamed Tier"
        assert [o["key"] for o in schema[0]["options"]] == ["b"]


# ---------------------------------------------------------------------------
# Lineage ("Supports Lineage") — auto-provision the successor relation type
# (issue #729)
# ---------------------------------------------------------------------------


class TestSuccessorRelationType:
    """Enabling has_successors must auto-create the self-referential
    rel{Key}Successor relation type the card-detail lineage section needs."""

    async def _fetch(self, client, admin, key):
        """Return the relation type dict for ``key`` (incl. hidden), or None."""
        resp = await client.get(
            "/api/v1/metamodel/relation-types?include_hidden=true",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        return next((r for r in resp.json() if r["key"] == key), None)

    async def test_enable_via_patch_creates_relation_type(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Widget", label="Widget")

        resp = await client.patch(
            "/api/v1/metamodel/types/Widget",
            json={"has_successors": True},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["has_successors"] is True

        rt = await self._fetch(client, admin, "relWidgetSuccessor")
        assert rt is not None
        assert rt["source_type_key"] == "Widget"
        assert rt["target_type_key"] == "Widget"
        assert rt["is_hidden"] is False
        assert rt["built_in"] is False
        assert rt["label"] == "succeeds"
        # The reverse verb has to mean the opposite of the forward one — it read
        # "is preceded by" until #1091, i.e. the same thing as "succeeds".
        assert rt["reverse_label"] == "is succeeded by"
        assert rt["translations"]  # non-empty i18n
        assert rt["translations"]["label"].get("en") == "succeeds"
        assert rt["translations"]["reverse_label"].get("en") == "is succeeded by"
        # Spot-check two locales that were wrong, pinning this path to the seed.
        assert rt["translations"]["reverse_label"].get("fr") == "a pour successeur"
        assert rt["translations"]["label"].get("ru") == "следует за"

    async def test_idempotent(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Widget", label="Widget")

        for _ in range(2):
            resp = await client.patch(
                "/api/v1/metamodel/types/Widget",
                json={"has_successors": True},
                headers=auth_headers(admin),
            )
            assert resp.status_code == 200

        listing = await client.get(
            "/api/v1/metamodel/relation-types?include_hidden=true",
            headers=auth_headers(admin),
        )
        matches = [r for r in listing.json() if r["key"] == "relWidgetSuccessor"]
        assert len(matches) == 1

    async def test_reenable_unhides(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Widget", label="Widget")

        # Enable, then hide the auto-created relation type manually.
        await client.patch(
            "/api/v1/metamodel/types/Widget",
            json={"has_successors": True},
            headers=auth_headers(admin),
        )
        await client.patch(
            "/api/v1/metamodel/relation-types/relWidgetSuccessor",
            json={"is_hidden": True},
            headers=auth_headers(admin),
        )
        hidden = await self._fetch(client, admin, "relWidgetSuccessor")
        assert hidden["is_hidden"] is True

        # Re-running the enable must un-hide the same row, not insert a second.
        await client.patch(
            "/api/v1/metamodel/types/Widget",
            json={"has_successors": True},
            headers=auth_headers(admin),
        )
        listing = await client.get(
            "/api/v1/metamodel/relation-types?include_hidden=true",
            headers=auth_headers(admin),
        )
        matches = [r for r in listing.json() if r["key"] == "relWidgetSuccessor"]
        assert len(matches) == 1
        assert matches[0]["is_hidden"] is False

    async def test_create_type_with_flag_creates_relation_type(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        resp = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "Widget", "label": "Widget", "has_successors": True},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201

        rt = await self._fetch(client, admin, "relWidgetSuccessor")
        assert rt is not None
        assert rt["source_type_key"] == rt["target_type_key"] == "Widget"

    async def test_disable_leaves_relation_type(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Widget", label="Widget")
        await client.patch(
            "/api/v1/metamodel/types/Widget",
            json={"has_successors": True},
            headers=auth_headers(admin),
        )
        # Disabling must NOT delete the relation type (no silent data loss).
        await client.patch(
            "/api/v1/metamodel/types/Widget",
            json={"has_successors": False},
            headers=auth_headers(admin),
        )
        rt = await self._fetch(client, admin, "relWidgetSuccessor")
        assert rt is not None
        assert rt["is_hidden"] is False

    async def test_self_heal_when_flag_set_but_missing(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        # Simulate an install already in the #729 state: flag on, no relation type.
        ct = await create_card_type(db, key="Widget", label="Widget")
        ct.has_successors = True
        await db.flush()
        assert await self._fetch(client, admin, "relWidgetSuccessor") is None

        # Any save while has_successors stays true should provision the missing one.
        resp = await client.patch(
            "/api/v1/metamodel/types/Widget",
            json={"label": "Widget Renamed"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        rt = await self._fetch(client, admin, "relWidgetSuccessor")
        assert rt is not None


class TestScoringSignatureRequiredFlag:
    """Toggling `required` on a field must change the scoring signature so the
    type save triggers `_recompute_data_quality_for_type` — the mandatory-field
    gate pins incomplete cards to 0 and their stored scores must refresh
    immediately, not on next edit."""

    def test_required_toggle_changes_signature(self):
        from app.api.v1.metamodel import _scoring_signature

        base = [{"section": "S", "fields": [{"key": "a", "weight": 1}]}]
        toggled = [{"section": "S", "fields": [{"key": "a", "weight": 1, "required": True}]}]
        assert _scoring_signature(base, None) != _scoring_signature(toggled, None)

    def test_readonly_toggle_changes_signature(self):
        from app.api.v1.metamodel import _scoring_signature

        base = [{"section": "S", "fields": [{"key": "a", "weight": 1, "required": True}]}]
        toggled = [
            {
                "section": "S",
                "fields": [{"key": "a", "weight": 1, "required": True, "readonly": True}],
            }
        ]
        assert _scoring_signature(base, None) != _scoring_signature(toggled, None)

    def test_label_edit_leaves_signature_unchanged(self):
        from app.api.v1.metamodel import _scoring_signature

        a = [{"section": "S", "fields": [{"key": "a", "weight": 1, "label": "Old"}]}]
        b = [{"section": "S", "fields": [{"key": "a", "weight": 1, "label": "New"}]}]
        assert _scoring_signature(a, None) == _scoring_signature(b, None)


class TestScoringSignatureSubtypes:
    """What a subtype drops out of the score is part of the signature (#1296):
    a change to its ``hidden_fields`` or ``optional_relations`` re-scores the
    type, a reorder or an unconfigured subtype does not."""

    def _sig(self, subtypes):
        from app.api.v1.metamodel import _scoring_signature

        return _scoring_signature([], None, subtypes)

    def test_optional_relations_change_the_signature(self):
        base = [{"key": "saas", "label": "SaaS"}]
        exempt = [{"key": "saas", "label": "SaaS", "optional_relations": ["relAppToOrg"]}]
        assert self._sig(base) != self._sig(exempt)

    def test_hidden_fields_change_the_signature(self):
        base = [{"key": "saas", "label": "SaaS", "hidden_fields": []}]
        hidden = [{"key": "saas", "label": "SaaS", "hidden_fields": ["cost"]}]
        assert self._sig(base) != self._sig(hidden)

    def test_order_labels_and_unconfigured_subtypes_leave_it_unchanged(self):
        a = [
            {"key": "saas", "label": "SaaS", "optional_relations": ["x", "y"]},
            {"key": "paas", "label": "PaaS", "hidden_fields": []},
        ]
        b = [
            {"key": "saas", "label": "Software", "optional_relations": ["y", "x"]},
            {"key": "iaas", "label": "IaaS"},
        ]
        assert self._sig(a) == self._sig(b)
        assert self._sig(None) == self._sig([])

    def test_an_exemption_moving_between_subtypes_changes_it(self):
        a = [{"key": "saas", "optional_relations": ["x"]}, {"key": "paas"}]
        b = [{"key": "saas"}, {"key": "paas", "optional_relations": ["x"]}]
        assert self._sig(a) != self._sig(b)

    def test_malformed_entries_are_ignored(self):
        assert self._sig(["saas", {"label": "No key"}, {"key": 3}]) == self._sig([])
        assert self._sig([{"key": "saas", "optional_relations": ["x", 3]}]) == self._sig(
            [{"key": "saas", "optional_relations": ["x"]}]
        )


class TestOptionalRelationsAuditHelpers:
    def test_changed_reads_each_subtype_by_key(self):
        from app.api.v1.metamodel import _optional_relations_changed

        a = [{"key": "saas", "optional_relations": ["x"]}, {"key": "paas"}]
        assert _optional_relations_changed(a, a) is False
        # Absent and empty mean the same thing; other properties do not count.
        assert (
            _optional_relations_changed(
                [{"key": "saas", "label": "A"}],
                [{"key": "saas", "label": "B", "optional_relations": [], "hidden_fields": ["f"]}],
            )
            is False
        )
        assert _optional_relations_changed(a, [{"key": "saas"}, {"key": "paas"}]) is True
        assert _optional_relations_changed(None, a) is True
        assert _optional_relations_changed(["junk"], None) is False

    def test_side_labels_read_the_verb_from_this_types_side(self):
        from types import SimpleNamespace

        from app.api.v1.metamodel import _relation_side_labels

        rts = [
            SimpleNamespace(
                key="relAppToOrg",
                label="is owned by",
                reverse_label="owns",
                source_type_key="Application",
                target_type_key="Organization",
            ),
            SimpleNamespace(
                key="relOrgToApp",
                label="uses",
                reverse_label=None,
                source_type_key="Organization",
                target_type_key="Application",
            ),
            SimpleNamespace(
                key="relAppFeeds",
                label="feeds",
                reverse_label="is fed by",
                source_type_key="Application",
                target_type_key="Application",
            ),
        ]
        labels = {"Organization": "Organisation", "Application": "App"}
        assert _relation_side_labels(rts, "Application", labels) == {
            "relAppToOrg": "is owned by → Organisation",
            # No reverse label: the forward one stands in.
            "relOrgToApp": "uses → Organisation",
            "relAppFeeds__out": "feeds → App",
            "relAppFeeds__in": "is fed by → App",
        }
        # An unknown other type falls back to its key.
        assert _relation_side_labels(rts[:1], "Application", {}) == {
            "relAppToOrg": "is owned by → Organization"
        }


class TestOptionalRelationsRescore:
    """PATCHing a subtype's ``optional_relations`` re-scores the type's cards
    at once, as derived maintenance: Modified must not move (#1296)."""

    async def test_patch_moves_the_exempted_subtypes_score(
        self, client, db, metamodel_env, card_update_sql
    ):
        admin = metamodel_env["admin"]
        await create_card_type(
            db,
            key="Application",
            label="Application",
            fields_schema=[
                {
                    "section": "Details",
                    "fields": [{"key": "a", "label": "A", "type": "text", "weight": 1}],
                }
            ],
            subtypes=[{"key": "saas", "label": "SaaS"}],
            section_config={
                "__dataQuality": {
                    "description": 0,
                    "lifecycle": 0,
                    "tags": 0,
                    "stakeholders": 0,
                }
            },
        )
        await create_card_type(db, key="Organization", label="Organization")
        rt = await create_relation_type(
            db,
            key="relAppToOrg",
            label="is owned by",
            source_type_key="Application",
            target_type_key="Organization",
        )
        rt.source_mandatory = True
        await db.flush()
        saas = await create_card(
            db, card_type="Application", name="CRM", subtype="saas", attributes={"a": "x"}
        )
        plain = await create_card(
            db, card_type="Application", name="ERP", attributes={"a": "x"}, data_quality=50.0
        )
        saas.data_quality = 50.0
        await db.flush()

        card_update_sql.clear()
        resp = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={
                "subtypes": [
                    {"key": "saas", "label": "SaaS", "optional_relations": ["relAppToOrg"]}
                ]
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        await db.refresh(saas)
        await db.refresh(plain)
        # One filled field, no relation slot → 100%; the other card keeps 1/2.
        assert saas.data_quality == 100.0
        assert plain.data_quality == 50.0
        assert resp.json()["subtypes"][0]["optional_relations"] == ["relAppToOrg"]
        assert card_update_sql.statements, "expected the rescore to UPDATE the card"
        assert not card_update_sql.bumped(), "an exemption is not an edit to every card"


# ---------------------------------------------------------------------------
# Per-card-type role permission overrides (discussion #1068)
# ---------------------------------------------------------------------------


class TestTypeRolePermissions:
    """PATCH validation + the matrix endpoint that feeds the admin Permissions tab."""

    async def test_serialized_type_carries_the_map(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")

        response = await client.get(
            "/api/v1/metamodel/types/Application", headers=auth_headers(admin)
        )
        assert response.status_code == 200
        assert response.json()["role_permissions"] == {}

    async def test_patch_round_trips(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_role(db, key="member", label="Member", permissions={"inventory.view": True})

        response = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"role_permissions": {"member": {"inventory.create": False}}},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["role_permissions"] == {"member": {"inventory.create": False}}

    async def test_patch_drops_an_empty_override_map(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_role(db, key="member", label="Member", permissions={"inventory.view": True})

        response = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"role_permissions": {"member": {}}},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["role_permissions"] == {}

    async def test_unknown_role_rejected(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")

        response = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"role_permissions": {"ghost": {"inventory.create": False}}},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_wildcard_role_rejected(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")

        response = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"role_permissions": {"admin": {"inventory.create": False}}},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_non_type_scoped_permission_rejected(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_role(db, key="member", label="Member", permissions={"inventory.view": True})

        response = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"role_permissions": {"member": {"inventory.export": False}}},
            headers=auth_headers(admin),
        )
        assert response.status_code == 400

    async def test_view_override_accepted(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_role(db, key="member", label="Member", permissions={"inventory.view": True})

        response = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"role_permissions": {"member": {"inventory.view": False}}},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        assert response.json()["role_permissions"] == {"member": {"inventory.view": False}}

    async def test_matrix_is_hidden_from_non_admins(self, client, db, metamodel_env):
        """Which types are hidden from which role is RBAC config, not metadata."""
        viewer = metamodel_env["viewer"]
        ct = await create_card_type(db, key="Application", label="Application")
        ct.role_permissions = {"viewer": {"inventory.view": False}}
        await db.flush()

        one = await client.get("/api/v1/metamodel/types/Application", headers=auth_headers(viewer))
        assert one.status_code == 200
        assert "role_permissions" not in one.json()
        many = await client.get("/api/v1/metamodel/types", headers=auth_headers(viewer))
        assert all("role_permissions" not in t for t in many.json())

    async def test_created_type_overrides_apply_immediately(self, client, db, metamodel_env):
        """A lookup before the type existed must not keep answering "no overrides"."""
        from app.services.permission_service import PermissionService

        admin = metamodel_env["admin"]
        viewer = metamodel_env["viewer"]
        # Prime the per-type cache with the not-yet-existing key.
        assert await PermissionService.load_type_role_permissions(db, "Gadget") == {}
        response = await client.post(
            "/api/v1/metamodel/types",
            json={
                "key": "Gadget",
                "label": "Gadget",
                "role_permissions": {"viewer": {"inventory.view": False}},
            },
            headers=auth_headers(admin),
        )
        assert response.status_code in (200, 201)
        assert not await PermissionService.has_app_permission(
            db, viewer, "inventory.view", card_type_key="Gadget"
        )

    async def test_create_type_accepts_the_map(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_role(db, key="member", label="Member", permissions={"inventory.view": True})

        response = await client.post(
            "/api/v1/metamodel/types",
            json={
                "key": "CustomThing",
                "label": "Custom Thing",
                "role_permissions": {"member": {"inventory.create": False}},
            },
            headers=auth_headers(admin),
        )
        assert response.status_code in (200, 201)
        assert response.json()["role_permissions"] == {"member": {"inventory.create": False}}


class TestTypePermissionsMatrix:
    async def test_returns_actions_and_roles(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        await create_role(
            db,
            key="member",
            label="Member",
            permissions={"inventory.create": True, "inventory.edit": True},
            is_system=False,
        )

        response = await client.get(
            "/api/v1/metamodel/types/Application/permissions", headers=auth_headers(admin)
        )
        assert response.status_code == 200
        body = response.json()
        assert [a["key"] for a in body["actions"]] == [
            "inventory.view",
            "inventory.create",
            "inventory.edit",
            "inventory.archive",
            "inventory.delete",
        ]
        # Descriptions come from the permission registry, not a hardcoded list.
        assert all(a["description"] for a in body["actions"])

        by_key = {r["key"]: r for r in body["roles"]}
        assert by_key["member"]["inherited"]["inventory.create"] is True
        assert by_key["member"]["inherited"]["inventory.delete"] is False
        assert by_key["member"]["overrides"] == {}

    async def test_wildcard_role_inherits_everything(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")

        response = await client.get(
            "/api/v1/metamodel/types/Application/permissions", headers=auth_headers(admin)
        )
        by_key = {r["key"]: r for r in response.json()["roles"]}
        assert by_key["admin"]["is_wildcard"] is True
        assert all(by_key["admin"]["inherited"].values())

    async def test_overrides_are_reported(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        ct = await create_card_type(db, key="Application", label="Application")
        await create_role(db, key="member", label="Member", permissions={"inventory.create": True})
        ct.role_permissions = {"member": {"inventory.create": False}}
        await db.flush()

        response = await client.get(
            "/api/v1/metamodel/types/Application/permissions", headers=auth_headers(admin)
        )
        by_key = {r["key"]: r for r in response.json()["roles"]}
        assert by_key["member"]["overrides"] == {"inventory.create": False}

    async def test_archived_role_is_omitted(self, client, db, metamodel_env):
        from app.models.role import Role

        admin = metamodel_env["admin"]
        await create_card_type(db, key="Application", label="Application")
        role = await create_role(db, key="oldrole", label="Old", permissions={})
        role.is_archived = True
        await db.flush()

        response = await client.get(
            "/api/v1/metamodel/types/Application/permissions", headers=auth_headers(admin)
        )
        assert "oldrole" not in {r["key"] for r in response.json()["roles"]}
        assert isinstance(role, Role)

    async def test_stale_override_role_is_ignored(self, client, db, metamodel_env):
        """A role key that no longer resolves is inert — never listed, never checked."""
        admin = metamodel_env["admin"]
        ct = await create_card_type(db, key="Application", label="Application")
        ct.role_permissions = {"vanished": {"inventory.create": False}}
        await db.flush()

        response = await client.get(
            "/api/v1/metamodel/types/Application/permissions", headers=auth_headers(admin)
        )
        assert response.status_code == 200
        assert "vanished" not in {r["key"] for r in response.json()["roles"]}

    async def test_requires_admin_metamodel(self, client, db, metamodel_env):
        viewer = metamodel_env["viewer"]
        await create_card_type(db, key="Application", label="Application")

        response = await client.get(
            "/api/v1/metamodel/types/Application/permissions", headers=auth_headers(viewer)
        )
        assert response.status_code == 403

    async def test_unknown_type_404s(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        response = await client.get(
            "/api/v1/metamodel/types/Nope/permissions", headers=auth_headers(admin)
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# Hierarchy link labels (#1100)
# ---------------------------------------------------------------------------


class TestHierarchyLinkLabels:
    """The per-type vocabulary a parent/child link is labelled from.

    Stored like `subtypes` and shaped like a `single_select`'s options, so it is
    translatable and colourable. The two things worth pinning are that a PATCH
    can actually write it (an absent entry in `update_type`'s `updatable` list
    fails silently, with a 200 and no change) and that removing an entry leaves
    the cards already carrying it alone.
    """

    async def test_patch_writes_the_vocabulary(self, client, db, metamodel_env):
        await create_card_type(db, key="Organization", label="Organization", has_hierarchy=True)
        vocab = [
            {"key": "commercial", "label": "Commercial", "color": "#2889ff"},
            {"key": "sales", "label": "Sales", "color": "#33cc58"},
        ]
        response = await client.patch(
            "/api/v1/metamodel/types/Organization",
            json={"hierarchy_labels": vocab},
            headers=auth_headers(metamodel_env["admin"]),
        )
        assert response.status_code == 200
        assert response.json()["hierarchy_labels"] == vocab

    async def test_types_listing_reports_it(self, client, db, metamodel_env):
        await create_card_type(
            db,
            key="Organization",
            label="Organization",
            has_hierarchy=True,
            hierarchy_labels=[{"key": "commercial", "label": "Commercial"}],
        )
        response = await client.get(
            "/api/v1/metamodel/types", headers=auth_headers(metamodel_env["admin"])
        )
        assert response.status_code == 200
        org = next(t for t in response.json() if t["key"] == "Organization")
        assert org["hierarchy_labels"] == [{"key": "commercial", "label": "Commercial"}]

    async def test_a_type_without_a_vocabulary_reports_an_empty_list(
        self, client, db, metamodel_env
    ):
        """Never null: the frontend gates the whole feature on `.length`."""
        await create_card_type(db, key="Application", label="Application")
        response = await client.get(
            "/api/v1/metamodel/types", headers=auth_headers(metamodel_env["admin"])
        )
        app = next(t for t in response.json() if t["key"] == "Application")
        assert app["hierarchy_labels"] == []

    async def test_usage_endpoint_counts_cards(self, client, db, metamodel_env):
        await create_card_type(
            db,
            key="Organization",
            label="Organization",
            has_hierarchy=True,
            hierarchy_labels=[{"key": "commercial", "label": "Commercial"}],
        )
        parent = await create_card(db, card_type="Organization", name="Company A")
        await db.flush()
        await create_card(
            db,
            card_type="Organization",
            name="Company B",
            parent_id=parent.id,
            parent_label="commercial",
        )
        await create_card(
            db,
            card_type="Organization",
            name="Company C",
            parent_id=parent.id,
            parent_label="commercial",
        )
        await create_card(db, card_type="Organization", name="Company D", parent_id=parent.id)
        await db.commit()

        response = await client.get(
            "/api/v1/metamodel/types/Organization/hierarchy-label-usage?label_key=commercial",
            headers=auth_headers(metamodel_env["admin"]),
        )
        assert response.status_code == 200
        assert response.json() == {"label_key": "commercial", "card_count": 2}

    async def test_usage_endpoint_requires_admin(self, client, db, metamodel_env):
        await create_card_type(db, key="Organization", label="Organization", has_hierarchy=True)
        response = await client.get(
            "/api/v1/metamodel/types/Organization/hierarchy-label-usage?label_key=commercial",
            headers=auth_headers(metamodel_env["viewer"]),
        )
        assert response.status_code == 403

    async def test_usage_endpoint_404s_for_an_unknown_type(self, client, db, metamodel_env):
        response = await client.get(
            "/api/v1/metamodel/types/Nope/hierarchy-label-usage?label_key=commercial",
            headers=auth_headers(metamodel_env["admin"]),
        )
        assert response.status_code == 404

    async def test_removing_an_entry_leaves_stored_values_alone(self, client, db, metamodel_env):
        """Cards keep the value and render it as an unknown chip — they are not
        rewritten, so nothing is lost if an admin removes an entry by mistake."""
        await create_card_type(
            db,
            key="Organization",
            label="Organization",
            has_hierarchy=True,
            hierarchy_labels=[{"key": "commercial", "label": "Commercial"}],
        )
        parent = await create_card(db, card_type="Organization", name="Company A")
        await db.flush()
        child = await create_card(
            db,
            card_type="Organization",
            name="Company B",
            parent_id=parent.id,
            parent_label="commercial",
        )
        await db.commit()

        response = await client.patch(
            "/api/v1/metamodel/types/Organization",
            json={"hierarchy_labels": []},
            headers=auth_headers(metamodel_env["admin"]),
        )
        assert response.status_code == 200

        await db.refresh(child)
        assert child.parent_label == "commercial"


# ---------------------------------------------------------------------------
# Security & admin audit log — every metamodel write records one admin.* row
# ---------------------------------------------------------------------------


async def _audit_rows(db, prefix: str):
    """Roll back whatever a request flushed but never committed, then read the
    audit log: what survives is exactly what the route committed. ORM
    instances are expired by the rollback, so tests capture ids first."""
    from app.models.audit_log import AuditLogEntry

    await db.rollback()
    result = await db.execute(
        select(AuditLogEntry)
        .where(AuditLogEntry.action.like(f"{prefix}%"))
        .order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars().all())


class TestMetamodelAudit:
    """Every metamodel write records one ``admin.*`` row whose ``details``
    read in plain language: plain columns as ``changes``, the JSON columns as
    semantic ``items`` (``services/audit_changes``), facts as ``context`` —
    labels everywhere, never a key or a size."""

    async def _patch_type(self, client, admin, key: str, body: dict):
        resp = await client.patch(
            f"/api/v1/metamodel/types/{key}", json=body, headers=auth_headers(admin)
        )
        assert resp.status_code == 200, resp.text
        return resp

    async def test_type_create_update_delete(self, client, db, metamodel_env, default_categories):
        admin = metamodel_env["admin"]
        admin_id, headers = admin.id, auth_headers(admin)

        resp = await client.post(
            "/api/v1/metamodel/types",
            json={
                "key": "AuditType",
                "label": "Audit Type",
                "category": "Application & Data",
                "fields_schema": [
                    {"section": "S", "fields": [{"key": "a", "label": "Alpha", "type": "text"}]}
                ],
            },
            headers=headers,
        )
        assert resp.status_code == 201
        await create_relation_type(
            db,
            key="relAuditSelf",
            label="depends on",
            source_type_key="AuditType",
            target_type_key="AuditType",
        )
        resp = await client.patch(
            "/api/v1/metamodel/types/AuditType",
            json={
                "label": "Audited",
                "fields_schema": [
                    {
                        "section": "S",
                        "fields": [
                            {"key": "a", "label": "Alpha", "type": "text"},
                            {"key": "b", "label": "Beta", "type": "number"},
                        ],
                    }
                ],
            },
            headers=headers,
        )
        assert resp.status_code == 200
        resp = await client.delete("/api/v1/metamodel/types/AuditType", headers=headers)
        assert resp.status_code == 200

        created, updated, deleted = await _audit_rows(db, "admin.metamodel.type.")
        assert created.action == "admin.metamodel.type.created"
        assert created.category == "admin" and created.outcome == "success"
        assert created.actor_user_id == admin_id
        assert (created.target_type, created.target_id, created.target_label) == (
            "card_type",
            "AuditType",
            "Audit Type",
        )
        assert created.details == {
            "context": {"category": "Application & Data", "has_hierarchy": False, "fields": 1}
        }

        assert updated.action == "admin.metamodel.type.updated"
        assert updated.target_label == "Audited"
        # The new field is named by its label and section — never a size.
        assert updated.details == {
            "changes": {"label": {"old": "Audit Type", "new": "Audited"}},
            "items": [{"kind": "field.added", "section": "S", "field": "Beta", "type": "number"}],
        }

        assert deleted.action == "admin.metamodel.type.deleted"
        # Removed relation types are listed by label, not by key.
        assert deleted.details == {
            "context": {
                "mode": "deleted",
                "card_count": 0,
                "relation_count": 0,
                "relation_types_removed": ["depends on"],
                "calculation_count": 0,
                "stakeholder_role_count": 0,
            }
        }

    async def test_adding_a_field_to_an_existing_section(self, client, db, metamodel_env):
        await create_card_type(
            db,
            key="Gizmo",
            label="Gizmo",
            fields_schema=[
                {"section": "Finance", "fields": [{"key": "cost", "label": "Cost", "type": "cost"}]}
            ],
        )
        await self._patch_type(
            client,
            metamodel_env["admin"],
            "Gizmo",
            {
                "fields_schema": [
                    {
                        "section": "Finance",
                        "fields": [
                            {"key": "cost", "label": "Cost", "type": "cost"},
                            {"key": "owner", "label": "Budget owner", "type": "text"},
                        ],
                    }
                ]
            },
        )

        [row] = await _audit_rows(db, "admin.metamodel.type.updated")
        assert row.details == {
            "items": [
                {
                    "kind": "field.added",
                    "section": "Finance",
                    "field": "Budget owner",
                    "type": "text",
                }
            ]
        }

    async def test_renaming_an_option(self, client, db, metamodel_env):
        def schema(option_label: str) -> list:
            return [
                {
                    "section": "Ops",
                    "fields": [
                        {
                            "key": "status",
                            "label": "Status",
                            "type": "single_select",
                            "options": [{"key": "a", "label": option_label}],
                        }
                    ],
                }
            ]

        await create_card_type(db, key="Gizmo", label="Gizmo", fields_schema=schema("Active"))
        await self._patch_type(
            client, metamodel_env["admin"], "Gizmo", {"fields_schema": schema("Live")}
        )

        [row] = await _audit_rows(db, "admin.metamodel.type.updated")
        assert row.details == {
            "items": [{"kind": "option.renamed", "field": "Status", "old": "Active", "new": "Live"}]
        }

    async def test_reordering_sections_names_them(self, client, db, metamodel_env):
        await create_card_type(
            db,
            key="Gizmo",
            label="Gizmo",
            fields_schema=[
                {
                    "section": "Finance",
                    "fields": [{"key": "cost", "label": "Cost", "type": "cost"}],
                },
                {"section": "Ops", "fields": [{"key": "sla", "label": "SLA", "type": "text"}]},
            ],
            section_config={"__order": ["description", "custom:0", "custom:1"]},
        )
        await self._patch_type(
            client,
            metamodel_env["admin"],
            "Gizmo",
            {"section_config": {"__order": ["description", "custom:1", "custom:0"]}},
        )

        [row] = await _audit_rows(db, "admin.metamodel.type.updated")
        assert row.details == {
            "items": [
                {
                    "kind": "layout.reordered",
                    "old": ["description", "Finance", "Ops"],
                    "new": ["description", "Ops", "Finance"],
                }
            ]
        }

    async def test_section_names_skip_the_description_pseudo_section(
        self, client, db, metamodel_env
    ):
        # ``custom:N`` indexes fields_schema WITHOUT ``__description``: custom:0
        # is Finance here, not the Description fields.
        await create_card_type(
            db,
            key="Gizmo",
            label="Gizmo",
            fields_schema=[
                {
                    "section": "__description",
                    "fields": [{"key": "alias", "label": "Alias", "type": "text"}],
                },
                {
                    "section": "Finance",
                    "fields": [{"key": "cost", "label": "Cost", "type": "cost"}],
                },
                {"section": "Ops", "fields": [{"key": "sla", "label": "SLA", "type": "text"}]},
            ],
            section_config={"__order": ["description", "custom:0", "custom:1"]},
        )
        await self._patch_type(
            client,
            metamodel_env["admin"],
            "Gizmo",
            {
                "section_config": {
                    "__order": ["description", "custom:1", "custom:0"],
                    "custom:1": {"hidden": True},
                }
            },
        )

        [row] = await _audit_rows(db, "admin.metamodel.type.updated")
        assert row.details == {
            "items": [
                {
                    "kind": "layout.reordered",
                    "old": ["description", "Finance", "Ops"],
                    "new": ["description", "Ops", "Finance"],
                },
                {
                    "kind": "section.changed",
                    "section": "Ops",
                    "property": "hidden",
                    "old": False,
                    "new": True,
                },
            ]
        }

    async def test_subtype_hidden_fields_are_named_by_label(self, client, db, metamodel_env):
        await create_card_type(
            db,
            key="Gizmo",
            label="Gizmo",
            fields_schema=[
                {
                    "section": "Finance",
                    "fields": [{"key": "costTotalAnnual", "label": "Annual cost", "type": "cost"}],
                }
            ],
            subtypes=[{"key": "saas", "label": "SaaS"}],
        )
        await self._patch_type(
            client,
            metamodel_env["admin"],
            "Gizmo",
            {"subtypes": [{"key": "saas", "label": "SaaS", "hidden_fields": ["costTotalAnnual"]}]},
        )

        [row] = await _audit_rows(db, "admin.metamodel.type.updated")
        assert row.details == {
            "items": [
                {
                    "kind": "subtype.changed",
                    "label": "SaaS",
                    "property": "hidden_fields",
                    "old": [],
                    "new": ["Annual cost"],
                }
            ]
        }

    async def test_subtype_optional_relations_are_named_by_verb(self, client, db, metamodel_env):
        # #1296: the log names each exempted side "verb → other type", read
        # from this type's side, never as a side key.
        await create_card_type(
            db, key="Gizmo", label="Gizmo", subtypes=[{"key": "saas", "label": "SaaS"}]
        )
        await create_card_type(db, key="Owner", label="Owner org")
        await create_relation_type(
            db,
            key="relGizmoToOwner",
            label="is owned by",
            source_type_key="Gizmo",
            target_type_key="Owner",
        )
        await create_relation_type(
            db,
            key="relGizmoFeeds",
            label="feeds",
            reverse_label="is fed by",
            source_type_key="Gizmo",
            target_type_key="Gizmo",
        )
        await self._patch_type(
            client,
            metamodel_env["admin"],
            "Gizmo",
            {
                "subtypes": [
                    {
                        "key": "saas",
                        "label": "SaaS",
                        "optional_relations": [
                            "relGizmoToOwner",
                            "relGizmoFeeds__in",
                            "relGone",
                        ],
                    }
                ]
            },
        )

        [row] = await _audit_rows(db, "admin.metamodel.type.updated")
        assert row.details == {
            "items": [
                {
                    "kind": "subtype.changed",
                    "label": "SaaS",
                    "property": "optional_relations",
                    "old": [],
                    "new": ["is owned by → Owner org", "is fed by → Gizmo", "relGone"],
                }
            ]
        }

    async def test_subtype_rename_and_recolour(self, client, db, metamodel_env):
        await create_card_type(
            db, key="Gizmo", label="Gizmo", subtypes=[{"key": "saas", "label": "SaaS"}]
        )
        await self._patch_type(
            client,
            metamodel_env["admin"],
            "Gizmo",
            {
                "subtypes": [
                    {"key": "saas", "label": "Software as a Service", "color": "#ff0000"},
                    {"key": "paas", "label": "PaaS"},
                ]
            },
        )

        [row] = await _audit_rows(db, "admin.metamodel.type.updated")
        assert row.details == {
            "items": [
                {"kind": "subtype.added", "label": "PaaS"},
                {"kind": "subtype.renamed", "old": "SaaS", "new": "Software as a Service"},
                {
                    "kind": "subtype.changed",
                    "label": "Software as a Service",
                    "property": "color",
                    "old": None,
                    "new": "#ff0000",
                },
            ]
        }

    async def test_reference_config_is_diffed_per_key(self, client, db, metamodel_env):
        await create_card_type(db, key="Gizmo", label="Gizmo")
        await self._patch_type(
            client,
            metamodel_env["admin"],
            "Gizmo",
            {"reference_config": {"mode": "auto", "prefix": "GZ-", "start": 1, "padding": 3}},
        )

        [row] = await _audit_rows(db, "admin.metamodel.type.updated")
        assert row.details == {
            "changes": {
                "reference_mode": {"old": "off", "new": "auto"},
                "reference_prefix": {"old": "", "new": "GZ-"},
                "reference_start": {"old": 10000, "new": 1},
                "reference_padding": {"old": 0, "new": 3},
            }
        }

    async def test_role_permission_flip_records_exactly_that_cell(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_role(db, key="member", label="Member", permissions={"inventory.view": True})
        await create_card_type(
            db,
            key="Gizmo",
            label="Gizmo",
            role_permissions={
                "member": {"inventory.view": True, "inventory.edit": False},
                "viewer": {"inventory.view": False},
            },
        )
        await self._patch_type(
            client,
            admin,
            "Gizmo",
            {
                "role_permissions": {
                    "member": {"inventory.view": False, "inventory.edit": False},
                    "viewer": {"inventory.view": False},
                }
            },
        )

        [row] = await _audit_rows(db, "admin.metamodel.type.updated")
        # The role is named by its label, the cell by allow / deny / inherit.
        assert row.details == {
            "items": [
                {
                    "kind": "type_permission.changed",
                    "role": "Member",
                    "permission": "inventory.view",
                    "old": "allow",
                    "new": "deny",
                }
            ]
        }

    async def test_a_view_deny_reads_inherit_to_deny(self, client, db, metamodel_env):
        await create_role(db, key="member", label="Member", permissions={"inventory.view": True})
        await create_card_type(db, key="Gizmo", label="Gizmo")
        await self._patch_type(
            client,
            metamodel_env["admin"],
            "Gizmo",
            {"role_permissions": {"member": {"inventory.view": False}}},
        )

        [row] = await _audit_rows(db, "admin.metamodel.type.updated")
        assert row.details == {
            "items": [
                {
                    "kind": "type_permission.changed",
                    "role": "Member",
                    "permission": "inventory.view",
                    "old": "inherit",
                    "new": "deny",
                }
            ]
        }

    async def test_removing_a_deny_cell_reads_as_inherit(self, client, db, metamodel_env):
        await create_card_type(
            db, key="Gizmo", label="Gizmo", role_permissions={"viewer": {"inventory.view": False}}
        )
        await self._patch_type(client, metamodel_env["admin"], "Gizmo", {"role_permissions": {}})

        [row] = await _audit_rows(db, "admin.metamodel.type.updated")
        assert row.details == {
            "items": [
                {
                    "kind": "type_permission.changed",
                    "role": "Viewer",
                    "permission": "inventory.view",
                    "old": "deny",
                    "new": "inherit",
                }
            ]
        }

    async def test_a_label_translation_edit_names_locale_and_text(self, client, db, metamodel_env):
        await create_card_type(
            db, key="Gizmo", label="Gizmo", translations={"label": {"de": "Gerat"}}
        )
        await self._patch_type(
            client,
            metamodel_env["admin"],
            "Gizmo",
            {"translations": {"label": {"de": "Gerät", "fr": "Gadget"}}},
        )

        [row] = await _audit_rows(db, "admin.metamodel.type.updated")
        assert row.details == {
            "items": [
                {
                    "kind": "translation.changed",
                    "property": "label",
                    "locale": "de",
                    "old": "Gerat",
                    "new": "Gerät",
                },
                {
                    "kind": "translation.changed",
                    "property": "label",
                    "locale": "fr",
                    "old": None,
                    "new": "Gadget",
                },
            ]
        }

    async def test_unchanged_json_columns_record_nothing(self, client, db, metamodel_env):
        schema = [{"section": "S", "fields": [{"key": "a", "label": "A", "type": "text"}]}]
        await create_card_type(
            db,
            key="Gizmo",
            label="Gizmo",
            fields_schema=schema,
            translations={"label": {"de": "Gerät"}},
        )
        await self._patch_type(
            client,
            metamodel_env["admin"],
            "Gizmo",
            {
                "label": "Gadget",
                "fields_schema": schema,
                "translations": {"label": {"de": "Gerät"}},
            },
        )

        [row] = await _audit_rows(db, "admin.metamodel.type.updated")
        assert row.details == {"changes": {"label": {"old": "Gizmo", "new": "Gadget"}}}

    async def test_a_no_op_patch_records_no_row(self, client, db, metamodel_env):
        schema = [{"section": "S", "fields": [{"key": "a", "label": "A", "type": "text"}]}]
        await create_card_type(db, key="Gizmo", label="Gizmo", fields_schema=schema)
        # A stored ``{}`` reference config and the defaults a save writes back
        # are the same configuration, not a change.
        await self._patch_type(
            client,
            metamodel_env["admin"],
            "Gizmo",
            {"label": "Gizmo", "fields_schema": schema, "reference_config": {"mode": "off"}},
        )

        assert await _audit_rows(db, "admin.metamodel.type.") == []

    async def test_built_in_type_delete_records_the_soft_delete(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(db, key="BuiltIn", label="Built In", built_in=True)
        resp = await client.delete("/api/v1/metamodel/types/BuiltIn", headers=auth_headers(admin))
        assert resp.json()["status"] == "hidden"
        [row] = await _audit_rows(db, "admin.metamodel.type.")
        assert row.details == {"context": {"mode": "hidden", "card_count": 0}}

    async def test_a_refused_write_records_nothing(self, client, db, metamodel_env):
        resp = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "Nope", "label": "Nope"},
            headers=auth_headers(metamodel_env["viewer"]),
        )
        assert resp.status_code == 403
        assert await _audit_rows(db, "admin.") == []

    async def test_relation_type_lifecycle(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        headers = auth_headers(admin)
        await create_card_type(db, key="Application", label="Business App")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(db, key="relBuiltIn", label="uses", built_in=True)

        resp = await client.post(
            "/api/v1/metamodel/relation-types",
            json={
                "key": "relAudit",
                "label": "runs on",
                "source_type_key": "Application",
                "target_type_key": "ITComponent",
                "cardinality": "1:n",
            },
            headers=headers,
        )
        assert resp.status_code == 201
        resp = await client.patch(
            "/api/v1/metamodel/relation-types/relAudit",
            json={"label": "is hosted on"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert (
            await client.delete("/api/v1/metamodel/relation-types/relAudit", headers=headers)
        ).status_code == 200
        assert (
            await client.delete("/api/v1/metamodel/relation-types/relBuiltIn", headers=headers)
        ).status_code == 200
        assert (
            await client.post(
                "/api/v1/metamodel/relation-types/relBuiltIn/restore", headers=headers
            )
        ).status_code == 200

        rows = await _audit_rows(db, "admin.metamodel.relation_type.")
        assert [r.action.rsplit(".", 1)[1] for r in rows] == [
            "created",
            "updated",
            "deleted",
            "deleted",
            "restored",
        ]
        # The endpoints are named by their type labels.
        assert rows[0].details == {
            "context": {
                "source_type": "Business App",
                "target_type": "IT Component",
                "cardinality": "1:n",
            }
        }
        assert rows[1].details == {"changes": {"label": {"old": "runs on", "new": "is hosted on"}}}
        assert rows[2].details == {"context": {"mode": "deleted", "instances_removed": 0}}
        assert rows[3].details == {"context": {"mode": "hidden", "instances_removed": 0}}
        assert rows[4].target_id == "relBuiltIn"
        assert rows[4].details is None

    async def test_relation_type_endpoint_change_records_labels(self, client, db, metamodel_env):
        await create_card_type(db, key="Application", label="Business App")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_card_type(db, key="Initiative", label="Strategic Initiative")
        await create_relation_type(db, key="relMove")
        resp = await client.patch(
            "/api/v1/metamodel/relation-types/relMove",
            json={
                "source_type_key": "Initiative",
                "attributes_schema": [{"key": "usage", "label": "Usage", "type": "text"}],
            },
            headers=auth_headers(metamodel_env["admin"]),
        )
        assert resp.status_code == 200, resp.text

        [row] = await _audit_rows(db, "admin.metamodel.relation_type.updated")
        assert row.details == {
            "changes": {"source_type": {"old": "Business App", "new": "Strategic Initiative"}},
            "items": [{"kind": "attribute.added", "attribute": "Usage", "type": "text"}],
        }

    async def test_a_no_op_relation_type_patch_records_no_row(self, client, db, metamodel_env):
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_relation_type(db, key="relSame", label="uses")
        resp = await client.patch(
            "/api/v1/metamodel/relation-types/relSame",
            json={"label": "uses", "source_type_key": "Application"},
            headers=auth_headers(metamodel_env["admin"]),
        )
        assert resp.status_code == 200
        assert await _audit_rows(db, "admin.metamodel.relation_type.") == []

    async def test_principles_regulations_and_resource_types(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        headers = auth_headers(admin)

        principle = await client.post(
            "/api/v1/metamodel/principles", json={"title": "Reuse first"}, headers=headers
        )
        pid = principle.json()["id"]
        await client.patch(
            f"/api/v1/metamodel/principles/{pid}", json={"title": "Reuse"}, headers=headers
        )
        await client.delete(f"/api/v1/metamodel/principles/{pid}", headers=headers)

        reg = await client.post(
            "/api/v1/metamodel/compliance-regulations",
            json={"key": "audit_reg", "label": "Audit Reg"},
            headers=headers,
        )
        rid = reg.json()["id"]
        await client.patch(
            f"/api/v1/metamodel/compliance-regulations/{rid}",
            json={"is_enabled": False, "translations": {"de": "Prüfregel"}},
            headers=headers,
        )
        await client.delete(f"/api/v1/metamodel/compliance-regulations/{rid}", headers=headers)

        rt = await client.post(
            "/api/v1/metamodel/resource-types",
            json={"kind": "link_type", "key": "audit_wiki", "label": "Wiki"},
            headers=headers,
        )
        rtid = rt.json()["id"]
        await client.patch(
            f"/api/v1/metamodel/resource-types/{rtid}",
            json={"label": "Wiki page", "icon": "menu_book", "translations": {"fr": "Wiki"}},
            headers=headers,
        )
        await client.delete(f"/api/v1/metamodel/resource-types/{rtid}", headers=headers)

        principles = await _audit_rows(db, "admin.principle.")
        assert [r.action for r in principles] == [
            "admin.principle.created",
            "admin.principle.updated",
            "admin.principle.deleted",
        ]
        assert principles[0].details == {"context": {"is_active": True}}
        assert principles[1].details == {
            "changes": {"title": {"old": "Reuse first", "new": "Reuse"}}
        }
        assert principles[2].target_label == "Reuse"
        assert principles[2].details is None

        regulations = await _audit_rows(db, "admin.regulation.")
        assert [r.action for r in regulations] == [
            "admin.regulation.created",
            "admin.regulation.updated",
            "admin.regulation.deleted",
        ]
        assert regulations[0].details == {"context": {"is_enabled": True}}
        assert regulations[1].details == {
            "changes": {"is_enabled": {"old": True, "new": False}},
            "items": [
                {
                    "kind": "translation.changed",
                    "property": "label",
                    "locale": "de",
                    "old": None,
                    "new": "Prüfregel",
                }
            ],
        }
        assert regulations[0].target_id == "audit_reg"

        resource = await _audit_rows(db, "admin.metamodel.resource_type.")
        assert [r.action.rsplit(".", 1)[1] for r in resource] == ["created", "updated", "deleted"]
        assert resource[0].details == {"context": {"kind": "link_type", "key": "audit_wiki"}}
        assert resource[1].details == {
            "changes": {
                "label": {"old": "Wiki", "new": "Wiki page"},
                "icon": {"old": None, "new": "menu_book"},
            },
            "items": [
                {
                    "kind": "translation.changed",
                    "property": "label",
                    "locale": "fr",
                    "old": None,
                    "new": "Wiki",
                }
            ],
        }
        assert resource[2].details == {"context": {"kind": "link_type", "key": "audit_wiki"}}
        # The row's own id is its target id — never repeated in the details.
        assert rtid not in str(resource[1].details)

    async def test_long_principle_texts_are_clipped(self, client, db, metamodel_env):
        headers = auth_headers(metamodel_env["admin"])
        principle = await client.post(
            "/api/v1/metamodel/principles",
            json={"title": "Reuse", "rationale": "r" * 600},
            headers=headers,
        )
        pid = principle.json()["id"]
        resp = await client.patch(
            f"/api/v1/metamodel/principles/{pid}",
            json={"rationale": "s" * 501, "implications": "short", "is_active": False},
            headers=headers,
        )
        assert resp.status_code == 200

        [row] = await _audit_rows(db, "admin.principle.updated")
        assert row.details == {
            "changes": {
                "rationale": {"old": "r" * 499 + "…", "new": "s" * 499 + "…"},
                "implications": {"old": None, "new": "short"},
                "is_active": {"old": True, "new": False},
            }
        }

    async def test_a_no_op_principle_patch_records_no_row(self, client, db, metamodel_env):
        headers = auth_headers(metamodel_env["admin"])
        principle = await client.post(
            "/api/v1/metamodel/principles", json={"title": "Reuse"}, headers=headers
        )
        pid = principle.json()["id"]
        resp = await client.patch(
            f"/api/v1/metamodel/principles/{pid}", json={"title": "Reuse"}, headers=headers
        )
        assert resp.status_code == 200
        assert await _audit_rows(db, "admin.principle.updated") == []

    async def test_deleting_an_unknown_principle_records_nothing(self, client, db, metamodel_env):
        import uuid as _uuid

        resp = await client.delete(
            f"/api/v1/metamodel/principles/{_uuid.uuid4()}",
            headers=auth_headers(metamodel_env["admin"]),
        )
        assert resp.status_code == 204
        assert await _audit_rows(db, "admin.principle.") == []

    async def test_generate_references(self, client, db, metamodel_env):
        admin = metamodel_env["admin"]
        await create_card_type(
            db,
            key="Application",
            label="Application",
        )
        ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
        ct.reference_config = {"mode": "auto", "prefix": "APP-", "start": 1, "padding": 0}
        await create_card(db, card_type="Application", name="One", user_id=admin.id)
        await db.flush()

        resp = await client.post(
            "/api/v1/metamodel/types/Application/generate-references",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        [row] = await _audit_rows(db, "admin.metamodel.type.references_generated")
        assert row.details == {"context": {"generated": 1}}
        assert resp.json()["generated"] == 1
        assert row.target_id == "Application"


class TestAuditHelpers:
    """The pure helpers behind the metamodel audit rows (no database)."""

    def test_reference_changes_normalise_defaults(self):
        from app.api.v1.metamodel import _reference_changes

        assert _reference_changes({}, {"mode": "off"}) == {}
        assert _reference_changes(None, {"mode": "auto", "prefix": "A-"}) == {
            "reference_mode": {"old": "off", "new": "auto"},
            "reference_prefix": {"old": "", "new": "A-"},
        }

    def test_reference_changes_compare_an_invalid_config_as_stored(self):
        from app.api.v1.metamodel import _reference_changes

        # A prefix the validator refuses is still reported, not swallowed.
        assert _reference_changes({"mode": "off", "prefix": "bad prefix!"}, {"mode": "off"}) == {
            "reference_prefix": {"old": "bad prefix!", "new": ""},
            "reference_start": {"old": None, "new": 10000},
            "reference_padding": {"old": None, "new": 0},
        }
        assert _reference_changes("junk", {"mode": "auto"}) == {
            "reference_mode": {"old": None, "new": "auto"},
            "reference_prefix": {"old": None, "new": ""},
            "reference_start": {"old": None, "new": 10000},
            "reference_padding": {"old": None, "new": 0},
        }

    def test_clip_text(self):
        from app.api.v1.metamodel import _clip_text

        assert _clip_text("a" * 500) == "a" * 500
        assert _clip_text("a" * 501) == "a" * 499 + "…"
        assert _clip_text(None) is None
        assert _clip_text(7) == 7

    def test_clipped_touches_only_the_long_text_fields(self):
        from app.api.v1.metamodel import _clipped

        long = "x" * 600
        assert _clipped(
            {
                "title": {"old": long, "new": "t"},
                "implications": {"old": None, "new": long},
            }
        ) == {
            "title": {"old": long, "new": "t"},
            "implications": {"old": None, "new": "x" * 499 + "…"},
        }

    def test_type_label_falls_back_to_the_key(self):
        from app.api.v1.metamodel import _type_label

        assert _type_label({"App": "Business App"}, "App") == "Business App"
        assert _type_label({"App": ""}, "App") == "App"
        assert _type_label({}, "Gone") == "Gone"
        assert _type_label({}, None) is None

    def test_section_names(self):
        from app.api.v1.metamodel import _section_names

        assert _section_names([{"section": "A"}, "junk", {"section": "B"}]) == ["A", "B"]
        # ``custom:N`` skips the Description pseudo-section.
        assert _section_names(
            [{"section": "__description"}, {"section": "A"}, {"section": "B"}]
        ) == ["A", "B"]
        assert _section_names(None) == []

    def test_type_audit_changes_caps_items(self):
        from app.api.v1.metamodel import _TYPE_AUDIT_JSON, _TYPE_AUDIT_SCALARS, _type_audit_changes

        before = dict.fromkeys(_TYPE_AUDIT_SCALARS + _TYPE_AUDIT_JSON)
        after = dict(
            before,
            subtypes=[{"key": f"s{i}", "label": f"S{i}"} for i in range(205)],
        )
        changes, items = _type_audit_changes(before, after)
        assert changes == {}
        assert len(items) == 201
        assert items[0] == {"kind": "subtype.added", "label": "S0"}
        assert items[-1] == {"kind": "more", "count": 5}
