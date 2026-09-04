"""Stakeholders are told when a card they follow drops to Broken.

Turbo EA breaks an approval automatically whenever a substantive field changes
on an approved card. Every one of the paths that does so used to do it in
silence: no `approval_status` in the `card.updated` payload (so the History tab
showed the edit and never the state change it caused) and no notification, so
the people who owe the re-review found out by stumbling on the card in the
Inventory. The explicit Approve / Reject / Reset endpoint was the only thing
that ever emitted `approval_status_changed`.

These tests cover the four break paths end to end, and the one thing that is
easy to get wrong: never telling somebody to re-approve a card that the same
request has just archived or deleted.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS
from app.models.event import Event
from app.models.notification import Notification
from app.models.stakeholder import Stakeholder
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_card_type(
        db,
        key="Application",
        label="Application",
        has_hierarchy=True,
        fields_schema=[{"section": "General", "fields": []}],
    )
    editor = await create_user(db, email="editor@test.com", role="admin")
    owner = await create_user(db, email="owner@test.com", role="member")
    return {"editor": editor, "owner": owner}


async def _approved_card_owned_by(db, owner, *, name="App", parent_id=None):
    card = await create_card(db, name=name, approval_status="APPROVED", parent_id=parent_id)
    db.add(Stakeholder(card_id=card.id, user_id=owner.id, role="responsible"))
    await db.flush()
    return card


async def _notifications(db, user_id, notif_type="approval_status_changed"):
    rows = await db.execute(
        select(Notification).where(Notification.user_id == user_id, Notification.type == notif_type)
    )
    return list(rows.scalars().all())


async def _card_updated_changes(db, card_id) -> list[dict]:
    rows = await db.execute(
        select(Event).where(Event.card_id == card_id, Event.event_type == "card.updated")
    )
    return [(e.data or {}).get("changes") or {} for e in rows.scalars().all()]


def _capture_batches(monkeypatch) -> list[list[dict]]:
    """Intercept the background fan-out.

    Left unpatched, the real `deliver_notification_batch` opens its own session
    outside the test's outer transaction, finds no committed users, and quietly
    delivers to nobody — so an assertion-bearing test has to patch.
    """
    from app.services import notification_service

    calls: list[list[dict]] = []

    async def fake_deliver(recipients, *, notif_type, actor_id=None):
        assert notif_type == "approval_status_changed"
        calls.append(recipients)

    monkeypatch.setattr(notification_service, "deliver_notification_batch", fake_deliver)
    return calls


class TestSingleCardEdit:
    async def test_stakeholder_is_notified_and_the_editor_is_not(self, client, db, env):
        editor, owner = env["editor"], env["owner"]
        card = await _approved_card_owned_by(db, owner)

        resp = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"description": "Now with more detail"},
            headers=auth_headers(editor),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["approval_status"] == "BROKEN"

        notifs = await _notifications(db, owner.id)
        assert len(notifs) == 1
        assert notifs[0].data["approval_status"] == "BROKEN"
        assert notifs[0].link == f"/cards/{card.id}"
        assert await _notifications(db, editor.id) == []

    async def test_the_break_lands_in_the_history_payload(self, client, db, env):
        editor, owner = env["editor"], env["owner"]
        card = await _approved_card_owned_by(db, owner)

        await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"description": "Changed"},
            headers=auth_headers(editor),
        )

        changes = await _card_updated_changes(db, card.id)
        assert len(changes) == 1
        # The exact shape `HistoryTab.parseChanges` renders, and the one
        # `rollback_service` reads to restore the previous value.
        assert changes[0]["approval_status"] == {"old": "APPROVED", "new": "BROKEN"}

    async def test_a_non_breaking_edit_notifies_nobody_about_approval(self, client, db, env):
        editor, owner = env["editor"], env["owner"]
        card = await _approved_card_owned_by(db, owner)

        resp = await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"tags": []},
            headers=auth_headers(editor),
        )
        assert resp.status_code == 200, resp.text
        assert await _notifications(db, owner.id) == []

    @pytest.mark.parametrize("status", ["DRAFT", "REJECTED"])
    async def test_an_unapproved_card_has_no_approval_to_break(self, client, db, env, status):
        editor, owner = env["editor"], env["owner"]
        card = await create_card(db, name="App", approval_status=status)
        db.add(Stakeholder(card_id=card.id, user_id=owner.id, role="responsible"))
        await db.flush()

        await client.patch(
            f"/api/v1/cards/{card.id}",
            json={"description": "Changed"},
            headers=auth_headers(editor),
        )
        assert await _notifications(db, owner.id) == []
        changes = await _card_updated_changes(db, card.id)
        assert all("approval_status" not in c for c in changes)


class TestBulkEdit:
    async def test_one_notification_per_person_not_per_card(self, client, db, env, monkeypatch):
        editor, owner = env["editor"], env["owner"]
        cards = [await _approved_card_owned_by(db, owner, name=f"App {i}") for i in range(3)]
        calls = _capture_batches(monkeypatch)

        resp = await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(c.id) for c in cards], "updates": {"description": "Bulk"}},
            headers=auth_headers(editor),
        )
        assert resp.status_code == 200, resp.text

        assert len(calls) == 1
        recipients = calls[0]
        assert len(recipients) == 1
        assert recipients[0]["user_id"] == owner.id
        assert recipients[0]["data"]["card_count"] == 3

    async def test_the_break_lands_in_each_cards_history(self, client, db, env, monkeypatch):
        editor, owner = env["editor"], env["owner"]
        card = await _approved_card_owned_by(db, owner)
        _capture_batches(monkeypatch)

        await client.patch(
            "/api/v1/cards/bulk",
            json={"ids": [str(card.id)], "updates": {"description": "Bulk"}},
            headers=auth_headers(editor),
        )
        changes = await _card_updated_changes(db, card.id)
        assert changes[0]["approval_status"] == {"old": "APPROVED", "new": "BROKEN"}

    async def test_a_dry_run_notifies_nobody(self, client, db, env, monkeypatch):
        editor, owner = env["editor"], env["owner"]
        card = await _approved_card_owned_by(db, owner)
        calls = _capture_batches(monkeypatch)

        resp = await client.patch(
            "/api/v1/cards/bulk",
            json={
                "ids": [str(card.id)],
                "updates": {"description": "Preview"},
                "dry_run": True,
            },
            headers=auth_headers(editor),
        )
        assert resp.status_code == 200, resp.text
        assert calls == []
        await db.refresh(card)
        assert card.approval_status == "APPROVED"


class TestArchiveCascade:
    async def test_a_reparented_child_is_recorded_and_notified(self, client, db, env, monkeypatch):
        editor, owner = env["editor"], env["owner"]
        parent = await create_card(db, name="Parent")
        child = await _approved_card_owned_by(db, owner, name="Child", parent_id=parent.id)
        calls = _capture_batches(monkeypatch)

        resp = await client.post(
            f"/api/v1/cards/{parent.id}/archive",
            json={"child_strategy": "disconnect"},
            headers=auth_headers(editor),
        )
        assert resp.status_code == 200, resp.text

        await db.refresh(child)
        assert child.approval_status == "BROKEN"
        # The move used to bump the child's Modified date with no event at all,
        # so its History tab was empty while the Inventory said it had changed.
        changes = await _card_updated_changes(db, child.id)
        assert len(changes) == 1
        assert changes[0]["approval_status"] == {"old": "APPROVED", "new": "BROKEN"}
        assert changes[0]["parent_id"] == {"old": str(parent.id), "new": None}

        assert len(calls) == 1
        assert calls[0][0]["user_id"] == owner.id

    async def test_bulk_archive_notifies_a_child_that_survives(self, client, db, env, monkeypatch):
        """Positive control for the suppression test below."""
        editor, owner = env["editor"], env["owner"]
        parent = await create_card(db, name="Parent")
        child = await _approved_card_owned_by(db, owner, name="Child", parent_id=parent.id)
        calls = _capture_batches(monkeypatch)

        resp = await client.post(
            "/api/v1/cards/bulk-archive",
            json={"card_ids": [str(parent.id)], "child_strategy": "disconnect"},
            headers=auth_headers(editor),
        )
        assert resp.status_code == 200, resp.text

        await db.refresh(child)
        assert child.status == "ACTIVE"
        assert child.approval_status == "BROKEN"
        assert len(calls) == 1
        assert calls[0][0]["user_id"] == owner.id

    async def test_a_child_archived_in_the_same_breath_is_not_asked_to_re_approve(
        self, client, db, env, monkeypatch
    ):
        """The hazard: disconnect moves the child, then we archive it anyway.

        The parent change is still worth recording, but nudging somebody to
        re-approve a card that just left the active landscape is how a bell
        gets muted.
        """
        editor, owner = env["editor"], env["owner"]
        parent = await create_card(db, name="Parent")
        child = await _approved_card_owned_by(db, owner, name="Child", parent_id=parent.id)
        calls = _capture_batches(monkeypatch)

        resp = await client.post(
            "/api/v1/cards/bulk-archive",
            json={"card_ids": [str(parent.id), str(child.id)], "child_strategy": "disconnect"},
            headers=auth_headers(editor),
        )
        assert resp.status_code == 200, resp.text

        await db.refresh(child)
        assert child.status == "ARCHIVED"
        assert calls == [] or all(r == [] for r in calls)
        # The event is still owed — only the notification is suppressed.
        assert await _card_updated_changes(db, child.id)


class TestDeleteCascade:
    async def test_a_deleted_child_gets_neither_event_nor_notification(
        self, client, db, env, monkeypatch
    ):
        editor, owner = env["editor"], env["owner"]
        parent = await create_card(db, name="Parent")
        child = await _approved_card_owned_by(db, owner, name="Child", parent_id=parent.id)
        child_id = child.id
        calls = _capture_batches(monkeypatch)

        resp = await client.post(
            "/api/v1/cards/bulk-delete",
            json={"card_ids": [str(parent.id), str(child_id)], "child_strategy": "disconnect"},
            headers=auth_headers(editor),
        )
        assert resp.status_code == 200, resp.text

        assert calls == [] or all(r == [] for r in calls)
        assert await _card_updated_changes(db, child_id) == []

    async def test_a_surviving_child_is_recorded_and_notified(self, client, db, env, monkeypatch):
        editor, owner = env["editor"], env["owner"]
        parent = await create_card(db, name="Parent")
        child = await _approved_card_owned_by(db, owner, name="Child", parent_id=parent.id)
        calls = _capture_batches(monkeypatch)

        resp = await client.request(
            "DELETE",
            f"/api/v1/cards/{parent.id}",
            json={"child_strategy": "disconnect"},
            headers=auth_headers(editor),
        )
        assert resp.status_code == 200, resp.text

        await db.refresh(child)
        assert child.approval_status == "BROKEN"
        assert await _card_updated_changes(db, child.id)
        assert len(calls) == 1
        assert calls[0][0]["user_id"] == owner.id
