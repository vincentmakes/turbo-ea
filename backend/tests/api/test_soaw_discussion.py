"""The discussion of a Statement of Architecture Work (``/soaw/{id}/comments``).

The rules are the decision's (``test_adr_discussion.py``) on ``soaw.*``
permissions; this file covers every route for SoAWs and what is SoAW-only:

- signing takes an optional ``{note}`` body: a ``sign_note`` comment and the
  signature timeline row's note;
- rejecting is open to a signatory holding ``soaw.sign`` (or ``soaw.manage``),
  as for decisions, and opens a rejection thread;
- ``scope=chain`` follows ``soaw_service.load_chains``; sections are SoAW keys.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.event import Event
from app.models.notification import Notification
from app.services import notification_service, rollback_service
from tests.conftest import auth_headers, create_role, create_user

SOAW = "/api/v1/soaw"


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
        db, key="signer", label="Signer", permissions={"soaw.view": True, "soaw.sign": True}
    )
    await create_role(
        db,
        key="blind",
        label="Blind",
        permissions={"inventory.view": True, "adr.view": True, "reports.ea_dashboard": True},
    )
    users = {
        "admin": await create_user(db, email="ada@s.test", role="admin", display_name="Ada"),
        "one": await create_user(db, email="one@s.test", role="member", display_name="One"),
        "two": await create_user(db, email="two@s.test", role="member", display_name="Two"),
        "viewer": await create_user(db, email="vic@s.test", role="viewer", display_name="Vic"),
        "signer": await create_user(db, email="sig@s.test", role="signer", display_name="Sig"),
        "signer2": await create_user(db, email="si2@s.test", role="signer", display_name="Si2"),
        "blind": await create_user(db, email="bea@s.test", role="blind", display_name="Bea"),
    }
    return {
        "users": users,
        "ids": {k: str(u.id) for k, u in users.items()},
        "h": {k: auth_headers(u) for k, u in users.items()},
    }


async def _call(client, env, method, path, who="admin", json=None, status=None, **kw):
    resp = await client.request(method, path, json=json, headers=env["h"][who], **kw)
    if status is None:
        status = {"DELETE": 204}.get(method, 200)
    assert resp.status_code == status, resp.text
    return resp.json() if resp.content else None


async def _soaw(client, env, name="Plan") -> dict:
    return await _call(client, env, "POST", SOAW, json={"name": name}, status=201)


async def _post(client, env, soaw_id, body="<p>Hello</p>", who="one", status=201, **extra):
    return await _call(
        client,
        env,
        "POST",
        f"{SOAW}/{soaw_id}/comments",
        who=who,
        json={"body": body, **extra},
        status=status,
    )


async def _list(client, env, soaw_id, who="admin", **params) -> dict:
    return await _call(client, env, "GET", f"{SOAW}/{soaw_id}/comments", who=who, params=params)


async def _request(client, env, soaw_id, *signers):
    await _call(
        client,
        env,
        "POST",
        f"{SOAW}/{soaw_id}/request-signatures",
        json={"user_ids": [env["ids"][s] for s in signers]},
    )


async def _timeline(client, env, soaw_id):
    resp = await client.get(f"{SOAW}/{soaw_id}/history", headers=env["h"]["admin"])
    # The API answers newest first; read it in the order things happened.
    return [(e["kind"], e["actor_name"], e["note"]) for e in reversed(resp.json()["entries"])]


class TestRoutes:
    async def test_post_and_read(self, client, env):
        soaw = await _soaw(client, env)
        thread = await _post(client, env, soaw["id"], section="1.1")
        assert thread == {
            "id": thread["id"],
            "kind": "comment",
            "section": "1.1",
            "revision_id": soaw["id"],
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
        as_viewer = await _list(client, env, soaw["id"], who="viewer")
        assert (as_viewer["can"], as_viewer["open_count"]) == (
            {"comment": False, "moderate": False},
            1,
        )
        as_member = await _list(client, env, soaw["id"], who="two")
        assert as_member["can"] == {"comment": True, "moderate": True}
        assert as_member["threads"][0]["can"] == {"edit": False, "delete": True, "resolve": True}

    async def test_refusals(self, client, env):
        soaw = await _soaw(client, env)
        other = await _soaw(client, env, name="Other")
        top = await _post(client, env, soaw["id"])
        foreign = await _post(client, env, other["id"])
        reply = (await _post(client, env, soaw["id"], parent_id=top["id"]))["replies"][0]
        base = f"{SOAW}/{soaw['id']}/comments"
        resp = await _post(client, env, soaw["id"], who="viewer", status=403)
        assert resp["detail"] == "You may not comment on this document"
        resp = await _call(client, env, "GET", base, who="blind", status=403)
        assert resp["detail"] == "Insufficient permissions"
        resp = await _call(client, env, "GET", f"{SOAW}/{uuid.uuid4()}/comments", status=404)
        assert resp["detail"] == "Statement of Architecture Work not found"
        for json, detail in (
            ({"body": "<p>x</p>", "section": "1-1"}, "Unknown section"),
            (
                {"body": "<p>x</p>", "parent_id": reply["id"]},
                "A reply must answer a thread of this document",
            ),
            (
                {"body": "<p>x</p>", "parent_id": foreign["id"]},
                "A reply must answer a thread of this document",
            ),
            ({"body": "<br>"}, "A comment needs some text"),
        ):
            resp = await _call(client, env, "POST", base, json=json, status=400)
            assert resp["detail"] == detail
        for method, suffix, json in (
            ("PATCH", "", {"body": "<p>x</p>"}),
            ("DELETE", "", None),
            ("POST", "/resolve", None),
            ("POST", "/reopen", None),
        ):
            resp = await _call(
                client, env, method, f"{base}/{foreign['id']}{suffix}", json=json, status=404
            )
            assert resp["detail"] == "Comment not found"
        resp = await _call(
            client,
            env,
            "PATCH",
            f"{base}/{top['id']}",
            who="two",
            json={"body": "<p>x</p>"},
            status=403,
        )
        assert resp["detail"] == "Only the author may edit a comment"
        resp = await _call(client, env, "POST", f"{base}/{reply['id']}/resolve", status=400)
        assert resp["detail"] == "Only a thread can be resolved or reopened"

    async def test_edit_resolve_reopen_delete(self, client, env):
        soaw = await _soaw(client, env)
        top = await _post(client, env, soaw["id"])
        base = f"{SOAW}/{soaw['id']}/comments/{top['id']}"
        edited = await _call(client, env, "PATCH", base, who="one", json={"body": "<p>New</p>"})
        assert (edited["body"], edited["edited_at"] is not None) == ("<p>New</p>", True)
        resolved = await _call(client, env, "POST", f"{base}/resolve", who="two")
        assert resolved["resolved_by"] == {"id": env["ids"]["two"], "display_name": "Two"}
        assert (await _list(client, env, soaw["id"]))["open_count"] == 0
        reopened = await _call(client, env, "POST", f"{base}/reopen", who="two")
        assert reopened["resolved_at"] is None
        await _call(client, env, "DELETE", base, who="two")
        (thread,) = (await _list(client, env, soaw["id"]))["threads"]
        assert (thread["deleted"], thread["body"]) == (True, "")
        resp = await _call(client, env, "DELETE", base, who="one", status=409)
        assert resp["detail"] == "This comment has already been deleted"

    async def test_a_signatory_without_the_comment_permission_may_post(self, client, env):
        soaw = await _soaw(client, env)
        await _post(client, env, soaw["id"], who="signer", status=403)
        await _request(client, env, soaw["id"], "signer")
        await _call(client, env, "POST", f"{SOAW}/{soaw['id']}/recall-signatures")
        thread = await _post(client, env, soaw["id"], who="signer")
        assert thread["author_name"] == "Sig"
        resp = await _call(
            client,
            env,
            "DELETE",
            f"{SOAW}/{soaw['id']}/comments/{thread['id']}",
            who="viewer",
            status=403,
        )
        assert resp["detail"] == "Only the author or an editor may delete a comment"


class TestWorkflow:
    async def test_a_signatory_with_soaw_sign_rejects(self, client, env):
        soaw = await _soaw(client, env)
        await _request(client, env, soaw["id"], "signer", "viewer")
        resp = await _call(
            client,
            env,
            "POST",
            f"{SOAW}/{soaw['id']}/reject",
            who="signer2",
            json={"comment": "x"},
            status=403,
        )
        assert resp["detail"] == "You are not a signatory of this document"
        resp = await _call(
            client,
            env,
            "POST",
            f"{SOAW}/{soaw['id']}/reject",
            who="viewer",
            json={"comment": "x"},
            status=403,
        )
        assert resp["detail"] == "Insufficient permissions"
        body = await _call(
            client,
            env,
            "POST",
            f"{SOAW}/{soaw['id']}/reject",
            who="signer",
            json={"comment": "Scope?"},
        )
        assert (body["status"], body["signatories"], body["open_thread_count"]) == ("draft", [], 1)
        (thread,) = (await _list(client, env, soaw["id"]))["threads"]
        assert (thread["kind"], thread["body"], thread["author_name"]) == (
            "rejection",
            "<p>Scope?</p>",
            "Sig",
        )
        assert ("rejected", "Sig", "Scope?") in await _timeline(client, env, soaw["id"])
        # A moderator resolves a rejection; deleting it is the author's.
        path = f"{SOAW}/{soaw['id']}/comments/{thread['id']}"
        resp = await _call(client, env, "DELETE", path, status=403)
        assert resp["detail"] == "A rejection reason is resolved, not deleted"
        await _call(client, env, "POST", f"{path}/resolve")

    async def test_a_manage_holder_still_rejects(self, client, env):
        soaw = await _soaw(client, env)
        await _request(client, env, soaw["id"], "one")
        await _call(
            client, env, "POST", f"{SOAW}/{soaw['id']}/reject", who="one", json={"comment": ""}
        )
        (thread,) = (await _list(client, env, soaw["id"]))["threads"]
        assert (thread["kind"], thread["body"]) == ("rejection", "")

    async def test_sign_with_a_note(self, client, env):
        soaw = await _soaw(client, env)
        await _request(client, env, soaw["id"], "signer", "one")
        await _call(
            client,
            env,
            "POST",
            f"{SOAW}/{soaw['id']}/sign",
            who="signer",
            json={"note": "x" * 2001},
            status=422,
        )
        await _call(
            client,
            env,
            "POST",
            f"{SOAW}/{soaw['id']}/sign",
            who="signer",
            json={"comment": "old shape"},
            status=422,
        )
        signed = await _call(
            client,
            env,
            "POST",
            f"{SOAW}/{soaw['id']}/sign",
            who="signer",
            json={"note": "Fine by me"},
        )
        assert [s for s in signed["signatories"] if "comment" in s or "note" in s] == []
        # No body at all still signs.
        await _call(client, env, "POST", f"{SOAW}/{soaw['id']}/sign", who="one")
        listing = await _list(client, env, soaw["id"])
        assert [(t["kind"], t["body"], t["author_name"]) for t in listing["threads"]] == [
            ("sign_note", "<p>Fine by me</p>", "Sig")
        ]
        assert listing["open_count"] == 0
        timeline = await _timeline(client, env, soaw["id"])
        assert [row for row in timeline if row[0] == "signature"] == [
            ("signature", "Sig", "Fine by me"),
            ("signature", "One", None),
        ]
        # Discussion stays open after signing.
        await _post(client, env, soaw["id"], body="<p>after</p>")

    async def test_open_thread_count_on_single_responses_only(self, client, env):
        soaw = await _soaw(client, env)
        assert soaw["open_thread_count"] == 0
        await _post(client, env, soaw["id"])
        detail = await _call(client, env, "GET", f"{SOAW}/{soaw['id']}")
        assert detail["open_thread_count"] == 1
        patched = await _call(client, env, "PATCH", f"{SOAW}/{soaw['id']}", json={"name": "P2"})
        assert patched["open_thread_count"] == 1
        rows = await _call(client, env, "GET", SOAW)
        assert [("open_thread_count" in r) for r in rows] == [False]
        revisions = await _call(client, env, "GET", f"{SOAW}/{soaw['id']}/revisions")
        assert [("open_thread_count" in r) for r in revisions] == [False]

    async def test_scope_chain(self, client, env):
        soaw = await _soaw(client, env)
        old = await _post(client, env, soaw["id"], body="<p>old</p>")
        await _request(client, env, soaw["id"], "one")
        await _call(client, env, "POST", f"{SOAW}/{soaw['id']}/sign", who="one")
        rev = await _call(client, env, "POST", f"{SOAW}/{soaw['id']}/revise")
        new = await _post(client, env, rev["id"], body="<p>new</p>", section="custom_3")
        chain = await _list(client, env, rev["id"], scope="chain")
        assert [
            (t["id"], t["revision_id"], t["revision_number"], t["section"])
            for t in chain["threads"]
        ] == [(old["id"], soaw["id"], 1, None), (new["id"], rev["id"], 2, "custom_3")]
        assert chain["open_count"] == 1
        own = await _list(client, env, rev["id"])
        assert [t["id"] for t in own["threads"]] == [new["id"]]


class TestNotificationsAndEvents:
    async def test_recipients(self, client, env, db):
        soaw = await _soaw(client, env)
        await _request(client, env, soaw["id"], "signer")
        await _post(client, env, soaw["id"], who="two")
        mention = (
            f'<span data-type="mention" data-kind="user" data-id="{env["ids"]["blind"]}"></span>'
        )
        thread = await _post(client, env, soaw["id"], who="one", body=f"<p>{mention}</p>")
        assert thread["unnotified_mentions"] == [{"id": env["ids"]["blind"], "display_name": "Bea"}]
        rows = (
            (await db.execute(select(Notification).where(Notification.type == "document_comment")))
            .scalars()
            .all()
        )
        mine = [n for n in rows if n.data["comment_id"] == thread["id"]]
        assert {n.user_id for n in mine} == {env["users"][k].id for k in ("admin", "signer", "two")}
        note = mine[0]
        assert (note.title, note.message, note.link) == (
            'New comment on "Plan"',
            'One commented on "Plan"',
            f"/ea-delivery/soaw/{soaw['id']}/preview?thread={thread['id']}",
        )
        assert note.data == {
            "doc_kind": "soaw",
            "doc_id": soaw["id"],
            "comment_id": thread["id"],
            "thread_id": thread["id"],
        }
        mentions = (
            (await db.execute(select(Notification).where(Notification.type == "document_mention")))
            .scalars()
            .all()
        )
        assert mentions == []

    async def test_event(self, client, env, db, publish_commit_log):
        soaw = await _soaw(client, env)
        publish_commit_log.clear()
        thread = await _post(client, env, soaw["id"], section="2.1")
        assert publish_commit_log[-2:] == [("publish", "soaw.comment_added", True), ("commit",)]
        (event,) = (
            (await db.execute(select(Event).where(Event.event_type == "soaw.comment_added")))
            .scalars()
            .all()
        )
        assert event.data == {
            "id": soaw["id"],
            "comment_id": thread["id"],
            "kind": "comment",
            "section": "2.1",
            "revision_number": 1,
        }
        (op,) = rollback_service.plan_ops([event])
        assert (op["op"], op["reason"]) == (
            "unsupported",
            "soaw.comment_added is not reversed: "
            "A posted comment has been read; delete it from the discussion.",
        )
        resp = await client.get("/api/v1/reports/dashboard", headers=env["h"]["blind"])
        assert "soaw.comment_added" not in {r["event_type"] for r in resp.json()["recent_events"]}
        resp = await client.get("/api/v1/reports/dashboard", headers=env["h"]["admin"])
        assert "soaw.comment_added" in {r["event_type"] for r in resp.json()["recent_events"]}
