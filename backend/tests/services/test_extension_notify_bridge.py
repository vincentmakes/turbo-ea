"""The SDK notification bridge (SDK 1.9): grant gating, delivery through the
recipient's own preferences under the generic ``extension_notice`` type,
in-app-only links, recipient caps, and the ``ext`` provenance stamp."""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.config import settings
from app.models.notification import Notification
from app.models.user import NOTIFICATION_TYPE_SPECS_BY_KEY
from app.services import notification_service
from app.services.extensions import notify_bridge as bridge_mod
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.notify_bridge import ExtensionNotify
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.sdk import ExtensionDataError, ExtensionPermissionError
from tests.conftest import create_card, create_card_type, create_user

NOW = datetime.now(timezone.utc)
KEY = "sample-rules"


def load_registry(*, grants: list[str], enabled: bool = True) -> None:
    extension_registry.clear()
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=KEY,
                name="Sample Rules",
                version="1.0.0",
                status="installed",
                enabled=enabled,
                manifest={"grants": grants},
            )
        ]
    )
    extension_registry.set_license(
        LicenseDocument(
            licensee="ACME",
            customer_id="cus_1",
            issued_at=NOW - timedelta(days=1),
            grace_days=30,
            entitlements=[Entitlement(extension_key=KEY, expires_at=None)],
        )
    )


@pytest.fixture(autouse=True)
def _registry_cleanup():
    extension_registry.clear()
    yield
    extension_registry.clear()


@pytest.fixture(autouse=True)
def _patch_sessions(monkeypatch, db):
    @asynccontextmanager
    async def fake_session():
        yield db

    monkeypatch.setattr(bridge_mod, "async_session", fake_session)
    # deliver_notification_batch imports the factory lazily from app.database.
    import app.database as database_mod

    monkeypatch.setattr(database_mod, "async_session", fake_session)


@pytest.fixture
async def env(db):
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="Billing")
    a = await create_user(db, email="a@test.com", role="member", display_name="A")
    b = await create_user(db, email="b@test.com", role="member", display_name="B")
    gone = await create_user(db, email="gone@test.com", role="member")
    gone.is_active = False
    await db.flush()
    return {"card": card, "a": a, "b": b, "gone": gone}


async def _rows(db) -> list[Notification]:
    return list(
        (await db.execute(select(Notification).order_by(Notification.created_at))).scalars().all()
    )


def test_extension_notice_is_a_registered_configurable_type():
    spec = NOTIFICATION_TYPE_SPECS_BY_KEY["extension_notice"]
    assert spec.in_app_default is True
    assert spec.email_default is False
    assert spec.in_app_only is False
    assert spec.user_configurable is True


class TestGating:
    async def test_requires_the_send_grant(self, db, env):
        load_registry(grants=["core.cards.write", "core.notifications.channel"])
        with pytest.raises(ExtensionPermissionError):
            await ExtensionNotify(KEY).send([str(env["a"].id)], title="Hi")
        assert await _rows(db) == []

    async def test_disabled_extension_and_kill_switch(self, db, env, monkeypatch):
        load_registry(grants=["core.notifications.send"], enabled=False)
        with pytest.raises(ExtensionPermissionError):
            await ExtensionNotify(KEY).send([str(env["a"].id)], title="Hi")
        load_registry(grants=["core.notifications.send"])
        monkeypatch.setattr(settings, "EXTENSION_WRITES_ENABLED", False)
        with pytest.raises(ExtensionPermissionError):
            await ExtensionNotify(KEY).send([str(env["a"].id)], title="Hi")
        assert await _rows(db) == []


class TestSend:
    async def test_delivers_to_active_recipients_with_provenance(self, db, env):
        load_registry(grants=["core.notifications.send"])
        count = await ExtensionNotify(KEY).send(
            [str(env["a"].id), str(env["b"].id), str(env["a"].id), str(env["gone"].id)],
            title="Rule fired",
            message="Billing crossed the cost threshold",
            link=f"/cards/{env['card'].id}",
            card_id=str(env["card"].id),
            data={"rule": "r1"},
        )
        assert count == 2
        rows = await _rows(db)
        assert {r.user_id for r in rows} == {env["a"].id, env["b"].id}
        for r in rows:
            assert r.type == "extension_notice"
            assert r.title == "Rule fired"
            assert r.link == f"/cards/{env['card'].id}"
            assert r.card_id == env["card"].id
            assert r.actor_id is None
            assert r.data == {"rule": "r1", "ext": KEY}
            assert r.is_emailed is False

    async def test_recipient_preferences_decide(self, db, env):
        load_registry(grants=["core.notifications.send"])
        env["a"].notification_preferences = {"in_app": {"extension_notice": False}}
        await db.flush()
        count = await ExtensionNotify(KEY).send(
            [str(env["a"].id), str(env["b"].id)], title="Muted for A"
        )
        # Counted as addressed; the bell row exists only for B.
        assert count == 2
        rows = await _rows(db)
        assert [r.user_id for r in rows] == [env["b"].id]

    async def test_no_active_recipients_is_a_noop(self, db, env):
        load_registry(grants=["core.notifications.send"])
        bridge = ExtensionNotify(KEY)
        assert await bridge.send([], title="x") == 0
        assert await bridge.send([str(env["gone"].id), str(uuid.uuid4())], title="x") == 0
        assert await _rows(db) == []

    async def test_validation(self, db, env):
        load_registry(grants=["core.notifications.send"])
        bridge = ExtensionNotify(KEY)
        uid = str(env["a"].id)
        with pytest.raises(ExtensionDataError):
            await bridge.send([uid], title="  ")
        with pytest.raises(ExtensionDataError):
            await bridge.send([uid], title="x" * 201)
        with pytest.raises(ExtensionDataError):
            await bridge.send([uid], title="x", message="m" * 2001)
        with pytest.raises(ExtensionDataError):
            await bridge.send([uid], title="x", link="https://evil.example/phish")
        with pytest.raises(ExtensionDataError):
            await bridge.send([uid], title="x", link="//evil.example")
        with pytest.raises(ExtensionDataError):
            await bridge.send(["nope"], title="x")
        with pytest.raises(ExtensionDataError):
            await bridge.send([str(uuid.uuid4()) for _ in range(51)], title="x")
        with pytest.raises(ExtensionDataError, match="not found"):
            await bridge.send([uid], title="x", card_id=str(uuid.uuid4()))
        with pytest.raises(ExtensionDataError):
            await bridge.send([uid], title="x", data=["not", "a", "dict"])  # type: ignore[arg-type]
        assert await _rows(db) == []

    async def test_goes_through_the_batch_deliverer_not_inline_create(self, db, env, monkeypatch):
        """The batch path is what keeps a session from being held across
        SMTP; the bridge must never call create_notification directly."""
        load_registry(grants=["core.notifications.send"])
        calls: list[str] = []
        real = notification_service.deliver_notification_batch

        async def spy(recipients, *, notif_type, actor_id=None):
            calls.append(notif_type)
            await real(recipients, notif_type=notif_type, actor_id=actor_id)

        monkeypatch.setattr(bridge_mod.notification_service, "deliver_notification_batch", spy)
        await ExtensionNotify(KEY).send([str(env["a"].id)], title="x")
        assert calls == ["extension_notice"]
