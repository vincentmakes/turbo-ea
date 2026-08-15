"""Tests for the daily "a newer release is available" check.

Covers the three properties the feature promises: it never mistakes an older or
unparseable tag for an upgrade, it notifies exactly the users whose role can act
on it, and it announces a given version once rather than every single day.
"""

from __future__ import annotations

import httpx
import pytest
from sqlalchemy import select

from app.config import settings as app_config
from app.models.app_settings import AppSettings
from app.models.notification import Notification
from app.services import update_check
from app.services.update_check import (
    NOTIFICATION_TYPE,
    ReleaseInfo,
    admin_recipient_ids,
    fetch_latest_release,
    is_newer,
    record_result,
    update_check_enabled,
)
from tests.conftest import create_role, create_user

# ---------------------------------------------------------------------------
# Version comparison
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("latest", "current", "expected"),
    [
        ("2.60.0", "2.59.1", True),
        ("2.59.2", "2.59.1", True),
        ("3.0.0", "2.59.1", True),
        ("2.59.1", "2.59.1", False),
        ("2.59.0", "2.59.1", False),
        ("2.9.0", "2.10.0", False),  # not a string comparison
        ("2.10.0", "2.9.0", True),
        # A tag that is not a version must never read as an upgrade.
        ("nightly", "2.59.1", False),
        ("", "2.59.1", False),
    ],
)
def test_is_newer(latest: str, current: str, expected: bool):
    assert is_newer(latest, current) is expected


# ---------------------------------------------------------------------------
# The HTTP probe
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("boom", request=None, response=None)

    def json(self):
        return self._payload


class _FakeClient:
    """Stands in for httpx.AsyncClient, recording the calls it receives."""

    calls: list[str] = []
    response: object = None
    raises: Exception | None = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, **kwargs):
        type(self).calls.append(url)
        if type(self).raises is not None:
            raise type(self).raises
        return type(self).response


@pytest.fixture
def fake_http(monkeypatch):
    _FakeClient.calls = []
    _FakeClient.response = None
    _FakeClient.raises = None
    monkeypatch.setattr(update_check.httpx, "AsyncClient", _FakeClient)
    return _FakeClient


async def test_fetch_strips_the_v_prefix_and_keeps_the_release_url(fake_http):
    fake_http.response = _FakeResponse(
        {
            "tag_name": "v2.60.0",
            "html_url": "https://github.com/vincentmakes/turbo-ea/releases/tag/v2.60.0",
        }
    )

    release, error = await fetch_latest_release()

    assert error is None
    assert release == ReleaseInfo(
        version="2.60.0",
        url="https://github.com/vincentmakes/turbo-ea/releases/tag/v2.60.0",
    )
    assert fake_http.calls == [update_check.GITHUB_LATEST_RELEASE_URL]


async def test_fetch_falls_back_to_the_releases_page_when_the_url_is_unusable(fake_http):
    fake_http.response = _FakeResponse({"tag_name": "2.60.0", "html_url": None})

    release, error = await fetch_latest_release()

    assert error is None
    assert release.version == "2.60.0"
    assert release.url == "https://github.com/vincentmakes/turbo-ea/releases"


async def test_fetch_keeps_the_release_body_as_notes(fake_http):
    fake_http.response = _FakeResponse(
        {
            "tag_name": "v2.60.0",
            "html_url": "https://example.com/r",
            "body": "\n### Added\n- Something new\n",
        }
    )

    release, error = await fetch_latest_release()

    assert error is None
    assert release.notes == "### Added\n- Something new"


async def test_fetch_caps_an_oversized_release_body(fake_http):
    """The notes land on the singleton settings row every read touches."""
    fake_http.response = _FakeResponse(
        {"tag_name": "2.60.0", "html_url": "https://example.com/r", "body": "x" * 50_000}
    )

    release, _ = await fetch_latest_release()

    assert len(release.notes) <= update_check.MAX_RELEASE_NOTES_CHARS + 4
    assert release.notes.endswith("…")


async def test_fetch_tolerates_a_release_with_no_body(fake_http):
    fake_http.response = _FakeResponse({"tag_name": "2.60.0", "html_url": "https://example.com/r"})

    release, error = await fetch_latest_release()

    assert error is None
    assert release.notes == ""


async def test_fetch_reports_an_unreachable_github_without_raising(fake_http):
    """Air-gapped installs must not see a stack trace every day."""
    fake_http.raises = httpx.ConnectError("no route to host")

    release, error = await fetch_latest_release()

    assert release is None
    assert error == "Could not reach GitHub"


async def test_fetch_rejects_a_payload_with_no_tag(fake_http):
    fake_http.response = _FakeResponse({"html_url": "https://example.com"})

    release, error = await fetch_latest_release()

    assert release is None
    assert error == "Malformed release payload"


# ---------------------------------------------------------------------------
# The enabled flag
# ---------------------------------------------------------------------------


async def test_update_check_is_enabled_by_default(db):
    assert await update_check_enabled(db) is True


async def test_update_check_respects_the_admin_toggle(db):
    db.add(AppSettings(id="default", general_settings={"updateCheckEnabled": False}))
    await db.flush()

    assert await update_check_enabled(db) is False


async def test_run_update_check_makes_no_request_when_disabled(db, fake_http, monkeypatch):
    """Off must stop the outbound call itself, not merely mute the notification."""
    db.add(AppSettings(id="default", general_settings={"updateCheckEnabled": False}))
    await db.commit()

    class _Session:
        async def __aenter__(self):
            return db

        async def __aexit__(self, *exc):
            return False

    monkeypatch.setattr("app.database.async_session", lambda: _Session())

    await update_check.run_update_check()

    assert fake_http.calls == []


# ---------------------------------------------------------------------------
# Recipients
# ---------------------------------------------------------------------------


async def test_recipients_are_resolved_by_permission_not_by_role_name(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="ops", label="Ops", permissions={"admin.settings": True})
    await create_role(db, key="member", label="Member", permissions={"inventory.edit": True})

    admin = await create_user(db, role="admin", email="admin@example.com")
    ops = await create_user(db, role="ops", email="ops@example.com")
    await create_user(db, role="member", email="member@example.com")

    ids = await admin_recipient_ids(db)

    assert set(ids) == {admin.id, ops.id}


async def test_deactivated_admins_are_not_notified(db):
    await create_role(db, key="admin", permissions={"*": True})
    active = await create_user(db, role="admin", email="active@example.com")
    dormant = await create_user(db, role="admin", email="dormant@example.com")
    dormant.is_active = False
    await db.flush()

    ids = await admin_recipient_ids(db)

    assert ids == [active.id]


# ---------------------------------------------------------------------------
# Recording the result
# ---------------------------------------------------------------------------


async def _notifications(db) -> list[Notification]:
    result = await db.execute(select(Notification).where(Notification.type == NOTIFICATION_TYPE))
    return list(result.scalars().all())


async def _state(db) -> dict:
    row = (await db.execute(select(AppSettings).where(AppSettings.id == "default"))).scalar_one()
    return (row.general_settings or {}).get("updateCheck") or {}


async def test_a_newer_release_notifies_every_admin(db, monkeypatch):
    monkeypatch.setattr(update_check, "APP_VERSION", "2.59.1")
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions={"inventory.edit": True})
    await create_user(db, role="admin", email="a@example.com")
    await create_user(db, role="admin", email="b@example.com")
    await create_user(db, role="member", email="c@example.com")

    created = await record_result(
        db, release=ReleaseInfo(version="2.60.0", url="https://example.com/r"), error=None
    )

    assert created == 2
    notifs = await _notifications(db)
    assert len(notifs) == 2
    assert "2.60.0" in notifs[0].title
    assert notifs[0].link == "https://example.com/r"
    assert notifs[0].data["current_version"] == "2.59.1"
    assert notifs[0].data["latest_version"] == "2.60.0"
    assert (await _state(db))["notifiedVersion"] == "2.60.0"


async def test_the_notification_title_uses_the_configured_instance_name(db, monkeypatch):
    """A white-labelled install must not announce itself as "Turbo EA"."""
    monkeypatch.setattr(update_check, "APP_VERSION", "2.59.1")
    monkeypatch.setattr(app_config, "APP_TITLE", "Acme Architecture")
    await create_role(db, key="admin", permissions={"*": True})
    await create_user(db, role="admin", email="a@example.com")

    await record_result(
        db, release=ReleaseInfo(version="2.60.0", url="https://example.com/r"), error=None
    )

    assert (await _notifications(db))[0].title == "Acme Architecture 2.60.0 is available"


async def test_the_same_version_is_announced_only_once(db, monkeypatch):
    """An instance sitting a release behind for a month gets one notification."""
    monkeypatch.setattr(update_check, "APP_VERSION", "2.59.1")
    await create_role(db, key="admin", permissions={"*": True})
    await create_user(db, role="admin", email="a@example.com")
    release = ReleaseInfo(version="2.60.0", url="https://example.com/r")

    first = await record_result(db, release=release, error=None)
    second = await record_result(db, release=release, error=None)

    assert (first, second) == (1, 0)
    assert len(await _notifications(db)) == 1


async def test_a_further_release_notifies_again(db, monkeypatch):
    monkeypatch.setattr(update_check, "APP_VERSION", "2.59.1")
    await create_role(db, key="admin", permissions={"*": True})
    await create_user(db, role="admin", email="a@example.com")

    await record_result(
        db, release=ReleaseInfo(version="2.60.0", url="https://example.com/a"), error=None
    )
    created = await record_result(
        db, release=ReleaseInfo(version="2.61.0", url="https://example.com/b"), error=None
    )

    assert created == 1
    assert len(await _notifications(db)) == 2


async def test_running_the_latest_version_notifies_nobody(db, monkeypatch):
    monkeypatch.setattr(update_check, "APP_VERSION", "2.60.0")
    await create_role(db, key="admin", permissions={"*": True})
    await create_user(db, role="admin", email="a@example.com")

    created = await record_result(
        db, release=ReleaseInfo(version="2.60.0", url="https://example.com/r"), error=None
    )

    assert created == 0
    assert await _notifications(db) == []
    state = await _state(db)
    assert state["latestVersion"] == "2.60.0"
    assert "notifiedVersion" not in state


async def test_read_status_reports_the_cached_notes(db, monkeypatch):
    monkeypatch.setattr(update_check, "APP_VERSION", "2.59.1")
    await record_result(
        db,
        release=ReleaseInfo(version="2.60.0", url="https://example.com/r", notes="### Added\n- x"),
        error=None,
    )

    status = await update_check.read_status(db)

    assert status["latest_version"] == "2.60.0"
    assert status["release_notes"] == "### Added\n- x"
    assert status["release_url"] == "https://example.com/r"
    assert status["update_available"] is True
    assert status["enabled"] is True


async def test_read_status_reports_no_update_when_current(db, monkeypatch):
    monkeypatch.setattr(update_check, "APP_VERSION", "2.60.0")
    await record_result(
        db, release=ReleaseInfo(version="2.60.0", url="https://example.com/r"), error=None
    )

    status = await update_check.read_status(db)

    assert status["update_available"] is False


async def test_a_failed_probe_records_the_error_and_notifies_nobody(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_user(db, role="admin", email="a@example.com")

    created = await record_result(db, release=None, error="Could not reach GitHub")

    assert created == 0
    assert await _notifications(db) == []
    state = await _state(db)
    assert state["error"] == "Could not reach GitHub"
    assert state["checkedAt"]


async def test_an_admin_who_muted_the_type_is_not_notified(db, monkeypatch):
    """Muting is per user — and a muted admin must not block the version stamp,
    or the check would retry the same version every day forever."""
    monkeypatch.setattr(update_check, "APP_VERSION", "2.59.1")
    await create_role(db, key="admin", permissions={"*": True})
    user = await create_user(db, role="admin", email="a@example.com")
    user.notification_preferences = {"in_app": {NOTIFICATION_TYPE: False}, "email": {}}
    await db.flush()

    created = await record_result(
        db, release=ReleaseInfo(version="2.60.0", url="https://example.com/r"), error=None
    )

    assert created == 0
    assert await _notifications(db) == []
    assert (await _state(db))["notifiedVersion"] == "2.60.0"
