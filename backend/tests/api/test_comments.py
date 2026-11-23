"""Integration tests for the /cards/{id}/comments and /comments endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.card_type import CardType
from app.models.comment import Comment
from app.models.event import Event
from app.models.notification import Notification
from app.models.stakeholder import Stakeholder
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)


@pytest.fixture
async def comments_env(db):
    """Prerequisite data for comment tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="member",
        label="Member",
        permissions=MEMBER_PERMISSIONS,
    )
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions=VIEWER_PERMISSIONS,
    )
    await create_card_type(db, key="Application", label="Application")
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    card = await create_card(
        db,
        card_type="Application",
        name="Commented App",
        user_id=admin.id,
    )
    return {
        "admin": admin,
        "member": member,
        "viewer": viewer,
        "card": card,
    }


# ---------------------------------------------------------------
# POST /cards/{id}/comments  (create)
# ---------------------------------------------------------------


class TestCreateComment:
    async def test_admin_can_create_comment(self, client, db, comments_env):
        admin = comments_env["admin"]
        card = comments_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/comments",
            json={"content": "Looks good!"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["content"] == "Looks good!"
        assert data["card_id"] == str(card.id)
        assert data["user_id"] == str(admin.id)

    async def test_member_can_create_comment(self, client, db, comments_env):
        member = comments_env["member"]
        card = comments_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/comments",
            json={"content": "Member comment"},
            headers=auth_headers(member),
        )
        assert resp.status_code == 201

    async def test_viewer_cannot_create_comment(self, client, db, comments_env):
        viewer = comments_env["viewer"]
        card = comments_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/comments",
            json={"content": "Blocked"},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_create_reply(self, client, db, comments_env):
        admin = comments_env["admin"]
        card = comments_env["card"]
        # Create parent comment
        parent_resp = await client.post(
            f"/api/v1/cards/{card.id}/comments",
            json={"content": "Parent"},
            headers=auth_headers(admin),
        )
        parent_id = parent_resp.json()["id"]

        # Create reply
        resp = await client.post(
            f"/api/v1/cards/{card.id}/comments",
            json={
                "content": "Reply",
                "parent_id": parent_id,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["parent_id"] == parent_id


# ---------------------------------------------------------------
# GET /cards/{id}/comments  (list)
# ---------------------------------------------------------------


class TestListComments:
    async def test_list_comments(self, client, db, comments_env):
        admin = comments_env["admin"]
        card = comments_env["card"]
        # Create a comment first
        await client.post(
            f"/api/v1/cards/{card.id}/comments",
            json={"content": "Listed comment"},
            headers=auth_headers(admin),
        )
        resp = await client.get(
            f"/api/v1/cards/{card.id}/comments",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1

    async def test_viewer_can_list_comments(self, client, db, comments_env):
        viewer = comments_env["viewer"]
        card = comments_env["card"]
        resp = await client.get(
            f"/api/v1/cards/{card.id}/comments",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------
# PATCH /comments/{id}  (update)
# ---------------------------------------------------------------


class TestUpdateComment:
    async def test_owner_can_update(self, client, db, comments_env):
        admin = comments_env["admin"]
        card = comments_env["card"]
        create_resp = await client.post(
            f"/api/v1/cards/{card.id}/comments",
            json={"content": "Original"},
            headers=auth_headers(admin),
        )
        comment_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/comments/{comment_id}",
            json={"content": "Edited"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["content"] == "Edited"

    async def test_update_nonexistent_returns_404(self, client, db, comments_env):
        admin = comments_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.patch(
            f"/api/v1/comments/{fake_id}",
            json={"content": "Nope"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------
# DELETE /comments/{id}
# ---------------------------------------------------------------


class TestDeleteComment:
    async def test_owner_can_delete(self, client, db, comments_env):
        admin = comments_env["admin"]
        card = comments_env["card"]
        create_resp = await client.post(
            f"/api/v1/cards/{card.id}/comments",
            json={"content": "Delete me"},
            headers=auth_headers(admin),
        )
        comment_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/comments/{comment_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

    async def test_delete_nonexistent_returns_404(self, client, db, comments_env):
        admin = comments_env["admin"]
        fake_id = uuid.uuid4()
        resp = await client.delete(
            f"/api/v1/comments/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------
# Who may delete (and edit) — and what a delete leaves behind
# ---------------------------------------------------------------


async def _add_comment(db, card, author, content="Some words", parent=None) -> Comment:
    comment = Comment(
        card_id=card.id,
        user_id=author.id,
        content=content,
        parent_id=parent.id if parent else None,
    )
    db.add(comment)
    await db.flush()
    return comment


async def _post(client, card, user, content="Posted", parent_id=None) -> dict:
    body = {"content": content}
    if parent_id:
        body["parent_id"] = parent_id
    resp = await client.post(
        f"/api/v1/cards/{card.id}/comments", json=body, headers=auth_headers(user)
    )
    assert resp.status_code == 201
    return resp.json()


async def _existing_ids(db, ids) -> set[uuid.UUID]:
    rows = await db.execute(select(Comment.id).where(Comment.id.in_(ids)))
    return set(rows.scalars().all())


async def _hide_type_from(db, type_key: str, role_key: str) -> None:
    ct = (await db.execute(select(CardType).where(CardType.key == type_key))).scalar_one()
    ct.role_permissions = {role_key: {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()


@pytest.fixture
async def manage_env(db, comments_env):
    """Adds a second member, a moderator holding a stakeholder role that grants
    ``card.manage_comments`` on the card, and a plain observer on it."""
    await create_stakeholder_role_def(
        db,
        card_type_key="Application",
        key="moderator",
        permissions={"card.view": True, "card.manage_comments": True},
    )
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="observer", permissions={"card.view": True}
    )
    card = comments_env["card"]
    other = await create_user(db, email="other@test.com", role="member")
    moderator = await create_user(db, email="moderator@test.com", role="member")
    observer = await create_user(db, email="observer@test.com", role="member")
    db.add(Stakeholder(card_id=card.id, user_id=moderator.id, role="moderator"))
    db.add(Stakeholder(card_id=card.id, user_id=observer.id, role="observer"))
    await db.flush()
    return {**comments_env, "other": other, "moderator": moderator, "observer": observer}


class TestWhoMayDelete:
    async def test_member_cannot_delete_or_edit_anothers_comment(self, client, db, manage_env):
        card = manage_env["card"]
        theirs = await _add_comment(db, card, manage_env["other"], "Not yours")
        headers = auth_headers(manage_env["member"])

        resp = await client.delete(f"/api/v1/comments/{theirs.id}", headers=headers)
        assert resp.status_code == 403
        resp = await client.patch(
            f"/api/v1/comments/{theirs.id}", json={"content": "Hijacked"}, headers=headers
        )
        assert resp.status_code == 403

        assert await _existing_ids(db, [theirs.id]) == {theirs.id}
        listed = await client.get(f"/api/v1/cards/{card.id}/comments", headers=headers)
        assert [c["content"] for c in listed.json()] == ["Not yours"]

    async def test_author_deletes_own_comment(self, client, db, manage_env):
        mine = await _add_comment(db, manage_env["card"], manage_env["member"])
        resp = await client.delete(
            f"/api/v1/comments/{mine.id}", headers=auth_headers(manage_env["member"])
        )
        assert resp.status_code == 204
        assert await _existing_ids(db, [mine.id]) == set()

    async def test_admin_deletes_anothers_comment(self, client, db, manage_env):
        card = manage_env["card"]
        theirs = await _add_comment(db, card, manage_env["member"], "Off topic")
        kept = await _add_comment(db, card, manage_env["member"], "On topic")
        admin = manage_env["admin"]

        resp = await client.delete(f"/api/v1/comments/{theirs.id}", headers=auth_headers(admin))
        assert resp.status_code == 204

        assert await _existing_ids(db, [theirs.id, kept.id]) == {kept.id}
        listed = await client.get(f"/api/v1/cards/{card.id}/comments", headers=auth_headers(admin))
        assert [c["id"] for c in listed.json()] == [str(kept.id)]

    async def test_stakeholder_role_granting_manage_deletes_anothers(self, client, db, manage_env):
        theirs = await _add_comment(db, manage_env["card"], manage_env["other"])
        resp = await client.delete(
            f"/api/v1/comments/{theirs.id}", headers=auth_headers(manage_env["moderator"])
        )
        assert resp.status_code == 204
        assert await _existing_ids(db, [theirs.id]) == set()

    async def test_stakeholder_role_without_manage_cannot(self, client, db, manage_env):
        theirs = await _add_comment(db, manage_env["card"], manage_env["other"])
        resp = await client.delete(
            f"/api/v1/comments/{theirs.id}", headers=auth_headers(manage_env["observer"])
        )
        assert resp.status_code == 403
        assert await _existing_ids(db, [theirs.id]) == {theirs.id}

    async def test_manage_role_on_another_card_does_not_count(self, client, db, manage_env):
        """The moderator's grant is per card: on a card they hold no role, 403."""
        elsewhere = await create_card(db, card_type="Application", name="Elsewhere")
        theirs = await _add_comment(db, elsewhere, manage_env["other"])
        resp = await client.delete(
            f"/api/v1/comments/{theirs.id}", headers=auth_headers(manage_env["moderator"])
        )
        assert resp.status_code == 403


class TestHiddenCard:
    """A comment on a card whose type is hidden from the caller does not exist
    for them: 404 on edit and delete, whoever wrote it."""

    @pytest.mark.parametrize("whose", ["member", "other"])
    async def test_edit_and_delete_answer_404(self, client, db, manage_env, whose):
        comment = await _add_comment(db, manage_env["card"], manage_env[whose], "Hidden")
        await _hide_type_from(db, "Application", "member")
        headers = auth_headers(manage_env["member"])

        resp = await client.patch(
            f"/api/v1/comments/{comment.id}", json={"content": "Changed"}, headers=headers
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Comment not found"
        resp = await client.delete(f"/api/v1/comments/{comment.id}", headers=headers)
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Comment not found"

        assert await _existing_ids(db, [comment.id]) == {comment.id}
        stored = await db.execute(select(Comment.content).where(Comment.id == comment.id))
        assert stored.scalar_one() == "Hidden"

    async def test_a_role_the_deny_does_not_name_still_deletes(self, client, db, manage_env):
        comment = await _add_comment(db, manage_env["card"], manage_env["other"])
        await _hide_type_from(db, "Application", "viewer")
        resp = await client.delete(
            f"/api/v1/comments/{comment.id}", headers=auth_headers(manage_env["other"])
        )
        assert resp.status_code == 204


class TestMalformedId:
    """A malformed id names no comment: 404, as for a bad id elsewhere
    (it used to raise an unhandled ValueError, a 500)."""

    async def test_patch_and_delete_answer_404(self, client, db, comments_env):
        headers = auth_headers(comments_env["admin"])
        resp = await client.patch(
            "/api/v1/comments/not-a-uuid", json={"content": "x"}, headers=headers
        )
        assert resp.status_code == 404
        resp = await client.delete("/api/v1/comments/not-a-uuid", headers=headers)
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Comment not found"


class TestCardIdAndScopeOnListAndCreate:
    async def test_a_malformed_card_id_is_404(self, client, db, comments_env):
        headers = auth_headers(comments_env["admin"])
        resp = await client.get("/api/v1/cards/not-a-uuid/comments", headers=headers)
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Card not found"
        resp = await client.post(
            "/api/v1/cards/not-a-uuid/comments", json={"content": "x"}, headers=headers
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Card not found"

    async def test_an_unknown_card_is_404_on_create(self, client, db, comments_env):
        resp = await client.post(
            f"/api/v1/cards/{uuid.uuid4()}/comments",
            json={"content": "x"},
            headers=auth_headers(comments_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_a_hidden_card_is_404_on_create(self, client, db, manage_env):
        await _hide_type_from(db, "Application", "member")
        card = manage_env["card"]
        resp = await client.post(
            f"/api/v1/cards/{card.id}/comments",
            json={"content": "Into the dark"},
            headers=auth_headers(manage_env["member"]),
        )
        assert resp.status_code == 404
        rows = await db.execute(select(Comment.id).where(Comment.card_id == card.id))
        assert rows.scalars().all() == []

    async def test_a_readable_card_without_create_stays_403(self, client, db, manage_env):
        # The deny names another role: the viewer reads the card, may not post.
        await _hide_type_from(db, "Application", "member")
        resp = await client.post(
            f"/api/v1/cards/{manage_env['card'].id}/comments",
            json={"content": "x"},
            headers=auth_headers(manage_env["viewer"]),
        )
        assert resp.status_code == 403


class TestReplyParent:
    """A reply sits on its parent's card; any other parent is 404, so the
    answer says nothing about comments on a card the caller did not name."""

    @pytest.mark.parametrize("which", ["malformed", "unknown", "other_card"])
    async def test_a_parent_not_on_this_card_is_404(self, client, db, manage_env, which):
        card = manage_env["card"]
        other_card = await create_card(db, card_type="Application", name="Other card")
        elsewhere = await _add_comment(db, other_card, manage_env["member"], "Elsewhere")
        parent_id = {
            "malformed": "not-a-uuid",
            "unknown": str(uuid.uuid4()),
            "other_card": str(elsewhere.id),
        }[which]

        resp = await client.post(
            f"/api/v1/cards/{card.id}/comments",
            json={"content": "Reply", "parent_id": parent_id},
            headers=auth_headers(manage_env["admin"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Parent comment not found"
        rows = await db.execute(select(Comment.id).where(Comment.card_id == card.id))
        assert rows.scalars().all() == []

    async def test_a_parent_on_this_card_is_accepted(self, client, db, manage_env):
        card = manage_env["card"]
        parent = await _add_comment(db, card, manage_env["member"], "Parent")
        reply = await _post(client, card, manage_env["other"], "Reply", parent_id=str(parent.id))
        assert reply["parent_id"] == str(parent.id)
        assert reply["card_id"] == str(card.id)


class TestRepliesGoWithTheirParent:
    async def test_deleting_a_parent_deletes_its_replies(self, client, db, manage_env):
        card = manage_env["card"]
        parent = await _add_comment(db, card, manage_env["member"], "Parent")
        reply = await _add_comment(db, card, manage_env["other"], "Reply", parent=parent)
        sibling = await _add_comment(db, card, manage_env["other"], "Unrelated")
        admin = manage_env["admin"]

        resp = await client.delete(f"/api/v1/comments/{parent.id}", headers=auth_headers(admin))
        assert resp.status_code == 204

        # Gone, not re-parented to the top level.
        assert await _existing_ids(db, [parent.id, reply.id, sibling.id]) == {sibling.id}
        listed = await client.get(f"/api/v1/cards/{card.id}/comments", headers=auth_headers(admin))
        assert [c["content"] for c in listed.json()] == ["Unrelated"]

    async def test_replies_deeper_than_the_eager_load_go_too(self, client, db, manage_env):
        card = manage_env["card"]
        chain = [await _add_comment(db, card, manage_env["member"], "Level 0")]
        for level in range(1, 6):
            chain.append(
                await _add_comment(db, card, manage_env["member"], f"Level {level}", chain[-1])
            )
        ids = [c.id for c in chain]
        headers = auth_headers(manage_env["admin"])
        # Nothing preloaded: the route loads the chain itself, three levels eagerly.
        db.expire_all()

        resp = await client.delete(f"/api/v1/comments/{ids[0]}", headers=headers)
        assert resp.status_code == 204
        assert await _existing_ids(db, ids) == set()

    async def test_an_author_deletes_their_comment_with_someone_elses_reply(
        self, client, db, manage_env
    ):
        """The owner's decision: a comment's replies go with it, whoever wrote
        them — the author needs no right over the replies."""
        card = manage_env["card"]
        mine = await _add_comment(db, card, manage_env["member"], "Mine")
        theirs = await _add_comment(db, card, manage_env["other"], "Their reply", parent=mine)
        resp = await client.delete(
            f"/api/v1/comments/{mine.id}", headers=auth_headers(manage_env["member"])
        )
        assert resp.status_code == 204
        assert await _existing_ids(db, [mine.id, theirs.id]) == set()

    async def test_deleting_a_reply_keeps_its_parent(self, client, db, manage_env):
        card = manage_env["card"]
        parent = await _add_comment(db, card, manage_env["member"], "Parent")
        reply = await _add_comment(db, card, manage_env["member"], "Reply", parent=parent)
        resp = await client.delete(
            f"/api/v1/comments/{reply.id}", headers=auth_headers(manage_env["member"])
        )
        assert resp.status_code == 204
        assert await _existing_ids(db, [parent.id, reply.id]) == {parent.id}


class TestDeleteHistoryAndCopies:
    async def test_a_comment_deleted_event_is_stored(self, client, db, manage_env):
        card = manage_env["card"]
        comment = await _add_comment(db, card, manage_env["member"], "Secret words")
        moderator = manage_env["moderator"]

        resp = await client.delete(
            f"/api/v1/comments/{comment.id}", headers=auth_headers(moderator)
        )
        assert resp.status_code == 204

        events = (
            (
                await db.execute(
                    select(Event).where(
                        Event.card_id == card.id, Event.event_type == "comment.deleted"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(events) == 1
        assert events[0].user_id == moderator.id
        assert events[0].data["id"] == str(comment.id)
        assert "content" not in events[0].data
        assert "Secret words" not in str(events[0].data)

    async def test_the_event_is_published_before_the_commit(
        self, client, db, manage_env, publish_commit_log
    ):
        comment = await _add_comment(db, manage_env["card"], manage_env["member"])
        resp = await client.delete(
            f"/api/v1/comments/{comment.id}", headers=auth_headers(manage_env["member"])
        )
        assert resp.status_code == 204
        assert publish_commit_log == [("publish", "comment.deleted", True), ("commit",)]

    async def test_notifications_and_stored_text_are_erased(self, client, db, manage_env):
        card = manage_env["card"]
        member = manage_env["member"]
        parent = await _post(client, card, member, "Parent words")
        reply = await _post(client, card, member, "Reply words", parent_id=parent["id"])
        deep = await _post(client, card, member, "Deep words", parent_id=reply["id"])
        kept = await _post(client, card, member, "Kept words")
        posted = {parent["id"], reply["id"], deep["id"], kept["id"]}

        async def notified() -> set[str]:
            rows = await db.execute(
                select(Notification).where(Notification.type == "comment_added")
            )
            return {n.data["comment_id"] for n in rows.scalars().all()}

        async def created_events() -> dict[str, dict]:
            rows = await db.execute(
                select(Event)
                .where(Event.event_type == "comment.created")
                .execution_options(populate_existing=True)
            )
            return {e.data["id"]: e.data for e in rows.scalars().all()}

        # The moderator and the observer subscribe to the card: notified of all four.
        assert await notified() == posted
        assert (await created_events())[parent["id"]]["content"] == "Parent words"
        assert (await created_events())[deep["id"]]["content"] == "Deep words"

        resp = await client.delete(
            f"/api/v1/comments/{parent['id']}", headers=auth_headers(manage_env["admin"])
        )
        assert resp.status_code == 204

        assert await notified() == {kept["id"]}
        events = await created_events()
        assert set(events) == posted  # the history keeps that they were posted
        assert "content" not in events[parent["id"]]
        assert "content" not in events[reply["id"]]
        # A reply to a reply: found by walking the thread past its first level.
        assert "content" not in events[deep["id"]]
        assert events[parent["id"]]["id"] == parent["id"]
        assert events[kept["id"]]["content"] == "Kept words"

    async def test_a_legacy_reply_on_another_card_is_erased_too(self, client, db, manage_env):
        """Older data may hold a reply on another card than its parent: its
        copies are looked up on the card the reply carries."""
        card = manage_env["card"]
        other_card = await create_card(db, card_type="Application", name="Other card")
        parent = await _add_comment(db, card, manage_env["member"], "Parent")
        stray = await _add_comment(db, other_card, manage_env["other"], "Stray words", parent)
        stray_notification = Notification(
            user_id=manage_env["observer"].id,
            type="comment_added",
            title="New Comment",
            message="Stray words",
            card_id=other_card.id,
            data={"comment_id": str(stray.id)},
        )
        stray_event = Event(
            card_id=other_card.id,
            event_type="comment.created",
            data={"id": str(stray.id), "content": "Stray words"},
        )
        db.add_all([stray_notification, stray_event])
        await db.flush()
        notification_id, event_id = stray_notification.id, stray_event.id

        resp = await client.delete(
            f"/api/v1/comments/{parent.id}", headers=auth_headers(manage_env["admin"])
        )
        assert resp.status_code == 204

        assert await _existing_ids(db, [parent.id, stray.id]) == set()
        left = await db.execute(select(Notification.id).where(Notification.id == notification_id))
        assert left.scalar_one_or_none() is None
        event = (
            await db.execute(
                select(Event).where(Event.id == event_id).execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert event.data == {"id": str(stray.id)}


class TestCanDelete:
    async def test_list_says_who_may_delete(self, client, db, manage_env):
        card = manage_env["card"]
        parent = await _add_comment(db, card, manage_env["member"], "By member")
        await _add_comment(db, card, manage_env["other"], "Reply by other", parent=parent)

        async def listed(user) -> dict[str, bool]:
            resp = await client.get(f"/api/v1/cards/{card.id}/comments", headers=auth_headers(user))
            assert resp.status_code == 200
            out = {}
            for c in resp.json():
                out[c["content"]] = c["can"]["delete"]
                for r in c["replies"]:
                    out[r["content"]] = r["can"]["delete"]
            return out

        assert await listed(manage_env["member"]) == {"By member": True, "Reply by other": False}
        assert await listed(manage_env["other"]) == {"By member": False, "Reply by other": True}
        assert await listed(manage_env["moderator"]) == {
            "By member": True,
            "Reply by other": True,
        }
        assert await listed(manage_env["admin"]) == {"By member": True, "Reply by other": True}
        assert await listed(manage_env["viewer"]) == {"By member": False, "Reply by other": False}

    async def test_create_and_update_responses_carry_it(self, client, db, manage_env):
        card = manage_env["card"]
        mine = await _post(client, card, manage_env["member"], "Mine")
        assert mine["can"] == {"delete": True}
        assert mine["replies"] == []

        moderated = await _post(client, card, manage_env["moderator"], "Moderator's")
        assert moderated["can"] == {"delete": True}

        resp = await client.patch(
            f"/api/v1/comments/{mine['id']}",
            json={"content": "Mine, edited"},
            headers=auth_headers(manage_env["member"]),
        )
        assert resp.status_code == 200
        assert resp.json()["can"] == {"delete": True}

        # A manager editing someone else's comment may delete it too.
        resp = await client.patch(
            f"/api/v1/comments/{mine['id']}",
            json={"content": "Mine, moderated"},
            headers=auth_headers(manage_env["moderator"]),
        )
        assert resp.status_code == 200
        assert resp.json()["can"] == {"delete": True}
