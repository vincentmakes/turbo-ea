"""Approval gate: mandatory relations + mandatory tag groups must be
satisfied before a card can be approved.

Each test operates in its own transaction (savepoint rollback pattern
established in conftest). Admin users have
`inventory.approval_status: True` which maps to `card.approval_status`.
"""

from __future__ import annotations

import pytest

from app.core.permissions import VIEWER_PERMISSIONS
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
async def approval_env(db):
    """Admin user + Application/Organization card types + one draft card."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Organization", label="Organization")

    admin = await create_user(db, email="admin@test.com", role="admin")
    card = await create_card(db, card_type="Application", name="My App", user_id=admin.id)
    return {"admin": admin, "card": card}


class TestApprovalMandatoryRelation:
    async def test_blocked_when_source_mandatory_relation_missing(self, client, db, approval_env):
        admin = approval_env["admin"]
        card = approval_env["card"]

        rt = await create_relation_type(
            db,
            key="app_operated_by_org",
            label="operated by",
            source_type_key="Application",
            target_type_key="Organization",
        )
        rt.source_mandatory = True
        await db.flush()

        resp = await client.post(
            f"/api/v1/cards/{card.id}/approval-status?action=approve",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400, resp.text
        detail = resp.json()["detail"]
        assert detail["code"] == "approval_blocked_mandatory_missing"
        assert len(detail["missing_relations"]) == 1
        missing = detail["missing_relations"][0]
        assert missing["key"] == "app_operated_by_org"
        assert missing["side"] == "source"
        assert missing["other_type_key"] == "Organization"

    async def test_approve_succeeds_once_relation_present(self, client, db, approval_env):
        admin = approval_env["admin"]
        card = approval_env["card"]

        org = await create_card(db, card_type="Organization", name="Acme", user_id=admin.id)
        rt = await create_relation_type(
            db,
            key="app_operated_by_org",
            label="operated by",
            source_type_key="Application",
            target_type_key="Organization",
        )
        rt.source_mandatory = True
        await db.flush()
        await create_relation(
            db, type_key="app_operated_by_org", source_id=card.id, target_id=org.id
        )

        resp = await client.post(
            f"/api/v1/cards/{card.id}/approval-status?action=approve",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["approval_status"] == "APPROVED"

    async def test_target_mandatory_enforced_on_incoming_side(self, client, db, approval_env):
        admin = approval_env["admin"]
        app_card = approval_env["card"]
        org = await create_card(db, card_type="Organization", name="Acme", user_id=admin.id)

        rt = await create_relation_type(
            db,
            key="app_operated_by_org",
            label="operated by",
            source_type_key="Application",
            target_type_key="Organization",
        )
        rt.target_mandatory = True
        await db.flush()

        # Org has no incoming relation yet — approving it should 400.
        resp = await client.post(
            f"/api/v1/cards/{org.id}/approval-status?action=approve",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400, resp.text
        missing = resp.json()["detail"]["missing_relations"][0]
        assert missing["side"] == "target"

        # Link any Application to the Org → approve succeeds.
        await create_relation(
            db, type_key="app_operated_by_org", source_id=app_card.id, target_id=org.id
        )
        resp2 = await client.post(
            f"/api/v1/cards/{org.id}/approval-status?action=approve",
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 200, resp2.text


class TestApprovalMandatoryTagGroup:
    async def _make_group_and_tag(self, client, admin, *, name="Env", restrict=None):
        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": name, "mandatory": True},
            headers=auth_headers(admin),
        )
        assert group_resp.status_code == 201, group_resp.text
        group_id = group_resp.json()["id"]
        if restrict is not None:
            await client.patch(
                f"/api/v1/tag-groups/{group_id}",
                json={"restrict_to_types": restrict},
                headers=auth_headers(admin),
            )
        tag_resp = await client.post(
            f"/api/v1/tag-groups/{group_id}/tags",
            json={"name": "Prod"},
            headers=auth_headers(admin),
        )
        assert tag_resp.status_code == 201, tag_resp.text
        return group_id, tag_resp.json()["id"]

    async def test_blocked_when_mandatory_tag_group_unsatisfied(self, client, db, approval_env):
        admin = approval_env["admin"]
        card = approval_env["card"]

        # Mandatory group scoped to Application
        _, _tag_id = await self._make_group_and_tag(
            client, admin, name="Env", restrict=["Application"]
        )

        resp = await client.post(
            f"/api/v1/cards/{card.id}/approval-status?action=approve",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400, resp.text
        assert len(resp.json()["detail"]["missing_tag_groups"]) == 1
        assert resp.json()["detail"]["missing_tag_groups"][0]["name"] == "Env"

    async def test_approve_succeeds_when_tag_assigned(self, client, db, approval_env):
        admin = approval_env["admin"]
        card = approval_env["card"]
        _, tag_id = await self._make_group_and_tag(
            client, admin, name="Env", restrict=["Application"]
        )

        await client.post(
            f"/api/v1/cards/{card.id}/tags",
            json=[tag_id],
            headers=auth_headers(admin),
        )
        resp = await client.post(
            f"/api/v1/cards/{card.id}/approval-status?action=approve",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text

    async def test_mandatory_group_restricted_to_other_type_is_ignored(
        self, client, db, approval_env
    ):
        """A card of type X doesn't need tags from a mandatory group that
        restricts to Y only."""
        admin = approval_env["admin"]
        card = approval_env["card"]
        await self._make_group_and_tag(client, admin, name="OrgTheme", restrict=["Organization"])

        resp = await client.post(
            f"/api/v1/cards/{card.id}/approval-status?action=approve",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text

    async def test_empty_mandatory_group_is_vacuous(self, client, db, approval_env):
        """A mandatory group with zero tags shouldn't hard-block approval."""
        admin = approval_env["admin"]
        card = approval_env["card"]

        group_resp = await client.post(
            "/api/v1/tag-groups",
            json={"name": "Empty", "mandatory": True},
            headers=auth_headers(admin),
        )
        assert group_resp.status_code == 201
        # No tags added — should be skipped by the gate.

        resp = await client.post(
            f"/api/v1/cards/{card.id}/approval-status?action=approve",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text

    async def test_reject_and_reset_are_not_gated(self, client, db, approval_env):
        admin = approval_env["admin"]
        card = approval_env["card"]
        await self._make_group_and_tag(client, admin, name="Env", restrict=["Application"])

        # Reject should still work even with unsatisfied mandatory groups.
        reject = await client.post(
            f"/api/v1/cards/{card.id}/approval-status?action=reject",
            headers=auth_headers(admin),
        )
        assert reject.status_code == 200
        assert reject.json()["approval_status"] == "REJECTED"

        reset = await client.post(
            f"/api/v1/cards/{card.id}/approval-status?action=reset",
            headers=auth_headers(admin),
        )
        assert reset.status_code == 200
        assert reset.json()["approval_status"] == "DRAFT"
