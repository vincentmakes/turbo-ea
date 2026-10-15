"""The /users admin routes write the security & admin audit log.

Every read goes through ``_committed``, which rolls the session back first: the
``db`` fixture shares one session with the app, so a row that was only flushed
would still be visible and prove nothing. What survives the rollback is what
the route committed. ORM instances are expired by it, so ids, emails and auth
headers are captured *before* the request.

DB-backed: skipped locally without PostgreSQL, run in CI.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.audit_log import AuditLogEntry
from app.models.sso_invitation import SsoInvitation
from tests.conftest import auth_headers, create_role, create_user


async def _committed(db, prefix: str = "admin.user.") -> list[AuditLogEntry]:
    await db.rollback()
    result = await db.execute(
        select(AuditLogEntry)
        .where(AuditLogEntry.action.like(f"{prefix}%"))
        .order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars().all())


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    return {
        "admin_id": admin.id,
        "admin_h": auth_headers(admin),
        "member_id": member.id,
        "member_h": auth_headers(member),
    }


def _assert_actor_and_subject(row, env, *, subject: str, target_id: str | None):
    assert row.category == "admin"
    assert row.outcome == "success"
    assert row.actor_user_id == env["admin_id"]
    assert row.actor_email == "admin@test.com"
    assert row.subject_email == subject
    assert row.target_type == "user"
    assert row.target_label == subject
    if target_id is not None:
        assert row.target_id == target_id


class TestCreate:
    async def test_create_records_role_and_provider(self, client, db, env):
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "New@Test.com",
                "display_name": "New",
                "password": "StrongPass1",
                "role": "member",
            },
            headers=env["admin_h"],
        )
        assert resp.status_code == 201
        new_id = resp.json()["id"]

        [row] = await _committed(db)
        assert row.action == "admin.user.created"
        _assert_actor_and_subject(row, env, subject="new@test.com", target_id=new_id)
        # The role is named by its label, as the Users screen shows it.
        assert row.details == {
            "context": {"role": "Member", "auth_provider": "local", "invited": False}
        }

    async def test_refused_create_records_nothing(self, client, db, env):
        resp = await client.post(
            "/api/v1/users",
            json={"email": "x@test.com", "display_name": "X", "role": "nope"},
            headers=env["admin_h"],
        )
        assert resp.status_code == 400
        assert await _committed(db) == []


class TestUpdate:
    async def test_admin_edit_records_only_changed_fields(self, client, db, env):
        member_id = str(env["member_id"])
        resp = await client.patch(
            f"/api/v1/users/{member_id}",
            json={"role": "viewer", "display_name": "Test User", "is_active": False},
            headers=env["admin_h"],
        )
        assert resp.status_code == 200

        [row] = await _committed(db)
        assert row.action == "admin.user.updated"
        _assert_actor_and_subject(row, env, subject="member@test.com", target_id=member_id)
        # display_name was re-sent unchanged, so it is not reported.
        assert row.details == {
            "changes": {
                "role": {"old": "Member", "new": "Viewer"},
                "is_active": {"old": True, "new": False},
            }
        }

    async def test_admin_setting_a_password_is_masked(self, client, db, env):
        resp = await client.patch(
            f"/api/v1/users/{env['member_id']}",
            json={"password": "AdminChosen1"},
            headers=env["admin_h"],
        )
        assert resp.status_code == 200

        [row] = await _committed(db, prefix="")
        assert row.action == "admin.user.updated"
        assert row.details == {"changes": {"password": {"old": "***", "new": "***"}}}
        assert "AdminChosen1" not in str(row.details)

    async def test_own_password_change_is_an_auth_event_only(self, client, db, env):
        resp = await client.patch(
            f"/api/v1/users/{env['member_id']}",
            json={"password": "MemberChosen1"},
            headers=env["member_h"],
        )
        assert resp.status_code == 200

        rows = await _committed(db, prefix="")
        assert [r.action for r in rows] == ["auth.password.changed"]

    async def test_member_own_profile_edit_records_nothing(self, client, db, env):
        """A non-admin renaming themselves is self-service, not an admin act."""
        member_id = env["member_id"]
        resp = await client.patch(
            f"/api/v1/users/{member_id}",
            json={"display_name": "Renamed", "locale": "de"},
            headers=env["member_h"],
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] == "Renamed"
        assert await _committed(db, prefix="") == []

    async def test_admin_own_profile_edit_is_recorded(self, client, db, env):
        admin_id = str(env["admin_id"])
        resp = await client.patch(
            f"/api/v1/users/{admin_id}",
            json={"display_name": "Chief", "locale": "fr"},
            headers=env["admin_h"],
        )
        assert resp.status_code == 200

        [row] = await _committed(db)
        assert row.action == "admin.user.updated"
        assert row.category == "admin"
        assert row.actor_user_id == env["admin_id"]
        assert row.subject_email == "admin@test.com"
        assert row.target_id == admin_id
        assert row.details == {
            "changes": {
                "display_name": {"old": "Test User", "new": "Chief"},
                "locale": {"old": "en", "new": "fr"},
            }
        }

    async def test_no_op_edit_records_nothing(self, client, db, env):
        resp = await client.patch(
            f"/api/v1/users/{env['member_id']}",
            json={"role": "member"},
            headers=env["admin_h"],
        )
        assert resp.status_code == 200
        assert await _committed(db) == []


class TestDelete:
    async def test_delete_records_the_removed_account(self, client, db, env):
        member_id = str(env["member_id"])
        resp = await client.delete(f"/api/v1/users/{member_id}", headers=env["admin_h"])
        assert resp.status_code == 204

        [row] = await _committed(db)
        assert row.action == "admin.user.deleted"
        _assert_actor_and_subject(row, env, subject="member@test.com", target_id=member_id)
        assert row.details == {"context": {"role": "Member", "display_name": "Test User"}}

    async def test_a_role_with_no_definition_is_named_by_its_key(self, client, db, env):
        ghost = await create_user(db, email="ghost@test.com", role="ghost")
        ghost_id = str(ghost.id)
        resp = await client.delete(f"/api/v1/users/{ghost_id}", headers=env["admin_h"])
        assert resp.status_code == 204

        [row] = await _committed(db)
        assert row.details == {"context": {"role": "ghost", "display_name": "Test User"}}

    async def test_member_cannot_delete_and_nothing_is_recorded(self, client, db, env):
        resp = await client.delete(f"/api/v1/users/{env['admin_id']}", headers=env["member_h"])
        assert resp.status_code == 403
        assert await _committed(db) == []


class TestBulk:
    async def test_bulk_update_records_count_and_fields(self, client, db, env):
        other = await create_user(db, email="other@test.com", role="member")
        ids = sorted([str(env["member_id"]), str(other.id)])
        resp = await client.patch(
            "/api/v1/users/bulk",
            json={"ids": ids, "updates": {"role": "viewer"}},
            headers=env["admin_h"],
        )
        assert resp.status_code == 200

        [row] = await _committed(db)
        assert row.action == "admin.user.bulk_updated"
        assert row.actor_user_id == env["admin_id"]
        assert (row.target_type, row.target_id, row.target_label) == ("users", None, None)
        assert row.details["context"] == {"count": 2}
        # One item per user per changed field, roles by label, users by email.
        assert sorted(row.details["items"], key=lambda i: i["user"]) == [
            {
                "kind": "user.changed",
                "user": "member@test.com",
                "field": "role",
                "old": "Member",
                "new": "Viewer",
            },
            {
                "kind": "user.changed",
                "user": "other@test.com",
                "field": "role",
                "old": "Member",
                "new": "Viewer",
            },
        ]
        assert set(row.details) == {"context", "items"}

    async def test_bulk_update_lists_only_what_moved_per_user(self, client, db, env):
        viewer = await create_user(db, email="viewer@test.com", role="viewer")
        ids = [str(env["member_id"]), str(viewer.id)]
        resp = await client.patch(
            "/api/v1/users/bulk",
            json={"ids": ids, "updates": {"role": "viewer", "is_active": False}},
            headers=env["admin_h"],
        )
        assert resp.status_code == 200

        [row] = await _committed(db)
        assert row.details["context"] == {"count": 2}
        # The viewer was already a viewer: only their deactivation is listed.
        items = sorted(row.details["items"], key=lambda i: (i["user"], i["field"]))
        assert items == [
            {
                "kind": "user.changed",
                "user": "member@test.com",
                "field": "is_active",
                "old": True,
                "new": False,
            },
            {
                "kind": "user.changed",
                "user": "member@test.com",
                "field": "role",
                "old": "Member",
                "new": "Viewer",
            },
            {
                "kind": "user.changed",
                "user": "viewer@test.com",
                "field": "is_active",
                "old": True,
                "new": False,
            },
        ]

    async def test_bulk_update_that_changes_nothing_records_nothing(self, client, db, env):
        resp = await client.patch(
            "/api/v1/users/bulk",
            json={"ids": [str(env["member_id"])], "updates": {"role": "member"}},
            headers=env["admin_h"],
        )
        assert resp.status_code == 200
        assert [u["role"] for u in resp.json()] == ["member"]
        assert await _committed(db) == []

    async def test_bulk_delete_records_only_deleted_accounts(self, client, db, env):
        gone = await create_user(db, email="gone@test.com", role="member")
        gone.is_active = False
        await db.flush()
        gone_id = str(gone.id)
        resp = await client.post(
            "/api/v1/users/bulk-delete",
            json={"ids": [gone_id, str(env["member_id"])]},
            headers=env["admin_h"],
        )
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 1

        [row] = await _committed(db)
        assert row.action == "admin.user.bulk_deleted"
        assert (row.target_type, row.target_id, row.target_label) == ("users", None, None)
        assert row.details == {
            "context": {"count": 1, "skipped": 1},
            "items": [{"kind": "user.deleted", "user": "gone@test.com"}],
        }


class TestUnlock:
    async def test_unlocking_an_unlocked_account_records_nothing(self, client, db, env):
        resp = await client.post(f"/api/v1/users/{env['member_id']}/unlock", headers=env["admin_h"])
        assert resp.status_code == 200
        assert resp.json()["failed_login_attempts"] == 0
        assert await _committed(db) == []

    async def test_clearing_failed_attempts_alone_is_recorded(self, client, db, env):
        from app.models.user import User

        member = (await db.execute(select(User).where(User.id == env["member_id"]))).scalar_one()
        member.failed_login_attempts = 2
        await db.flush()
        resp = await client.post(f"/api/v1/users/{env['member_id']}/unlock", headers=env["admin_h"])
        assert resp.status_code == 200

        [row] = await _committed(db)
        assert row.action == "admin.user.unlocked"
        assert row.details == {"changes": {"failed_login_attempts": {"old": 2, "new": 0}}}


class TestInvitations:
    async def _invite(self, db, env, email="invitee@test.com", role="viewer"):
        inv = SsoInvitation(email=email, role=role, invited_by=env["admin_id"])
        db.add(inv)
        await db.flush()
        return str(inv.id)

    async def test_delete_invitation_records(self, client, db, env):
        inv_id = await self._invite(db, env)
        resp = await client.delete(f"/api/v1/users/invitations/{inv_id}", headers=env["admin_h"])
        assert resp.status_code == 204

        [row] = await _committed(db)
        assert row.action == "admin.user.invitation.deleted"
        assert row.actor_user_id == env["admin_id"]
        assert row.subject_email == "invitee@test.com"
        assert (row.target_type, row.target_id) == ("invitation", inv_id)
        assert row.details == {"context": {"role": "Viewer"}}

    async def test_delete_invitation_for_an_unknown_role_names_the_key(self, client, db, env):
        inv_id = await self._invite(db, env, role="retired")
        resp = await client.delete(f"/api/v1/users/invitations/{inv_id}", headers=env["admin_h"])
        assert resp.status_code == 204

        [row] = await _committed(db)
        assert row.details == {"context": {"role": "retired"}}

    async def test_resend_invitation_records_and_commits(self, client, db, env, monkeypatch):
        import app.services.email_service as email_service

        async def _sent(**kwargs):
            return True

        monkeypatch.setattr(email_service, "send_notification_email", _sent)
        inv_id = await self._invite(db, env)
        resp = await client.post(
            f"/api/v1/users/invitations/{inv_id}/resend", headers=env["admin_h"]
        )
        assert resp.status_code == 200

        [row] = await _committed(db)
        assert row.action == "admin.user.invitation.resent"
        assert row.subject_email == "invitee@test.com"
        assert (row.target_type, row.target_id) == ("invitation", inv_id)

    async def test_failed_resend_records_nothing(self, client, db, env, monkeypatch):
        import app.services.email_service as email_service

        async def _not_sent(**kwargs):
            return False

        monkeypatch.setattr(email_service, "send_notification_email", _not_sent)
        inv_id = await self._invite(db, env)
        resp = await client.post(
            f"/api/v1/users/invitations/{inv_id}/resend", headers=env["admin_h"]
        )
        assert resp.status_code == 400
        assert await _committed(db) == []


async def test_unknown_invitation_is_404(client, db, env):
    resp = await client.delete(f"/api/v1/users/invitations/{uuid.uuid4()}", headers=env["admin_h"])
    assert resp.status_code == 404
    assert await _committed(db) == []
