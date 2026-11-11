"""The discussion of a decision, end to end (``/adr/{id}/comments``).

- Reading needs ``adr.view``; posting, replying, resolving and reopening the
  comment permission or being a signatory of the revision (a past round
  counts); editing is the author's; deleting the author's or an editor's (not
  a rejection); a comment of another document is 404.
- A rejection opens a thread with the reason; a signing note becomes a
  comment and the timeline row's note, no longer the signatory entry's.
- ``scope=chain`` lists the threads of every revision; ``open_thread_count``
  is on the detail response.
- Notifications reach exactly the document's people, carry no text, and a
  mentioned person who cannot open the decision is reported back instead.
- The ``adr.comment_added`` event is persisted before the commit, hidden
  from a reader without ``adr.view`` and declined by rollback.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import Engine, select
from sqlalchemy import event as sa_event

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.document_comment import DocumentComment
from app.models.event import Event
from app.models.notification import Notification
from app.services import mention_service, notification_service, rollback_service
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

ADR = "/api/v1/adr"


@pytest.fixture(autouse=True)
def deliveries(db, monkeypatch):
    """Stand in for the batch delivery a comment schedules after its commit.

    The real ``deliver_notification_batch`` opens its own session outside the
    test's transaction and would find no committed users; this one writes the
    bell rows it would write into the test session (no event, no e-mail) and
    records each call as ``(notif_type, recipients, actor_id)``.
    """
    calls: list[tuple[str, list[dict], object]] = []

    async def fake_deliver(recipients, *, notif_type, actor_id=None):
        calls.append((notif_type, recipients, actor_id))
        for r in recipients:
            db.add(
                Notification(
                    user_id=r["user_id"],
                    type=notif_type,
                    title=r["title"],
                    message=r["message"],
                    link=r.get("link"),
                    data=r.get("data") or {},
                    actor_id=actor_id,
                )
            )
        await db.flush()

    monkeypatch.setattr(notification_service, "deliver_notification_batch", fake_deliver)
    return calls


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_role(
        db,
        key="signer",
        label="Signer",
        permissions={"adr.view": True, "adr.sign": True, "soaw.view": True, "soaw.sign": True},
    )
    await create_role(
        db,
        key="blind",
        label="Blind",
        permissions={"inventory.view": True, "reports.ea_dashboard": True},
    )
    users = {
        "admin": await create_user(db, email="ada@t.test", role="admin", display_name="Ada"),
        "one": await create_user(db, email="one@t.test", role="member", display_name="One"),
        "two": await create_user(db, email="two@t.test", role="member", display_name="Two"),
        "three": await create_user(db, email="three@t.test", role="member", display_name="Tri"),
        "viewer": await create_user(db, email="vic@t.test", role="viewer", display_name="Vic"),
        "signer": await create_user(db, email="sig@t.test", role="signer", display_name="Sig"),
        "blind": await create_user(db, email="bea@t.test", role="blind", display_name="Bea"),
    }
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="Billing")
    return {
        "users": users,
        "ids": {k: str(u.id) for k, u in users.items()},
        "h": {k: auth_headers(u) for k, u in users.items()},
        "card": card,
    }


async def _adr(client, env, who="admin", **fields) -> dict:
    resp = await client.post(ADR, json={"title": "Use Postgres", **fields}, headers=env["h"][who])
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _call(client, env, method, path, who="admin", json=None, status=None, **kw):
    resp = await client.request(method, path, json=json, headers=env["h"][who], **kw)
    if status is None:
        status = 204 if method == "DELETE" else 200
    assert resp.status_code == status, resp.text
    return resp.json() if resp.content else None


async def _post(client, env, adr_id, body="<p>Hello</p>", who="one", status=201, **extra):
    return await _call(
        client,
        env,
        "POST",
        f"{ADR}/{adr_id}/comments",
        who=who,
        json={"body": body, **extra},
        status=status,
    )


async def _list(client, env, adr_id, who="admin", **params) -> dict:
    return await _call(client, env, "GET", f"{ADR}/{adr_id}/comments", who=who, params=params)


async def _request(client, env, adr_id, *signers):
    await _call(
        client,
        env,
        "POST",
        f"{ADR}/{adr_id}/request-signatures",
        json={"user_ids": [env["ids"][s] for s in signers]},
    )


def _detail(resp: dict) -> object:
    return resp["detail"]


# ---------------------------------------------------------------------------
# Posting and reading
# ---------------------------------------------------------------------------


class TestPostAndRead:
    async def test_a_member_starts_a_thread(self, client, env):
        adr = await _adr(client, env)
        thread = await _post(client, env, adr["id"], section="context")
        assert thread["created_at"] is not None
        assert thread == {
            "id": thread["id"],
            "kind": "comment",
            "section": "context",
            "revision_id": adr["id"],
            "revision_number": 1,
            "author": {"id": env["ids"]["one"], "display_name": "One"},
            "author_name": "One",
            "body": "<p>Hello</p>",
            "created_at": thread["created_at"],
            "edited_at": None,
            "deleted": False,
            "resolved_at": None,
            "resolved_by": None,
            "can": {"edit": True, "delete": True, "resolve": True},
            "replies": [],
            "unnotified_mentions": [],
        }
        listing = await _list(client, env, adr["id"], who="viewer")
        assert listing["can"] == {"comment": False, "moderate": False}
        assert listing["open_count"] == 1
        (only,) = listing["threads"]
        assert only["id"] == thread["id"]
        assert only["can"] == {"edit": False, "delete": False, "resolve": False}
        assert "unnotified_mentions" not in only

    async def test_a_viewer_reads_but_may_not_post(self, client, env):
        adr = await _adr(client, env)
        resp = await _post(client, env, adr["id"], who="viewer", status=403)
        assert _detail(resp) == "You may not comment on this document"
        assert (await _list(client, env, adr["id"], who="viewer"))["threads"] == []

    async def test_without_adr_view(self, client, env):
        adr = await _adr(client, env)
        thread = await _post(client, env, adr["id"])
        base = f"{ADR}/{adr['id']}/comments"
        for method, path, json in (
            ("GET", base, None),
            ("POST", base, {"body": "<p>x</p>"}),
            ("PATCH", f"{base}/{thread['id']}", {"body": "<p>x</p>"}),
            ("DELETE", f"{base}/{thread['id']}", None),
            ("POST", f"{base}/{thread['id']}/resolve", None),
            ("POST", f"{base}/{thread['id']}/reopen", None),
        ):
            resp = await _call(client, env, method, path, who="blind", json=json, status=403)
            assert _detail(resp) == "Insufficient permissions"

    @pytest.mark.parametrize(
        "doc_id", [str(uuid.uuid4()), "not-a-uuid"], ids=["unknown", "malformed"]
    )
    async def test_an_unknown_decision_is_404(self, client, env, doc_id):
        for method, path, json in (
            ("GET", f"{ADR}/{doc_id}/comments", None),
            ("POST", f"{ADR}/{doc_id}/comments", {"body": "<p>x</p>"}),
            ("DELETE", f"{ADR}/{doc_id}/comments/{uuid.uuid4()}", None),
        ):
            resp = await _call(client, env, method, path, json=json, status=404)
            assert _detail(resp) == "Architecture decision not found"

    async def test_a_signatory_without_the_comment_permission_may_post(self, client, env):
        adr = await _adr(client, env)
        await _post(client, env, adr["id"], who="signer", status=403)
        await _request(client, env, adr["id"], "signer")
        assert (await _list(client, env, adr["id"], who="signer"))["can"] == {
            "comment": True,
            "moderate": False,
        }
        thread = await _post(client, env, adr["id"], who="signer")
        assert thread["author"] == {"id": env["ids"]["signer"], "display_name": "Sig"}
        # The right outlives a recall: the review round is on the timeline.
        await _call(client, env, "POST", f"{ADR}/{adr['id']}/recall-signatures")
        await _post(client, env, adr["id"], who="signer")
        # A viewer who was never asked still may not.
        await _post(client, env, adr["id"], who="viewer", status=403)

    async def test_a_past_signatory_of_a_rejected_round_may_post(self, client, env):
        adr = await _adr(client, env)
        await _request(client, env, adr["id"], "signer", "viewer")
        await _call(
            client, env, "POST", f"{ADR}/{adr['id']}/reject", who="signer", json={"comment": ""}
        )
        await _post(client, env, adr["id"], who="viewer")

    async def test_posting_works_in_draft_review_and_after_signing(self, client, env):
        adr = await _adr(client, env)
        await _post(client, env, adr["id"], body="<p>draft</p>")
        await _request(client, env, adr["id"], "one")
        await _post(client, env, adr["id"], body="<p>review</p>")
        await _call(client, env, "POST", f"{ADR}/{adr['id']}/sign", who="one")
        await _post(client, env, adr["id"], body="<p>signed</p>")
        listing = await _list(client, env, adr["id"])
        assert [t["body"] for t in listing["threads"]] == [
            "<p>draft</p>",
            "<p>review</p>",
            "<p>signed</p>",
        ]
        assert listing["open_count"] == 3

    async def test_a_reply(self, client, env):
        adr = await _adr(client, env)
        top = await _post(client, env, adr["id"], section="decision")
        thread = await _post(
            client, env, adr["id"], body="<p>Agreed</p>", who="two", parent_id=top["id"]
        )
        assert thread["id"] == top["id"]
        (reply,) = thread["replies"]
        assert (reply["body"], reply["section"], reply["author_name"]) == (
            "<p>Agreed</p>",
            "decision",
            "Two",
        )
        assert reply["can"] == {"edit": True, "delete": True, "resolve": False}
        assert "replies" not in reply
        listing = await _list(client, env, adr["id"])
        assert [len(t["replies"]) for t in listing["threads"]] == [1]
        assert listing["open_count"] == 1

    async def test_rejected_input(self, client, env):
        adr = await _adr(client, env)
        other = await _adr(client, env, title="Other")
        top = await _post(client, env, adr["id"])
        reply = await _post(client, env, adr["id"], parent_id=top["id"])
        foreign = await _post(client, env, other["id"])
        cases = [
            ({"body": "<p> </p>"}, 400, "A comment needs some text"),
            ({"body": "<p>x</p>", "section": "intro"}, 400, "Unknown section"),
            ({"body": "x" * 20001}, 400, "A comment is longer than 20000 characters"),
            (
                {"body": "<p>x</p>", "parent_id": reply["replies"][0]["id"]},
                400,
                "A reply must answer a thread of this document",
            ),
            (
                {"body": "<p>x</p>", "parent_id": foreign["id"]},
                400,
                "A reply must answer a thread of this document",
            ),
            (
                {"body": "<p>x</p>", "parent_id": "nope"},
                400,
                "A reply must answer a thread of this document",
            ),
            (
                {"body": "<p>x</p>", "parent_id": str(uuid.uuid4())},
                400,
                "A reply must answer a thread of this document",
            ),
        ]
        for json, status, detail in cases:
            resp = await _call(
                client, env, "POST", f"{ADR}/{adr['id']}/comments", json=json, status=status
            )
            assert _detail(resp) == detail, json
        await _call(
            client,
            env,
            "POST",
            f"{ADR}/{adr['id']}/comments",
            json={"body": "x", "extra": 1},
            status=422,
        )
        await _call(
            client,
            env,
            "GET",
            f"{ADR}/{adr['id']}/comments",
            params={"scope": "everything"},
            status=422,
        )

    async def test_the_body_is_cleaned(self, client, env, db):
        adr = await _adr(client, env)
        thread = await _post(
            client, env, adr["id"], body='<p onclick="x()">Hi <script>alert(1)</script></p>'
        )
        expected = '&lt;p onclick="x()"&gt;Hi &lt;script&gt;alert(1)&lt;/script&gt;</p>'
        assert thread["body"] == expected
        stored = await db.get(DocumentComment, uuid.UUID(thread["id"]))
        assert stored.body == expected


# ---------------------------------------------------------------------------
# Edit, delete, resolve
# ---------------------------------------------------------------------------


class TestEdit:
    async def test_the_author_edits(self, client, env):
        adr = await _adr(client, env)
        top = await _post(client, env, adr["id"])
        reply = (await _post(client, env, adr["id"], who="two", parent_id=top["id"]))["replies"][0]
        path = f"{ADR}/{adr['id']}/comments/{reply['id']}"
        thread = await _call(client, env, "PATCH", path, who="two", json={"body": "<p>New</p>"})
        assert thread["id"] == top["id"]
        assert thread["unnotified_mentions"] == []
        (edited,) = thread["replies"]
        assert edited["body"] == "<p>New</p>"
        assert edited["edited_at"] is not None
        assert thread["edited_at"] is None

    async def test_refusals(self, client, env):
        adr = await _adr(client, env)
        other = await _adr(client, env, title="Other")
        top = await _post(client, env, adr["id"])
        foreign = await _post(client, env, other["id"])
        base = f"{ADR}/{adr['id']}/comments"
        resp = await _call(
            client, env, "PATCH", f"{base}/{top['id']}", who="two", json={"body": "x"}, status=403
        )
        assert _detail(resp) == "Only the author may edit a comment"
        for comment_id in (foreign["id"], str(uuid.uuid4()), "bad"):
            resp = await _call(
                client,
                env,
                "PATCH",
                f"{base}/{comment_id}",
                who="one",
                json={"body": "x"},
                status=404,
            )
            assert _detail(resp) == "Comment not found"
        resp = await _call(
            client, env, "PATCH", f"{base}/{top['id']}", who="one", json={"body": ""}, status=400
        )
        assert _detail(resp) == "A comment needs some text"
        await _call(client, env, "DELETE", f"{base}/{top['id']}", who="one")
        resp = await _call(
            client, env, "PATCH", f"{base}/{top['id']}", who="one", json={"body": "x"}, status=409
        )
        assert _detail(resp) == "This comment has been deleted"

    async def test_a_rejection_and_a_sign_note_are_not_editable(self, client, env):
        adr = await _adr(client, env)
        await _request(client, env, adr["id"], "one", "two")
        await _call(
            client, env, "POST", f"{ADR}/{adr['id']}/sign", who="two", json={"comment": "Fine"}
        )
        await _call(
            client, env, "POST", f"{ADR}/{adr['id']}/reject", who="one", json={"comment": "No"}
        )
        threads = (await _list(client, env, adr["id"]))["threads"]
        assert [(t["kind"], t["author_name"]) for t in threads] == [
            ("sign_note", "Two"),
            ("rejection", "One"),
        ]
        for thread, who in zip(threads, ("two", "one"), strict=True):
            resp = await _call(
                client,
                env,
                "PATCH",
                f"{ADR}/{adr['id']}/comments/{thread['id']}",
                who=who,
                json={"body": "<p>x</p>"},
                status=403,
            )
            assert _detail(resp) == "A signing note or a rejection reason cannot be edited"


class TestDelete:
    async def test_soft_delete_keeps_the_thread(self, client, env, db):
        adr = await _adr(client, env)
        top = await _post(client, env, adr["id"])
        await _post(client, env, adr["id"], who="two", parent_id=top["id"])
        resp = await client.delete(
            f"{ADR}/{adr['id']}/comments/{top['id']}", headers=env["h"]["one"]
        )
        assert (resp.status_code, resp.content) == (204, b"")
        listing = await _list(client, env, adr["id"])
        (thread,) = listing["threads"]
        assert (thread["deleted"], thread["body"], len(thread["replies"])) == (True, "", 1)
        assert thread["can"] == {"edit": False, "delete": False, "resolve": False}
        assert listing["open_count"] == 0
        stored = await db.get(DocumentComment, uuid.UUID(top["id"]))
        assert (stored.body, stored.deleted_at is not None) == ("", True)
        resp = await _call(
            client,
            env,
            "DELETE",
            f"{ADR}/{adr['id']}/comments/{top['id']}",
            who="one",
            status=409,
        )
        assert _detail(resp) == "This comment has already been deleted"

    async def test_who_may_delete(self, client, env):
        adr = await _adr(client, env)
        mine = await _post(client, env, adr["id"], who="one")
        path = f"{ADR}/{adr['id']}/comments/{mine['id']}"
        await _request(client, env, adr["id"], "signer")
        resp = await _call(client, env, "DELETE", path, who="signer", status=403)
        assert _detail(resp) == "Only the author or an editor may delete a comment"
        # An editor (adr.manage) moderates a plain comment.
        await _call(client, env, "DELETE", path, who="two")
        other = await _adr(client, env, title="Other")
        foreign = await _post(client, env, other["id"])
        resp = await _call(
            client,
            env,
            "DELETE",
            f"{ADR}/{adr['id']}/comments/{foreign['id']}",
            status=404,
        )
        assert _detail(resp) == "Comment not found"

    async def test_a_moderator_cannot_delete_a_rejection(self, client, env):
        adr = await _adr(client, env)
        await _request(client, env, adr["id"], "one")
        await _call(
            client, env, "POST", f"{ADR}/{adr['id']}/reject", who="one", json={"comment": "No"}
        )
        (rejection,) = (await _list(client, env, adr["id"]))["threads"]
        assert rejection["can"] == {"edit": False, "delete": False, "resolve": True}
        path = f"{ADR}/{adr['id']}/comments/{rejection['id']}"
        resp = await _call(client, env, "DELETE", path, who="admin", status=403)
        assert _detail(resp) == "A rejection reason is resolved, not deleted"
        await _call(client, env, "DELETE", path, who="one")


class TestDeletedThreads:
    """A thread whose first comment is deleted is closed to replies, resolve
    and reopen; it stays listed, in either scope, and never counts as open."""

    async def _delete(self, client, env, adr_id, comment_id, who="admin"):
        await _call(client, env, "DELETE", f"{ADR}/{adr_id}/comments/{comment_id}", who=who)

    async def test_a_reply_to_a_closed_thread_is_409(self, client, env):
        adr = await _adr(client, env)
        top = await _post(client, env, adr["id"])
        await _post(client, env, adr["id"], who="two", parent_id=top["id"])
        await self._delete(client, env, adr["id"], top["id"], who="one")
        resp = await _post(client, env, adr["id"], who="two", parent_id=top["id"], status=409)
        assert _detail(resp) == "This thread's first comment was deleted"
        # The comment right is still checked first.
        resp = await _post(client, env, adr["id"], who="viewer", parent_id=top["id"], status=403)
        assert _detail(resp) == "You may not comment on this document"
        (thread,) = (await _list(client, env, adr["id"]))["threads"]
        assert len(thread["replies"]) == 1
        # Resolving or reopening a closed thread stays refused.
        for action in ("resolve", "reopen"):
            resp = await _call(
                client,
                env,
                "POST",
                f"{ADR}/{adr['id']}/comments/{top['id']}/{action}",
                status=409,
            )
            assert _detail(resp) == "This comment has been deleted"

    async def test_a_reply_to_a_live_thread_still_posts(self, client, env):
        adr = await _adr(client, env)
        top = await _post(client, env, adr["id"])
        thread = await _post(client, env, adr["id"], who="two", parent_id=top["id"])
        assert (thread["deleted"], len(thread["replies"])) == (False, 1)

    async def test_a_closed_thread_keeps_its_live_reply(self, client, env):
        adr = await _adr(client, env)
        top = await _post(client, env, adr["id"], section="decision")
        reply = await _post(
            client, env, adr["id"], body="<p>Still here</p>", who="two", parent_id=top["id"]
        )
        await self._delete(client, env, adr["id"], top["id"], who="one")
        listing = await _list(client, env, adr["id"])
        (thread,) = listing["threads"]
        assert (thread["id"], thread["deleted"], thread["body"], thread["section"]) == (
            top["id"],
            True,
            "",
            "decision",
        )
        assert [(r["body"], r["deleted"]) for r in thread["replies"]] == [
            ("<p>Still here</p>", False)
        ]
        assert listing["open_count"] == 0
        # The author of the live reply still edits it inside the closed thread.
        reply_id = reply["replies"][0]["id"]
        edited = await _call(
            client,
            env,
            "PATCH",
            f"{ADR}/{adr['id']}/comments/{reply_id}",
            who="two",
            json={"body": "<p>Edited</p>"},
        )
        assert edited["replies"][0]["body"] == "<p>Edited</p>"

    async def test_a_thread_with_nothing_live_stays_listed(self, client, env):
        adr = await _adr(client, env)
        alone = await _post(client, env, adr["id"], body="<p>alone</p>")
        top = await _post(client, env, adr["id"], body="<p>top</p>")
        reply = await _post(client, env, adr["id"], who="two", parent_id=top["id"])
        kept = await _post(client, env, adr["id"], body="<p>kept</p>")
        await self._delete(client, env, adr["id"], alone["id"], who="one")
        await self._delete(client, env, adr["id"], top["id"], who="one")
        await self._delete(client, env, adr["id"], reply["replies"][0]["id"], who="two")
        for scope in ("document", "chain"):
            listing = await _list(client, env, adr["id"], scope=scope)
            assert [
                (t["id"], t["deleted"], t["body"], [r["deleted"] for r in t["replies"]])
                for t in listing["threads"]
            ] == [
                (alone["id"], True, "", []),
                (top["id"], True, "", [True]),
                (kept["id"], False, "<p>kept</p>", []),
            ]
            assert listing["open_count"] == 1
        detail = await _call(client, env, "GET", f"{ADR}/{adr['id']}")
        assert detail["open_thread_count"] == 1

    async def test_reading_still_needs_adr_view(self, client, env):
        adr = await _adr(client, env)
        resp = await _call(
            client, env, "GET", f"{ADR}/{adr['id']}/comments", who="blind", status=403
        )
        assert "detail" in resp


class TestResolve:
    async def test_resolve_and_reopen(self, client, env):
        adr = await _adr(client, env)
        top = await _post(client, env, adr["id"])
        base = f"{ADR}/{adr['id']}/comments/{top['id']}"
        resolved = await _call(client, env, "POST", f"{base}/resolve", who="two")
        assert resolved["resolved_by"] == {"id": env["ids"]["two"], "display_name": "Two"}
        assert resolved["resolved_at"] is not None
        assert "unnotified_mentions" not in resolved
        assert (await _list(client, env, adr["id"]))["open_count"] == 0
        again = await _call(client, env, "POST", f"{base}/resolve", who="one")
        assert again["resolved_by"] == resolved["resolved_by"]
        reopened = await _call(client, env, "POST", f"{base}/reopen", who="one")
        assert (reopened["resolved_at"], reopened["resolved_by"]) == (None, None)
        assert (await _list(client, env, adr["id"]))["open_count"] == 1

    async def test_refusals(self, client, env):
        adr = await _adr(client, env)
        top = await _post(client, env, adr["id"])
        reply = (await _post(client, env, adr["id"], parent_id=top["id"]))["replies"][0]
        base = f"{ADR}/{adr['id']}/comments"
        resp = await _call(
            client, env, "POST", f"{base}/{top['id']}/resolve", who="viewer", status=403
        )
        assert _detail(resp) == "You may not comment on this document"
        for action in ("resolve", "reopen"):
            resp = await _call(client, env, "POST", f"{base}/{reply['id']}/{action}", status=400)
            assert _detail(resp) == "Only a thread can be resolved or reopened"
        await _request(client, env, adr["id"], "one")
        await _call(
            client, env, "POST", f"{ADR}/{adr['id']}/sign", who="one", json={"comment": "ok"}
        )
        note = next(
            t for t in (await _list(client, env, adr["id"]))["threads"] if t["kind"] == "sign_note"
        )
        resp = await _call(client, env, "POST", f"{base}/{note['id']}/resolve", status=400)
        assert _detail(resp) == "A signing note is not a thread to resolve"
        await _call(client, env, "DELETE", f"{base}/{top['id']}", who="one")
        resp = await _call(client, env, "POST", f"{base}/{top['id']}/resolve", status=409)
        assert _detail(resp) == "This comment has been deleted"


# ---------------------------------------------------------------------------
# Workflow: rejection threads and signing notes
# ---------------------------------------------------------------------------


class TestWorkflow:
    async def _timeline(self, client, env, adr_id):
        resp = await client.get(f"{ADR}/{adr_id}/history", headers=env["h"]["admin"])
        # The API answers newest first; read it in the order things happened.
        return [(e["kind"], e["actor_name"], e["note"]) for e in reversed(resp.json()["entries"])]

    async def test_a_rejection_opens_a_thread(self, client, env):
        adr = await _adr(client, env)
        await _request(client, env, adr["id"], "one")
        await _call(
            client,
            env,
            "POST",
            f"{ADR}/{adr['id']}/reject",
            who="one",
            json={"comment": "Needs <numbers>\nand costs"},
        )
        listing = await _list(client, env, adr["id"])
        (thread,) = listing["threads"]
        assert (thread["kind"], thread["body"], thread["author_name"], thread["section"]) == (
            "rejection",
            "<p>Needs &lt;numbers&gt;</p><p>and costs</p>",
            "One",
            None,
        )
        assert (thread["resolved_at"], listing["open_count"]) == (None, 1)
        assert ("rejected", "One", "Needs <numbers>\nand costs") in await self._timeline(
            client, env, adr["id"]
        )
        detail = await _call(client, env, "GET", f"{ADR}/{adr['id']}")
        assert detail["open_thread_count"] == 1

    async def test_an_empty_reason_opens_an_empty_thread(self, client, env):
        adr = await _adr(client, env)
        await _request(client, env, adr["id"], "one")
        await _call(
            client, env, "POST", f"{ADR}/{adr['id']}/reject", who="one", json={"comment": ""}
        )
        (thread,) = (await _list(client, env, adr["id"]))["threads"]
        assert (thread["kind"], thread["body"]) == ("rejection", "")

    async def test_a_signing_note_becomes_a_comment(self, client, env, db):
        adr = await _adr(client, env)
        await _request(client, env, adr["id"], "one", "two")
        signed = await _call(
            client, env, "POST", f"{ADR}/{adr['id']}/sign", who="one", json={"comment": "Go"}
        )
        assert [s for s in signed["signatories"] if "comment" in s] == []
        assert signed["open_thread_count"] == 0
        await _call(client, env, "POST", f"{ADR}/{adr['id']}/sign", who="two")
        listing = await _list(client, env, adr["id"])
        assert [(t["kind"], t["body"], t["author_name"]) for t in listing["threads"]] == [
            ("sign_note", "<p>Go</p>", "One")
        ]
        assert listing["open_count"] == 0
        timeline = await self._timeline(client, env, adr["id"])
        assert [row for row in timeline if row[0] == "signature"] == [
            ("signature", "One", "Go"),
            ("signature", "Two", None),
        ]

    async def test_a_recall_keeps_the_note(self, client, env):
        adr = await _adr(client, env)
        await _request(client, env, adr["id"], "one", "two")
        await _call(
            client, env, "POST", f"{ADR}/{adr['id']}/sign", who="one", json={"comment": "Go"}
        )
        await _call(client, env, "POST", f"{ADR}/{adr['id']}/recall-signatures")
        threads = (await _list(client, env, adr["id"]))["threads"]
        assert [(t["kind"], t["body"]) for t in threads] == [("sign_note", "<p>Go</p>")]

    async def test_open_thread_count_on_the_detail(self, client, env):
        adr = await _adr(client, env)
        assert adr["open_thread_count"] == 0
        first = await _post(client, env, adr["id"])
        await _post(client, env, adr["id"])
        await _post(client, env, adr["id"], parent_id=first["id"])
        assert (await _call(client, env, "GET", f"{ADR}/{adr['id']}"))["open_thread_count"] == 2
        await _call(client, env, "POST", f"{ADR}/{adr['id']}/comments/{first['id']}/resolve")
        assert (await _call(client, env, "GET", f"{ADR}/{adr['id']}"))["open_thread_count"] == 1
        rows = await _call(client, env, "GET", ADR)
        items = rows if isinstance(rows, list) else rows["items"]
        assert all("open_thread_count" not in row for row in items)


# ---------------------------------------------------------------------------
# Revisions
# ---------------------------------------------------------------------------


class TestChain:
    async def test_threads_across_revisions(self, client, env):
        adr = await _adr(client, env)
        old = await _post(client, env, adr["id"], body="<p>old</p>")
        await _request(client, env, adr["id"], "viewer")
        await _call(client, env, "POST", f"{ADR}/{adr['id']}/recall-signatures")
        await _request(client, env, adr["id"], "one")
        await _call(client, env, "POST", f"{ADR}/{adr['id']}/sign", who="one")
        rev = await _call(client, env, "POST", f"{ADR}/{adr['id']}/revise")
        new = await _post(client, env, rev["id"], body="<p>new</p>")

        mine = await _list(client, env, rev["id"])
        assert [t["id"] for t in mine["threads"]] == [new["id"]]
        chain = await _list(client, env, rev["id"], scope="chain")
        assert [(t["id"], t["revision_id"], t["revision_number"]) for t in chain["threads"]] == [
            (old["id"], adr["id"], 1),
            (new["id"], rev["id"], 2),
        ]
        assert chain["open_count"] == 1
        # The viewer was asked to sign revision 1 only: its thread is theirs
        # to resolve, revision 2's is not.
        as_viewer = await _list(client, env, rev["id"], who="viewer", scope="chain")
        assert as_viewer["can"] == {"comment": False, "moderate": False}
        assert [t["can"]["resolve"] for t in as_viewer["threads"]] == [True, False]
        # A thread is changed through its own revision only.
        resp = await _call(
            client,
            env,
            "POST",
            f"{ADR}/{rev['id']}/comments/{old['id']}/resolve",
            status=404,
        )
        assert _detail(resp) == "Comment not found"
        await _call(
            client, env, "POST", f"{ADR}/{adr['id']}/comments/{old['id']}/resolve", who="viewer"
        )
        # The earlier revision's scope=chain answer is the same list.
        from_old = await _list(client, env, adr["id"], scope="chain")
        assert [t["id"] for t in from_old["threads"]] == [old["id"], new["id"]]
        assert from_old["open_count"] == 0


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


def _mention(user_id) -> str:
    return f'<span data-type="mention" data-kind="user" data-id="{user_id}">@x</span>'


async def _notes(db, notif_type, comment_id=None):
    rows = await db.execute(
        select(Notification).where(Notification.type == notif_type).order_by(Notification.id)
    )
    return [
        n
        for n in rows.scalars().all()
        if comment_id is None or n.data.get("comment_id") == comment_id
    ]


class TestNotifications:
    async def _setup(self, client, env):
        adr = await _adr(
            client,
            env,
            decision_makers=[{"user_id": env["ids"]["one"]}, {"name": "Outside"}],
            participants=[{"user_id": env["ids"]["two"]}],
        )
        await _request(client, env, adr["id"], "signer")
        await _call(client, env, "POST", f"{ADR}/{adr['id']}/recall-signatures")
        earlier = await _post(client, env, adr["id"], who="three")
        return adr, earlier

    async def test_exact_recipients_and_no_text(self, client, env, db):
        adr, _ = await self._setup(client, env)
        body = (
            f"<p>Secret words {_mention(env['ids']['viewer'])} {_mention(env['ids']['blind'])}</p>"
        )
        thread = await _post(client, env, adr["id"], body=body, who="two")
        assert thread["unnotified_mentions"] == [{"id": env["ids"]["blind"], "display_name": "Bea"}]
        mentions = await _notes(db, "document_mention")
        assert [(n.user_id, n.actor_id) for n in mentions] == [
            (env["users"]["viewer"].id, env["users"]["two"].id)
        ]
        comments = await _notes(db, "document_comment", thread["id"])
        # Earlier commenter (Tri) and the creator (Ada), signatory of a past
        # round (Sig), decision maker (One); not the actor (Two, a
        # participant) nor the mentioned viewer (Vic).
        recipients = {n.user_id for n in comments}
        assert recipients == {env["users"][k].id for k in ("admin", "signer", "one", "three")}
        label = f"{adr['reference_number']} — Use Postgres"
        link = f"/ea-delivery/adr/{adr['id']}/preview?thread={thread['id']}"
        data = {
            "doc_kind": "adr",
            "doc_id": adr["id"],
            "comment_id": thread["id"],
            "thread_id": thread["id"],
        }
        for note in comments:
            assert (note.title, note.message, note.link, note.data, note.actor_id) == (
                f'New comment on "{label}"',
                f'Two commented on "{label}"',
                link,
                data,
                env["users"]["two"].id,
            )
        (mention,) = mentions
        assert (mention.title, mention.message, mention.link, mention.data) == (
            f'Mentioned on "{label}"',
            f'Two mentioned you in the discussion of "{label}"',
            link,
            data,
        )
        for note in [*comments, *mentions]:
            assert "Secret" not in note.message + note.title + str(note.data)

    async def test_a_reply_links_to_its_thread(self, client, env, db):
        adr, earlier = await self._setup(client, env)
        thread = await _post(client, env, adr["id"], who="one", parent_id=earlier["id"])
        reply_id = thread["replies"][0]["id"]
        comments = await _notes(db, "document_comment", reply_id)
        assert {n.user_id for n in comments} == {
            env["users"][k].id for k in ("admin", "signer", "two", "three")
        }
        note = comments[0]
        assert note.link == f"/ea-delivery/adr/{adr['id']}/preview?thread={earlier['id']}"
        assert note.data == {
            "doc_kind": "adr",
            "doc_id": adr["id"],
            "comment_id": reply_id,
            "thread_id": earlier["id"],
        }
        assert note.title.startswith("New reply on ")

    async def test_an_edit_notifies_new_mentions_only(self, client, env, db):
        adr, _ = await self._setup(client, env)
        thread = await _post(
            client, env, adr["id"], body=f"<p>{_mention(env['ids']['viewer'])}</p>", who="two"
        )
        before = len(await _notes(db, "document_comment"))
        body = f"<p>{_mention(env['ids']['viewer'])}{_mention(env['ids']['one'])}</p>"
        edited = await _call(
            client,
            env,
            "PATCH",
            f"{ADR}/{adr['id']}/comments/{thread['id']}",
            who="two",
            json={"body": body},
        )
        assert edited["unnotified_mentions"] == []
        mentions = await _notes(db, "document_mention")
        assert sorted(str(n.user_id) for n in mentions) == sorted(
            [env["ids"]["viewer"], env["ids"]["one"]]
        )
        assert len(await _notes(db, "document_comment")) == before

    async def test_delivered_after_the_commit_never_inline(
        self, client, env, publish_commit_log, monkeypatch
    ):
        adr, _ = await self._setup(client, env)
        calls = []

        async def fake_deliver(recipients, *, notif_type, actor_id=None):
            ids = sorted(str(r["user_id"]) for r in recipients)
            calls.append((notif_type, publish_commit_log[-1], ids, actor_id))

        inline = []

        async def no_inline(*args, **kwargs):
            inline.append(kwargs.get("notif_type"))

        monkeypatch.setattr(notification_service, "deliver_notification_batch", fake_deliver)
        monkeypatch.setattr(notification_service, "create_notification", no_inline)
        publish_commit_log.clear()
        await _post(
            client, env, adr["id"], body=f"<p>{_mention(env['ids']['viewer'])}</p>", who="two"
        )
        two = env["users"]["two"].id
        assert inline == []
        assert calls == [
            ("document_mention", ("commit",), [env["ids"]["viewer"]], two),
            (
                "document_comment",
                ("commit",),
                sorted(env["ids"][k] for k in ("admin", "signer", "one", "three")),
                two,
            ),
        ]

    async def test_an_over_long_body_is_refused_before_it_is_read(self, client, env, monkeypatch):
        adr = await _adr(client, env)
        thread = await _post(client, env, adr["id"])

        def boom(*args, **kwargs):
            raise AssertionError("the body was read")

        monkeypatch.setattr(mention_service, "restore_tokens", boom)
        monkeypatch.setattr(mention_service, "canonicalise", boom)
        long = _mention(env["ids"]["viewer"]) * 600
        assert 40_000 < len(long) <= 100_000
        for method, path in (
            ("POST", f"{ADR}/{adr['id']}/comments"),
            ("PATCH", f"{ADR}/{adr['id']}/comments/{thread['id']}"),
        ):
            resp = await _call(
                client, env, method, path, who="one", json={"body": long}, status=400
            )
            assert _detail(resp) == "A comment is longer than 20000 characters"

    async def test_a_mention_of_an_unknown_person_is_refused(self, client, env):
        adr = await _adr(client, env)
        resp = await _post(client, env, adr["id"], body=_mention(uuid.uuid4()), status=404)
        assert _detail(resp) == "User not found"


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------


class TestEvents:
    async def test_persisted_before_the_commit_without_the_body(
        self, client, env, db, publish_commit_log
    ):
        adr = await _adr(client, env)
        publish_commit_log.clear()
        thread = await _post(client, env, adr["id"], body="<p>Private words</p>", section="context")
        assert publish_commit_log[-1] == ("commit",)
        assert ("publish", "adr.comment_added", True) in publish_commit_log
        assert (
            publish_commit_log.index(("publish", "adr.comment_added", True))
            < len(publish_commit_log) - 1
        )
        (event,) = (
            (await db.execute(select(Event).where(Event.event_type == "adr.comment_added")))
            .scalars()
            .all()
        )
        assert event.data == {
            "id": adr["id"],
            "comment_id": thread["id"],
            "kind": "comment",
            "section": "context",
            "revision_number": 1,
        }
        assert event.user_id == env["users"]["one"].id
        (op,) = rollback_service.plan_ops([event])
        assert (op["op"], op["reason"]) == (
            "unsupported",
            "adr.comment_added is not reversed: "
            "A posted comment has been read; delete it from the discussion.",
        )

    async def test_hidden_from_a_reader_without_adr_view(self, client, env):
        adr = await _adr(client, env)
        await _post(client, env, adr["id"])

        async def _types(who):
            resp = await client.get("/api/v1/reports/dashboard", headers=env["h"][who])
            assert resp.status_code == 200, resp.text
            return {row["event_type"] for row in resp.json()["recent_events"]}

        assert "adr.comment_added" in await _types("admin")
        assert "adr.comment_added" not in await _types("blind")

    async def test_no_event_for_a_rejection_thread(self, client, env, db):
        adr = await _adr(client, env)
        await _request(client, env, adr["id"], "one")
        await _call(
            client, env, "POST", f"{ADR}/{adr['id']}/reject", who="one", json={"comment": "No"}
        )
        rows = await db.execute(select(Event).where(Event.event_type == "adr.comment_added"))
        assert rows.scalars().all() == []


# ---------------------------------------------------------------------------
# Query count
# ---------------------------------------------------------------------------


@pytest.fixture
def sql_count():
    statements: list[str] = []

    def _capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    sa_event.listen(Engine, "before_cursor_execute", _capture)
    yield statements
    sa_event.remove(Engine, "before_cursor_execute", _capture)


class TestQueryCount:
    async def test_constant_whatever_the_number_of_comments(self, client, env, sql_count):
        adr = await _adr(client, env)
        card = f'<span data-type="mention" data-kind="card" data-id="{env["card"].id}"></span>'

        async def _count():
            sql_count.clear()
            await _list(client, env, adr["id"], who="viewer", scope="chain")
            # Savepoints come and go with the test's transaction: queries only.
            return len([q for q in sql_count if q.lstrip().upper().startswith("SELECT")])

        async def _add(n):
            for _ in range(n):
                top = await _post(
                    client, env, adr["id"], body=f"<p>{card}{_mention(env['ids']['two'])}</p>"
                )
                await _post(client, env, adr["id"], who="two", parent_id=top["id"])

        await _add(1)
        await _count()  # warm the permission caches
        few = await _count()
        await _add(4)
        assert await _count() == few
