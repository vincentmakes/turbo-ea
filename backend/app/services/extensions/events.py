"""Event dispatch to extensions (SDK 1.2).

Extensions declare interest via the OPTIONAL ``get_event_handlers()`` hook
(duck-typed — deliberately not part of the ``TurboExtension`` protocol, so
pre-1.2 extensions load untouched) returning ``EventSubscription`` rows.

Topology per subscribing extension: **relay task → private queue → worker
task**. The relay consumes ``event_bus.subscribe()`` and must never block:
the bus silently drops any subscriber whose queue fills
(``event_bus.publish``'s ``QueueFull`` handling), so a slow extension
handler must not be allowed to back the bus queue up. The relay filters
(prefix + grant + entitlement + self-origin) and enqueues into a private
bounded queue with drop-oldest overflow; the worker runs handlers
sequentially with a per-handler timeout, logging crashes — a broken handler
never takes the dispatcher down and never unsubscribes it silently.

Delivery is gated twice: at registration a subscription whose prefix no
*declared* manifest grant covers is skipped with a warning (visible
misconfig), and per event via ``registry.grants_for`` so disabling the
extension or a license lapse pauses delivery immediately, exactly like the
job supervisor.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.services.event_bus import event_bus
from app.services.extensions.jobs import build_context
from app.services.extensions.loader import LoadReport
from app.services.extensions.registry import extension_registry
from app.services.extensions.sdk import EventSubscription, ExtensionContext

logger = logging.getLogger(__name__)

# Which core event-type prefixes each ``core.events.*`` grant unlocks.
# Future scopes (cards, relations, …) are one-line additions here plus the
# matching VALID_GRANTS entry in bundle.py / teax.py.
EVENT_SCOPE_GRANTS: dict[str, tuple[str, ...]] = {
    "core.events.todo": ("todo.",),
}

HANDLER_TIMEOUT_SECONDS = 30
PRIVATE_QUEUE_SIZE = 1000


def _granted_prefixes(key: str) -> tuple[str, ...]:
    """Event-type prefixes currently unlocked for this extension — empty
    when it is disabled, unlicensed, or pending restart."""
    prefixes: list[str] = []
    for grant in extension_registry.grants_for(key):
        prefixes.extend(EVENT_SCOPE_GRANTS.get(grant, ()))
    return tuple(prefixes)


def _declared_prefixes(key: str) -> tuple[str, ...]:
    """Prefixes covered by the manifest's *declared* grants, ignoring
    enablement — used at registration so a misconfigured subscription is
    reported even while the extension happens to be disabled."""
    info = extension_registry.get(key)
    manifest_grants = (info.manifest.get("grants") if info else None) or []
    prefixes: list[str] = []
    for grant in manifest_grants:
        prefixes.extend(EVENT_SCOPE_GRANTS.get(str(grant), ()))
    return tuple(prefixes)


def _deliverable(key: str, sub: EventSubscription, message: dict[str, Any]) -> bool:
    event_type = str(message.get("event") or "")
    if not event_type.startswith(sub.prefix):
        return False
    # Self-origin filter: events caused by this extension's own bridge
    # writes carry data["ext"] == key. Dropping them by default breaks the
    # write → event → handler → write sync loop by construction.
    data = message.get("data") or {}
    if not sub.include_self and data.get("ext") == key:
        return False
    # Live grant check — lapse/disable pauses delivery immediately.
    return any(event_type.startswith(p) for p in _granted_prefixes(key))


async def _relay_loop(key: str, subs: list[EventSubscription], private_q: asyncio.Queue) -> None:
    """Drain the global bus immediately; never block on the extension."""
    dropped = 0
    async for message in event_bus.subscribe():
        for sub in subs:
            if not _deliverable(key, sub, message):
                continue
            try:
                private_q.put_nowait((sub, message))
                if dropped:
                    logger.warning(
                        "Extension %s event queue recovered after dropping %d events",
                        key,
                        dropped,
                    )
                    dropped = 0
            except asyncio.QueueFull:
                # Drop-oldest: the newest state is what a sync connector
                # needs; log once per overflow burst, not per event.
                try:
                    private_q.get_nowait()
                except asyncio.QueueEmpty:  # pragma: no cover - race only
                    pass
                private_q.put_nowait((sub, message))
                if dropped == 0:
                    logger.warning("Extension %s event queue full — dropping oldest events", key)
                dropped += 1


async def _worker_loop(key: str, ctx: ExtensionContext, private_q: asyncio.Queue) -> None:
    """Run handlers sequentially; a crash or timeout is logged, never fatal."""
    while True:
        sub, message = await private_q.get()
        try:
            async with asyncio.timeout(HANDLER_TIMEOUT_SECONDS):
                await sub.handler(ctx, message)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception(
                "Extension %s handler for %s failed — continuing",
                key,
                message.get("event"),
            )


def start_extension_event_dispatchers(report: LoadReport) -> list[asyncio.Task]:
    """Spawn relay + worker tasks per subscribing extension. Caller cancels
    the returned tasks on shutdown (same contract as job loops)."""
    tasks: list[asyncio.Task] = []
    for ext in report.loaded:
        if ext.instance is None:
            continue
        hook = getattr(ext.instance, "get_event_handlers", None)
        if hook is None:
            continue
        try:
            subs = list(hook() or [])
        except Exception:  # noqa: BLE001
            logger.exception("Extension %s get_event_handlers() failed", ext.key)
            continue
        declared = _declared_prefixes(ext.key)
        usable_subs: list[EventSubscription] = []
        for sub in subs:
            if not any(sub.prefix.startswith(p) or p.startswith(sub.prefix) for p in declared):
                logger.warning(
                    "Extension %s subscribes to %r but declares no covering "
                    "core.events.* grant — subscription skipped",
                    ext.key,
                    sub.prefix,
                )
                continue
            usable_subs.append(sub)
        if not usable_subs:
            continue
        ctx = build_context(ext.key)
        private_q: asyncio.Queue = asyncio.Queue(maxsize=PRIVATE_QUEUE_SIZE)
        tasks.append(
            asyncio.create_task(
                _relay_loop(ext.key, usable_subs, private_q),
                name=f"ext:{ext.key}:event-relay",
            )
        )
        tasks.append(
            asyncio.create_task(
                _worker_loop(ext.key, ctx, private_q),
                name=f"ext:{ext.key}:event-worker",
            )
        )
        logger.info(
            "Started event dispatcher for extension %s (%d subscription(s))",
            ext.key,
            len(usable_subs),
        )
    return tasks
