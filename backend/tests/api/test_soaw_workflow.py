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
from app.models.event import Event
from app.models.notification import Notification
from app.models.soaw import SoAW
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

    async def test_reject_keeps_the_revision_and_notifies_everyone_else(self, client, db, env):
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
        # Rejections do not bump the revision: revisions count signed versions.
        assert body["revision_number"] == 1
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


# ---------------------------------------------------------------------------
# Revision parity with decisions: chain guard, chain fields, review lock
# ---------------------------------------------------------------------------


async def _signed(client, env, name="Doc") -> dict:
    doc = await _create(client, env["admin"], name=name)
    await _request(client, env["admin"], doc["id"], [env["one"]])
    resp = await client.post(f"{SOAW}/{doc['id']}/sign", headers=auth_headers(env["one"]))
    assert resp.json()["status"] == "signed"
    return resp.json()


async def _revise(client, env, soaw_id):
    return await client.post(f"{SOAW}/{soaw_id}/revise", headers=auth_headers(env["admin"]))


async def _sign(client, env, soaw_id) -> dict:
    await _request(client, env["admin"], soaw_id, [env["one"]])
    resp = await client.post(f"{SOAW}/{soaw_id}/sign", headers=auth_headers(env["one"]))
    assert resp.json()["status"] == "signed"
    return resp.json()


def _by_id(rows: list[dict]) -> dict[str, dict]:
    return {r["id"]: r for r in rows}


class TestReviseGuard:
    async def test_second_revise_is_409_until_the_open_revision_is_signed(self, client, db, env):
        first = await _signed(client, env)
        second = (await _revise(client, env, first["id"])).json()
        assert second["revision_number"] == 2

        again = await _revise(client, env, first["id"])
        assert again.status_code == 409
        assert again.json()["detail"] == {
            "error": "open_revision_exists",
            "revision_id": second["id"],
        }

        await _sign(client, env, second["id"])
        stale = await _revise(client, env, first["id"])
        assert stale.status_code == 409
        assert stale.json()["detail"] == {"error": "not_revisable", "reason": "not_latest"}

        third = await _revise(client, env, second["id"])
        assert third.status_code == 200
        assert third.json()["revision_number"] == 3
        assert third.json()["parent_id"] == second["id"]

    async def test_a_draft_revision_cannot_be_revised(self, client, db, env):
        first = await _signed(client, env)
        second = (await _revise(client, env, first["id"])).json()
        resp = await _revise(client, env, second["id"])
        assert resp.status_code == 400
        assert resp.json()["detail"] == "Only signed documents can be revised"

    async def test_numbering_follows_the_chain_maximum_after_a_legacy_gap(self, client, db, env):
        # Before rejections stopped bumping, a chain could read 1, 3.
        root = SoAW(name="Legacy", status="signed", revision_number=1, created_by=env["admin"].id)
        db.add(root)
        await db.flush()
        tip = SoAW(
            name="Legacy",
            status="signed",
            revision_number=3,
            parent_id=root.id,
            created_by=env["admin"].id,
        )
        db.add(tip)
        await db.flush()

        resp = await _revise(client, env, str(tip.id))
        assert resp.status_code == 200
        body = resp.json()
        assert body["revision_number"] == 4
        assert body["parent_id"] == str(tip.id)
        assert body["status"] == "draft"

    async def test_revise_copies_the_content_and_answers_with_chain_fields(self, client, db, env):
        doc = await _create(
            client,
            env["admin"],
            name="Copy",
            initiative_id=str(env["initiative"].id),
            sections={"scope": "v1"},
            version_history=[{"version": "1.0"}],
        )
        await _sign(client, env, doc["id"])
        resp = await _revise(client, env, doc["id"])
        body = resp.json()
        assert body["name"] == "Copy"
        assert body["initiative_id"] == str(env["initiative"].id)
        assert body["sections"] == {"scope": "v1"}
        assert body["document_info"] == {"version": "1.0"}
        assert body["version_history"] == [{"version": "1.0"}]
        assert body["created_by"] == str(env["admin"].id)
        assert body["signatories"] == []
        assert body["is_current"] is False
        assert body["is_earlier_revision"] is False
        assert body["superseded_by"] is None
        assert body["open_revision"] is None

    async def test_viewer_cannot_revise(self, client, db, env):
        first = await _signed(client, env)
        resp = await client.post(
            f"{SOAW}/{first['id']}/revise", headers=auth_headers(env["viewer"])
        )
        assert resp.status_code == 403


class TestChainFields:
    async def test_a_single_draft_is_current(self, client, db, env):
        doc = await _create(client, env["admin"])
        assert doc["is_current"] is True
        assert doc["is_earlier_revision"] is False
        assert doc["superseded_by"] is None
        assert doc["open_revision"] is None

    async def test_list_and_detail_while_a_revision_is_open(self, client, db, env):
        first = await _signed(client, env)
        second = (await _revise(client, env, first["id"])).json()

        rows = _by_id((await client.get(SOAW, headers=auth_headers(env["admin"]))).json())
        assert rows[first["id"]]["is_current"] is True
        assert rows[first["id"]]["is_earlier_revision"] is False
        assert rows[first["id"]]["superseded_by"] is None
        assert rows[first["id"]]["open_revision"] == {
            "id": second["id"],
            "name": "Doc",
            "revision_number": 2,
            "status": "draft",
        }
        assert rows[second["id"]]["is_current"] is False
        assert rows[second["id"]]["is_earlier_revision"] is False
        assert rows[second["id"]]["superseded_by"] is None
        assert rows[second["id"]]["open_revision"] is None

        detail = (
            await client.get(f"{SOAW}/{first['id']}", headers=auth_headers(env["admin"]))
        ).json()
        assert detail["open_revision"]["id"] == second["id"]
        assert detail["revisions"] == [
            {
                "id": first["id"],
                "name": "Doc",
                "revision_number": 1,
                "status": "signed",
                "signed_at": first["signed_at"],
            },
            {
                "id": second["id"],
                "name": "Doc",
                "revision_number": 2,
                "status": "draft",
                "signed_at": None,
            },
        ]

    async def test_list_and_detail_once_the_revision_is_signed(self, client, db, env):
        first = await _signed(client, env)
        second = (await _revise(client, env, first["id"])).json()
        signed_second = await _sign(client, env, second["id"])

        rows = _by_id((await client.get(SOAW, headers=auth_headers(env["viewer"]))).json())
        assert rows[first["id"]]["is_current"] is False
        assert rows[first["id"]]["is_earlier_revision"] is True
        assert rows[first["id"]]["superseded_by"] == {
            "id": second["id"],
            "name": "Doc",
            "revision_number": 2,
        }
        assert rows[first["id"]]["open_revision"] is None
        assert rows[second["id"]]["is_current"] is True
        assert rows[second["id"]]["superseded_by"] is None

        detail = (
            await client.get(f"{SOAW}/{second['id']}", headers=auth_headers(env["viewer"]))
        ).json()
        assert detail["is_current"] is True
        assert [(r["id"], r["status"]) for r in detail["revisions"]] == [
            (first["id"], "signed"),
            (second["id"], "signed"),
        ]
        assert detail["revisions"][1]["signed_at"] == signed_second["signed_at"]

    async def test_include_earlier_false_drops_only_earlier_revisions(self, client, db, env):
        first = await _signed(client, env)
        second = (await _revise(client, env, first["id"])).json()
        other = await _create(client, env["admin"], name="Other")

        open_ids = {
            r["id"]
            for r in (
                await client.get(
                    f"{SOAW}?include_earlier=false", headers=auth_headers(env["admin"])
                )
            ).json()
        }
        # The current revision and the open draft both stay.
        assert open_ids == {first["id"], second["id"], other["id"]}

        await _sign(client, env, second["id"])
        current_ids = {
            r["id"]
            for r in (
                await client.get(
                    f"{SOAW}?include_earlier=false", headers=auth_headers(env["admin"])
                )
            ).json()
        }
        assert current_ids == {second["id"], other["id"]}
        all_ids = {
            r["id"] for r in (await client.get(SOAW, headers=auth_headers(env["admin"]))).json()
        }
        assert all_ids == {first["id"], second["id"], other["id"]}

    async def test_revisions_listing_carries_chain_fields(self, client, db, env):
        first = await _signed(client, env)
        second = (await _revise(client, env, first["id"])).json()
        await _sign(client, env, second["id"])
        resp = await client.get(
            f"{SOAW}/{second['id']}/revisions", headers=auth_headers(env["one"])
        )
        rows = resp.json()
        assert [r["id"] for r in rows] == [first["id"], second["id"]]
        assert [r["is_current"] for r in rows] == [False, True]
        assert [r["is_earlier_revision"] for r in rows] == [True, False]
        assert rows[0]["sections"] == {}

    async def test_revisions_listing_survives_a_fork(self, client, db, env):
        # Legacy data: two children of one parent. (A dangling parent cannot
        # reach the database, the FK sets it NULL; the service tests cover it.)
        root = SoAW(name="Fork", status="signed", revision_number=1, created_by=env["admin"].id)
        db.add(root)
        await db.flush()
        a = SoAW(name="Fork", status="signed", revision_number=2, parent_id=root.id)
        b = SoAW(name="Fork", status="draft", revision_number=3, parent_id=root.id)
        db.add_all([a, b])
        await db.flush()

        for node in (root, a, b):
            resp = await client.get(
                f"{SOAW}/{node.id}/revisions", headers=auth_headers(env["admin"])
            )
            assert [r["id"] for r in resp.json()] == [str(root.id), str(a.id), str(b.id)]
            assert [r["is_current"] for r in resp.json()] == [False, True, False]


class TestReviewLock:
    async def _in_review(self, client, env) -> dict:
        doc = await _create(client, env["admin"], sections={"scope": "v1"})
        return await _request(client, env["admin"], doc["id"], [env["one"]])

    async def test_the_initiative_stays_editable_in_review(self, client, db, env):
        doc = await self._in_review(client, env)
        resp = await client.patch(
            f"{SOAW}/{doc['id']}",
            json={"initiative_id": str(env["initiative"].id)},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["initiative_id"] == str(env["initiative"].id)
        assert resp.json()["status"] == "in_review"

    @pytest.mark.parametrize(
        "change",
        [
            {"name": "Renamed"},
            {"sections": {"scope": "v2"}},
            {"document_info": {"version": "2.0"}},
            {"version_history": [{"version": "2.0"}]},
            {"initiative_id": None, "name": "Renamed"},
        ],
    )
    async def test_content_is_locked_in_review(self, client, db, env, change):
        doc = await self._in_review(client, env)
        resp = await client.patch(
            f"{SOAW}/{doc['id']}", json=change, headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == (
            "A document in review is locked. Recall the signature requests to edit it."
        )
        after = (await client.get(f"{SOAW}/{doc['id']}", headers=auth_headers(env["admin"]))).json()
        assert after["name"] == "Cloud Migration SoAW"
        assert after["sections"] == {"scope": "v1"}
        assert after["document_info"] == {"version": "1.0"}

    async def test_approved_is_refused_during_review(self, client, db, env):
        doc = await self._in_review(client, env)
        resp = await client.patch(
            f"{SOAW}/{doc['id']}", json={"status": "approved"}, headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 403
        after = (await client.get(f"{SOAW}/{doc['id']}", headers=auth_headers(env["admin"]))).json()
        assert after["status"] == "in_review"

    async def test_a_draft_can_be_approved_edited_and_sent(self, client, db, env):
        doc = await _create(client, env["admin"])
        approved = await client.patch(
            f"{SOAW}/{doc['id']}", json={"status": "approved"}, headers=auth_headers(env["admin"])
        )
        assert approved.status_code == 200 and approved.json()["status"] == "approved"
        edited = await client.patch(
            f"{SOAW}/{doc['id']}", json={"name": "Still open"}, headers=auth_headers(env["admin"])
        )
        assert edited.status_code == 200 and edited.json()["name"] == "Still open"
        sent = await _request(client, env["admin"], doc["id"], [env["one"]])
        assert sent["status"] == "in_review"

    async def test_signatures_cannot_be_requested_again_in_review(self, client, db, env):
        doc = await self._in_review(client, env)
        resp = await client.post(
            f"{SOAW}/{doc['id']}/request-signatures",
            json={"user_ids": [str(env["two"].id)]},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 409
        assert resp.json()["detail"] == {"error": "not_requestable"}
        after = (await client.get(f"{SOAW}/{doc['id']}", headers=auth_headers(env["admin"]))).json()
        assert [s["user_id"] for s in after["signatories"]] == [str(env["one"].id)]
        assert [t.assigned_to for t in await _open_sign_todos(db)] == [env["one"].id]

    async def test_recall_then_edit_works(self, client, db, env):
        doc = await self._in_review(client, env)
        await client.post(
            f"{SOAW}/{doc['id']}/recall-signatures", headers=auth_headers(env["admin"])
        )
        resp = await client.patch(
            f"{SOAW}/{doc['id']}", json={"name": "Renamed"}, headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 200 and resp.json()["name"] == "Renamed"


class TestDeleteDraftsOnly:
    async def test_a_draft_can_be_deleted(self, client, db, env):
        doc = await _create(client, env["admin"])
        resp = await client.delete(f"{SOAW}/{doc['id']}", headers=auth_headers(env["admin"]))
        assert resp.status_code == 204
        gone = await client.get(f"{SOAW}/{doc['id']}", headers=auth_headers(env["admin"]))
        assert gone.status_code == 404

    async def test_in_review_cannot_be_deleted(self, client, db, env):
        doc = await _create(client, env["admin"])
        await _request(client, env["admin"], doc["id"], [env["one"]])
        resp = await client.delete(f"{SOAW}/{doc['id']}", headers=auth_headers(env["admin"]))
        assert resp.status_code == 400
        assert resp.json()["detail"] == "Only draft documents can be deleted"
        still = await client.get(f"{SOAW}/{doc['id']}", headers=auth_headers(env["admin"]))
        assert still.status_code == 200

    async def test_signed_cannot_be_deleted(self, client, db, env):
        doc = await _signed(client, env)
        resp = await client.delete(f"{SOAW}/{doc['id']}", headers=auth_headers(env["admin"]))
        assert resp.status_code == 400
        assert resp.json()["detail"] == "Only draft documents can be deleted"

    async def test_approved_cannot_be_deleted(self, client, db, env):
        doc = await _create(client, env["admin"])
        await client.patch(
            f"{SOAW}/{doc['id']}", json={"status": "approved"}, headers=auth_headers(env["admin"])
        )
        resp = await client.delete(f"{SOAW}/{doc['id']}", headers=auth_headers(env["admin"]))
        assert resp.status_code == 400

    async def test_viewer_is_refused_before_the_status_check(self, client, db, env):
        doc = await _signed(client, env)
        resp = await client.delete(f"{SOAW}/{doc['id']}", headers=auth_headers(env["viewer"]))
        assert resp.status_code == 403


class TestRevisionTexts:
    async def test_a_second_revision_is_named_with_its_revision(self, client, db, env):
        first = await _signed(client, env)
        second = (await _revise(client, env, first["id"])).json()
        await _request(client, env["admin"], second["id"], [env["two"]])

        (todo,) = await _open_sign_todos(db)
        assert todo.description == 'Sign SoAW: "Doc (Rev 2)"'
        assert todo.link == f"/ea-delivery/soaw/{second['id']}"
        notes = await _notifications(db, env["two"], "soaw_sign_requested")
        assert [n.message for n in notes] == ['Ada requested your signature on "Doc (Rev 2)"']
        assert notes[0].data == {
            "soaw_id": second["id"],
            "soaw_name": "Doc",
            "revision_number": 2,
        }
        events = (
            await db.execute(select(Event).where(Event.event_type == "soaw.signatures_requested"))
        ).scalars()
        payloads = [e.data for e in events if e.data["id"] == second["id"]]
        assert payloads == [
            {"id": second["id"], "name": "Doc", "revision_number": 2, "signatory_count": 1}
        ]

    async def test_a_first_revision_is_named_plainly(self, client, db, env):
        doc = await _create(client, env["admin"], name="Plain")
        await _request(client, env["admin"], doc["id"], [env["one"]])
        (todo,) = await _open_sign_todos(db)
        assert todo.description == 'Sign SoAW: "Plain"'

    async def test_signing_closes_only_the_todo_of_this_document(self, client, db, env):
        # Two documents with the same name: matching by name closed both.
        a = await _create(client, env["admin"], name="Twin")
        b = await _create(client, env["admin"], name="Twin")
        await _request(client, env["admin"], a["id"], [env["one"]])
        await _request(client, env["admin"], b["id"], [env["one"]])
        await client.post(f"{SOAW}/{a['id']}/sign", headers=auth_headers(env["one"]))
        assert [t.link for t in await _open_sign_todos(db)] == [f"/ea-delivery/soaw/{b['id']}"]

    async def test_recall_and_reject_close_only_this_documents_todos(self, client, db, env):
        a = await _create(client, env["admin"], name="Twin")
        b = await _create(client, env["admin"], name="Twin")
        c = await _create(client, env["admin"], name="Twin")
        for doc in (a, b, c):
            await _request(client, env["admin"], doc["id"], [env["one"]])
        await client.post(f"{SOAW}/{a['id']}/recall-signatures", headers=auth_headers(env["admin"]))
        await client.post(
            f"{SOAW}/{b['id']}/reject", json={"comment": "no"}, headers=auth_headers(env["one"])
        )
        assert [t.link for t in await _open_sign_todos(db)] == [f"/ea-delivery/soaw/{c['id']}"]

    async def test_signature_and_rejection_texts_carry_the_revision(self, client, db, env):
        first = await _signed(client, env)
        second = (await _revise(client, env, first["id"])).json()
        await _request(client, env["admin"], second["id"], [env["one"], env["two"]])
        await client.post(f"{SOAW}/{second['id']}/sign", headers=auth_headers(env["one"]))
        signed_notes = await _notifications(db, env["admin"], "soaw_signed")
        assert 'One signed "Doc (Rev 2)" (1/2)' in [n.message for n in signed_notes]

        await client.post(
            f"{SOAW}/{second['id']}/reject",
            json={"comment": "Scope"},
            headers=auth_headers(env["two"]),
        )
        (rejected,) = await _notifications(db, env["admin"], "soaw_rejected")
        assert rejected.message == 'Two rejected "Doc (Rev 2)": Scope'
        assert rejected.data["revision_number"] == 2
        events = (
            await db.execute(select(Event).where(Event.event_type == "soaw.rejected"))
        ).scalars()
        assert [e.data["revision_number"] for e in events] == [2]
