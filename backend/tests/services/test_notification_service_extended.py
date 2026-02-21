"""Extended notification service tests — preference checking, email delivery,
and subscriber-based batch notifications.

These are integration tests requiring a PostgreSQL test database.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.user import DEFAULT_NOTIFICATION_PREFERENCES
from app.services.notification_service import (
    _user_wants_notification,
    create_notification,
    create_notifications_for_subscribers,
)
from tests.conftest import (
    create_card,
    create_card_type,
    create_role,
    create_user,
)

# ---------------------------------------------------------------------------
# Helper to assign a stakeholder for subscriber tests
# ---------------------------------------------------------------------------


async def _assign_stakeholder(db, card_id, user_id, role_key="responsible"):
    from app.models.stakeholder import Stakeholder

    s = Stakeholder(card_id=card_id, user_id=user_id, role=role_key)
    db.add(s)
    await db.flush()
    return s


# ---------------------------------------------------------------------------
# _user_wants_notification — preference resolution
# ---------------------------------------------------------------------------


class TestUserWantsNotification:
    """Unit tests for the preference helper (no DB needed)."""

    def _make_user(self, prefs=None):
        """Create a minimal mock user with notification_preferences."""
        user = MagicMock()
        user.notification_preferences = prefs
        return user

    def test_default_prefs_in_app_enabled(self):
        """Default preferences enable in_app for card_updated."""
        user = self._make_user(DEFAULT_NOTIFICATION_PREFERENCES)
        assert _user_wants_notification(user, "card_updated", "in_app") is True

    def test_default_prefs_email_card_updated_disabled(self):
        """Default preferences disable email for card_updated."""
        user = self._make_user(DEFAULT_NOTIFICATION_PREFERENCES)
        assert _user_wants_notification(user, "card_updated", "email") is False

    def test_default_prefs_email_todo_assigned_enabled(self):
        """Default preferences enable email for todo_assigned."""
        user = self._make_user(DEFAULT_NOTIFICATION_PREFERENCES)
        assert _user_wants_notification(user, "todo_assigned", "email") is True

    def test_none_prefs_uses_defaults(self):
        """When notification_preferences is None, fall back to defaults."""
        user = self._make_user(None)
        # in_app card_updated should be True per DEFAULT_NOTIFICATION_PREFERENCES
        assert _user_wants_notification(user, "card_updated", "in_app") is True

    def test_unknown_notif_type_in_app_defaults_true(self):
        """Unknown notification type defaults to True for in_app channel."""
        user = self._make_user({"in_app": {}, "email": {}})
        assert _user_wants_notification(user, "unknown_type", "in_app") is True

    def test_unknown_notif_type_email_defaults_false(self):
        """Unknown notification type defaults to False for email channel."""
        user = self._make_user({"in_app": {}, "email": {}})
        assert _user_wants_notification(user, "unknown_type", "email") is False

    def test_explicit_opt_out_in_app(self):
        """Explicit False for in_app should return False."""
        prefs = {"in_app": {"card_updated": False}, "email": {}}
        user = self._make_user(prefs)
        assert _user_wants_notification(user, "card_updated", "in_app") is False

    def test_explicit_opt_in_email(self):
        """Explicit True for email should return True."""
        prefs = {"in_app": {}, "email": {"card_updated": True}}
        user = self._make_user(prefs)
        assert _user_wants_notification(user, "card_updated", "email") is True

    def test_missing_channel_uses_default(self):
        """If channel key is entirely missing, uses default logic."""
        user = self._make_user({})
        # "in_app" key missing => channel_prefs = {}, default = True for in_app
        assert _user_wants_notification(user, "card_updated", "in_app") is True
        # "email" key missing => channel_prefs = {}, default = False for email
        assert _user_wants_notification(user, "card_updated", "email") is False

    def test_all_default_preference_types_covered(self):
        """Every notification type in DEFAULT should be testable."""
        user = self._make_user(DEFAULT_NOTIFICATION_PREFERENCES)
        for notif_type in DEFAULT_NOTIFICATION_PREFERENCES["in_app"]:
            # Should not raise
            _user_wants_notification(user, notif_type, "in_app")
            _user_wants_notification(user, notif_type, "email")


# ---------------------------------------------------------------------------
# create_notification — email delivery path
# ---------------------------------------------------------------------------


class TestNotificationEmailDelivery:
    async def test_email_sent_when_opted_in(self, db):
        """If user opts into email, is_emailed should be set True."""
        await create_role(db, key="member", permissions={})
        user = await create_user(db, role="member")
        # Opt in to email for card_updated
        user.notification_preferences = {
            "in_app": {"card_updated": True},
            "email": {"card_updated": True},
        }
        await db.flush()

        with (
            patch("app.services.notification_service.event_bus") as mock_bus,
            patch(
                "app.services.email_service.send_notification_email",
                new_callable=AsyncMock,
                return_value=True,
            ) as mock_send,
        ):
            mock_bus.publish = AsyncMock()
            notif = await create_notification(
                db,
                user_id=user.id,
                notif_type="card_updated",
                title="Email Test",
            )

        assert notif is not None
        assert notif.is_emailed is True
        mock_send.assert_called_once()

    async def test_email_not_sent_when_opted_out(self, db):
        """If user has email disabled, send_notification_email is not called."""
        await create_role(db, key="member", permissions={})
        user = await create_user(db, role="member")
        user.notification_preferences = {
            "in_app": {"card_updated": True},
            "email": {"card_updated": False},
        }
        await db.flush()

        with (
            patch("app.services.notification_service.event_bus") as mock_bus,
            patch(
                "app.services.email_service.send_notification_email",
                new_callable=AsyncMock,
            ) as mock_send,
        ):
            mock_bus.publish = AsyncMock()
            notif = await create_notification(
                db,
                user_id=user.id,
                notif_type="card_updated",
                title="No Email",
            )

        assert notif is not None
        assert notif.is_emailed is False
        mock_send.assert_not_called()

    async def test_email_failure_does_not_block_notification(self, db):
        """Email exception should be silently caught; notification still created."""
        await create_role(db, key="member", permissions={})
        user = await create_user(db, role="member")
        user.notification_preferences = {
            "in_app": {"card_updated": True},
            "email": {"card_updated": True},
        }
        await db.flush()

        with (
            patch("app.services.notification_service.event_bus") as mock_bus,
            patch(
                "app.services.email_service.send_notification_email",
                new_callable=AsyncMock,
                side_effect=Exception("SMTP down"),
            ),
        ):
            mock_bus.publish = AsyncMock()
            notif = await create_notification(
                db,
                user_id=user.id,
                notif_type="card_updated",
                title="Resilient",
            )

        assert notif is not None
        assert notif.is_emailed is False  # Email failed, flag stays False

    async def test_nonexistent_user_returns_none(self, db):
        """Notification for a user_id that doesn't exist returns None."""
        await create_role(db, key="member", permissions={})

        with patch("app.services.notification_service.event_bus") as mock_bus:
            mock_bus.publish = AsyncMock()
            notif = await create_notification(
                db,
                user_id=uuid.uuid4(),
                notif_type="card_updated",
                title="Ghost",
            )

        assert notif is None

    async def test_user_opted_out_in_app_returns_none(self, db):
        """If user has in_app disabled for this type, no notification is created."""
        await create_role(db, key="member", permissions={})
        user = await create_user(db, role="member")
        user.notification_preferences = {
            "in_app": {"card_updated": False},
            "email": {},
        }
        await db.flush()

        with patch("app.services.notification_service.event_bus") as mock_bus:
            mock_bus.publish = AsyncMock()
            notif = await create_notification(
                db,
                user_id=user.id,
                notif_type="card_updated",
                title="Opted Out",
            )

        assert notif is None

    async def test_card_id_stored_on_notification(self, db):
        """card_id is correctly stored on the notification record."""
        await create_role(db, key="admin", permissions={"*": True})
        user = await create_user(db, role="admin")
        await create_card_type(db, key="Application", label="Application")
        card = await create_card(db, card_type="Application", name="Test", user_id=user.id)

        with patch("app.services.notification_service.event_bus") as mock_bus:
            mock_bus.publish = AsyncMock()
            notif = await create_notification(
                db,
                user_id=user.id,
                notif_type="card_updated",
                title="Card Ref",
                card_id=card.id,
            )

        assert notif is not None
        assert notif.card_id == card.id


# ---------------------------------------------------------------------------
# create_notifications_for_subscribers
# ---------------------------------------------------------------------------


class TestCreateNotificationsForSubscribers:
    async def test_notifies_all_stakeholders(self, db):
        """All stakeholders on a card should get notifications."""
        await create_role(db, key="admin", permissions={"*": True})
        await create_card_type(db, key="Application", label="Application")
        admin = await create_user(db, email="admin@test.com", role="admin")
        user1 = await create_user(db, email="user1@test.com", role="admin")
        user2 = await create_user(db, email="user2@test.com", role="admin")
        card = await create_card(db, card_type="Application", name="App", user_id=admin.id)

        await _assign_stakeholder(db, card.id, user1.id)
        await _assign_stakeholder(db, card.id, user2.id)

        with patch("app.services.notification_service.event_bus") as mock_bus:
            mock_bus.publish = AsyncMock()
            notifs = await create_notifications_for_subscribers(
                db,
                card_id=card.id,
                notif_type="card_updated",
                title="Card Changed",
                actor_id=admin.id,
            )

        assert len(notifs) == 2
        notif_user_ids = {n.user_id for n in notifs}
        assert user1.id in notif_user_ids
        assert user2.id in notif_user_ids

    async def test_no_stakeholders_returns_empty(self, db):
        """Card with no stakeholders produces no notifications."""
        await create_role(db, key="admin", permissions={"*": True})
        await create_card_type(db, key="Application", label="Application")
        admin = await create_user(db, email="admin@test.com", role="admin")
        card = await create_card(db, card_type="Application", name="Lonely", user_id=admin.id)

        with patch("app.services.notification_service.event_bus") as mock_bus:
            mock_bus.publish = AsyncMock()
            notifs = await create_notifications_for_subscribers(
                db,
                card_id=card.id,
                notif_type="card_updated",
                title="No Subscribers",
                actor_id=admin.id,
            )

        assert notifs == []

    async def test_actor_excluded_from_standard_type(self, db):
        """Actor (who triggered the action) should not receive notification."""
        await create_role(db, key="admin", permissions={"*": True})
        await create_card_type(db, key="Application", label="Application")
        actor = await create_user(db, email="actor@test.com", role="admin")
        other = await create_user(db, email="other@test.com", role="admin")
        card = await create_card(db, card_type="Application", name="App", user_id=actor.id)

        await _assign_stakeholder(db, card.id, actor.id)
        await _assign_stakeholder(db, card.id, other.id)

        with patch("app.services.notification_service.event_bus") as mock_bus:
            mock_bus.publish = AsyncMock()
            notifs = await create_notifications_for_subscribers(
                db,
                card_id=card.id,
                notif_type="card_updated",
                title="Self Excluded",
                actor_id=actor.id,
            )

        # Actor excluded, only 'other' gets notification
        assert len(notifs) == 1
        assert notifs[0].user_id == other.id

    async def test_inactive_stakeholder_user_excluded(self, db):
        """Inactive user should not get notification even as stakeholder."""
        await create_role(db, key="admin", permissions={"*": True})
        await create_card_type(db, key="Application", label="Application")
        admin = await create_user(db, email="admin@test.com", role="admin")
        inactive = await create_user(db, email="inactive@test.com", role="admin")
        inactive.is_active = False
        await db.flush()
        card = await create_card(db, card_type="Application", name="App", user_id=admin.id)

        await _assign_stakeholder(db, card.id, inactive.id)

        with patch("app.services.notification_service.event_bus") as mock_bus:
            mock_bus.publish = AsyncMock()
            notifs = await create_notifications_for_subscribers(
                db,
                card_id=card.id,
                notif_type="card_updated",
                title="Inactive Skip",
                actor_id=admin.id,
            )

        assert notifs == []

    async def test_nonexistent_card_returns_empty(self, db):
        """Subscriber notification for nonexistent card returns empty list."""
        await create_role(db, key="admin", permissions={"*": True})

        with patch("app.services.notification_service.event_bus") as mock_bus:
            mock_bus.publish = AsyncMock()
            notifs = await create_notifications_for_subscribers(
                db,
                card_id=uuid.uuid4(),
                notif_type="card_updated",
                title="Ghost Card",
            )

        assert notifs == []

    async def test_card_id_set_on_subscriber_notifications(self, db):
        """Each subscriber notification should have card_id set."""
        await create_role(db, key="admin", permissions={"*": True})
        await create_card_type(db, key="Application", label="Application")
        admin = await create_user(db, email="admin@test.com", role="admin")
        user = await create_user(db, email="user@test.com", role="admin")
        card = await create_card(db, card_type="Application", name="App", user_id=admin.id)
        await _assign_stakeholder(db, card.id, user.id)

        with patch("app.services.notification_service.event_bus") as mock_bus:
            mock_bus.publish = AsyncMock()
            notifs = await create_notifications_for_subscribers(
                db,
                card_id=card.id,
                notif_type="card_updated",
                title="Card Ref",
                actor_id=admin.id,
            )

        assert len(notifs) == 1
        assert notifs[0].card_id == card.id
