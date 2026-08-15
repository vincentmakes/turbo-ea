"""Tests for the once-per-upgrade "the app was updated" announcement.

The whole point of the marker is that a restart loop cannot spam every user in
the instance, so most of these assert that nothing happens.
"""

from __future__ import annotations

from sqlalchemy import select

from app.models.app_settings import AppSettings
from app.models.notification import Notification
from app.services import upgrade_announce
from app.services.upgrade_announce import (
    ANNOUNCED_FROM_KEY,
    ENABLED_SETTING,
    LAST_ANNOUNCED_KEY,
    NOTIFICATION_TYPE,
    announce_upgrade_if_needed,
    read_whats_new,
)
from tests.conftest import create_role, create_user


async def _settings(db, **general) -> AppSettings:
    row = AppSettings(id="default", email_settings={}, general_settings=general)
    db.add(row)
    await db.flush()
    return row


async def _general(db) -> dict:
    row = (await db.execute(select(AppSettings).where(AppSettings.id == "default"))).scalar_one()
    return row.general_settings or {}


async def _notifications(db) -> list[Notification]:
    result = await db.execute(select(Notification).where(Notification.type == NOTIFICATION_TYPE))
    return list(result.scalars().all())


async def _three_users(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions={"inventory.edit": True})
    return [
        await create_user(db, role="admin", email="a@example.com"),
        await create_user(db, role="member", email="b@example.com"),
        await create_user(db, role="member", email="c@example.com"),
    ]


class TestNothingToAnnounce:
    async def test_a_fresh_install_records_the_version_and_stays_quiet(self, db, monkeypatch):
        """First boot has no history — there is no upgrade to announce."""
        monkeypatch.setattr(upgrade_announce, "APP_VERSION", "2.60.0")
        await _three_users(db)

        notified = await announce_upgrade_if_needed(db)

        assert notified is None
        assert await _notifications(db) == []
        assert (await _general(db))[LAST_ANNOUNCED_KEY] == "2.60.0"

    async def test_a_restart_on_the_same_version_announces_nothing(self, db, monkeypatch):
        monkeypatch.setattr(upgrade_announce, "APP_VERSION", "2.60.0")
        await _three_users(db)
        await _settings(db, **{LAST_ANNOUNCED_KEY: "2.60.0"})

        assert await announce_upgrade_if_needed(db) is None
        assert await _notifications(db) == []

    async def test_a_rollback_announces_nothing(self, db, monkeypatch):
        """Running an older image is a deliberate operator act, not user news."""
        monkeypatch.setattr(upgrade_announce, "APP_VERSION", "2.59.0")
        await _three_users(db)
        await _settings(db, **{LAST_ANNOUNCED_KEY: "2.60.0"})

        assert await announce_upgrade_if_needed(db) is None
        assert await _notifications(db) == []
        assert (await _general(db))[LAST_ANNOUNCED_KEY] == "2.59.0"

    async def test_the_toggle_off_announces_nothing_but_still_advances(self, db, monkeypatch):
        """Advancing matters: re-enabling months later must not replay this."""
        monkeypatch.setattr(upgrade_announce, "APP_VERSION", "2.60.0")
        await _three_users(db)
        await _settings(db, **{LAST_ANNOUNCED_KEY: "2.57.0", ENABLED_SETTING: False})

        assert await announce_upgrade_if_needed(db) is None
        assert await _notifications(db) == []
        assert (await _general(db))[LAST_ANNOUNCED_KEY] == "2.60.0"

    async def test_the_second_boot_after_an_upgrade_is_a_no_op(self, db, monkeypatch):
        monkeypatch.setattr(upgrade_announce, "APP_VERSION", "2.60.0")
        await _three_users(db)
        await _settings(db, **{LAST_ANNOUNCED_KEY: "2.59.0"})

        first = await announce_upgrade_if_needed(db)
        second = await announce_upgrade_if_needed(db)

        assert (first, second) == (3, None)
        assert len(await _notifications(db)) == 3


class TestAnnouncing:
    async def test_every_active_user_is_notified_once(self, db, monkeypatch):
        monkeypatch.setattr(upgrade_announce, "APP_VERSION", "2.60.0")
        users = await _three_users(db)
        await _settings(db, **{LAST_ANNOUNCED_KEY: "2.57.0"})

        notified = await announce_upgrade_if_needed(db)

        assert notified == 3
        notifs = await _notifications(db)
        assert {n.user_id for n in notifs} == {u.id for u in users}
        assert "2.60.0" in notifs[0].title
        assert notifs[0].data["from_version"] == "2.57.0"
        assert notifs[0].data["to_version"] == "2.60.0"
        # No link: the notes come from the bundled changelog, not a web page.
        assert notifs[0].link is None

    async def test_the_announced_span_is_recorded_for_the_dialog(self, db, monkeypatch):
        monkeypatch.setattr(upgrade_announce, "APP_VERSION", "2.60.0")
        await _three_users(db)
        await _settings(db, **{LAST_ANNOUNCED_KEY: "2.57.0"})

        await announce_upgrade_if_needed(db)

        general = await _general(db)
        assert general[ANNOUNCED_FROM_KEY] == "2.57.0"
        assert general[LAST_ANNOUNCED_KEY] == "2.60.0"

    async def test_deactivated_users_are_skipped(self, db, monkeypatch):
        monkeypatch.setattr(upgrade_announce, "APP_VERSION", "2.60.0")
        users = await _three_users(db)
        users[2].is_active = False
        await db.flush()
        await _settings(db, **{LAST_ANNOUNCED_KEY: "2.59.0"})

        assert await announce_upgrade_if_needed(db) == 2
        assert {n.user_id for n in await _notifications(db)} == {users[0].id, users[1].id}

    async def test_a_user_who_muted_the_type_is_skipped(self, db, monkeypatch):
        monkeypatch.setattr(upgrade_announce, "APP_VERSION", "2.60.0")
        users = await _three_users(db)
        users[1].notification_preferences = {"in_app": {NOTIFICATION_TYPE: False}, "email": {}}
        await db.flush()
        await _settings(db, **{LAST_ANNOUNCED_KEY: "2.59.0"})

        assert await announce_upgrade_if_needed(db) == 2
        assert users[1].id not in {n.user_id for n in await _notifications(db)}

    async def test_no_email_is_sent_even_if_a_preference_says_otherwise(self, db, monkeypatch):
        """This type fans out to everyone — an email channel would make every
        patch release a mass mailing, so the backend refuses regardless."""
        sent: list[str] = []

        async def _boom(**kwargs):
            sent.append(kwargs.get("to", ""))
            return True

        monkeypatch.setattr(upgrade_announce, "APP_VERSION", "2.60.0")
        monkeypatch.setattr(
            "app.services.email_service.send_notification_email", _boom, raising=False
        )
        users = await _three_users(db)
        users[0].notification_preferences = {
            "in_app": {NOTIFICATION_TYPE: True},
            "email": {NOTIFICATION_TYPE: True},
        }
        await db.flush()
        await _settings(db, **{LAST_ANNOUNCED_KEY: "2.59.0"})

        await announce_upgrade_if_needed(db)

        assert sent == []
        assert all(n.is_emailed is False for n in await _notifications(db))


class TestReadWhatsNew:
    async def test_reports_the_announced_span(self, db, monkeypatch):
        monkeypatch.setattr(upgrade_announce, "APP_VERSION", "2.60.0")
        await _settings(db, **{ANNOUNCED_FROM_KEY: "2.59.0"})

        out = await read_whats_new(db)

        assert out["version"] == "2.60.0"
        assert out["from_version"] == "2.59.0"
        # Real bundled changelog: the span must include the current version.
        assert "## 2.60.0" in out["notes"]
        assert "## 2.59.0" not in out["notes"]

    async def test_falls_back_to_the_running_version_with_no_span(self, db, monkeypatch):
        monkeypatch.setattr(upgrade_announce, "APP_VERSION", "2.60.0")
        await _settings(db)

        out = await read_whats_new(db)

        assert out["from_version"] is None
        assert "## 2.60.0" in out["notes"]
        assert "## 2.59.1" not in out["notes"]

    async def test_an_unknown_running_version_yields_empty_notes(self, db, monkeypatch):
        monkeypatch.setattr(upgrade_announce, "APP_VERSION", "99.99.99")
        await _settings(db)

        out = await read_whats_new(db)

        assert out["version"] == "99.99.99"
        assert out["notes"] == ""
