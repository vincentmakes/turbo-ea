"""Extension event dispatcher: filtering, gating, isolation, backpressure."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from app.services.event_bus import event_bus
from app.services.extensions import events as ev_mod
from app.services.extensions.events import (
    _deliverable,
    start_extension_event_dispatchers,
)
from app.services.extensions.jobs import reset_contexts
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.loader import LoadedExtension, LoadReport
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.sdk import EventSubscription

NOW = datetime.now(timezone.utc)
KEY = "jira-sync"


def load_registry(*, grants: list[str], enabled: bool = True, licensed: bool = True) -> None:
    extension_registry.clear()
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=KEY,
                name="Jira Sync",
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
    yield
    extension_registry.clear()
    reset_contexts()


def sub(prefix: str = "todo.", *, include_self: bool = False, handler=None) -> EventSubscription:
    async def _noop(ctx, message):
        pass

    return EventSubscription(prefix=prefix, handler=handler or _noop, include_self=include_self)


def msg(event: str, data: dict | None = None) -> dict:
    return {"event": event, "data": data or {}, "card_id": None, "batch_id": None}


class TestDeliverable:
    def test_prefix_mismatch(self):
        load_registry(grants=["core.events.todo"])
        assert not _deliverable(KEY, sub("card."), msg("todo.created"))

    def test_granted_prefix_delivers(self):
        load_registry(grants=["core.events.todo"])
        assert _deliverable(KEY, sub("todo."), msg("todo.created"))

    def test_no_grant_blocks(self):
        load_registry(grants=[])
        assert not _deliverable(KEY, sub("todo."), msg("todo.created"))

    def test_lapse_pauses_delivery(self):
        load_registry(grants=["core.events.todo"], licensed=False)
        assert not _deliverable(KEY, sub("todo."), msg("todo.created"))

    def test_disable_pauses_delivery(self):
        load_registry(grants=["core.events.todo"], enabled=False)
        assert not _deliverable(KEY, sub("todo."), msg("todo.created"))

    def test_self_events_suppressed_by_default(self):
        load_registry(grants=["core.events.todo"])
        own = msg("todo.created", {"ext": KEY})
        assert not _deliverable(KEY, sub("todo."), own)
        assert _deliverable(KEY, sub("todo.", include_self=True), own)

    def test_other_extensions_events_deliver(self):
        load_registry(grants=["core.events.todo"])
        other = msg("todo.created", {"ext": "planner-sync"})
        assert _deliverable(KEY, sub("todo."), other)


class FakeInstance:
    """Minimal 1.2 extension instance with the optional event hook."""

    key = KEY
    sdk_version = "1.2"

    def __init__(self, subs):
        self._subs = subs

    def get_event_handlers(self):
        return self._subs


def report_for(instance) -> LoadReport:
    return LoadReport(
        loaded=[
            LoadedExtension(
                key=KEY,
                manifest={"key": KEY},
                directory=None,  # type: ignore[arg-type]
                instance=instance,
            )
        ],
        failed=[],
    )


class TestDispatcher:
    async def test_end_to_end_delivery_and_crash_isolation(self):
        load_registry(grants=["core.events.todo"])
        received: list[str] = []

        async def crashy(ctx, message):
            received.append(message["event"])
            if message["event"] == "todo.created":
                raise RuntimeError("handler boom")

        tasks = start_extension_event_dispatchers(
            report_for(FakeInstance([sub("todo.", handler=crashy)]))
        )
        assert len(tasks) == 2  # relay + worker
        try:
            await asyncio.sleep(0)  # let the relay subscribe
            await event_bus.publish("todo.created", {"todo_id": "1"})
            await event_bus.publish("todo.completed", {"todo_id": "1"})
            await asyncio.sleep(0.05)
            # The crash on the first event did not stop the second.
            assert received == ["todo.created", "todo.completed"]
        finally:
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    async def test_undeclared_prefix_is_skipped_at_registration(self, caplog):
        load_registry(grants=["core.events.todo"])
        tasks = start_extension_event_dispatchers(report_for(FakeInstance([sub("card.")])))
        # No usable subscription → no tasks at all.
        assert tasks == []

    async def test_extension_without_hook_spawns_nothing(self):
        load_registry(grants=["core.events.todo"])

        class NoHook:
            key = KEY
            sdk_version = "1.1"

        assert start_extension_event_dispatchers(report_for(NoHook())) == []

    async def test_crashing_hook_is_contained(self):
        load_registry(grants=["core.events.todo"])

        class BadHook:
            key = KEY
            sdk_version = "1.2"

            def get_event_handlers(self):
                raise RuntimeError("hook boom")

        assert start_extension_event_dispatchers(report_for(BadHook())) == []

    async def test_scope_map_covers_todo_prefix(self):
        assert ev_mod.EVENT_SCOPE_GRANTS["core.events.todo"] == ("todo.",)

    async def test_scope_map_covers_card_and_relation_prefixes(self):
        # SDK 1.5 — the inventory domain rides one grant.
        assert ev_mod.EVENT_SCOPE_GRANTS["core.events.card"] == ("card.", "relation.")


class TestCardScope:
    def test_card_grant_delivers_card_and_relation_events(self):
        load_registry(grants=["core.events.card"])
        assert _deliverable(KEY, sub("card."), msg("card.updated"))
        assert _deliverable(KEY, sub("relation."), msg("relation.created"))
        # The todo domain stays off without its own grant.
        assert not _deliverable(KEY, sub("todo."), msg("todo.created"))

    def test_todo_grant_does_not_imply_card_events(self):
        load_registry(grants=["core.events.todo"])
        assert not _deliverable(KEY, sub("card."), msg("card.updated"))

    def test_own_bridge_writes_are_suppressed_by_default(self):
        # The data bridge stamps data["ext"] on events its writes cause —
        # the loop breaker for write → event → handler → write.
        load_registry(grants=["core.events.card"])
        own = msg("card.updated", {"ext": KEY})
        other = msg("card.updated", {"ext": "another-ext"})
        assert not _deliverable(KEY, sub("card."), own)
        assert _deliverable(KEY, sub("card.", include_self=True), own)
        assert _deliverable(KEY, sub("card."), other)

    def test_lapse_pauses_card_delivery(self):
        load_registry(grants=["core.events.card"], licensed=False)
        assert not _deliverable(KEY, sub("card."), msg("card.updated"))
