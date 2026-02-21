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
