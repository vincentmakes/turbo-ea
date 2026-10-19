"""Integration tests for the card type category registry (the EA layers).

Covers ``/metamodel/categories`` (list, create, edit, reorder, delete), the
lock on the four built-in layers, the validation ``POST`` / ``PATCH
/metamodel/types`` now applies to ``category``, the bootstrap payload and the
Security & admin log rows each write records.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.audit_log import AuditLogEntry
from app.models.card_type_category import CardTypeCategory
from tests.conftest import auth_headers, create_card_type, create_role, create_user

BASE = "/api/v1/metamodel/categories"


@pytest.fixture
async def env(db, default_categories):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "viewer": viewer}


async def _audit(db, action: str) -> list[AuditLogEntry]:
    await db.rollback()
    result = await db.execute(
        select(AuditLogEntry)
        .where(AuditLogEntry.action == action)
        .order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars().all())


async def _create(client, user, label: str, **extra):
    return await client.post(BASE, json={"label": label, **extra}, headers=auth_headers(user))


class TestList:
    async def test_viewer_reads_the_defaults_in_layer_order(self, client, env):
        r = await client.get(BASE, headers=auth_headers(env["viewer"]))
        assert r.status_code == 200
        rows = r.json()
        assert [c["key"] for c in rows] == [
            "Strategy & Transformation",
            "Business Architecture",
            "Application & Data",
            "Technical Architecture",
        ]
        assert all(c["built_in"] for c in rows)
        app_data = rows[2]
        assert app_data["color"] == "#0f7eb5"
        assert app_data["translations"]["fr"] == "Application et données"

    async def test_requires_authentication(self, client, env):
        r = await client.get(BASE)
        assert r.status_code == 401

    async def test_bootstrap_carries_the_registry(self, client, env):
        r = await client.get("/api/v1/settings/bootstrap", headers=auth_headers(env["viewer"]))
        assert r.status_code == 200
        keys = [c["key"] for c in r.json()["card_type_categories"]]
        assert keys[0] == "Strategy & Transformation"
        assert len(keys) == 4


class TestCreate:
    async def test_key_is_the_trimmed_label_with_the_default_colour(self, client, db, env):
        r = await _create(client, env["admin"], "  Security Architecture  ")
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["key"] == body["label"] == "Security Architecture"
        assert body["color"] == "#999999"
        assert body["built_in"] is False
        # Ordered after every existing layer.
        assert body["sort_order"] == 4

        (row,) = await _audit(db, "admin.metamodel.category.created")
        assert (row.target_type, row.target_id, row.target_label) == (
            "card_type_category",
            "Security Architecture",
            "Security Architecture",
        )
        assert row.details == {"context": {"color": "#999999"}}

    async def test_colour_and_translations_are_kept(self, client, env):
        r = await _create(
            client,
            env["admin"],
            "Security",
            color="#123456",
            translations={"fr": " Sécurité ", "de": "  "},
        )
        assert r.status_code == 201
        assert r.json()["color"] == "#123456"
        # A blank translation means "fall back to the label".
        assert r.json()["translations"] == {"fr": "Sécurité"}

    async def test_duplicate_is_case_insensitive(self, client, env):
        r = await _create(client, env["admin"], "application & data")
        assert r.status_code == 409
        assert r.json()["detail"]["error"] == "category_exists"
        assert r.json()["detail"]["key"] == "Application & Data"

    async def test_a_renamed_categorys_label_is_taken(self, client, db, env):
        await _create(client, env["admin"], "Foo")
        r = await client.patch(
            f"{BASE}/Foo", json={"label": "Bar"}, headers=auth_headers(env["admin"])
        )
        assert r.status_code == 200, r.text
        r = await _create(client, env["admin"], "bar")
        assert r.status_code == 409
        assert r.json()["detail"]["error"] == "category_exists"
        # The clash names the row that holds the label, by its key.
        assert r.json()["detail"]["key"] == "Foo"
        rows = (await db.execute(select(CardTypeCategory.key))).scalars().all()
        assert "bar" not in rows

    @pytest.mark.parametrize("label", ["", "   ", "x" * 101])
    async def test_blank_or_overlong_label_is_refused(self, client, env, label):
        r = await _create(client, env["admin"], label)
        assert r.status_code == 400
        assert r.json()["detail"]["error"] == "invalid_category"

    async def test_bad_colour_is_refused(self, client, env):
        r = await _create(client, env["admin"], "Security", color="red")
        assert r.status_code == 400

    async def test_non_admin_is_forbidden(self, client, env):
        r = await _create(client, env["viewer"], "Security")
        assert r.status_code == 403


class TestUpdate:
    async def test_custom_category_is_editable_and_audited(self, client, db, env):
        await _create(client, env["admin"], "Security")
        r = await client.patch(
            f"{BASE}/Security",
            json={"label": "Security Layer", "color": "#abcdef", "translations": {"de": "Sich"}},
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # The key is what card types store, so it never moves.
        assert body["key"] == "Security"
        assert body["label"] == "Security Layer"
        assert body["color"] == "#abcdef"

        (row,) = await _audit(db, "admin.metamodel.category.updated")
        assert row.target_label == "Security Layer"
        assert row.details["changes"] == {
            "label": {"old": "Security", "new": "Security Layer"},
            "color": {"old": "#999999", "new": "#abcdef"},
        }
        assert row.details["items"] == [
            {
                "kind": "translation.changed",
                "property": "label",
                "locale": "de",
                "old": None,
                "new": "Sich",
            }
        ]

    async def test_a_no_op_records_nothing(self, client, db, env):
        await _create(client, env["admin"], "Security")
        r = await client.patch(
            f"{BASE}/Security", json={"label": "Security"}, headers=auth_headers(env["admin"])
        )
        assert r.status_code == 200
        assert await _audit(db, "admin.metamodel.category.updated") == []

    async def test_built_in_is_locked(self, client, env):
        r = await client.patch(
            f"{BASE}/Application & Data",
            json={"color": "#000000"},
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 400
        assert r.json()["detail"]["error"] == "built_in_locked"

    async def test_rename_onto_another_category_conflicts(self, client, env):
        await _create(client, env["admin"], "Security")
        r = await client.patch(
            f"{BASE}/Security",
            json={"label": "TECHNICAL architecture"},
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 409
        assert r.json()["detail"]["error"] == "category_exists"

    async def test_rename_onto_another_renamed_categorys_label_conflicts(self, client, env):
        await _create(client, env["admin"], "Foo")
        await _create(client, env["admin"], "Baz")
        r = await client.patch(
            f"{BASE}/Foo", json={"label": "Bar"}, headers=auth_headers(env["admin"])
        )
        assert r.status_code == 200
        r = await client.patch(
            f"{BASE}/Baz", json={"label": "BAR"}, headers=auth_headers(env["admin"])
        )
        assert r.status_code == 409
        assert r.json()["detail"]["error"] == "category_exists"
        assert r.json()["detail"]["key"] == "Foo"

    async def test_a_category_may_be_renamed_back_to_its_own_key(self, client, env):
        await _create(client, env["admin"], "Foo")
        await client.patch(f"{BASE}/Foo", json={"label": "Bar"}, headers=auth_headers(env["admin"]))
        r = await client.patch(
            f"{BASE}/Foo", json={"label": "foo"}, headers=auth_headers(env["admin"])
        )
        assert r.status_code == 200, r.text
        assert r.json()["label"] == "foo"

    async def test_unknown_is_404(self, client, env):
        r = await client.patch(
            f"{BASE}/Nope", json={"label": "x"}, headers=auth_headers(env["admin"])
        )
        assert r.status_code == 404

    async def test_non_admin_is_forbidden(self, client, env):
        r = await client.patch(
            f"{BASE}/Business Architecture", json={}, headers=auth_headers(env["viewer"])
        )
        assert r.status_code == 403


class TestReorder:
    async def test_permutation_rewrites_every_sort_order(self, client, db, env):
        await _create(client, env["admin"], "Security")
        order = [
            "Strategy & Transformation",
            "Security",
            "Business Architecture",
            "Application & Data",
            "Technical Architecture",
        ]
        r = await client.put(
            f"{BASE}/order", json={"keys": order}, headers=auth_headers(env["admin"])
        )
        assert r.status_code == 200, r.text
        assert [c["key"] for c in r.json()] == order
        assert [c["sort_order"] for c in r.json()] == [0, 1, 2, 3, 4]

        (row,) = await _audit(db, "admin.metamodel.category.reordered")
        assert row.details == {"context": {"order": order}}

    async def test_unchanged_order_records_nothing(self, client, db, env):
        r = await client.get(BASE, headers=auth_headers(env["admin"]))
        keys = [c["key"] for c in r.json()]
        r = await client.put(
            f"{BASE}/order", json={"keys": keys}, headers=auth_headers(env["admin"])
        )
        assert r.status_code == 200
        assert await _audit(db, "admin.metamodel.category.reordered") == []

    @pytest.mark.parametrize(
        "keys",
        [
            ["Strategy & Transformation", "Business Architecture", "Application & Data"],
            [
                "Strategy & Transformation",
                "Business Architecture",
                "Application & Data",
                "Application & Data",
            ],
            [
                "Strategy & Transformation",
                "Business Architecture",
                "Application & Data",
                "Unknown",
            ],
        ],
    )
    async def test_non_permutation_is_refused(self, client, env, keys):
        r = await client.put(
            f"{BASE}/order", json={"keys": keys}, headers=auth_headers(env["admin"])
        )
        assert r.status_code == 400
        assert r.json()["detail"]["error"] == "invalid_order"

    async def test_non_admin_is_forbidden(self, client, env):
        r = await client.put(
            f"{BASE}/order", json={"keys": []}, headers=auth_headers(env["viewer"])
        )
        assert r.status_code == 403


class TestDelete:
    async def test_built_in_cannot_be_deleted(self, client, env):
        r = await client.delete(f"{BASE}/Business Architecture", headers=auth_headers(env["admin"]))
        assert r.status_code == 400
        assert r.json()["detail"]["error"] == "built_in_locked"

    async def test_in_use_answers_409_with_the_types(self, client, db, env):
        await _create(client, env["admin"], "Security")
        await create_card_type(db, key="Zeta", label="Zeta Type", category="Security")
        await create_card_type(db, key="Alpha", label="Alpha Type", category=" Security ")
        r = await client.delete(f"{BASE}/Security", headers=auth_headers(env["admin"]))
        assert r.status_code == 409
        detail = r.json()["detail"]
        assert detail["error"] == "types_present"
        assert detail["count"] == 2
        assert detail["types"] == ["Alpha Type", "Zeta Type"]

    async def test_unused_custom_category_is_deleted_and_audited(self, client, db, env):
        await _create(client, env["admin"], "Security")
        r = await client.delete(f"{BASE}/Security", headers=auth_headers(env["admin"]))
        assert r.status_code == 204
        (row,) = await _audit(db, "admin.metamodel.category.deleted")
        assert row.target_label == "Security"
        remaining = (await db.execute(select(CardTypeCategory.key))).scalars().all()
        assert "Security" not in remaining

    async def test_unknown_is_404(self, client, env):
        r = await client.delete(f"{BASE}/Nope", headers=auth_headers(env["admin"]))
        assert r.status_code == 404

    async def test_non_admin_is_forbidden(self, client, env):
        r = await client.delete(f"{BASE}/Security", headers=auth_headers(env["viewer"]))
        assert r.status_code == 403


class TestTypeCategoryValidation:
    async def test_a_built_in_type_moves_to_a_custom_category(self, client, db, env):
        await create_card_type(db, key="Application", built_in=True, category="Application & Data")
        await _create(client, env["admin"], "Security")
        r = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"category": " Security "},
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 200, r.text
        assert r.json()["category"] == "Security"

    async def test_an_unknown_category_is_refused(self, client, db, env):
        await create_card_type(db, key="Application", category="Application & Data")
        r = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"category": "Typo Layer"},
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 400
        assert r.json()["detail"]["error"] == "unknown_category"
        assert r.json()["detail"]["category"] == "Typo Layer"

    async def test_blank_means_uncategorised(self, client, db, env):
        await create_card_type(db, key="Application", category="Application & Data")
        r = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"category": "  "},
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 200
        assert r.json()["category"] is None

    async def test_resending_a_dangling_current_value_is_accepted(self, client, db, env):
        await create_card_type(db, key="Application", category="Legacy Layer")
        r = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"category": "Legacy Layer", "label": "Apps"},
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 200
        assert r.json()["label"] == "Apps"

    async def test_create_type_validates_the_category(self, client, env):
        ok = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "Gadget", "label": "Gadget", "category": "Technical Architecture"},
            headers=auth_headers(env["admin"]),
        )
        assert ok.status_code == 201
        assert ok.json()["category"] == "Technical Architecture"
        bad = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "Gizmo", "label": "Gizmo", "category": "Nowhere"},
            headers=auth_headers(env["admin"]),
        )
        assert bad.status_code == 400
        assert bad.json()["detail"]["error"] == "unknown_category"

    async def test_create_type_without_category_is_uncategorised(self, client, env):
        r = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "Gadget", "label": "Gadget"},
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 201
        assert r.json()["category"] is None

    async def test_non_string_category_is_refused(self, client, env):
        r = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "Gadget", "label": "Gadget", "category": 5},
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 400
        assert r.json()["detail"]["error"] == "invalid_category"


class TestTypeCategoryAuditLabels:
    """A card-type audit row names its category by the registry label — the
    key a type stores is not what an admin reads once a custom layer has been
    renamed."""

    async def _renamed_foo(self, client, env):
        await _create(client, env["admin"], "Foo")
        r = await client.patch(
            f"{BASE}/Foo", json={"label": "Bar"}, headers=auth_headers(env["admin"])
        )
        assert r.status_code == 200

    async def test_moving_a_type_logs_the_category_labels(self, client, db, env):
        await create_card_type(db, key="Application", category="Application & Data")
        await self._renamed_foo(client, env)
        r = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"category": "Foo"},
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 200, r.text
        assert r.json()["category"] == "Foo"
        (row,) = await _audit(db, "admin.metamodel.type.updated")
        assert row.details["changes"]["category"] == {"old": "Application & Data", "new": "Bar"}

    async def test_a_value_without_a_registry_row_is_logged_as_stored(self, client, db, env):
        await create_card_type(db, key="Application", category="Legacy Layer")
        r = await client.patch(
            "/api/v1/metamodel/types/Application",
            json={"category": None},
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 200
        (row,) = await _audit(db, "admin.metamodel.type.updated")
        assert row.details["changes"]["category"] == {"old": "Legacy Layer", "new": None}

    async def test_creating_a_type_logs_the_category_label(self, client, db, env):
        await self._renamed_foo(client, env)
        r = await client.post(
            "/api/v1/metamodel/types",
            json={"key": "Gadget", "label": "Gadget", "category": "Foo"},
            headers=auth_headers(env["admin"]),
        )
        assert r.status_code == 201, r.text
        (row,) = await _audit(db, "admin.metamodel.type.created")
        assert row.details["context"]["category"] == "Bar"
