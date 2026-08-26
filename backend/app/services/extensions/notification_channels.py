"""Extension-delivered notification channels (SDK 1.6).

Core notifications ship on two channels it owns outright — the in-app bell
and email. An extension can register a third (a chat DM, a pager, an SMS
gateway) through the OPTIONAL ``get_notification_channels()`` hook
(duck-typed, deliberately not part of the ``TurboExtension`` protocol, so
pre-1.6 extensions load untouched), unlocked by the
``core.notifications.channel`` grant.

**Core owns the preference matrix; the extension owns the transport.** Which
notification types exist, who opted in to what, and which types may never
leave the bell are all decided here, against the same
``NOTIFICATION_TYPE_SPECS`` the dialog renders — so a channel cannot invent
a type, cannot deliver something the recipient did not switch on, and cannot
start delivering merely by being installed.

Topology per channel: **bounded private queue → worker task**, borrowed from
``events.py`` but deliberately *not* routed through the event bus. Two
reasons, both load-bearing:

- ``notification.created`` is only published when a bell row exists, and the
  SSE fan-out in ``api/v1/events.py`` forwards every bus message to every
  ``admin.events`` holder. Publishing a second event so channels could see
  deliveries that have no row would broadcast the content of notifications
  belonging to users who deliberately muted their bell.
- The bus drops *whole subscribers* whose queue fills, so a slow channel
  would silently lose its subscription rather than lose a message.

``dispatch`` is therefore a plain ``def``: it enqueues and returns, doing no
I/O and no ``await``, which is what makes it safe to call from
``create_notification`` with the caller's transaction still open. Durability
past that queue belongs to the extension — the documented contract is
"persist to your own outbox, drain it from a job".
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence
from dataclasses import dataclass

from app.models.user import User
from app.services.extensions.loader import LoadReport
from app.services.extensions.registry import extension_registry
from app.services.extensions.sdk import (
    ExtensionContext,
    NotificationChannel,
    NotificationDelivery,
)

logger = logging.getLogger(__name__)

#: The single grant that unlocks channel registration and delivery.
GRANT = "core.notifications.channel"

DELIVER_TIMEOUT_SECONDS = 30
PRIVATE_QUEUE_SIZE = 1000


@dataclass
class _Registered:
    ext_key: str
    channel: NotificationChannel
    ctx: ExtensionContext
    queue: asyncio.Queue
    dropped: int = 0


#: channel key -> registration. Empty on a stock install, which is what keeps
#: the notification path free of extension work when nothing is registered.
_channels: dict[str, _Registered] = {}


def reset_channels() -> None:
    """Drop every registration. Test helper — mirrors ``jobs.reset_contexts``."""
    _channels.clear()


def _live(channel_key: str) -> _Registered | None:
    """The registration, but only while its extension may actually deliver.

    Checked per call rather than cached so that disabling an extension or
    letting its license lapse pauses the channel immediately, exactly like
    the job supervisor and the event dispatcher.
    """
    reg = _channels.get(channel_key)
    if reg is None:
        return None
    if GRANT not in extension_registry.grants_for(reg.ext_key):
        return None
    return reg


def registered_channel_keys() -> list[str]:
    """Channel keys currently able to deliver, sorted for a stable UI order."""
    return sorted(key for key in _channels if _live(key) is not None)


def channel_descriptors() -> list[dict[str, str]]:
    """What the preferences dialog needs to decide a column exists.

    Only the identity — the label and icon come from the extension's own UI
    bundle, which knows the viewer's locale. A channel the backend does not
    report gets no column, even if a UI plugin contributes one: a UI-only
    bundle installs live while a backend channel needs a restart, and a
    column whose PATCH the backend would ignore is worse than no column.
    """
    return [
        {"key": key, "extension_key": _channels[key].ext_key} for key in registered_channel_keys()
    ]


def wanted_channels(user: User, notif_type: str) -> list[str]:
    """Channel keys this user has switched on for this notification type.

    Empty whenever nothing is registered — the stock-install path, which
    costs one dict lookup.
    """
    if not _channels:
        return []
    from app.services.notification_service import _user_wants_notification

    return [
        key for key in registered_channel_keys() if _user_wants_notification(user, notif_type, key)
    ]


def dispatch(payload: NotificationDelivery, channel_keys: Sequence[str]) -> None:
    """Hand a delivery to each channel's worker.

    NOT a coroutine, on purpose: enqueue only, no I/O and no ``await``, so
    ``create_notification`` can call it with its transaction open without
    holding a pooled connection across anything slow. Pinned by
    ``test_dispatch_is_not_a_coroutine``.
    """
    for key in channel_keys:
        reg = _live(key)
        if reg is None:
            continue
        try:
            reg.queue.put_nowait(payload)
            if reg.dropped:
                logger.warning(
                    "Notification channel %s recovered after dropping %d deliveries",
                    key,
                    reg.dropped,
                )
                reg.dropped = 0
        except asyncio.QueueFull:
            # Drop-oldest, matching the event dispatcher: a backed-up channel
            # should lose its stalest work, not its newest. Logged once per
            # overflow burst rather than per delivery.
            try:
                reg.queue.get_nowait()
            except asyncio.QueueEmpty:  # pragma: no cover - race only
                pass
            reg.queue.put_nowait(payload)
            if reg.dropped == 0:
                logger.warning(
                    "Notification channel %s queue full — dropping oldest deliveries", key
                )
            reg.dropped += 1


async def _worker_loop(channel_key: str) -> None:
    """Deliver sequentially; a crash or timeout is logged, never fatal."""
    reg = _channels[channel_key]
    while True:
        payload = await reg.queue.get()
        try:
            async with asyncio.timeout(DELIVER_TIMEOUT_SECONDS):
                await reg.channel.deliver(reg.ctx, payload)
        except asyncio.CancelledError:
            raise
        except TimeoutError:
            logger.warning(
                "Notification channel %s took longer than %ds to accept a delivery — "
                "deliver() must enqueue and return, not call out",
                channel_key,
                DELIVER_TIMEOUT_SECONDS,
            )
        except Exception:
            logger.exception(
                "Notification channel %s failed to accept a %s delivery — continuing",
                channel_key,
                payload.type,
            )


def start_notification_channels(report: LoadReport) -> list[asyncio.Task]:
    """Register channels and spawn one worker each.

    Caller cancels the returned tasks on shutdown — same contract as the job
    loops and event dispatchers.
    """
    # Imported here, not at module scope: notification_service imports this
    # module, and build_context pulls in the whole bridge stack (data,
    # todos, users, cron). A module-level import would drag all of it into
    # everything that sends a notification.
    from app.services.extensions.jobs import build_context

    tasks: list[asyncio.Task] = []
    for ext in report.loaded:
        if ext.instance is None:
            continue
        hook = getattr(ext.instance, "get_notification_channels", None)
        if hook is None:
            continue
        try:
            channels = list(hook() or [])
        except Exception:  # noqa: BLE001
            logger.exception("Extension %s get_notification_channels() failed", ext.key)
            continue
        if not channels:
            continue

        info = extension_registry.get(ext.key)
        declared = (info.manifest.get("grants") if info else None) or []
        if GRANT not in [str(g) for g in declared]:
            logger.warning(
                "Extension %s registers notification channel(s) but declares no %s "
                "grant — channels skipped",
                ext.key,
                GRANT,
            )
            continue

        ctx = build_context(ext.key)
        for channel in channels:
            # The key lands in every user's preferences JSONB and becomes a
            # column id, so it is namespaced as strictly as permissions and
            # tables are.
            if not (channel.key == ext.key or channel.key.startswith(f"{ext.key}.")):
                logger.warning(
                    "Extension %s registers notification channel %r outside its own "
                    "namespace (must be %r or %r-prefixed) — channel skipped",
                    ext.key,
                    channel.key,
                    ext.key,
                    f"{ext.key}.",
                )
                continue
            if channel.key in _channels:
                logger.warning(
                    "Notification channel %r already registered by extension %s — "
                    "%s's channel skipped",
                    channel.key,
                    _channels[channel.key].ext_key,
                    ext.key,
                )
                continue
            _channels[channel.key] = _Registered(
                ext_key=ext.key,
                channel=channel,
                ctx=ctx,
                queue=asyncio.Queue(maxsize=PRIVATE_QUEUE_SIZE),
            )
            tasks.append(
                asyncio.create_task(
                    _worker_loop(channel.key),
                    name=f"ext:{ext.key}:notify:{channel.key}",
                )
            )
            logger.info("Registered notification channel %r for extension %s", channel.key, ext.key)
    return tasks
