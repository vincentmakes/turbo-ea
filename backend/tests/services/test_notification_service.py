"""Integration tests for the notification service.

These tests require a PostgreSQL test database — they verify that
notifications are created, self-notifications are blocked, and
mark-as-read operations work correctly.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from sqlalchemy import select

from app.models.notification import Notification
from app.services.notification_service import (
    create_notification,
    deliver_notification_batch,
    get_unread_count,
    mark_all_as_read,
    mark_as_read,
)
from tests.conftest import create_role, create_user

# ---------------------------------------------------------------------------
# create_notification
# ---------------------------------------------------------------------------


class TestCreateNotification:
    async def test_creates_notification_record(self, db):
        await create_role(db, key="member", permissions={})
        user = await create_user(db, role="member")

        with patch("app.services.notification_service.event_bus") as mock_bus:
            mock_bus.publish = AsyncMock()
            notif = await create_notification(
                db,
                user_id=user.id,
                notif_type="card_updated",
                title="Card Updated",
                message="Your card was changed.",
                link="/cards/123",
            )

        assert notif is not None
        assert notif.user_id == user.id
        assert notif.type == "card_updated"
        assert notif.title == "Card Updated"
        assert notif.is_read is False

    async def test_self_notification_blocked(self, db):
        """Actor == user should return None for standard types."""
        await create_role(db, key="member", permissions={})
        user = await create_user(db, role="member")

        with patch("app.services.notification_service.event_bus") as mock_bus:
            mock_bus.publish = AsyncMock()
            notif = await create_notification(
                db,
                user_id=user.id,
                notif_type="card_updated",
                title="Card Updated",
                actor_id=user.id,
            )

        assert notif is None

    async def test_self_notification_allowed_for_special_types(self, db):
        """Some notification types allow actor == user."""
        await create_role(db, key="member", permissions={})
        user = await create_user(db, role="member")

        with patch("app.services.notification_service.event_bus") as mock_bus:
            mock_bus.publish = AsyncMock()
            notif = await create_notification(
                db,
                user_id=user.id,
                notif_type="todo_assigned",
                title="Todo Assigned",
                actor_id=user.id,
            )

        assert notif is not None

    async def test_inactive_user_gets_no_notification(self, db):
        """Inactive users should not receive notifications."""
        await create_role(db, key="member", permissions={})
        user = await create_user(db, role="member")
        user.is_active = False
        await db.flush()

        with patch("app.services.notification_service.event_bus") as mock_bus:
            mock_bus.publish = AsyncMock()
            notif = await create_notification(
                db,
                user_id=user.id,
                notif_type="card_updated",
                title="Card Updated",
            )

        assert notif is None

    async def test_publishes_event_bus_message(self, db):
        """Creating a notification should publish to event_bus."""
        await create_role(db, key="member", permissions={})
        user = await create_user(db, role="member")

        with patch("app.services.notification_service.event_bus") as mock_bus:
            mock_bus.publish = AsyncMock()
            await create_notification(
                db,
                user_id=user.id,
                notif_type="comment_added",
                title="New Comment",
            )

        mock_bus.publish.assert_called_once()
        call_kwargs = mock_bus.publish.call_args
        assert call_kwargs.kwargs["event_type"] == ("notification.created")


# ---------------------------------------------------------------------------
# mark_as_read / mark_all_as_read
# ---------------------------------------------------------------------------


class TestMarkAsRead:
    async def test_mark_single_as_read(self, db):
        await create_role(db, key="member", permissions={})
        user = await create_user(db, role="member")

        with patch("app.services.notification_service.event_bus") as mock_bus:
            mock_bus.publish = AsyncMock()
            notif = await create_notification(
                db,
                user_id=user.id,
                notif_type="card_updated",
                title="Updated",
            )

        assert notif is not None
        result = await mark_as_read(db, notif.id, user.id)
        assert result is True

        # Verify in DB
        row = await db.execute(select(Notification).where(Notification.id == notif.id))
        assert row.scalar_one().is_read is True

    async def test_mark_as_read_wrong_user(self, db):
        """Cannot mark another user's notification as read."""
        await create_role(db, key="member", permissions={})
        user = await create_user(db, role="member")
        other = await create_user(db, role="member")

        with patch("app.services.notification_service.event_bus") as mock_bus:
            mock_bus.publish = AsyncMock()
            notif = await create_notification(
                db,
                user_id=user.id,
                notif_type="card_updated",
                title="Updated",
            )

        assert notif is not None
        result = await mark_as_read(db, notif.id, other.id)
        assert result is False

    async def test_mark_all_as_read(self, db):
        await create_role(db, key="member", permissions={})
        user = await create_user(db, role="member")

        with patch("app.services.notification_service.event_bus") as mock_bus:
            mock_bus.publish = AsyncMock()
            await create_notification(
                db,
                user_id=user.id,
                notif_type="card_updated",
                title="First",
            )
            await create_notification(
                db,
                user_id=user.id,
                notif_type="comment_added",
                title="Second",
            )

        count = await mark_all_as_read(db, user.id)
        assert count == 2

        unread = await get_unread_count(db, user.id)
        assert unread == 0


# ---------------------------------------------------------------------------
# get_unread_count
# ---------------------------------------------------------------------------


class TestGetUnreadCount:
    async def test_count_reflects_unread(self, db):
        await create_role(db, key="member", permissions={})
        user = await create_user(db, role="member")

        with patch("app.services.notification_service.event_bus") as mock_bus:
            mock_bus.publish = AsyncMock()
            await create_notification(
                db,
                user_id=user.id,
                notif_type="card_updated",
                title="N1",
            )
            n2 = await create_notification(
                db,
                user_id=user.id,
                notif_type="card_updated",
                title="N2",
            )

        assert await get_unread_count(db, user.id) == 2

        # Mark one as read
        assert n2 is not None
        await mark_as_read(db, n2.id, user.id)
        assert await get_unread_count(db, user.id) == 1

    async def test_count_zero_for_no_notifications(self, db):
        await create_role(db, key="member", permissions={})
        user = await create_user(db, role="member")

        assert await get_unread_count(db, user.id) == 0


# ---------------------------------------------------------------------------
# deliver_notification_batch — background fan-out for bulk sends
# ---------------------------------------------------------------------------


def _session_factory_for(db):
    """A stand-in for ``app.database.async_session`` that hands the test's
    savepoint session to the batch deliverer instead of a fresh connection —
    a real one could not see the test's uncommitted rows, and must not be
    closed by the code under test."""
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def factory():
        yield db

    return factory


class TestDeliverNotificationBatch:
    async def _user(self, db, email):
        return await create_user(db, email=email, role="member")

    async def test_inactive_recipient_gets_neither_email_nor_bell(self, db, monkeypatch):
        await create_role(db, key="member", permissions={})
        active = await self._user(db, "active@test.com")
        inactive = await self._user(db, "inactive@test.com")
        inactive.is_active = False
        await db.flush()
        monkeypatch.setattr("app.database.async_session", _session_factory_for(db))
        sent = []

        async def fake_send(**kwargs):
            sent.append(kwargs["to"])
            return True

        with patch("app.services.email_service.send_notification_email", new=fake_send):
            count = await deliver_notification_batch(
                [{"user_id": user.id, "title": "T"} for user in (active, inactive)],
                notif_type="survey_request",
            )
        rows = (await db.execute(select(Notification))).scalars().all()
        assert count == 1
        assert [row.user_id for row in rows] == [active.id]
        assert sent == [active.email]

    async def test_creates_rows_and_emails_opted_in_users(self, db, monkeypatch):
        await create_role(db, key="member", permissions={})
        alice = await self._user(db, "alice@test.com")
        bob = await self._user(db, "bob@test.com")
        monkeypatch.setattr("app.database.async_session", _session_factory_for(db))

        sent: list[str] = []

        async def fake_send(*, to, title, message, link, **_kw):
            sent.append(to)
            return True

        with patch("app.services.email_service.send_notification_email", new=fake_send):
            await deliver_notification_batch(
                [
                    {"user_id": alice.id, "title": "Survey: Q3", "message": "please"},
                    {"user_id": bob.id, "title": "Survey: Q3", "message": "please"},
                ],
                notif_type="survey_request",
            )

        rows = (
            (await db.execute(select(Notification).order_by(Notification.created_at)))
            .scalars()
            .all()
        )
        assert {r.user_id for r in rows} == {alice.id, bob.id}
        assert sorted(sent) == ["alice@test.com", "bob@test.com"]
        # Phase 3 stamped what phase 2 actually delivered.
        assert all(r.is_emailed for r in rows)

    async def test_a_failed_email_is_not_stamped_and_does_not_stop_the_batch(self, db, monkeypatch):
        await create_role(db, key="member", permissions={})
        alice = await self._user(db, "alice@test.com")
        bob = await self._user(db, "bob@test.com")
        monkeypatch.setattr("app.database.async_session", _session_factory_for(db))

        async def flaky_send(*, to, title, message, link, **_kw):
            if to == "alice@test.com":
                raise RuntimeError("smtp down")
            return True

        with patch("app.services.email_service.send_notification_email", new=flaky_send):
            await deliver_notification_batch(
                [
                    {"user_id": alice.id, "title": "T"},
                    {"user_id": bob.id, "title": "T"},
                ],
                notif_type="survey_request",
            )

        rows = {r.user_id: r for r in (await db.execute(select(Notification))).scalars()}
        assert set(rows) == {alice.id, bob.id}  # in-app rows regardless
        assert rows[alice.id].is_emailed is False
        assert rows[bob.id].is_emailed is True

    async def test_email_items_reach_the_email_and_not_the_bell(self, db, monkeypatch):
        """The card list is an email-only enrichment.

        One notification can now stand for many cards, so the email names them
        — but the in-app row stays the one-liner the bell renders.
        """
        await create_role(db, key="member", permissions={})
        alice = await self._user(db, "alice@test.com")
        monkeypatch.setattr("app.database.async_session", _session_factory_for(db))

        seen: list[dict] = []

        async def fake_send(**kwargs):
            seen.append(kwargs)
            return True

        items = [{"label": "Payroll", "link": "/surveys/1/respond/2"}]
        with patch("app.services.email_service.send_notification_email", new=fake_send):
            await deliver_notification_batch(
                [
                    {
                        "user_id": alice.id,
                        "title": "Survey: Q3",
                        "message": "please",
                        "email_items": items,
                        "email_items_title": "Cards to review",
                    }
                ],
                notif_type="survey_request",
            )

        assert seen[0]["items"] == items
        assert seen[0]["items_title"] == "Cards to review"
        row = (await db.execute(select(Notification))).scalars().one()
        assert row.message == "please"
        assert "Payroll" not in (row.message or "")

    async def test_never_raises(self, db, monkeypatch):
        """The batch runs detached — a total failure must be swallowed, not
        crash whatever scheduled it."""

        def broken_factory():
            raise RuntimeError("no database")

        monkeypatch.setattr("app.database.async_session", broken_factory)
        await deliver_notification_batch(
            [{"user_id": (await self._user(db, "x@test.com")).id, "title": "T"}],
            notif_type="survey_request",
        )

    async def test_card_batch_rechecks_scope_and_account_before_any_channel(self, db, monkeypatch):
        from datetime import UTC, datetime, timedelta

        from app.services.permission_service import PermissionService
        from tests.conftest import create_card, create_card_type

        await create_role(db, key="allowed", permissions={"inventory.view": True})
        await create_role(db, key="denied", permissions={"inventory.view": True})
        await create_card_type(db, role_permissions={"denied": {"inventory.view": False}})
        card = await create_card(db)
        allowed = await create_user(db, email="allowed-batch@test.com", role="allowed")
        muted = await create_user(db, email="muted-batch@test.com", role="allowed")
        expired = await create_user(db, email="expired-batch@test.com", role="allowed")
        denied = await create_user(db, email="denied-batch@test.com", role="denied")
        inactive = await create_user(db, email="inactive-batch@test.com", role="allowed")
        expired.access_expires_at = datetime.now(UTC) - timedelta(days=1)
        inactive.is_active = False
        for user in (allowed, muted, expired, denied, inactive):
            user.notification_preferences = {
                "in_app": {"card_updated": user is not muted},
                "email": {"card_updated": True},
            }
        await db.flush()
        PermissionService.invalidate_type_permission_cache()
        monkeypatch.setattr("app.database.async_session", _session_factory_for(db))
        sent = []

        async def fake_send(**kwargs):
            sent.append(kwargs["to"])
            return True

        with patch("app.services.email_service.send_notification_email", new=fake_send):
            count = await deliver_notification_batch(
                [
                    {"user_id": user.id, "title": "Card", "card_id": card.id}
                    for user in (allowed, muted, expired, denied, inactive)
                ],
                notif_type="card_updated",
                require_card_read=True,
            )
        rows = (await db.execute(select(Notification))).scalars().all()
        assert count == 1
        assert [row.user_id for row in rows] == [allowed.id]
        assert set(sent) == {allowed.email, muted.email}
