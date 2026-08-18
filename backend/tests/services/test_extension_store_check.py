"""Tests for the daily "new / updated extensions in the store" check.

Covers the properties the feature promises: it never mistakes an older or
unparseable catalogue version for an upgrade, it notifies exactly the users whose
role can act on it, it announces a given thing once rather than every day, it
stays quiet the first time it ever meets the catalogue, and it collapses a busy
release day into one digest per type instead of one row per extension.
"""

from __future__ import annotations

import httpx
import pytest
from sqlalchemy import select

from app.models.app_settings import AppSettings
from app.models.extension import Extension
from app.models.notification import Notification
from app.services import extension_store_check as check
from app.services.extension_store_check import (
    NEW_NOTIFICATION_TYPE,
    UPDATE_NOTIFICATION_TYPE,
    classify,
    extension_notices_enabled,
    installed_versions,
    record_result,
)
from app.services.extensions import store_catalog
from app.services.extensions.store_catalog import (
    STORE_USER_AGENT,
    classify_store_error,
    fetch_store_catalog,
    fetch_store_catalog_safe,
    store_client,
    store_update_available,
)
from tests.conftest import create_role, create_user

STORE = "https://store.example.com"


# ---------------------------------------------------------------------------
# Version comparison
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("store_version", "installed", "expected"),
    [
        ("1.1.0", "1.0.0", True),
        ("1.0.1", "1.0.0", True),
        ("2.0.0", "1.9.9", True),
        ("1.10.0", "1.9.0", True),  # not a string comparison
        ("1.0.0", "1.0.0", False),
        ("1.0.0", "1.1.0", False),  # a downgrade is never an update
        # Nothing without a digit may take part in a comparison, in either
        # direction — a rolling tag must neither announce itself nor mask a
        # genuine release.
        ("nightly", "1.0.0", False),
        ("1.0.0", "nightly", False),
        ("", "1.0.0", False),
        ("1.0.0", "", False),
        ("1.0.0", None, False),
    ],
)
def test_store_update_available(store_version, installed, expected):
    assert store_update_available(store_version, installed) is expected


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
    monkeypatch.setattr(store_catalog.httpx, "AsyncClient", _FakeClient)
    return _FakeClient


async def test_fetch_returns_the_extensions_list(fake_http):
    fake_http.response = _FakeResponse({"extensions": [{"key": "a", "version": "1.0.0"}]})

    items = await fetch_store_catalog(STORE)

    assert items == [{"key": "a", "version": "1.0.0"}]
    assert fake_http.calls == [f"{STORE}/catalog.json"]


async def test_fetch_drops_entries_with_no_key(fake_http):
    fake_http.response = _FakeResponse({"extensions": [{"key": "a"}, {"name": "no key"}, "junk"]})

    assert await fetch_store_catalog(STORE) == [{"key": "a"}]


async def test_fetch_rejects_a_payload_with_no_extensions_list(fake_http):
    fake_http.response = _FakeResponse({"nope": []})

    with pytest.raises(ValueError):
        await fetch_store_catalog(STORE)


async def test_safe_fetch_reports_an_unreachable_store_without_raising(fake_http):
    """Air-gapped installs must not see a stack trace every day."""
    fake_http.raises = httpx.ConnectError("no route to host")

    items, error = await fetch_store_catalog_safe(STORE)

    assert items is None
    assert error == "Could not reach the extension store"


# ---------------------------------------------------------------------------
# The enabled flag
# ---------------------------------------------------------------------------


async def test_notices_are_enabled_by_default(db):
    assert await extension_notices_enabled(db) is True


async def test_notices_respect_the_admin_toggle(db):
    db.add(AppSettings(id="default", general_settings={"extensionNoticesEnabled": False}))
    await db.flush()

    assert await extension_notices_enabled(db) is False


async def test_run_makes_no_request_when_disabled(db, fake_http, monkeypatch):
    """Off must stop the outbound call itself, not merely mute the notification."""
    db.add(AppSettings(id="default", general_settings={"extensionNoticesEnabled": False}))
    await db.commit()

    class _Session:
        async def __aenter__(self):
            return db

        async def __aexit__(self, *exc):
            return False

    monkeypatch.setattr("app.database.async_session", lambda: _Session())
    monkeypatch.setattr(check.settings, "EXTENSION_STORE_URL", STORE)

    await check.run_extension_store_check()

    assert fake_http.calls == []


async def test_run_makes_no_request_when_the_store_is_unconfigured(fake_http, monkeypatch):
    monkeypatch.setattr(check.settings, "EXTENSION_STORE_URL", "")

    await check.run_extension_store_check()

    assert fake_http.calls == []


# ---------------------------------------------------------------------------
# classify — the pure decision
# ---------------------------------------------------------------------------


def _catalogue(*entries: tuple[str, str, str]) -> list[dict]:
    return [{"key": k, "name": n, "version": v} for k, n, v in entries]


def test_an_installed_extension_with_a_newer_version_is_an_update():
    changes = classify(
        _catalogue(("a", "Acme", "1.1.0")),
        installed={"a": "1.0.0"},
        known_keys={"a"},
        notified_versions={},
        seeded=True,
    )

    assert not changes.new
    assert [u.key for u in changes.updates] == ["a"]
    assert changes.updates[0].installed_version == "1.0.0"
    assert changes.updates[0].store_version == "1.1.0"


def test_an_already_announced_version_is_not_repeated():
    changes = classify(
        _catalogue(("a", "Acme", "1.1.0")),
        installed={"a": "1.0.0"},
        known_keys={"a"},
        notified_versions={"a": "1.1.0"},
        seeded=True,
    )

    assert not changes


def test_an_unseen_uninstalled_key_is_new():
    changes = classify(
        _catalogue(("b", "Beta", "1.0.0")),
        installed={},
        known_keys=set(),
        notified_versions={},
        seeded=True,
    )

    assert [n.key for n in changes.new] == ["b"]
    assert not changes.updates


def test_an_installed_extension_is_never_announced_as_new():
    """A file-installed extension that later appears in the store is not news."""
    changes = classify(
        _catalogue(("a", "Acme", "1.0.0")),
        installed={"a": "1.0.0"},
        known_keys=set(),
        notified_versions={},
        seeded=True,
    )

    assert not changes


def test_nothing_is_new_before_the_first_catalogue_has_been_seen():
    changes = classify(
        _catalogue(("a", "Acme", "1.0.0"), ("b", "Beta", "2.0.0")),
        installed={},
        known_keys=set(),
        notified_versions={},
        seeded=False,
    )

    assert not changes


def test_updates_are_reported_even_on_the_very_first_run():
    """Seeding guards the catalogue-sized branch, not the installed-sized one."""
    changes = classify(
        _catalogue(("a", "Acme", "1.1.0")),
        installed={"a": "1.0.0"},
        known_keys=set(),
        notified_versions={},
        seeded=False,
    )

    assert [u.key for u in changes.updates] == ["a"]


# ---------------------------------------------------------------------------
# Recipients
# ---------------------------------------------------------------------------


async def _notifications(db, notif_type: str) -> list[Notification]:
    result = await db.execute(select(Notification).where(Notification.type == notif_type))
    return list(result.scalars().all())


async def _state(db) -> dict:
    row = (await db.execute(select(AppSettings).where(AppSettings.id == "default"))).scalar_one()
    return (row.general_settings or {}).get("extensionStoreCheck") or {}


async def _seeded(db) -> None:
    """Put the instance in the post-first-fetch state, with nothing known."""
    db.add(
        AppSettings(
            id="default",
            general_settings={"extensionStoreCheck": {"seeded": True, "knownKeys": []}},
        )
    )
    await db.flush()


async def test_recipients_are_resolved_by_permission_not_by_role_name(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="ops", label="Ops", permissions={"admin.manage_extensions": True})
    # admin.settings owns the *switch*, not the notification — it must not
    # by itself make someone a recipient.
    await create_role(db, key="cfg", label="Config", permissions={"admin.settings": True})
    await create_role(db, key="member", label="Member", permissions={"inventory.edit": True})

    admin = await create_user(db, role="admin", email="admin@example.com")
    ops = await create_user(db, role="ops", email="ops@example.com")
    await create_user(db, role="cfg", email="cfg@example.com")
    await create_user(db, role="member", email="member@example.com")
    await _seeded(db)

    created = await record_result(db, items=_catalogue(("b", "Beta", "1.0.0")), error=None)

    assert created == 2
    notified = {n.user_id for n in await _notifications(db, NEW_NOTIFICATION_TYPE)}
    assert notified == {admin.id, ops.id}


# ---------------------------------------------------------------------------
# Recording the result
# ---------------------------------------------------------------------------


async def _one_admin(db):
    await create_role(db, key="admin", permissions={"*": True})
    return await create_user(db, role="admin", email="a@example.com")


async def test_the_first_successful_fetch_seeds_silently(db):
    await _one_admin(db)

    created = await record_result(
        db, items=_catalogue(("a", "Acme", "1.0.0"), ("b", "Beta", "2.0.0")), error=None
    )

    assert created == 0
    assert await _notifications(db, NEW_NOTIFICATION_TYPE) == []
    state = await _state(db)
    assert state["seeded"] is True
    assert state["knownKeys"] == ["a", "b"]


async def test_a_key_that_appears_after_seeding_is_announced_once(db):
    await _one_admin(db)
    await record_result(db, items=_catalogue(("a", "Acme", "1.0.0")), error=None)

    created = await record_result(
        db, items=_catalogue(("a", "Acme", "1.0.0"), ("b", "Beta", "1.0.0")), error=None
    )
    assert created == 1
    notifs = await _notifications(db, NEW_NOTIFICATION_TYPE)
    assert len(notifs) == 1
    assert "Beta" in notifs[0].title
    assert notifs[0].link == "/admin/extensions?tab=store"

    # A second identical run says nothing more.
    assert (
        await record_result(
            db, items=_catalogue(("a", "Acme", "1.0.0"), ("b", "Beta", "1.0.0")), error=None
        )
        == 0
    )
    assert len(await _notifications(db, NEW_NOTIFICATION_TYPE)) == 1


async def test_an_installed_extension_update_is_announced_once_per_version(db):
    await _one_admin(db)
    db.add(Extension(key="a", name="Acme", version="1.0.0", status="installed"))
    await db.flush()

    assert await record_result(db, items=_catalogue(("a", "Acme", "1.1.0")), error=None) == 1
    notifs = await _notifications(db, UPDATE_NOTIFICATION_TYPE)
    assert len(notifs) == 1
    assert "1.1.0" in notifs[0].title
    assert notifs[0].data["extensions"][0]["installed_version"] == "1.0.0"
    assert (await _state(db))["notifiedVersions"] == {"a": "1.1.0"}

    # Same catalogue tomorrow: nothing.
    assert await record_result(db, items=_catalogue(("a", "Acme", "1.1.0")), error=None) == 0

    # A further release: announced again.
    assert await record_result(db, items=_catalogue(("a", "Acme", "1.2.0")), error=None) == 1
    assert len(await _notifications(db, UPDATE_NOTIFICATION_TYPE)) == 2


async def test_installing_the_update_clears_the_pending_stamp(db):
    await _one_admin(db)
    ext = Extension(key="a", name="Acme", version="1.0.0", status="installed")
    db.add(ext)
    await db.flush()
    await record_result(db, items=_catalogue(("a", "Acme", "1.1.0")), error=None)

    ext.version = "1.1.0"
    await db.flush()
    created = await record_result(db, items=_catalogue(("a", "Acme", "1.1.0")), error=None)

    assert created == 0
    assert (await _state(db))["notifiedVersions"] == {}


async def test_a_removed_extension_does_not_count_as_installed(db):
    db.add(Extension(key="a", name="Acme", version="1.0.0", status="removed"))
    await db.flush()

    assert await installed_versions(db) == {}


async def test_a_disabled_extension_still_gets_update_notices(db):
    await _one_admin(db)
    db.add(Extension(key="a", name="Acme", version="1.0.0", status="disabled", enabled=False))
    await db.flush()

    assert await record_result(db, items=_catalogue(("a", "Acme", "1.1.0")), error=None) == 1


async def test_a_catalogue_downgrade_is_never_announced(db):
    await _one_admin(db)
    db.add(Extension(key="a", name="Acme", version="1.0.0", status="installed"))
    await db.flush()

    assert await record_result(db, items=_catalogue(("a", "Acme", "0.9.0")), error=None) == 0


async def test_many_changes_produce_one_digest_per_type(db):
    admin = await _one_admin(db)
    db.add(Extension(key="a", name="Acme", version="1.0.0", status="installed"))
    db.add(Extension(key="b", name="Beta", version="1.0.0", status="installed"))
    await db.flush()
    await _seeded(db)

    created = await record_result(
        db,
        items=_catalogue(
            ("a", "Acme", "1.1.0"),
            ("b", "Beta", "2.0.0"),
            ("c", "Gamma", "1.0.0"),
            ("d", "Delta", "1.0.0"),
            ("e", "Epsilon", "1.0.0"),
        ),
        error=None,
    )

    # Two rows for one admin: one "new" digest, one "updates" digest.
    assert created == 2
    new = await _notifications(db, NEW_NOTIFICATION_TYPE)
    updates = await _notifications(db, UPDATE_NOTIFICATION_TYPE)
    assert len(new) == 1 and len(updates) == 1
    assert new[0].user_id == admin.id
    assert new[0].data["count"] == 3
    assert "3 new extensions" in new[0].title
    assert updates[0].data["count"] == 2
    assert "2 extension updates" in updates[0].title


async def test_an_admin_who_muted_the_types_is_not_notified_but_state_advances(db):
    await create_role(db, key="admin", permissions={"*": True})
    user = await create_user(db, role="admin", email="a@example.com")
    user.notification_preferences = {
        "in_app": {"extension_available": False, "extension_update_available": False}
    }
    await db.flush()
    await _seeded(db)

    created = await record_result(db, items=_catalogue(("b", "Beta", "1.0.0")), error=None)

    assert created == 0
    assert "b" in (await _state(db))["knownKeys"]


async def test_an_unreachable_store_records_the_error_and_stays_quiet(db):
    await _one_admin(db)

    created = await record_result(db, items=None, error="Could not reach the extension store")

    assert created == 0
    state = await _state(db)
    assert state["error"] == "Could not reach the extension store"
    assert state["checkedAt"]
    # Crucially: an install that has never reached the store is still un-seeded,
    # so the day it first gets through it seeds silently rather than announcing
    # the entire catalogue.
    assert state.get("seeded") is not True


async def test_known_keys_survive_an_empty_catalogue(db):
    """A partial or empty response must not make everything look new again."""
    await _one_admin(db)
    await record_result(db, items=_catalogue(("a", "Acme", "1.0.0")), error=None)

    await record_result(db, items=[], error=None)
    assert (await _state(db))["knownKeys"] == ["a"]

    # And the extension coming back is not re-announced.
    assert await record_result(db, items=_catalogue(("a", "Acme", "1.0.0")), error=None) == 0


async def test_an_unparseable_catalogue_version_is_seen_but_never_an_update(db):
    await _one_admin(db)
    db.add(Extension(key="a", name="Acme", version="1.0.0", status="installed"))
    await db.flush()

    assert await record_result(db, items=_catalogue(("a", "Acme", "nightly")), error=None) == 0
    assert (await _state(db))["knownKeys"] == ["a"]


# ---------------------------------------------------------------------------
# Talking to the store: identity, and telling "blocked" from "offline"
# ---------------------------------------------------------------------------


def test_every_store_call_identifies_itself():
    """httpx's default user agent is what bot protection rejects (#958).

    A stable, distinctive one is what a store operator or a customer proxy can
    allowlist, so it must be on the client every store call is built from.
    """
    client = store_client(1.0)
    assert client.headers["user-agent"] == STORE_USER_AGENT
    assert STORE_USER_AGENT.startswith("TurboEA/")
    assert "httpx" not in STORE_USER_AGENT


def test_a_refusal_is_blocked_and_carries_its_status():
    request = httpx.Request("GET", f"{STORE}/catalog.json")
    response = httpx.Response(403, request=request)
    exc = httpx.HTTPStatusError("refused", request=request, response=response)

    assert classify_store_error(exc) == ("blocked", 403)


def test_a_transport_failure_is_offline():
    """Only this may be reported to an admin as air-gapped."""
    assert classify_store_error(httpx.ConnectError("no route")) == ("offline", None)
    assert classify_store_error(ValueError("bad payload")) == ("offline", None)


async def test_safe_fetch_says_refused_rather_than_unreachable(fake_http):
    request = httpx.Request("GET", f"{STORE}/catalog.json")
    response = httpx.Response(403, request=request)
    fake_http.raises = httpx.HTTPStatusError("refused", request=request, response=response)

    items, error = await fetch_store_catalog_safe(STORE)

    assert items is None
    assert "refused" in error and "403" in error


async def test_safe_fetch_stays_quiet_when_there_is_no_route(fake_http):
    fake_http.raises = httpx.ConnectError("no route")

    items, error = await fetch_store_catalog_safe(STORE)

    assert items is None
    assert error == "Could not reach the extension store"
