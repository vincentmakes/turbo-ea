"""Extension notification channels: registration, gating, isolation, backpressure.

The load-bearing guard here is ``test_dispatch_is_not_a_coroutine``. Core calls
``dispatch`` from ``create_notification`` with the emitting request's
transaction still open, so the moment it grows an ``await`` it starts holding a
pooled connection across extension work — the failure mode this codebase has
shipped twice.
"""

from __future__ import annotations

import asyncio
import inspect
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.services.extensions import notification_channels as nc
from app.services.extensions.jobs import reset_contexts
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.loader import LoadedExtension, LoadReport
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.sdk import NotificationChannel, NotificationDelivery

NOW = datetime.now(timezone.utc)
KEY = "chat-relay"
GRANT = "core.notifications.channel"


def load_registry(*, grants: list[str], enabled: bool = True, licensed: bool = True) -> None:
    extension_registry.clear()
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=KEY,
                name="Chat Relay",
                version="1.0.0",
                status="installed",
                enabled=enabled,
                manifest={"grants": grants},
            )
        ]
    )
    if licensed:
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
def _cleanup():
    extension_registry.clear()
    reset_contexts()
    nc.reset_channels()
    yield
    extension_registry.clear()
    reset_contexts()
    nc.reset_channels()


class _Ext:
    """Minimal extension instance exposing the duck-typed hook."""

    def __init__(self, *channels: NotificationChannel, raises: bool = False):
        self.key = KEY
        self._channels = list(channels)
        self._raises = raises

    def get_notification_channels(self):
        if self._raises:
            raise RuntimeError("boom")
        return self._channels


def channel(key: str = KEY, deliver=None) -> NotificationChannel:
    async def _noop(ctx, payload):
        pass

    return NotificationChannel(key=key, deliver=deliver or _noop)


def report(instance) -> LoadReport:
    r = LoadReport()
    r.loaded.append(
        LoadedExtension(key=KEY, manifest={}, directory=Path("/nonexistent"), instance=instance)
    )
    return r


def delivery(notif_type: str = "todo_assigned") -> NotificationDelivery:
    return NotificationDelivery(
        notification_id="n1",
        user_id="u1",
        type=notif_type,
        title="A todo",
        message="",
        link="/todos",
        url="http://localhost:8920/todos",
        data={},
        created_at=NOW.isoformat(),
    )


def start(instance) -> list[asyncio.Task]:
    return nc.start_notification_channels(report(instance))


async def drain(tasks: list[asyncio.Task]) -> None:
    for t in tasks:
        t.cancel()
    for t in tasks:
        try:
            await t
        except asyncio.CancelledError:
            pass


class TestDispatchStaysSynchronous:
    def test_dispatch_is_not_a_coroutine(self):
        """dispatch runs inside the caller's open transaction: enqueue only.

        If this ever becomes ``async def``, a notification send starts holding
        a pooled database connection across extension work.
        """
        assert not inspect.iscoroutinefunction(nc.dispatch)


class TestRegistration:
    async def test_registers_with_grant(self):
        load_registry(grants=[GRANT])
        tasks = start(_Ext(channel()))
        assert nc.registered_channel_keys() == [KEY]
        await drain(tasks)

    async def test_missing_grant_skips_channel(self):
        load_registry(grants=[])
        tasks = start(_Ext(channel()))
        assert nc.registered_channel_keys() == []
        await drain(tasks)

    async def test_key_outside_own_namespace_skipped(self):
        """The key becomes a JSONB key on every user row and a column id."""
        load_registry(grants=[GRANT])
        tasks = start(_Ext(channel("slack")))
        assert nc.registered_channel_keys() == []
        await drain(tasks)

    async def test_dotted_subkey_allowed(self):
        load_registry(grants=[GRANT])
        tasks = start(_Ext(channel(f"{KEY}.dm")))
        assert nc.registered_channel_keys() == [f"{KEY}.dm"]
        await drain(tasks)

    async def test_duplicate_key_skips_second(self):
        load_registry(grants=[GRANT])
        tasks = start(_Ext(channel(), channel()))
        assert nc.registered_channel_keys() == [KEY]
        await drain(tasks)

    async def test_hook_raising_is_not_fatal(self):
        load_registry(grants=[GRANT])
        tasks = start(_Ext(raises=True))
        assert nc.registered_channel_keys() == []
        await drain(tasks)

    async def test_extension_without_hook_is_ignored(self):
        load_registry(grants=[GRANT])

        class Bare:
            key = KEY

        tasks = start(Bare())
        assert nc.registered_channel_keys() == []
        await drain(tasks)


class TestLiveGating:
    async def test_lapse_pauses_channel(self):
        load_registry(grants=[GRANT])
        tasks = start(_Ext(channel()))
        assert nc.registered_channel_keys() == [KEY]

        # A licence lapse must pause delivery without losing the registration
        # or anyone's stored opt-ins.
        load_registry(grants=[GRANT], licensed=False)
        assert nc.registered_channel_keys() == []
        assert nc.channel_descriptors() == []
        await drain(tasks)

    async def test_disable_pauses_channel(self):
        load_registry(grants=[GRANT])
        tasks = start(_Ext(channel()))
        load_registry(grants=[GRANT], enabled=False)
        assert nc.registered_channel_keys() == []
        await drain(tasks)

    async def test_paused_channel_receives_no_dispatch(self):
        seen: list[NotificationDelivery] = []

        async def _deliver(ctx, payload):
            seen.append(payload)

        load_registry(grants=[GRANT])
        tasks = start(_Ext(channel(deliver=_deliver)))
        load_registry(grants=[GRANT], licensed=False)
        nc.dispatch(delivery(), [KEY])
        await asyncio.sleep(0)
        assert seen == []
        await drain(tasks)

    async def test_descriptors_name_the_owning_extension(self):
        load_registry(grants=[GRANT])
        tasks = start(_Ext(channel()))
        assert nc.channel_descriptors() == [{"key": KEY, "extension_key": KEY}]
        await drain(tasks)


class TestDelivery:
    async def test_payload_reaches_the_channel(self):
        seen: list[NotificationDelivery] = []

        async def _deliver(ctx, payload):
            seen.append(payload)

        load_registry(grants=[GRANT])
        tasks = start(_Ext(channel(deliver=_deliver)))
        nc.dispatch(delivery(), [KEY])
        for _ in range(20):
            if seen:
                break
            await asyncio.sleep(0.01)
        assert [p.type for p in seen] == ["todo_assigned"]
        await drain(tasks)

    async def test_crashing_deliver_does_not_kill_the_worker(self):
        seen: list[str] = []

        async def _deliver(ctx, payload):
            seen.append(payload.type)
            if len(seen) == 1:
                raise RuntimeError("boom")

        load_registry(grants=[GRANT])
        tasks = start(_Ext(channel(deliver=_deliver)))
        nc.dispatch(delivery("todo_assigned"), [KEY])
        nc.dispatch(delivery("comment_added"), [KEY])
        for _ in range(40):
            if len(seen) == 2:
                break
            await asyncio.sleep(0.01)
        assert seen == ["todo_assigned", "comment_added"]
        await drain(tasks)

    async def test_unknown_channel_key_is_a_no_op(self):
        load_registry(grants=[GRANT])
        tasks = start(_Ext(channel()))
        nc.dispatch(delivery(), ["nobody-registered-this"])
        await drain(tasks)


class TestBackpressure:
    async def test_queue_overflow_drops_oldest(self, monkeypatch):
        load_registry(grants=[GRANT])
        monkeypatch.setattr(nc, "PRIVATE_QUEUE_SIZE", 2)
        tasks = start(_Ext(channel()))
        # Stop the worker so the queue can actually fill.
        await drain(tasks)

        reg = nc._channels[KEY]
        for i in range(5):
            nc.dispatch(delivery(f"type_{i}"), [KEY])
        assert reg.queue.qsize() == 2
        kept = [reg.queue.get_nowait().type for _ in range(2)]
        # Newest wins: a backed-up channel should lose its stalest work.
        assert kept == ["type_3", "type_4"]
