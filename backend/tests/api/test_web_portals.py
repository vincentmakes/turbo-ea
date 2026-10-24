"""Integration tests for the /web-portals endpoints."""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import (
    auth_headers,
    create_card_type,
    create_relation_type,
    create_role,
    create_user,
)


@pytest.fixture
async def portals_env(db):
    """Prerequisite data for web portal tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={"inventory.view": True},
    )
    await create_card_type(db, key="Application", label="Application")
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "viewer": viewer}


class TestCreatePortal:
    async def test_admin_can_create_portal(self, client, db, portals_env):
        admin = portals_env["admin"]
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "App Catalog",
                "slug": "app-catalog",
                "card_type": "Application",
                "is_published": True,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "App Catalog"
        assert data["slug"] == "app-catalog"
        assert data["card_type"] == "Application"
        assert data["is_published"] is True

    async def test_create_portal_invalid_slug(self, client, db, portals_env):
        admin = portals_env["admin"]
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Bad Slug",
                "slug": "Invalid Slug!",
                "card_type": "Application",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_create_portal_duplicate_slug(self, client, db, portals_env):
        admin = portals_env["admin"]
        body = {
            "name": "Portal One",
            "slug": "dup-slug",
            "card_type": "Application",
        }
        resp1 = await client.post(
            "/api/v1/web-portals",
            json=body,
            headers=auth_headers(admin),
        )
        assert resp1.status_code == 201

        resp2 = await client.post(
            "/api/v1/web-portals",
            json={**body, "name": "Portal Two"},
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 400

    async def test_viewer_cannot_create_portal(self, client, db, portals_env):
        viewer = portals_env["viewer"]
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Blocked",
                "slug": "blocked",
                "card_type": "Application",
            },
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


class TestListAndGetPortal:
    async def test_list_portals(self, client, db, portals_env):
        admin = portals_env["admin"]
        await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Portal A",
                "slug": "portal-a",
                "card_type": "Application",
            },
            headers=auth_headers(admin),
        )
        resp = await client.get(
            "/api/v1/web-portals",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        names = [p["name"] for p in data]
        assert "Portal A" in names

    async def test_get_portal_by_id(self, client, db, portals_env):
        admin = portals_env["admin"]
        create_resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Fetch Me",
                "slug": "fetch-me",
                "card_type": "Application",
            },
            headers=auth_headers(admin),
        )
        portal_id = create_resp.json()["id"]

        resp = await client.get(
            f"/api/v1/web-portals/{portal_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Fetch Me"

    async def test_get_nonexistent_portal(self, client, db, portals_env):
        admin = portals_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.get(
            f"/api/v1/web-portals/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


class TestUpdatePortal:
    async def test_update_portal_name(self, client, db, portals_env):
        admin = portals_env["admin"]
        create_resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Original",
                "slug": "original",
                "card_type": "Application",
            },
            headers=auth_headers(admin),
        )
        portal_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/web-portals/{portal_id}",
            json={"name": "Updated"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated"


class TestDeletePortal:
    async def test_delete_portal(self, client, db, portals_env):
        admin = portals_env["admin"]
        create_resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Delete Me",
                "slug": "delete-me",
                "card_type": "Application",
            },
            headers=auth_headers(admin),
        )
        portal_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/web-portals/{portal_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        # Verify it is gone
        resp = await client.get(
            f"/api/v1/web-portals/{portal_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


class TestPublicPortal:
    async def test_public_portal_no_auth(self, client, db, portals_env):
        """Published portals are accessible without auth."""
        admin = portals_env["admin"]
        await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Public Catalog",
                "slug": "public-catalog",
                "card_type": "Application",
                "is_published": True,
            },
            headers=auth_headers(admin),
        )

        resp = await client.get("/api/v1/web-portals/public/public-catalog")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Public Catalog"
        assert data["slug"] == "public-catalog"
        assert data["card_type"] == "Application"
        assert "type_info" in data

    async def test_public_portal_not_published(self, client, db, portals_env):
        """Unpublished portals return 404 on public endpoint."""
        admin = portals_env["admin"]
        await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Draft Portal",
                "slug": "draft-portal",
                "card_type": "Application",
                "is_published": False,
            },
            headers=auth_headers(admin),
        )

        resp = await client.get("/api/v1/web-portals/public/draft-portal")
        assert resp.status_code == 404

    async def test_public_portal_nonexistent_slug(self, client, db, portals_env):
        resp = await client.get("/api/v1/web-portals/public/no-such-slug")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Security & admin audit log — a portal is public exposure
# ---------------------------------------------------------------------------


async def _audit_rows(db, prefix: str = "admin.web_portal."):
    """Discard what a request flushed but never committed, then read the log."""
    from sqlalchemy import select

    from app.models.audit_log import AuditLogEntry

    await db.rollback()
    result = await db.execute(
        select(AuditLogEntry)
        .where(AuditLogEntry.action.like(f"{prefix}%"))
        .order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars().all())


class TestPortalAudit:
    async def test_create_update_delete_are_recorded(self, client, db, portals_env):
        admin = portals_env["admin"]
        admin_id, headers = admin.id, auth_headers(admin)
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "App Catalog",
                "slug": "app-catalog",
                "card_type": "Application",
                "is_published": True,
            },
            headers=headers,
        )
        pid = resp.json()["id"]
        await client.patch(
            f"/api/v1/web-portals/{pid}",
            json={"is_published": False, "filters": {"subtypes": ["x"]}},
            headers=headers,
        )
        await client.delete(f"/api/v1/web-portals/{pid}", headers=headers)

        created, updated, deleted = await _audit_rows(db)
        assert created.action == "admin.web_portal.created"
        assert created.actor_user_id == admin_id and created.category == "admin"
        assert (created.target_type, created.target_id, created.target_label) == (
            "web_portal",
            pid,
            "App Catalog",
        )
        assert created.details == {
            "context": {
                "slug": "app-catalog",
                "card_type": "Application",
                "is_published": True,
                "view": "cards",
                "access_mode": "public",
                "allowed_email_domains": None,
            }
        }

        assert updated.action == "admin.web_portal.updated"
        # An unknown subtype key reads as itself; nothing else rides along.
        assert updated.details == {
            "changes": {"is_published": {"old": True, "new": False}},
            "items": [
                {"kind": "portal_filter.changed", "filter": "subtypes", "old": [], "new": ["x"]}
            ],
            # Whether the change hit a live portal, even when it left these alone.
            "context": {"slug": "app-catalog", "is_published": False},
        }

        assert deleted.action == "admin.web_portal.deleted"
        assert deleted.details == {
            "context": {"slug": "app-catalog", "is_published": False, "access_mode": "public"}
        }

    async def test_card_type_is_recorded_by_label(self, client, db, portals_env):
        await create_card_type(db, key="ITComponent", label="IT Component")
        headers = auth_headers(portals_env["admin"])
        resp = await client.post(
            "/api/v1/web-portals",
            json={"name": "Catalog", "slug": "catalog", "card_type": "ITComponent"},
            headers=headers,
        )
        pid = resp.json()["id"]
        resp = await client.patch(
            f"/api/v1/web-portals/{pid}", json={"card_type": "Application"}, headers=headers
        )
        assert resp.status_code == 200

        created, updated = await _audit_rows(db)
        assert created.details["context"]["card_type"] == "IT Component"
        assert updated.details == {
            "changes": {"card_type": {"old": "IT Component", "new": "Application"}},
            "context": {"slug": "catalog", "is_published": False},
        }

    async def test_description_is_recorded_as_clipped_text(self, client, db, portals_env):
        headers = auth_headers(portals_env["admin"])
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Catalog",
                "slug": "catalog",
                "card_type": "Application",
                "description": "Teh catalog",
            },
            headers=headers,
        )
        pid = resp.json()["id"]
        long_text = "a" * 600
        await client.patch(
            f"/api/v1/web-portals/{pid}", json={"description": "The catalog"}, headers=headers
        )
        await client.patch(
            f"/api/v1/web-portals/{pid}", json={"description": long_text}, headers=headers
        )
        # Exactly at the limit: kept whole.
        await client.patch(
            f"/api/v1/web-portals/{pid}", json={"description": "b" * 500}, headers=headers
        )

        first, second, third = [
            r for r in await _audit_rows(db) if r.action == "admin.web_portal.updated"
        ]
        assert first.details == {
            "changes": {"description": {"old": "Teh catalog", "new": "The catalog"}},
            "context": {"slug": "catalog", "is_published": False},
        }
        clipped = second.details["changes"]["description"]["new"]
        assert clipped == "a" * 499 + "…"
        assert len(clipped) == 500
        assert second.details["changes"]["description"]["old"] == "The catalog"
        assert third.details == {
            "changes": {"description": {"old": "a" * 499 + "…", "new": "b" * 500}},
            "context": {"slug": "catalog", "is_published": False},
        }

    async def test_subtype_and_tag_filters_are_recorded_by_label(self, client, db, portals_env):
        from sqlalchemy import select

        from app.models.card_type import CardType
        from app.models.tag import Tag, TagGroup

        app_type = (
            await db.execute(select(CardType).where(CardType.key == "Application"))
        ).scalar_one()
        app_type.subtypes = [
            {"key": "business", "label": "Business Application"},
            {"key": "micro", "label": "Microservice"},
        ]
        await db.flush()
        group = TagGroup(name="Domain")
        db.add(group)
        await db.flush()
        finance = Tag(tag_group_id=group.id, name="Finance")
        sales = Tag(tag_group_id=group.id, name="Sales")
        db.add_all([finance, sales])
        await db.flush()
        headers = auth_headers(portals_env["admin"])
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Catalog",
                "slug": "catalog",
                "card_type": "Application",
                "filters": {"subtypes": ["business"], "tag_ids": [str(finance.id)]},
            },
            headers=headers,
        )
        pid = resp.json()["id"]
        resp = await client.patch(
            f"/api/v1/web-portals/{pid}",
            json={
                "filters": {
                    "subtypes": ["business", "micro"],
                    "tag_ids": [str(sales.id)],
                }
            },
            headers=headers,
        )
        assert resp.status_code == 200

        [updated] = [r for r in await _audit_rows(db) if r.action == "admin.web_portal.updated"]
        assert updated.details == {
            "items": [
                {
                    "kind": "portal_filter.changed",
                    "filter": "subtypes",
                    "old": ["Business Application"],
                    "new": ["Business Application", "Microservice"],
                },
                {
                    "kind": "portal_filter.changed",
                    "filter": "tags",
                    "old": ["Finance"],
                    "new": ["Sales"],
                },
            ],
            "context": {"slug": "catalog", "is_published": False},
        }

    async def test_card_filters_are_recorded_by_label(self, client, db, portals_env):
        from sqlalchemy import select

        from app.models.card_type import CardType
        from tests.conftest import create_card, create_relation_type

        app_type = (
            await db.execute(select(CardType).where(CardType.key == "Application"))
        ).scalar_one()
        app_type.fields_schema = [
            {
                "section": "Main",
                "fields": [
                    {
                        "key": "crit",
                        "label": "Criticality",
                        "type": "single_select",
                        "options": [{"key": "high", "label": "High"}, "junk"],
                    }
                ],
            },
            "junk",
        ]
        await create_card_type(db, key="Organization", label="Organisation")
        await create_relation_type(
            db,
            key="orgUsesApp",
            label="uses",
            reverse_label="is used by",
            source_type_key="Organization",
            target_type_key="Application",
            attributes_schema=[
                {
                    "key": "usage",
                    "label": "Usage",
                    "type": "single_select",
                    "options": [{"key": "daily", "label": "Daily"}],
                }
            ],
        )
        await create_relation_type(
            db,
            key="appCallsApp",
            label="calls",
            reverse_label="is called by",
            source_type_key="Application",
            target_type_key="Application",
        )
        corp = await create_card(db, card_type="Organization", name="Corp")
        headers = auth_headers(portals_env["admin"])
        resp = await client.post(
            "/api/v1/web-portals",
            json={"name": "Catalog", "slug": "catalog", "card_type": "Application"},
            headers=headers,
        )
        pid = resp.json()["id"]
        resp = await client.patch(
            f"/api/v1/web-portals/{pid}",
            json={
                "filters": {
                    "card_filters": {
                        "relationFilters": {
                            "Organization": [str(corp.id)],
                            "orgUsesApp": ["__empty__"],
                            "appCallsApp__in": [str(corp.id)],
                        },
                        "attrFilters": {"crit": ["high"]},
                        "relSubtypeFilters": {
                            "orgUsesApp::usage": ["daily"],
                            "gone::field": ["x"],
                        },
                    }
                }
            },
            headers=headers,
        )
        assert resp.status_code == 200

        [updated] = [r for r in await _audit_rows(db) if r.action == "admin.web_portal.updated"]
        assert updated.details["items"] == [
            {
                "kind": "portal_filter.changed",
                "filter": "related_cards",
                "old": [],
                "new": ["Organisation: Corp", "is called by: Corp", "is used by: —"],
            },
            {
                "kind": "portal_filter.changed",
                "filter": "card_fields",
                "old": [],
                "new": ["Criticality: High"],
            },
            {
                "kind": "portal_filter.changed",
                "filter": "relation_subtypes",
                "old": [],
                "new": ["gone · field: x", "is used by · Usage: Daily"],
            },
        ]

    async def test_moving_tags_across_groups_records_the_matching_change(
        self, client, db, portals_env
    ):
        from app.models.tag import Tag, TagGroup

        domain, tier = TagGroup(name="Domain"), TagGroup(name="Tier")
        db.add_all([domain, tier])
        await db.flush()
        finance = Tag(tag_group_id=domain.id, name="Finance")
        gold = Tag(tag_group_id=tier.id, name="Gold")
        db.add_all([finance, gold])
        await db.flush()
        headers = auth_headers(portals_env["admin"])
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Catalog",
                "slug": "catalog",
                "card_type": "Application",
                "filters": {"tag_ids": [str(finance.id), str(gold.id)]},
            },
            headers=headers,
        )
        pid = resp.json()["id"]
        resp = await client.patch(
            f"/api/v1/web-portals/{pid}",
            json={"filters": {"card_filters": {"tagFilterIds": [str(gold.id), str(finance.id)]}}},
            headers=headers,
        )
        assert resp.status_code == 200
        [updated] = [r for r in await _audit_rows(db) if r.action == "admin.web_portal.updated"]
        assert updated.details["items"] == [
            {
                "kind": "portal_filter.changed",
                "filter": "tag_matching",
                "old": "any_tag",
                "new": "tag_per_group",
            }
        ]

    async def test_card_filter_labels_read_each_side_and_fall_back(self, client, db, portals_env):
        from sqlalchemy import select

        from app.models.card_type import CardType
        from tests.conftest import create_relation_type

        app_type = (
            await db.execute(select(CardType).where(CardType.key == "Application"))
        ).scalar_one()
        app_type.fields_schema = [
            "junk",
            {
                "section": "Main",
                "fields": [
                    "junk",
                    {
                        "key": "crit",
                        "label": "Criticality",
                        "type": "single_select",
                        "options": [{"key": "high", "label": "High"}, {"key": "low"}],
                    },
                ],
            },
        ]
        await create_card_type(db, key="Organization", label="Organisation")
        await create_card_type(db, key="ITComponent", label="IT Component")
        # The portal type is the target and the type has no reverse verb.
        await create_relation_type(
            db,
            key="orgUsesApp",
            label="uses",
            reverse_label="",
            source_type_key="Organization",
            target_type_key="Application",
        )
        # The portal type is the source; the field sits after another one.
        await create_relation_type(
            db,
            key="appRunsOn",
            label="runs on",
            reverse_label="hosts",
            source_type_key="Application",
            target_type_key="ITComponent",
            attributes_schema=[
                {"key": "other", "label": "Other"},
                {
                    "key": "env",
                    "label": "Environment",
                    "options": [{"key": "prod", "label": "Prod"}],
                },
            ],
        )
        headers = auth_headers(portals_env["admin"])
        resp = await client.post(
            "/api/v1/web-portals",
            json={"name": "Catalog", "slug": "catalog", "card_type": "Application"},
            headers=headers,
        )
        pid = resp.json()["id"]
        resp = await client.patch(
            f"/api/v1/web-portals/{pid}",
            json={
                "filters": {
                    "card_filters": {
                        "relationFilters": {"orgUsesApp": ["__empty__"]},
                        "attrFilters": {"crit": ["low"], "nolabel": ["v"]},
                        "relSubtypeFilters": {"appRunsOn::env": ["prod"]},
                    }
                }
            },
            headers=headers,
        )
        assert resp.status_code == 200
        [updated] = [r for r in await _audit_rows(db) if r.action == "admin.web_portal.updated"]
        assert updated.details["items"] == [
            {
                "kind": "portal_filter.changed",
                "filter": "related_cards",
                "old": [],
                "new": ["uses: —"],
            },
            {
                "kind": "portal_filter.changed",
                "filter": "card_fields",
                "old": [],
                "new": ["Criticality: low", "nolabel: v"],
            },
            {
                "kind": "portal_filter.changed",
                "filter": "relation_subtypes",
                "old": [],
                "new": ["runs on · Environment: Prod"],
            },
        ]

    async def test_tags_are_read_from_the_shape_that_stores_them(self, client, db, portals_env):
        from app.models.tag import Tag, TagGroup

        domain = TagGroup(name="Domain")
        db.add(domain)
        await db.flush()
        finance = Tag(tag_group_id=domain.id, name="Finance")
        sales = Tag(tag_group_id=domain.id, name="Sales")
        db.add_all([finance, sales])
        await db.flush()
        # Read before any rollback below expires the rows.
        fid, sid = str(finance.id), str(sales.id)
        headers = auth_headers(portals_env["admin"])
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Catalog",
                "slug": "catalog",
                "card_type": "Application",
                "filters": {"tag_ids": [fid, sid]},
            },
            headers=headers,
        )
        pid = resp.json()["id"]
        # One group: any tag and one per group mean the same, so nothing to log.
        await client.patch(
            f"/api/v1/web-portals/{pid}",
            json={"filters": {"card_filters": {"tagFilterIds": [sid, fid]}}},
            headers=headers,
        )
        rows = await _audit_rows(db)
        assert [r.details for r in rows if r.action == "admin.web_portal.updated"] == []
        await client.patch(
            f"/api/v1/web-portals/{pid}",
            json={"filters": {"card_filters": {"tagFilterIds": [sid]}}},
            headers=headers,
        )
        [updated] = [r for r in await _audit_rows(db) if r.action == "admin.web_portal.updated"]
        assert updated.details["items"] == [
            {
                "kind": "portal_filter.changed",
                "filter": "tags",
                "old": ["Sales", "Finance"],
                "new": ["Sales"],
            }
        ]

    async def test_toggles_and_display_fields_are_recorded_by_label(self, client, db, portals_env):
        from sqlalchemy import select

        from app.models.card_type import CardType

        app_type = (
            await db.execute(select(CardType).where(CardType.key == "Application"))
        ).scalar_one()
        app_type.fields_schema = [
            {
                "section": "Finance",
                "fields": [
                    {"key": "costTotal", "label": "Total cost", "type": "cost"},
                    {"key": "owner", "label": "Owner", "type": "text"},
                ],
            }
        ]
        await db.flush()
        await create_relation_type(
            db,
            key="relAppToITC",
            label="uses",
            source_type_key="Application",
            target_type_key="Application",
        )
        headers = auth_headers(portals_env["admin"])
        resp = await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Catalog",
                "slug": "catalog",
                "card_type": "Application",
                "display_fields": ["costTotal"],
                "card_config": {"toggles": {"costTotal": {"card": True, "detail": True}}},
            },
            headers=headers,
        )
        pid = resp.json()["id"]
        resp = await client.patch(
            f"/api/v1/web-portals/{pid}",
            json={
                "display_fields": ["owner", "costTotal"],
                "card_config": {
                    "toggles": {
                        "costTotal": {"card": False, "detail": True},
                        "lifecycle": {"card": True},
                        "rel:relAppToITC": {"detail": True},
                    },
                    "show_logo": False,
                },
            },
            headers=headers,
        )
        assert resp.status_code == 200

        [updated] = [r for r in await _audit_rows(db) if r.action == "admin.web_portal.updated"]
        assert updated.details == {
            "changes": {"display_fields": {"old": ["Total cost"], "new": ["Owner", "Total cost"]}},
            "items": [
                {
                    "kind": "portal_toggle.changed",
                    "item": "Total cost",
                    "surface": "card",
                    "old": True,
                    "new": False,
                },
                {
                    "kind": "portal_toggle.changed",
                    "item": "lifecycle",
                    "surface": "card",
                    "old": None,
                    "new": True,
                },
                {
                    "kind": "portal_toggle.changed",
                    "item": "uses",
                    "surface": "detail",
                    "old": None,
                    "new": True,
                },
                {
                    "kind": "portal_option.changed",
                    "option": "show_logo",
                    "old": True,
                    "new": False,
                },
            ],
            "context": {"slug": "catalog", "is_published": False},
        }

    async def test_unchanged_blob_is_not_reported(self, client, db, portals_env):
        headers = auth_headers(portals_env["admin"])
        resp = await client.post(
            "/api/v1/web-portals",
            json={"name": "Catalog", "slug": "catalog", "card_type": "Application"},
            headers=headers,
        )
        pid = resp.json()["id"]
        resp = await client.patch(
            f"/api/v1/web-portals/{pid}",
            json={"name": "Catalogue", "filters": resp.json()["filters"]},
            headers=headers,
        )
        assert resp.status_code == 200

        [updated] = [r for r in await _audit_rows(db) if r.action == "admin.web_portal.updated"]
        assert updated.details == {
            "changes": {"name": {"old": "Catalog", "new": "Catalogue"}},
            "context": {"slug": "catalog", "is_published": False},
        }

    async def test_no_op_update_records_nothing(self, client, db, portals_env):
        headers = auth_headers(portals_env["admin"])
        resp = await client.post(
            "/api/v1/web-portals",
            json={"name": "Catalog", "slug": "catalog", "card_type": "Application"},
            headers=headers,
        )
        portal = resp.json()
        resp = await client.patch(
            f"/api/v1/web-portals/{portal['id']}",
            json={"name": "Catalog", "filters": portal["filters"]},
            headers=headers,
        )
        assert resp.status_code == 200

        assert [r.action for r in await _audit_rows(db)] == ["admin.web_portal.created"]

    async def test_viewer_is_refused_and_nothing_is_recorded(self, client, db, portals_env):
        resp = await client.post(
            "/api/v1/web-portals",
            json={"name": "X", "slug": "x", "card_type": "Application"},
            headers=auth_headers(portals_env["viewer"]),
        )
        assert resp.status_code == 403
        assert await _audit_rows(db) == []
