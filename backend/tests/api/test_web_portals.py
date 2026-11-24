"""Integration tests for the /web-portals endpoints."""

from __future__ import annotations

import uuid

import pytest

from app.api.v1.web_portals import (
    _PortalAuditLabels,
    _shown_visitor_filters,
    _toggle_relation_keys,
)
from app.services import portal_visibility
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


class TestVisitorFilterConfig:
    """``card_config.visitor_filters`` / ``visitor_can_add_filters`` (#1425)."""

    @staticmethod
    async def _create(client, admin, card_config, **extra):
        return await client.post(
            "/api/v1/web-portals",
            json={
                "name": "Catalog",
                "slug": "catalog",
                "card_type": "Application",
                "card_config": card_config,
                **extra,
            },
            headers=auth_headers(admin),
        )

    async def test_create_stores_them_normalised(self, client, db, portals_env):
        resp = await self._create(
            client,
            portals_env["admin"],
            {
                "visitor_filters": ["tags", "field:code", "bogus", 7, "tags", "rel:owns"],
                "visitor_can_add_filters": False,
                "show_logo": True,
            },
        )
        assert resp.status_code == 201
        assert resp.json()["card_config"] == {
            "visitor_filters": ["tags", "field:code", "rel:owns"],
            "visitor_can_add_filters": False,
            "show_logo": True,
        }

    async def test_adding_on_is_not_stored(self, client, db, portals_env):
        resp = await self._create(
            client, portals_env["admin"], {"visitor_can_add_filters": True, "show_logo": False}
        )
        assert resp.json()["card_config"] == {"show_logo": False}

    async def test_a_non_list_is_refused(self, client, db, portals_env):
        resp = await self._create(client, portals_env["admin"], {"visitor_filters": "tags"})
        assert resp.status_code == 422
        assert resp.json()["detail"] == "card_config.visitor_filters must be a list of filter keys"
        assert await _audit_rows(db) == []

    async def test_a_non_boolean_switch_is_refused(self, client, db, portals_env):
        resp = await self._create(client, portals_env["admin"], {"visitor_can_add_filters": "no"})
        assert resp.status_code == 422
        assert resp.json()["detail"] == (
            "card_config.visitor_can_add_filters must be true or false"
        )

    async def test_update_normalises_and_refuses(self, client, db, portals_env):
        headers = auth_headers(portals_env["admin"])
        pid = (await self._create(client, portals_env["admin"], None)).json()["id"]
        resp = await client.patch(
            f"/api/v1/web-portals/{pid}",
            json={"card_config": {"visitor_filters": ["subtype", "subtype", "x"]}},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["card_config"] == {"visitor_filters": ["subtype"]}
        resp = await client.patch(
            f"/api/v1/web-portals/{pid}",
            json={"card_config": {"visitor_filters": {"subtype": True}}},
            headers=headers,
        )
        assert resp.status_code == 422
        stored = await client.get(f"/api/v1/web-portals/{pid}", headers=headers)
        assert stored.json()["card_config"] == {"visitor_filters": ["subtype"]}

    async def test_a_board_portal_drops_them(self, client, db, portals_env):
        await create_card_type(db, key="BusinessProcess", label="Business Process")
        resp = await self._create(
            client,
            portals_env["admin"],
            {"visitor_filters": ["tags"], "visitor_can_add_filters": False, "show_logo": False},
            view="process_navigator",
        )
        assert resp.status_code == 201
        assert resp.json()["card_config"] == {"show_logo": False}

    async def test_switching_to_a_board_drops_them(self, client, db, portals_env):
        await create_card_type(db, key="BusinessProcess", label="Business Process")
        headers = auth_headers(portals_env["admin"])
        created = await self._create(
            client, portals_env["admin"], {"visitor_filters": ["tags"], "show_logo": False}
        )
        resp = await client.patch(
            f"/api/v1/web-portals/{created.json()['id']}",
            json={"view": "process_navigator"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["card_config"] == {"show_logo": False}

    async def test_switching_to_a_board_logs_each_shown_filter_leaving(
        self, client, db, portals_env
    ):
        """The board has no filter bar: every filter the card list showed is
        logged as gone, resolved on the card-list side and nothing on the
        board side."""
        await create_card_type(db, key="BusinessProcess", label="Business Process")
        created = await self._create(
            client, portals_env["admin"], {"visitor_filters": ["tags"], "show_logo": False}
        )
        resp = await client.patch(
            f"/api/v1/web-portals/{created.json()['id']}",
            json={"view": "process_navigator"},
            headers=auth_headers(portals_env["admin"]),
        )
        assert resp.status_code == 200

        [updated] = [r for r in await _audit_rows(db) if r.action == "admin.web_portal.updated"]
        assert [i for i in updated.details["items"] if i.get("surface") == "filter"] == [
            {
                "kind": "portal_toggle.changed",
                "item": "tags",
                "surface": "filter",
                "old": True,
                "new": False,
            }
        ]

    async def test_without_web_portals_manage_403(self, client, db, portals_env):
        resp = await self._create(client, portals_env["viewer"], {"visitor_filters": ["tags"]})
        assert resp.status_code == 403

    async def test_changes_are_recorded_by_label(self, client, db, portals_env):
        from sqlalchemy import select

        from app.models.card_type import CardType

        app_type = (
            await db.execute(select(CardType).where(CardType.key == "Application"))
        ).scalar_one()
        app_type.fields_schema = [
            {"section": "Main", "fields": [{"key": "code", "label": "Code", "type": "text"}]}
        ]
        # A subtype filter needs subtypes; a relation filter needs the relation shown.
        app_type.subtypes = [{"key": "saas", "label": "SaaS"}]
        await db.flush()
        await create_relation_type(
            db,
            key="appRunsOnApp",
            label="runs on",
            source_type_key="Application",
            target_type_key="Application",
        )
        toggles = {"rel:appRunsOnApp": {"card": False, "detail": True}}
        headers = auth_headers(portals_env["admin"])
        created = await self._create(
            client,
            portals_env["admin"],
            {"visitor_filters": ["tags", "subtype"], "toggles": toggles},
        )
        resp = await client.patch(
            f"/api/v1/web-portals/{created.json()['id']}",
            json={
                "card_config": {
                    "visitor_filters": ["tags", "field:code", "rel:appRunsOnApp"],
                    "visitor_can_add_filters": False,
                    "toggles": toggles,
                }
            },
            headers=headers,
        )
        assert resp.status_code == 200

        [updated] = [r for r in await _audit_rows(db) if r.action == "admin.web_portal.updated"]
        assert updated.details["items"] == [
            {
                "kind": "portal_toggle.changed",
                "item": "subtype",
                "surface": "filter",
                "old": True,
                "new": False,
            },
            {
                "kind": "portal_toggle.changed",
                "item": "Code",
                "surface": "filter",
                "old": False,
                "new": True,
            },
            {
                "kind": "portal_toggle.changed",
                "item": "runs on",
                "surface": "filter",
                "old": False,
                "new": True,
            },
            {
                "kind": "portal_option.changed",
                "option": "visitor_can_add_filters",
                "old": True,
                "new": False,
            },
        ]

    async def test_the_default_is_resolved_on_both_sides(self, client, db, portals_env):
        """Regression: a side following the default was logged as ``None`` and
        only the stored keys were walked, so unticking one filter from the
        default logged the others as added and nothing about the one removed."""
        from sqlalchemy import select

        from app.models.card_type import CardType

        app_type = (
            await db.execute(select(CardType).where(CardType.key == "Application"))
        ).scalar_one()
        tier = {"key": "tier", "label": "Tier", "type": "single_select"}
        tier["options"] = [{"key": "gold", "label": "Gold"}]
        app_type.fields_schema = [{"section": "Main", "fields": [tier]}]
        await db.flush()
        headers = auth_headers(portals_env["admin"])
        # The default bar: the tags and the Tier select.
        pid = (await self._create(client, portals_env["admin"], None)).json()["id"]

        async def filter_items(card_config) -> list:
            # Every row is stamped with the one test transaction's now(), so
            # the new row is told apart by id, never by its timestamp.
            seen = {r.id for r in await _audit_rows(db)}
            resp = await client.patch(
                f"/api/v1/web-portals/{pid}", json={"card_config": card_config}, headers=headers
            )
            assert resp.status_code == 200
            rows = [r for r in await _audit_rows(db) if r.id not in seen]
            return [
                i
                for r in rows
                for i in (r.details or {}).get("items") or []
                if i.get("surface") == "filter"
            ]

        untick = {"kind": "portal_toggle.changed", "item": "Tier", "surface": "filter"}
        assert await filter_items({"visitor_filters": ["tags"]}) == [
            {**untick, "old": True, "new": False}
        ]
        # Back to the default: Tier returns, and nothing else is reported.
        assert await filter_items({}) == [{**untick, "old": False, "new": True}]
        # The default written out as a list: the bar is the same, so nothing.
        assert await filter_items({"visitor_filters": ["tags", "field:tier"]}) == []


class TestPortalAuditHelpers:
    """The audit helpers of ``web_portals.py``, called directly."""

    def test_the_subtype_filter_keeps_its_code_over_a_field_of_that_key(self):
        # A field keyed ``subtype`` must not lend its label to the subtype filter.
        labels = _PortalAuditLabels(fields={"subtype": "Variant", "code": "Code"})
        out = labels.item_labels()
        assert out["subtype"] == "subtype"
        assert out["field:subtype"] == "Variant"
        assert out["code"] == "Code"

    def test_relation_keys_come_from_the_toggles_and_the_visitor_filters(self):
        keys = _toggle_relation_keys(
            {
                "toggles": {"rel:shown": {"card": True}, "field:x": {"card": True}},
                "visitor_filters": ["rel:listed", "field:code", 3, "tags"],
            },
            {"visitor_filters": ["rel:other"]},
            {"visitor_filters": "rel:not-a-list"},
            None,
            "junk",
        )
        assert keys == {"shown", "listed", "other"}


class TestShownVisitorFilters:
    """``_shown_visitor_filters``: the bar a snapshot's visitors see."""

    CONFIG = {"visitor_filters": ["tags"]}

    async def test_a_card_list_resolves_its_bar(self, db, portals_env):
        snapshot = {"view": "cards", "card_type": "Application", "card_config": self.CONFIG}
        assert await _shown_visitor_filters(db, snapshot) == ("tags",)

    async def test_no_view_reads_as_a_card_list(self, db, portals_env):
        snapshot = {"card_type": "Application", "card_config": self.CONFIG}
        assert await _shown_visitor_filters(db, snapshot) == ("tags",)
        snapshot["view"] = None
        assert await _shown_visitor_filters(db, snapshot) == ("tags",)

    async def test_a_board_has_no_bar(self, db, portals_env):
        snapshot = {
            "view": "process_navigator",
            "card_type": "Application",
            "card_config": self.CONFIG,
        }
        assert await _shown_visitor_filters(db, snapshot) == ()

    @pytest.mark.parametrize("card_type", [None, ""])
    async def test_no_card_type_has_no_bar(self, db, portals_env, card_type):
        snapshot = {"view": "cards", "card_type": card_type, "card_config": self.CONFIG}
        assert await _shown_visitor_filters(db, snapshot) == ()
        assert await _shown_visitor_filters(db, {"card_config": self.CONFIG}) == ()


class TestLoadPortalVisibility:
    """``portal_visibility.load_portal_visibility`` against the database."""

    async def test_field_types_of_the_public_schema(self, db):
        await create_card_type(
            db,
            key="Widget",
            label="Widget",
            fields_schema=[
                {
                    "section": "Main",
                    "fields": [
                        {"key": "code", "type": "text"},
                        {"key": "untyped"},
                        {"key": "spend", "type": "cost"},
                    ],
                }
            ],
        )
        vis = await portal_visibility.load_portal_visibility(db, "Widget", None)
        # No type reads as "", never "None"; a cost field is not published.
        assert vis.field_types == {"code": "text", "untyped": ""}

    async def test_an_unknown_card_type_shows_nothing_and_does_not_fail(self, db):
        vis = await portal_visibility.load_portal_visibility(db, "NoSuchType", {"toggles": {}})
        assert vis.field_types == {}
        assert vis.exposed_fields == frozenset()
        assert vis.relation_types == frozenset()
        assert "subtype" not in vis.visitor_filters.allowed
