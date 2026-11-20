"""Integration tests for the /tag-groups and /cards/{id}/tags endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
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
async def tags_env(db):
    """Prerequisite data for tag tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions=VIEWER_PERMISSIONS,
    )
    await create_card_type(db, key="Application", label="Application")
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    card = await create_card(
        db,
        card_type="Application",
        name="Tagged App",
        user_id=admin.id,
    )
    return {"admin": admin, "viewer": viewer, "card": card}


# ---------------------------------------------------------------
# POST /tag-groups  (create group)
# ---------------------------------------------------------------


class TestCreateTagGroup:
    async def test_admin_can_create_group(self, client, db, tags_env):
        admin = tags_env["admin"]
        resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Environment", "mode": "single"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Environment"

    async def test_viewer_cannot_create_group(self, client, db, tags_env):
        viewer = tags_env["viewer"]
        resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Blocked"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------
# GET /tag-groups  (list)
# ---------------------------------------------------------------


class TestListTagGroups:
    async def test_list_tag_groups_requires_auth(self, client, db, tags_env):
        """Tag groups now require authentication (was previously public)."""
        resp = await client.get("/api/v1/tag-groups")
        assert resp.status_code == 401

    async def test_authenticated_user_can_list_tag_groups(self, client, db, tags_env):
        viewer = tags_env["viewer"]
        resp = await client.get("/api/v1/tag-groups", headers=auth_headers(viewer))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


# ---------------------------------------------------------------
# POST /tag-groups/{id}/tags  (create tag)
# ---------------------------------------------------------------


class TestCreateTag:
    async def test_admin_can_create_tag(self, client, db, tags_env):
        admin = tags_env["admin"]
        # Create group first
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Lifecycle"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]

        resp = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "Active", "color": "#00ff00"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Active"
        assert data["color"] == "#00ff00"

    async def test_create_and_update_tag_with_description(self, client, db, tags_env):
        admin = tags_env["admin"]
        group_id = (
            await client.post(
                "/api/v1/tag-groups", json={"name": "Domain"}, headers=auth_headers(admin)
            )
        ).json()["id"]

        # Create with a description.
        created = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "Finance", "description": "Finance-domain systems"},
            headers=auth_headers(admin),
        )
        assert created.status_code == 201
        tag = created.json()
        assert tag["description"] == "Finance-domain systems"

        # It round-trips through the group listing.
        listed = await client.get("/api/v1/tag-groups", headers=auth_headers(admin))
        group = next(g for g in listed.json() if g["id"] == group_id)
        assert group["tags"][0]["description"] == "Finance-domain systems"

        # Update the description.
        patched = await client.patch(
            f"/api/v1/tag-groups/{group_id}/tags/{tag['id']}",
            json={"description": "Updated"},
            headers=auth_headers(admin),
        )
        assert patched.status_code == 200
        assert patched.json()["description"] == "Updated"

    async def test_tag_order_is_stable_after_update(self, client, db, tags_env):
        """Editing a tag (e.g. adding a description) must not reshuffle the list:
        tags are returned in a deterministic (sort_order, name) order."""
        admin = tags_env["admin"]
        group_id = (
            await client.post(
                "/api/v1/tag-groups", json={"name": "Domain"}, headers=auth_headers(admin)
            )
        ).json()["id"]

        # Create out of alphabetical order.
        ids = {}
        for name in ("Charlie", "Alpha", "Bravo"):
            r = await client.post(
                f"/api/v1/tag-groups/{group_id}/tags",
                json={"name": name},
                headers=auth_headers(admin),
            )
            ids[name] = r.json()["id"]

        async def names():
            listed = await client.get("/api/v1/tag-groups", headers=auth_headers(admin))
            group = next(g for g in listed.json() if g["id"] == group_id)
            return [t["name"] for t in group["tags"]]

        assert await names() == ["Alpha", "Bravo", "Charlie"]

        # Adding a description to the middle tag must not change the order.
        await client.patch(
            f"/api/v1/tag-groups/{group_id}/tags/{ids['Bravo']}",
            json={"description": "A description"},
            headers=auth_headers(admin),
        )
        assert await names() == ["Alpha", "Bravo", "Charlie"]


# ---------------------------------------------------------------
# POST /cards/{id}/tags  (assign tags)
# ---------------------------------------------------------------


class TestAssignTagsPermissionGate:
    async def test_editor_without_tags_manage_can_assign_and_remove(self, client, db, tags_env):
        """A user with card.edit (via inventory.edit) but NOT tags.manage
        must be able to tag their own card and remove tags from it."""
        # Build a custom role: member perms minus tags.manage
        editor_perms = {**MEMBER_PERMISSIONS, "tags.manage": False}
        await create_role(db, key="card_editor", label="Card Editor", permissions=editor_perms)
        editor = await create_user(db, email="editor@test.com", role="card_editor")

        admin = tags_env["admin"]
        card = tags_env["card"]

        # Admin creates a tag group + tag
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Env"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]
        tag_resp = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "Prod"},
            headers=auth_headers(admin),
        )
        tag_id = tag_resp.json()["id"]

        # Editor (no tags.manage) assigns the tag — must succeed
        assign = await client.post(
            f"/api/v1/cards/{card.id}/tags",
            json=[tag_id],
            headers=auth_headers(editor),
        )
        assert assign.status_code == 201, assign.text

        # Editor removes the tag — must also succeed
        remove = await client.delete(
            f"/api/v1/cards/{card.id}/tags/{tag_id}",
            headers=auth_headers(editor),
        )
        assert remove.status_code == 204, remove.text


class TestAssignTags:
    async def test_admin_can_assign_tags(self, client, db, tags_env):
        admin = tags_env["admin"]
        card = tags_env["card"]

        # Create group + tag
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Status"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]
        tag_resp = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "Production"},
            headers=auth_headers(admin),
        )
        tag_id = tag_resp.json()["id"]

        resp = await client.post(
            f"/api/v1/cards/{card.id}/tags",
            json=[tag_id],
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["status"] == "ok"

    async def test_viewer_cannot_assign_tags(self, client, db, tags_env):
        viewer = tags_env["viewer"]
        card = tags_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/tags",
            json=["some-fake-id"],
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------
# DELETE /cards/{card_id}/tags/{tag_id}  (remove tag)
# ---------------------------------------------------------------


class TestRemoveTag:
    async def test_admin_can_remove_tag(self, client, db, tags_env):
        admin = tags_env["admin"]
        card = tags_env["card"]

        # Create group + tag + assign
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Region"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]
        tag_resp = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "EU"},
            headers=auth_headers(admin),
        )
        tag_id = tag_resp.json()["id"]
        await client.post(
            f"/api/v1/cards/{card.id}/tags",
            json=[tag_id],
            headers=auth_headers(admin),
        )

        resp = await client.delete(
            f"/api/v1/cards/{card.id}/tags/{tag_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204


# ---------------------------------------------------------------
# PATCH /tag-groups/{id}  (update group)
# ---------------------------------------------------------------


class TestUpdateTagGroup:
    async def test_admin_can_update_group(self, client, db, tags_env):
        admin = tags_env["admin"]
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Env", "mode": "multi"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/tag-groups/{group_id}",
            json={"name": "Environment", "description": "Deployment env", "mandatory": True},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Environment"
        assert data["description"] == "Deployment env"
        assert data["mandatory"] is True
        assert data["mode"] == "multi"  # unchanged

    async def test_viewer_cannot_update_group(self, client, db, tags_env):
        admin = tags_env["admin"]
        viewer = tags_env["viewer"]
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Protected"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/tag-groups/{group_id}",
            json={"name": "Hacked"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_update_unknown_group_returns_404(self, client, db, tags_env):
        admin = tags_env["admin"]
        resp = await client.patch(
            "/api/v1/tag-groups/00000000-0000-0000-0000-000000000000",
            json={"name": "Ghost"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------
# DELETE /tag-groups/{id}  (delete group, cascades to tags + card_tags)
# ---------------------------------------------------------------


class TestDeleteTagGroup:
    async def test_admin_can_delete_group_cascades(self, client, db, tags_env):
        import uuid as uuid_mod

        from sqlalchemy import select

        from app.models.tag import CardTag, Tag, TagGroup

        admin = tags_env["admin"]
        card = tags_env["card"]

        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Doomed"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]
        tag_resp = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "Temp"},
            headers=auth_headers(admin),
        )
        tag_id = tag_resp.json()["id"]
        await client.post(
            f"/api/v1/cards/{card.id}/tags",
            json=[tag_id],
            headers=auth_headers(admin),
        )

        resp = await client.delete(
            f"/api/v1/tag-groups/{group_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        # Cascade: group gone, tag gone, card_tags row gone
        assert await db.get(TagGroup, uuid_mod.UUID(group_id)) is None
        assert await db.get(Tag, uuid_mod.UUID(tag_id)) is None
        leftover = await db.execute(select(CardTag).where(CardTag.tag_id == uuid_mod.UUID(tag_id)))
        assert leftover.scalar_one_or_none() is None

    async def test_viewer_cannot_delete_group(self, client, db, tags_env):
        admin = tags_env["admin"]
        viewer = tags_env["viewer"]
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Protected"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/tag-groups/{group_id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------
# PATCH /tag-groups/{group_id}/tags/{tag_id}  (update tag)
# ---------------------------------------------------------------


class TestUpdateTag:
    async def test_admin_can_update_tag(self, client, db, tags_env):
        admin = tags_env["admin"]
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Priority"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]
        tag_resp = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "High", "color": "#ff0000"},
            headers=auth_headers(admin),
        )
        tag_id = tag_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/tag-groups/{group_id}/tags/{tag_id}",
            json={"name": "Critical", "color": "#cc0000"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Critical"
        assert data["color"] == "#cc0000"

    async def test_viewer_cannot_update_tag(self, client, db, tags_env):
        admin = tags_env["admin"]
        viewer = tags_env["viewer"]
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Owner"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]
        tag_resp = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "Alice"},
            headers=auth_headers(admin),
        )
        tag_id = tag_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/tag-groups/{group_id}/tags/{tag_id}",
            json={"name": "Eve"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_update_tag_wrong_group_returns_404(self, client, db, tags_env):
        admin = tags_env["admin"]
        # Two groups, one tag
        g1 = await client.post(
            "/api/v1/tag-groups",
            json={"name": "G1"},
            headers=auth_headers(admin),
        )
        g2 = await client.post(
            "/api/v1/tag-groups",
            json={"name": "G2"},
            headers=auth_headers(admin),
        )
        tag_resp = await client.post(
            f"/api/v1/tag-groups/{g1.json()['id']}/tags",
            json={"name": "T1"},
            headers=auth_headers(admin),
        )
        tag_id = tag_resp.json()["id"]

        # Path references wrong group for this tag
        resp = await client.patch(
            f"/api/v1/tag-groups/{g2.json()['id']}/tags/{tag_id}",
            json={"name": "Moved"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------
# DELETE /tag-groups/{group_id}/tags/{tag_id}  (delete tag)
# ---------------------------------------------------------------


class TestDeleteTag:
    async def test_admin_can_delete_tag_cascades_card_tags(self, client, db, tags_env):
        import uuid as uuid_mod

        from sqlalchemy import select

        from app.models.tag import CardTag, Tag

        admin = tags_env["admin"]
        card = tags_env["card"]

        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Stage"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]
        tag_resp = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "Staging"},
            headers=auth_headers(admin),
        )
        tag_id = tag_resp.json()["id"]
        await client.post(
            f"/api/v1/cards/{card.id}/tags",
            json=[tag_id],
            headers=auth_headers(admin),
        )

        resp = await client.delete(
            f"/api/v1/tag-groups/{group_id}/tags/{tag_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        assert await db.get(Tag, uuid_mod.UUID(tag_id)) is None
        leftover = await db.execute(select(CardTag).where(CardTag.tag_id == uuid_mod.UUID(tag_id)))
        assert leftover.scalar_one_or_none() is None

    async def test_viewer_cannot_delete_tag(self, client, db, tags_env):
        admin = tags_env["admin"]
        viewer = tags_env["viewer"]
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Protected"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]
        tag_resp = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "Locked"},
            headers=auth_headers(admin),
        )
        tag_id = tag_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/tag-groups/{group_id}/tags/{tag_id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_delete_unknown_tag_returns_404(self, client, db, tags_env):
        admin = tags_env["admin"]
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "G"},
            headers=auth_headers(admin),
        )
        group_id = group_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/tag-groups/{group_id}/tags/00000000-0000-0000-0000-000000000000",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------
# Security & admin audit log
# ---------------------------------------------------------------


async def _audit_rows(db, prefix: str):
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


class TestTagAudit:
    async def test_group_and_tag_lifecycle_is_recorded(self, client, db, tags_env):
        admin = tags_env["admin"]
        admin_id, headers = admin.id, auth_headers(admin)

        group = await client.post(
            "/api/v1/tag-groups", json={"name": "Region", "mode": "single"}, headers=headers
        )
        gid = group.json()["id"]
        await client.patch(
            f"/api/v1/tag-groups/{gid}",
            json={"name": "Regions", "mandatory": True},
            headers=headers,
        )
        tag = await client.post(
            f"/api/v1/tag-groups/{gid}/tags", json={"name": "EMEA"}, headers=headers
        )
        tid = tag.json()["id"]
        await client.patch(
            f"/api/v1/tag-groups/{gid}/tags/{tid}", json={"color": "#112233"}, headers=headers
        )
        await client.delete(f"/api/v1/tag-groups/{gid}/tags/{tid}", headers=headers)
        await client.delete(f"/api/v1/tag-groups/{gid}", headers=headers)

        groups = await _audit_rows(db, "admin.tag_group.")
        assert [r.action for r in groups] == [
            "admin.tag_group.created",
            "admin.tag_group.updated",
            "admin.tag_group.deleted",
        ]
        assert all(r.actor_user_id == admin_id and r.category == "admin" for r in groups)
        assert all(r.target_type == "tag_group" and r.target_id == gid for r in groups)
        assert groups[0].details == {
            "context": {"mode": "single", "mandatory": False, "restrict_to_types": None}
        }
        assert groups[1].details == {
            "changes": {
                "name": {"old": "Region", "new": "Regions"},
                "mandatory": {"old": False, "new": True},
            }
        }
        assert groups[2].details is None

        tags = await _audit_rows(db, "admin.tag.")
        assert [r.action for r in tags] == [
            "admin.tag.created",
            "admin.tag.updated",
            "admin.tag.deleted",
        ]
        assert tags[0].target_label == "EMEA"
        # The group is named, never referenced by id.
        assert tags[0].details == {"context": {"tag_group": "Regions", "color": None}}
        assert tags[1].details == {"changes": {"color": {"old": None, "new": "#112233"}}}
        assert tags[2].details == {"context": {"tag_group": "Regions", "color": "#112233"}}

    async def test_a_no_op_update_records_no_row(self, client, db, tags_env):
        headers = auth_headers(tags_env["admin"])
        group = await client.post(
            "/api/v1/tag-groups", json={"name": "Region", "mode": "single"}, headers=headers
        )
        gid = group.json()["id"]
        tag = await client.post(
            f"/api/v1/tag-groups/{gid}/tags", json={"name": "EMEA"}, headers=headers
        )
        tid = tag.json()["id"]

        # The same values re-sent: nothing changed, so nothing is recorded.
        same_group = await client.patch(
            f"/api/v1/tag-groups/{gid}", json={"name": "Region", "mode": "single"}, headers=headers
        )
        same_tag = await client.patch(
            f"/api/v1/tag-groups/{gid}/tags/{tid}", json={"name": "EMEA"}, headers=headers
        )
        assert same_group.status_code == 200 and same_tag.status_code == 200

        assert [r.action for r in await _audit_rows(db, "admin.tag_group.")] == [
            "admin.tag_group.created"
        ]
        assert [r.action for r in await _audit_rows(db, "admin.tag.")] == ["admin.tag.created"]

    async def test_restricted_types_are_recorded_by_label(self, client, db, tags_env):
        await create_card_type(db, key="ITComponent", label="IT Component")
        gone = await create_card_type(db, key="Gone", label="Gone Type")
        headers = auth_headers(tags_env["admin"])

        group = await client.post(
            "/api/v1/tag-groups",
            json={
                "name": "Tier",
                "mode": "multi",
                "mandatory": True,
                "restrict_to_types": ["ITComponent", "Gone", "Application"],
            },
            headers=headers,
        )
        gid = group.json()["id"]
        # The type is deleted after the group names it: its key has no label
        # any more and is kept as it is.
        await db.delete(gone)
        await db.flush()
        await client.patch(
            f"/api/v1/tag-groups/{gid}",
            json={"restrict_to_types": ["Application"]},
            headers=headers,
        )
        await client.patch(
            f"/api/v1/tag-groups/{gid}", json={"restrict_to_types": None}, headers=headers
        )

        created, narrowed, cleared = await _audit_rows(db, "admin.tag_group.")
        assert created.details == {
            "context": {
                "mode": "multi",
                "mandatory": True,
                "restrict_to_types": ["IT Component", "Gone Type", "Application"],
            }
        }
        assert narrowed.details == {
            "changes": {
                "restrict_to_types": {
                    "old": ["IT Component", "Gone", "Application"],
                    "new": ["Application"],
                }
            }
        }
        assert cleared.details == {
            "changes": {"restrict_to_types": {"old": ["Application"], "new": None}}
        }

    async def test_card_tag_links_are_content_not_admin_actions(self, client, db, tags_env):
        admin = tags_env["admin"]
        headers = auth_headers(admin)
        card_id = str(tags_env["card"].id)
        group = await client.post(
            "/api/v1/tag-groups", json={"name": "Env", "mode": "multi"}, headers=headers
        )
        tag = await client.post(
            f"/api/v1/tag-groups/{group.json()['id']}/tags", json={"name": "Prod"}, headers=headers
        )
        tid = tag.json()["id"]
        await db.rollback()
        before = len(await _audit_rows(db, "admin."))

        resp = await client.post(f"/api/v1/cards/{card_id}/tags", json=[tid], headers=headers)
        assert resp.status_code == 201, resp.text
        await client.delete(f"/api/v1/cards/{card_id}/tags/{tid}", headers=headers)

        assert len(await _audit_rows(db, "admin.")) == before

    async def test_viewer_is_refused_and_nothing_is_recorded(self, client, db, tags_env):
        resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Nope", "mode": "single"},
            headers=auth_headers(tags_env["viewer"]),
        )
        assert resp.status_code == 403
        assert await _audit_rows(db, "admin.") == []


# ---------------------------------------------------------------
# POST /cards/tags/bulk  (add / remove / replace on many cards)
# ---------------------------------------------------------------


async def _card_tag_set(db, card_id) -> set[str]:
    from sqlalchemy import select

    from app.models.tag import CardTag

    rows = await db.execute(select(CardTag.tag_id).where(CardTag.card_id == card_id))
    return {str(t) for t in rows.scalars().all()}


async def _tag_events(db) -> list[tuple[str, str]]:
    from sqlalchemy import select

    from app.models.event import Event

    rows = await db.execute(select(Event).where(Event.event_type.like("tag.%")))
    return sorted((e.event_type, e.data["tag_name"]) for e in rows.scalars().all())


@pytest.fixture
async def bulk_env(db, tags_env):
    from app.models.stakeholder import Stakeholder
    from tests.conftest import create_stakeholder_role_def, create_tag, create_tag_group

    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_card_type(db, key="Initiative", label="Initiative")
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="editor", permissions={"card.edit": True}
    )
    member = await create_user(db, email="member@test.com", role="member")
    other = await create_card(db, card_type="Application", name="Other App")
    initiative = await create_card(db, card_type="Initiative", name="Secret Program")
    archived = await create_card(db, card_type="Application", name="Old App", status="ARCHIVED")
    domains = await create_tag_group(db, name="Domains", mode="multi")
    tier = await create_tag_group(db, name="Tier", mode="single")
    apps_only = await create_tag_group(db, name="Hosting", restrict_to_types=["Application"])
    tags = {
        "finance": await create_tag(db, group=domains, name="Finance"),
        "hr": await create_tag(db, group=domains, name="HR"),
        "gold": await create_tag(db, group=tier, name="Gold"),
        "silver": await create_tag(db, group=tier, name="Silver"),
        "cloud": await create_tag(db, group=apps_only, name="Cloud"),
    }
    db.add(Stakeholder(card_id=other.id, user_id=tags_env["viewer"].id, role="editor"))
    await db.flush()
    return {
        **tags_env,
        "member": member,
        "other": other,
        "initiative": initiative,
        "archived": archived,
        "tier": tier,
        "tags": {k: str(v.id) for k, v in tags.items()},
    }


def _ops(*rows) -> dict:
    return {
        "operations": [
            {"card_id": str(card_id), "tag_ids": list(tag_ids), "mode": mode}
            for card_id, tag_ids, mode in rows
        ]
    }


BULK = "/api/v1/cards/tags/bulk"


class TestBulkCardTags:
    async def test_add_replace_remove_with_results_and_events(
        self, client, db, bulk_env, publish_commit_log
    ):
        t = bulk_env["tags"]
        card = bulk_env["card"]
        headers = auth_headers(bulk_env["admin"])

        resp = await client.post(
            BULK, json=_ops((card.id, [t["finance"], t["gold"]], "add")), headers=headers
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert (body["updated"], body["unchanged"], body["failed"], body["dry_run"]) == (
            1,
            0,
            0,
            False,
        )
        row = body["results"][0]
        assert row["index"] == 0 and row["card_id"] == str(card.id)
        assert row["status"] == "updated"
        assert set(row["added"]) == {t["finance"], t["gold"]} and row["removed"] == []
        assert set(row["tag_ids"]) == {t["finance"], t["gold"]}
        assert await _card_tag_set(db, card.id) == {t["finance"], t["gold"]}
        # The events are persisted (db=) and published before the commit.
        assert publish_commit_log == [
            ("publish", "tag.added", True),
            ("publish", "tag.added", True),
            ("commit",),
        ]

        # Replace swaps the single-choice tag; remove drops one.
        resp = await client.post(
            BULK,
            json=_ops(
                (card.id, [t["finance"], t["silver"]], "replace"),
                (card.id, [t["finance"]], "remove"),
            ),
            headers=headers,
        )
        first, second = resp.json()["results"]
        assert first["added"] == [t["silver"]] and first["removed"] == [t["gold"]]
        assert second["status"] == "updated" and second["removed"] == [t["finance"]]
        assert second["tag_ids"] == [t["silver"]]
        assert resp.json()["updated"] == 2
        assert await _card_tag_set(db, card.id) == {t["silver"]}
        assert await _tag_events(db) == [
            ("tag.added", "Finance"),
            ("tag.added", "Gold"),
            ("tag.added", "Silver"),
            ("tag.removed", "Finance"),
            ("tag.removed", "Gold"),
        ]

    async def test_an_unchanged_set_reports_unchanged(self, client, db, bulk_env):
        t = bulk_env["tags"]
        card = bulk_env["card"]
        headers = auth_headers(bulk_env["admin"])
        await client.post(BULK, json=_ops((card.id, [t["hr"]], "add")), headers=headers)
        resp = await client.post(BULK, json=_ops((card.id, [t["hr"]], "add")), headers=headers)
        body = resp.json()
        assert (body["updated"], body["unchanged"]) == (0, 1)
        assert body["results"][0]["status"] == "unchanged"
        assert body["results"][0]["tag_ids"] == [t["hr"]]
        assert await _tag_events(db) == [("tag.added", "HR")]

    async def test_group_rules_fail_the_row_only(self, client, db, bulk_env):
        t = bulk_env["tags"]
        card, initiative = bulk_env["card"], bulk_env["initiative"]
        resp = await client.post(
            BULK,
            json=_ops(
                (card.id, [t["gold"], t["silver"]], "add"),
                (initiative.id, [t["cloud"]], "add"),
                (card.id, [t["hr"]], "add"),
            ),
            headers=auth_headers(bulk_env["admin"]),
        )
        assert resp.status_code == 200
        single, restricted, ok = resp.json()["results"]
        assert single["status"] == "failed" and "single-choice" in single["error"]
        assert single["tag_ids"] == [] and single["added"] == []
        assert restricted["status"] == "failed" and "restricted" in restricted["error"]
        assert ok["status"] == "updated"
        assert resp.json()["failed"] == 2
        assert await _card_tag_set(db, card.id) == {t["hr"]}
        assert await _card_tag_set(db, initiative.id) == set()

    async def test_unknown_and_malformed_tag_ids_fail_the_row(self, client, db, bulk_env):
        import uuid as _uuid

        card = bulk_env["card"]
        resp = await client.post(
            BULK,
            json=_ops((card.id, [str(_uuid.uuid4())], "add"), (card.id, ["nope"], "add")),
            headers=auth_headers(bulk_env["admin"]),
        )
        unknown, malformed = resp.json()["results"]
        assert unknown["status"] == "failed" and "Unknown tag" in unknown["error"]
        assert malformed["status"] == "failed"
        assert malformed["error"] == "Invalid tag id(s): nope"
        assert resp.json()["updated"] == 0

    async def test_archived_card_is_refused(self, client, db, bulk_env):
        t = bulk_env["tags"]
        archived = bulk_env["archived"]
        resp = await client.post(
            BULK,
            json=_ops((archived.id, [t["hr"]], "add")),
            headers=auth_headers(bulk_env["admin"]),
        )
        row = resp.json()["results"][0]
        assert (row["status"], row["error"]) == ("failed", "Card is archived")
        assert await _card_tag_set(db, archived.id) == set()

    async def test_hidden_unknown_and_malformed_cards_are_not_found(self, client, db, bulk_env):
        import uuid as _uuid

        from tests.api.test_cards_type_read_permissions import set_overrides

        await set_overrides(db, "Initiative", {"member": {"inventory.view": False}})
        t = bulk_env["tags"]
        initiative = bulk_env["initiative"]
        resp = await client.post(
            BULK,
            json=_ops(
                (initiative.id, [t["hr"]], "add"),
                (_uuid.uuid4(), [t["hr"]], "add"),
                ("not-a-uuid", [t["hr"]], "add"),
            ),
            headers=auth_headers(bulk_env["member"]),
        )
        assert resp.status_code == 200, resp.text
        rows = resp.json()["results"]
        assert [r["status"] for r in rows] == ["not_found"] * 3
        # The hidden card's row reads exactly like the missing one's.
        assert {k: v for k, v in rows[0].items() if k not in ("index", "card_id")} == {
            k: v for k, v in rows[1].items() if k not in ("index", "card_id")
        }
        assert resp.json()["failed"] == 3
        assert await _card_tag_set(db, initiative.id) == set()

    async def test_the_inventory_read_scope_applies(self, client, db, bulk_env):
        """A role that may manage tags but not browse the inventory reads no
        card here: the scope is the inventory's, not a module's."""
        await create_role(db, key="tagger", label="Tagger", permissions={"tags.manage": True})
        tagger = await create_user(db, email="tagger@test.com", role="tagger")
        t = bulk_env["tags"]
        card = bulk_env["card"]
        resp = await client.post(
            BULK, json=_ops((card.id, [t["hr"]], "add")), headers=auth_headers(tagger)
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["results"][0]["status"] == "not_found"
        assert await _card_tag_set(db, card.id) == set()

    async def test_without_edit_rights_the_call_is_refused(self, client, db, bulk_env):
        t = bulk_env["tags"]
        card, other = bulk_env["card"], bulk_env["other"]
        resp = await client.post(
            BULK,
            json=_ops((other.id, [t["hr"]], "add"), (card.id, [t["hr"]], "add")),
            headers=auth_headers(bulk_env["viewer"]),
        )
        assert resp.status_code == 403
        # The viewer edits `other` through a stakeholder role; only `card` is named.
        assert resp.json()["detail"] == f"Not enough permissions to tag card(s): {card.id}"
        assert await _card_tag_set(db, other.id) == set()
        assert await _tag_events(db) == []

    async def test_stakeholder_with_card_edit_may_tag(self, client, db, bulk_env):
        t = bulk_env["tags"]
        other = bulk_env["other"]
        resp = await client.post(
            BULK,
            json=_ops((other.id, [t["hr"]], "add")),
            headers=auth_headers(bulk_env["viewer"]),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["results"][0]["status"] == "updated"
        assert await _card_tag_set(db, other.id) == {t["hr"]}

    async def test_dry_run_persists_and_publishes_nothing(
        self, client, db, bulk_env, publish_commit_log
    ):
        t = bulk_env["tags"]
        card = bulk_env["card"]
        resp = await client.post(
            BULK,
            json={**_ops((card.id, [t["finance"], t["gold"]], "add")), "dry_run": True},
            headers=auth_headers(bulk_env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["dry_run"] is True and body["updated"] == 1
        assert set(body["results"][0]["tag_ids"]) == {t["finance"], t["gold"]}
        assert [e for e in publish_commit_log if e[0] == "publish"] == []
        assert ("commit",) not in publish_commit_log
        assert await _card_tag_set(db, card.id) == set()
        assert await _tag_events(db) == []

    @pytest.mark.parametrize(
        "body",
        [
            {"operations": []},
            {"operations": [{"card_id": "x", "tag_ids": [], "mode": "toggle"}]},
            {"operations": [{"card_id": "x", "tag_ids": []}]},
        ],
    )
    async def test_rejected_bodies(self, client, db, bulk_env, body):
        resp = await client.post(BULK, json=body, headers=auth_headers(bulk_env["admin"]))
        assert resp.status_code == 422

    async def test_tag_ids_per_operation_are_capped(self, client, db, bulk_env):
        from app.schemas.common import MAX_TAGS_PER_OPERATION

        card_id = str(bulk_env["card"].id)
        headers = auth_headers(bulk_env["admin"])
        unknown = "00000000-0000-0000-0000-000000000000"
        at_cap = {"card_id": card_id, "tag_ids": [unknown] * MAX_TAGS_PER_OPERATION, "mode": "add"}
        resp = await client.post(BULK, json={"operations": [at_cap]}, headers=headers)
        assert resp.status_code == 200
        over = {**at_cap, "tag_ids": [unknown] * (MAX_TAGS_PER_OPERATION + 1)}
        resp = await client.post(BULK, json={"operations": [over]}, headers=headers)
        assert resp.status_code == 422

    async def test_operations_are_capped(self, client, db, bulk_env):
        from app.schemas.common import MAX_CARD_TAG_OPERATIONS

        op = {"card_id": str(bulk_env["card"].id), "tag_ids": [], "mode": "add"}
        resp = await client.post(
            BULK,
            json={"operations": [op] * (MAX_CARD_TAG_OPERATIONS + 1)},
            headers=auth_headers(bulk_env["admin"]),
        )
        assert resp.status_code == 422

    async def test_card_detail_tags_carry_their_group_id(self, client, db, bulk_env):
        t = bulk_env["tags"]
        card = bulk_env["card"]
        headers = auth_headers(bulk_env["admin"])
        card_id, tier_id = card.id, bulk_env["tier"].id
        await client.post(BULK, json=_ops((card_id, [t["gold"]], "add")), headers=headers)
        db.expire_all()  # the shared test session cached the card's empty tag list
        resp = await client.get(f"/api/v1/cards/{card_id}", headers=headers)
        assert resp.status_code == 200
        [tag] = resp.json()["tags"]
        assert tag["tag_group_id"] == str(tier_id)
        assert tag["group_name"] == "Tier"


# ---------------------------------------------------------------
# Tag group / tag creation: dry run and validation
# ---------------------------------------------------------------


class TestTagCreationRules:
    async def test_group_dry_run_stores_and_records_nothing(self, client, db, tags_env):
        from sqlalchemy import select

        from app.models.tag import TagGroup

        resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Preview", "mode": "single", "dry_run": True},
            headers=auth_headers(tags_env["admin"]),
        )
        assert resp.status_code == 201
        assert resp.json() == {"id": None, "name": "Preview", "dry_run": True}
        assert (await db.execute(select(TagGroup))).scalars().all() == []
        assert await _audit_rows(db, "admin.") == []

    async def test_tag_dry_run_stores_and_records_nothing(self, client, db, tags_env):
        from sqlalchemy import select

        from app.models.tag import Tag
        from tests.conftest import create_tag_group

        group = await create_tag_group(db, name="Domains")
        resp = await client.post(
            f"/api/v1/tag-groups/{group.id}/tags",
            json={"name": "Finance", "color": "#112233", "dry_run": True},
            headers=auth_headers(tags_env["admin"]),
        )
        assert resp.status_code == 201
        assert resp.json() == {
            "id": None,
            "name": "Finance",
            "description": None,
            "color": "#112233",
            "dry_run": True,
        }
        assert (await db.execute(select(Tag))).scalars().all() == []
        assert await _audit_rows(db, "admin.") == []

    @pytest.mark.parametrize("group_id", ["00000000-0000-0000-0000-000000000000", "nope"])
    async def test_tag_in_unknown_group_is_404(self, client, db, tags_env, group_id):
        for dry_run in (False, True):
            resp = await client.post(
                f"/api/v1/tag-groups/{group_id}/tags",
                json={"name": "Orphan", "dry_run": dry_run},
                headers=auth_headers(tags_env["admin"]),
            )
            assert resp.status_code == 404
            assert resp.json()["detail"] == "Tag group not found"

    async def test_tag_needs_tags_manage(self, client, db, tags_env):
        from tests.conftest import create_tag_group

        group = await create_tag_group(db, name="Domains")
        resp = await client.post(
            f"/api/v1/tag-groups/{group.id}/tags",
            json={"name": "Finance", "dry_run": True},
            headers=auth_headers(tags_env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_bad_mode_is_422(self, client, db, tags_env):
        from tests.conftest import create_tag_group

        headers = auth_headers(tags_env["admin"])
        resp = await client.post(
            "/api/v1/tag-groups", json={"name": "Bad", "mode": "several"}, headers=headers
        )
        assert resp.status_code == 422
        group = await create_tag_group(db, name="Domains")
        resp = await client.patch(
            f"/api/v1/tag-groups/{group.id}", json={"mode": "several"}, headers=headers
        )
        assert resp.status_code == 422

    async def test_unknown_restrict_type_is_422(self, client, db, tags_env):
        headers = auth_headers(tags_env["admin"])
        for dry_run in (False, True):
            resp = await client.post(
                "/api/v1/tag-groups",
                json={
                    "name": "Scoped",
                    "restrict_to_types": ["Application", "Nope", "Ghost"],
                    "dry_run": dry_run,
                },
                headers=headers,
            )
            assert resp.status_code == 422
            assert resp.json()["detail"] == (
                "Unknown card type(s) in restrict_to_types: Ghost, Nope"
            )
        assert await _audit_rows(db, "admin.") == []

    async def test_patch_checks_new_restrict_keys_but_keeps_stored_ones(self, client, db, tags_env):
        from tests.conftest import create_tag_group

        headers = auth_headers(tags_env["admin"])
        # A group that already names a type which no longer exists.
        group = await create_tag_group(db, name="Scoped", restrict_to_types=["Gone"])
        resp = await client.patch(
            f"/api/v1/tag-groups/{group.id}",
            json={"restrict_to_types": ["Gone", "Application"]},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["restrict_to_types"] == ["Gone", "Application"]
        resp = await client.patch(
            f"/api/v1/tag-groups/{group.id}",
            json={"restrict_to_types": ["Application", "Nope"]},
            headers=headers,
        )
        assert resp.status_code == 422
        assert resp.json()["detail"] == "Unknown card type(s) in restrict_to_types: Nope"


class TestCardTagRefusalsExact:
    async def test_single_card_tagging_answers_the_stakeholder_question(self, client, db, bulk_env):
        t = bulk_env["tags"]
        headers = auth_headers(bulk_env["viewer"])
        # The viewer edits `other` through a stakeholder role on that card.
        ok = await client.post(
            f"/api/v1/cards/{bulk_env['other'].id}/tags", json=[t["hr"]], headers=headers
        )
        assert ok.status_code == 201, ok.text
        assert await _card_tag_set(db, bulk_env["other"].id) == {t["hr"]}
        refused = await client.post(
            f"/api/v1/cards/{bulk_env['card'].id}/tags", json=[t["hr"]], headers=headers
        )
        assert refused.status_code == 403
        assert refused.json() == {"detail": "Insufficient permissions"}

    async def test_every_malformed_tag_id_is_named(self, client, db, bulk_env):
        card = bulk_env["card"]
        resp = await client.post(
            BULK,
            json=_ops((card.id, ["nope", "bad"], "add")),
            headers=auth_headers(bulk_env["admin"]),
        )
        assert resp.json()["results"][0]["error"] == "Invalid tag id(s): nope, bad"

    async def test_the_events_name_the_caller(self, client, db, bulk_env):
        from sqlalchemy import select

        from app.models.event import Event

        t = bulk_env["tags"]
        card = bulk_env["card"]
        resp = await client.post(
            BULK, json=_ops((card.id, [t["hr"]], "add")), headers=auth_headers(bulk_env["admin"])
        )
        assert resp.status_code == 200
        rows = (await db.execute(select(Event).where(Event.event_type == "tag.added"))).scalars()
        assert [e.user_id for e in rows.all()] == [bulk_env["admin"].id]

    async def test_only_malformed_card_ids_are_all_not_found(self, client, db, bulk_env):
        t = bulk_env["tags"]
        resp = await client.post(
            BULK,
            json=_ops(("x", [t["hr"]], "add"), ("y", [t["hr"]], "add")),
            headers=auth_headers(bulk_env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        assert [r["status"] for r in resp.json()["results"]] == ["not_found", "not_found"]

    async def test_every_refused_card_is_named_in_order(self, client, db, bulk_env):
        card, archived = bulk_env["card"], bulk_env["archived"]
        t = bulk_env["tags"]
        resp = await client.post(
            BULK,
            json=_ops((card.id, [t["hr"]], "add"), (archived.id, [t["hr"]], "add")),
            headers=auth_headers(bulk_env["viewer"]),
        )
        assert resp.status_code == 403
        first, second = sorted([str(card.id), str(archived.id)])
        assert resp.json()["detail"] == (
            f"Not enough permissions to tag card(s): {first}, {second}"
        )

    async def test_a_card_read_through_a_stakeholder_role_is_tagged(self, client, db, bulk_env):
        """With the type hidden from the role, the card is still readable — and
        taggable — through the caller's stakeholder role on it."""
        from app.models.stakeholder import Stakeholder
        from tests.api.test_cards_type_read_permissions import set_overrides
        from tests.conftest import create_stakeholder_role_def

        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="curator",
            permissions={"card.view": True, "card.edit": True},
        )
        other = bulk_env["other"]
        db.add(Stakeholder(card_id=other.id, user_id=bulk_env["viewer"].id, role="curator"))
        await db.flush()
        await set_overrides(db, "Application", {"viewer": {"inventory.view": False}})
        t = bulk_env["tags"]
        resp = await client.post(
            BULK,
            json=_ops((other.id, [t["hr"]], "add"), (bulk_env["card"].id, [t["hr"]], "add")),
            headers=auth_headers(bulk_env["viewer"]),
        )
        assert resp.status_code == 200, resp.text
        assert [r["status"] for r in resp.json()["results"]] == ["updated", "not_found"]
        assert await _card_tag_set(db, other.id) == {t["hr"]}
