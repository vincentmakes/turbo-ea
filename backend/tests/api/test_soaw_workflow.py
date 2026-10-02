"""The SoAW signing workflow beyond the happy path ``test_soaw.py`` covers:
recall, reject, the revision chain, the update-route status guards and
the sign-route refusals. Notifications and system todos are asserted on
their rows, since they are what the signatories actually see.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.notification import Notification
from app.models.todo import Todo
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

SOAW = "/api/v1/soaw"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin", display_name="Ada")
    one = await create_user(db, email="one@test.com", role="member", display_name="One")
    two = await create_user(db, email="two@test.com", role="member", display_name="Two")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    await create_card_type(db, key="Initiative", label="Initiative")
    initiative = await create_card(db, card_type="Initiative", name="Cloud", user_id=admin.id)
    return {"admin": admin, "one": one, "two": two, "viewer": viewer, "initiative": initiative}


async def _create(client, user, name="Cloud Migration SoAW", **extra) -> dict:
    resp = await client.post(
        SOAW,
        json={"name": name, "status": "draft", "document_info": {"version": "1.0"}, **extra},
        headers=auth_headers(user),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _request(client, user, soaw_id, signers) -> dict:
    resp = await client.post(
        f"{SOAW}/{soaw_id}/request-signatures",
        json={"user_ids": [str(u.id) for u in signers]},
        headers=auth_headers(user),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _notifications(db, user, notif_type):
    rows = (
        await db.execute(
            select(Notification).where(
                Notification.user_id == user.id, Notification.type == notif_type
            )
        )
    ).scalars()
    return list(rows)


async def _open_sign_todos(db):
    rows = (
        await db.execute(
            select(Todo).where(
                Todo.is_system == True,  # noqa: E712
                Todo.status == "open",
                Todo.description.ilike("%Sign SoAW%"),
            )
        )
    ).scalars()
    return list(rows)


class TestRequestSignatures:
    async def test_unknown_signatory_is_404(self, client, db, env):
        doc = await _create(client, env["admin"])
        resp = await client.post(
            f"{SOAW}/{doc['id']}/request-signatures",
            json={"user_ids": [str(uuid.uuid4())]},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 404

    async def test_a_signed_document_cannot_be_sent_again(self, client, db, env):
        doc = await _create(client, env["admin"])
        await _request(client, env["admin"], doc["id"], [env["one"]])
        signed = await client.post(f"{SOAW}/{doc['id']}/sign", headers=auth_headers(env["one"]))
        assert signed.json()["status"] == "signed"

        resp = await client.post(
            f"{SOAW}/{doc['id']}/request-signatures",
            json={"user_ids": [str(env["two"].id)]},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400 and "already signed" in resp.json()["detail"]


class TestSign:
    async def test_no_request_yet_is_400(self, client, db, env):
        doc = await _create(client, env["admin"])
        resp = await client.post(f"{SOAW}/{doc['id']}/sign", headers=auth_headers(env["admin"]))
        assert resp.status_code == 400 and "No signatures have been requested" in resp.text

    async def test_signing_twice_is_400(self, client, db, env):
        doc = await _create(client, env["admin"])
        await _request(client, env["admin"], doc["id"], [env["one"], env["two"]])
        assert (
            await client.post(f"{SOAW}/{doc['id']}/sign", headers=auth_headers(env["one"]))
        ).status_code == 200
        resp = await client.post(f"{SOAW}/{doc['id']}/sign", headers=auth_headers(env["one"]))
        assert resp.status_code == 400 and "already signed" in resp.json()["detail"]

    async def test_signing_a_signed_document_is_400(self, client, db, env):
        doc = await _create(client, env["admin"])
        await _request(client, env["admin"], doc["id"], [env["one"]])
        await client.post(f"{SOAW}/{doc['id']}/sign", headers=auth_headers(env["one"]))
        resp = await client.post(f"{SOAW}/{doc['id']}/sign", headers=auth_headers(env["admin"]))
        assert resp.status_code == 400 and "already signed" in resp.json()["detail"]

    async def test_viewer_cannot_sign(self, client, db, env):
        doc = await _create(client, env["admin"])
        await _request(client, env["admin"], doc["id"], [env["one"]])
        resp = await client.post(f"{SOAW}/{doc['id']}/sign", headers=auth_headers(env["viewer"]))
        assert resp.status_code == 403

    async def test_partial_signature_notifies_the_creator_with_the_count(self, client, db, env):
        doc = await _create(client, env["admin"])
        await _request(client, env["admin"], doc["id"], [env["one"], env["two"]])
        assert len(await _open_sign_todos(db)) == 2

        resp = await client.post(f"{SOAW}/{doc['id']}/sign", headers=auth_headers(env["one"]))
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "in_review"
        statuses = {s["user_id"]: s["status"] for s in body["signatories"]}
        assert statuses == {str(env["one"].id): "signed", str(env["two"].id): "pending"}
        assert [t.assigned_to for t in await _open_sign_todos(db)] == [env["two"].id]
        (note,) = await _notifications(db, env["admin"], "soaw_signed")
        assert note.title == "SoAW Signature Received" and "(1/2)" in note.message

    async def test_final_signature_signs_the_document(self, client, db, env):
        doc = await _create(client, env["admin"])
        await _request(client, env["admin"], doc["id"], [env["one"]])
        resp = await client.post(f"{SOAW}/{doc['id']}/sign", headers=auth_headers(env["one"]))
        body = resp.json()
        assert body["status"] == "signed" and body["signed_at"]
        (note,) = await _notifications(db, env["admin"], "soaw_signed")
        assert note.title == "SoAW Fully Signed"
        assert note.link == f"/ea-delivery/soaw/{doc['id']}/preview"


class TestRecallSignatures:
    async def test_only_in_review_documents_can_be_recalled(self, client, db, env):
        doc = await _create(client, env["admin"])
        resp = await client.post(
            f"{SOAW}/{doc['id']}/recall-signatures", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 400

    async def test_viewer_cannot_recall(self, client, db, env):
        doc = await _create(client, env["admin"])
        await _request(client, env["admin"], doc["id"], [env["one"]])
        resp = await client.post(
            f"{SOAW}/{doc['id']}/recall-signatures", headers=auth_headers(env["viewer"])
        )
        assert resp.status_code == 403

    async def test_recall_resets_the_document_and_tells_pending_signatories(self, client, db, env):
        doc = await _create(client, env["admin"])
        await _request(client, env["admin"], doc["id"], [env["one"], env["two"]])
        await client.post(f"{SOAW}/{doc['id']}/sign", headers=auth_headers(env["one"]))

        resp = await client.post(
            f"{SOAW}/{doc['id']}/recall-signatures", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "draft" and body["signatories"] == []
        assert await _open_sign_todos(db) == []
        # Only the signatory who had not signed yet is told.
        assert await _notifications(db, env["one"], "soaw_sign_recalled") == []
        (note,) = await _notifications(db, env["two"], "soaw_sign_recalled")
        assert "Ada recalled the signature request" in note.message


class TestReject:
    async def test_only_in_review_documents_can_be_rejected(self, client, db, env):
        doc = await _create(client, env["admin"])
        resp = await client.post(
            f"{SOAW}/{doc['id']}/reject", json={"comment": "no"}, headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 400

    async def test_a_non_signatory_cannot_reject(self, client, db, env):
        doc = await _create(client, env["admin"])
        await _request(client, env["admin"], doc["id"], [env["one"]])
        resp = await client.post(
            f"{SOAW}/{doc['id']}/reject", json={"comment": "no"}, headers=auth_headers(env["two"])
        )
        assert resp.status_code == 403

    async def test_reject_bumps_the_revision_and_notifies_everyone_else(self, client, db, env):
        doc = await _create(client, env["admin"])
        assert doc["revision_number"] == 1
        await _request(client, env["admin"], doc["id"], [env["one"], env["two"]])

        resp = await client.post(
            f"{SOAW}/{doc['id']}/reject",
            json={"comment": "Scope is wrong"},
            headers=auth_headers(env["one"]),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "draft" and body["signatories"] == []
        assert body["revision_number"] == 2
        assert await _open_sign_todos(db) == []
        (creator_note,) = await _notifications(db, env["admin"], "soaw_rejected")
        assert creator_note.message == 'One rejected "Cloud Migration SoAW": Scope is wrong'
        assert creator_note.data["comment"] == "Scope is wrong"
        (other_note,) = await _notifications(db, env["two"], "soaw_rejected")
        assert other_note.message == creator_note.message
        assert await _notifications(db, env["one"], "soaw_rejected") == []


class TestRevisions:
    async def _signed(self, client, env, name="Doc") -> dict:
        doc = await _create(client, env["admin"], name=name)
        await _request(client, env["admin"], doc["id"], [env["one"]])
        return (
            await client.post(f"{SOAW}/{doc['id']}/sign", headers=auth_headers(env["one"]))
        ).json()

    async def test_chain_is_listed_from_any_node(self, client, db, env):
        first = await self._signed(client, env)
        second = (
            await client.post(f"{SOAW}/{first['id']}/revise", headers=auth_headers(env["admin"]))
        ).json()
        assert second["revision_number"] == 2 and second["parent_id"] == first["id"]
        await _request(client, env["admin"], second["id"], [env["one"]])
        await client.post(f"{SOAW}/{second['id']}/sign", headers=auth_headers(env["one"]))
        third = (
            await client.post(f"{SOAW}/{second['id']}/revise", headers=auth_headers(env["admin"]))
        ).json()

        for node in (first, second, third):
            resp = await client.get(
                f"{SOAW}/{node['id']}/revisions", headers=auth_headers(env["one"])
            )
            assert resp.status_code == 200
            assert [r["revision_number"] for r in resp.json()] == [1, 2, 3]
            assert [r["id"] for r in resp.json()] == [first["id"], second["id"], third["id"]]

    async def test_a_single_document_is_its_own_chain(self, client, db, env):
        doc = await _create(client, env["admin"])
        resp = await client.get(f"{SOAW}/{doc['id']}/revisions", headers=auth_headers(env["admin"]))
        assert [r["id"] for r in resp.json()] == [doc["id"]]

    async def test_revisions_need_the_view_permission(self, client, db, env):
        doc = await _create(client, env["admin"])
        resp = await client.get(
            f"{SOAW}/{doc['id']}/revisions", headers=auth_headers(env["viewer"])
        )
        assert resp.status_code == 200  # viewers hold soaw.view


class TestUpdateGuards:
    async def test_status_cannot_jump_to_in_review_through_patch(self, client, db, env):
        doc = await _create(client, env["admin"])
        resp = await client.patch(
            f"{SOAW}/{doc['id']}", json={"status": "in_review"}, headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 400 and "request-signatures" in resp.json()["detail"]

    async def test_in_review_cannot_be_reset_through_patch(self, client, db, env):
        doc = await _create(client, env["admin"])
        await _request(client, env["admin"], doc["id"], [env["one"]])
        resp = await client.patch(
            f"{SOAW}/{doc['id']}", json={"status": "draft"}, headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 400 and "recall-signatures" in resp.json()["detail"]

    async def test_content_and_initiative_can_be_updated(self, client, db, env):
        doc = await _create(client, env["admin"])
        resp = await client.patch(
            f"{SOAW}/{doc['id']}",
            json={
                "initiative_id": str(env["initiative"].id),
                "status": "draft",
                "document_info": {"version": "1.1"},
                "version_history": [{"version": "1.1", "note": "first"}],
                "sections": {"scope": "Everything"},
            },
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["initiative_id"] == str(env["initiative"].id)
        assert body["document_info"] == {"version": "1.1"}
        assert body["version_history"] == [{"version": "1.1", "note": "first"}]
        assert body["sections"] == {"scope": "Everything"}

        cleared = await client.patch(
            f"{SOAW}/{doc['id']}", json={"initiative_id": ""}, headers=auth_headers(env["admin"])
        )
        assert cleared.json()["initiative_id"] is None

    async def test_list_filters_by_initiative(self, client, db, env):
        linked = await _create(client, env["admin"], initiative_id=str(env["initiative"].id))
        await _create(client, env["admin"], name="Unlinked")
        resp = await client.get(
            f"{SOAW}?initiative_id={env['initiative'].id}", headers=auth_headers(env["admin"])
        )
        assert [r["id"] for r in resp.json()] == [linked["id"]]
