"""Extension SDK — the semver'd contract between core and backend extensions.

This module (plus ``require_extension`` re-exported below) is the ONLY
supported import surface for extension code. Anything else under
``app.*`` is core-internal and may change between releases without
notice; extensions that reach past the SDK void their compatibility
claim.

An extension bundle's manifest names an entrypoint (``"pkg.module:attr"``)
resolving to an object that satisfies the :class:`TurboExtension`
protocol. The loader instantiates nothing — the attribute IS the
extension instance (module-level singleton, mirroring how migration
source adapters register themselves).

Naming rules enforced at load time:

- permission keys must start with ``ext.{key}.``
- database tables created by extension migrations must be named
  ``ext_{key}_*`` (convention — the migration runner cannot inspect DDL,
  but the authoring lint checks it and code review enforces it)

Versioning: ``SDK_VERSION`` is major.minor. An extension declares the
SDK line it was built for; the loader refuses a different major and
warns on a newer minor.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol, runtime_checkable

from fastapi import APIRouter
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

# --- SDK 1.1 — route dependencies -------------------------------------------
# Sanctioned FastAPI dependencies for extension route handlers, re-exported so
# extensions never import core internals directly:
#
# - ``get_db`` — request-scoped AsyncSession (``db: AsyncSession = Depends(get_db)``).
#   Use it ONLY on the extension's own ``ext_{key}_*`` tables; core tables stay
#   off-limits (no core model imports). The sanctioned path to core data is
#   the typed bridge on ``ExtensionContext`` — ``ctx.todos`` (SDK 1.2) is the
#   first domain; REST-parity via a scoped service token is the eventual
#   generalization.
# - ``get_current_user`` — the authenticated user. Treat it as an opaque
#   record; the supported attributes are ``id``, ``email``, ``display_name``,
#   and ``role``.
# - ``require_permission("ext.{key}.something")`` — dependency factory
#   enforcing an app-level permission. Works with the extension's own
#   ``ext.{key}.*`` keys (registered via ``get_permissions()``) and with core
#   keys (e.g. gate a read on ``adr.view``).
#
# Every extension route is additionally gated by ``require_extension(key)``
# at mount time (enabled + usable entitlement), so handlers only need the
# permission/user dependencies above.
from app.api.deps import get_current_user, require_permission  # noqa: F401
from app.database import get_db  # noqa: F401

# --- SDK 1.2 — core-data bridge, events, secrets ----------------------------
# 1.2 added three additive surfaces (existing 1.0/1.1 extensions load and run
# unchanged):
#
# - ``ctx.todos`` — a typed bridge to the core ``todos`` table, gated by the
#   manifest grants ``core.todos.read`` / ``core.todos.write`` (write implies
#   read), evaluated on every call so disabling the extension or letting its
#   license lapse revokes access immediately. Writes are audited as an
#   ``ext:{key}`` mutation batch with origin ``ext``.
# - ``get_event_handlers()`` — an OPTIONAL hook on the extension instance
#   (deliberately NOT part of the ``TurboExtension`` protocol: the loader's
#   ``isinstance`` check is attribute-presence-based, so a required member
#   would break every already-shipped extension). Return
#   ``list[EventSubscription]`` to receive core events matching a prefix;
#   delivery is gated by the matching ``core.events.*`` grant.
# - ``ctx.get_secret`` / ``ctx.set_secret`` — credential storage encrypted
#   with the instance ``SECRET_KEY`` (Fernet). Values are ``str`` only. A
#   rotated ``SECRET_KEY`` makes ``get_secret`` return ``""`` — treat that as
#   "missing, re-prompt the operator", mirroring how core handles its own
#   SMTP/SSO secrets. Never store credentials via ``set_setting`` (plaintext,
#   and it leaves the instance in a workspace-transfer bundle).

# --- SDK 1.3 — users bridge, system-todo mirror fields -----------------------
# 1.3 added two additive surfaces for connector extensions:
#
# - ``ctx.users`` — a read-only typed bridge to the user directory, gated by
#   the manifest grant ``core.users.read`` (evaluated per call, like the
#   todos bridge). Returns the same least-privilege payload core's user
#   pickers get: id, email, display name, active flag — nothing more. Built
#   so connectors can map assignees to an external tracker's accounts
#   without a frontend-fed workaround.
# - The todos bridge now accepts ONE kind of write on ``is_system`` todos:
#   an ``update`` whose only fields are ``external_ref`` / ``external_url``
#   (mirror metadata; stamps ``external_source`` as usual). Status,
#   description, assignee, due date, ``complete`` and ``delete`` stay
#   refused — a sign-off can be *referenced* externally, never *performed*
#   externally.

# --- SDK 1.4 — batch settings ------------------------------------------------
# 1.4 added one additive surface (existing 1.x extensions load and run
# unchanged):
#
# - ``ctx.get_settings(names)`` / ``ctx.set_settings(values)`` — read or
#   write MANY namespaced settings in ONE database transaction. The per-key
#   ``get_setting`` / ``set_setting`` are each a full read-modify-write
#   round trip on the settings row, so an extension persisting N keys paid
#   N sequential transactions — seconds of latency on a remote database.
#   ``get_settings`` returns ``{name: value_or_None}``; ``set_settings``
#   refuses ``secret.``-prefixed names (credentials must go through
#   ``set_secret`` so they are Fernet-encrypted and transfer-scrubbed).

SDK_VERSION = "1.4"


@dataclass(frozen=True)
class ExtensionMigration:
    """One sequential schema step. ``version`` starts at 1 and increments.

    ``upgrade`` receives an :class:`AsyncConnection` inside a transaction
    owned by the runner; raise to abort (the extension is marked failed,
    core keeps booting).
    """

    version: int
    name: str
    upgrade: Callable[[AsyncConnection], Awaitable[None]]


@dataclass(frozen=True)
class ExtensionJob:
    """A periodic background job. ``run`` is invoked every
    ``interval_seconds`` while the extension is enabled and licensed —
    lapse or disable pauses the job without a restart."""

    name: str
    interval_seconds: int
    run: Callable[["ExtensionContext"], Awaitable[None]]


class ExtensionError(Exception):
    """Base class for errors raised by SDK bridge surfaces."""


class ExtensionPermissionError(ExtensionError):
    """The extension lacks the required manifest grant, is disabled, or its
    license entitlement is not usable."""


class ExtensionDataError(ExtensionError):
    """A bridge call failed on the data itself: row not found, validation
    error, conflict, or an attempt to touch a row the extension may not
    write (non-mirror fields of ``is_system`` todos, rows owned by another
    ``external_source``)."""


@dataclass(frozen=True)
class ExtTodo:
    """Read model returned by the todos bridge. All ids are strings; dates
    and timestamps are ISO strings (the bridge is a wire-shaped surface so
    connector code can serialize it as-is)."""

    id: str
    card_id: str | None
    description: str
    status: str
    link: str | None
    is_system: bool
    assigned_to: str | None
    created_by: str | None
    due_date: str | None
    created_at: str | None
    updated_at: str | None
    external_ref: str | None
    external_url: str | None
    external_source: str | None
    series_id: str | None
    recurrence_unit: str


class TodosBridge(Protocol):
    """Typed access to the core ``todos`` table (SDK 1.2).

    Reads require the ``core.todos.read`` or ``core.todos.write`` grant;
    writes require ``core.todos.write``. Every write is scoped: only rows
    whose ``external_source`` is NULL or the extension's own key, and any
    write that sets external fields stamps ``external_source`` with the
    extension's key. ``is_system`` rows accept exactly one write shape
    (SDK 1.3): an ``update`` touching only ``external_ref`` /
    ``external_url`` — mirror metadata so a connector can reference the
    sign-off externally; everything else on them (status, description,
    assignee, due date, ``complete``, ``delete``) is refused. ``create``
    is one-shot only — external trackers own their own recurrence — but
    ``complete`` on a user's recurring todo rolls the series forward
    exactly like the UI.
    """

    async def list(
        self,
        *,
        status: str | None = None,
        card_id: str | None = None,
        assigned_to: str | None = None,
        external_source: str | None = None,
        external_ref: str | None = None,
        updated_since: datetime | None = None,
    ) -> list[ExtTodo]: ...

    async def get(self, todo_id: str) -> ExtTodo | None: ...

    async def create(
        self,
        *,
        description: str,
        card_id: str | None = None,
        assigned_to: str | None = None,
        due_date: str | None = None,
        external_ref: str | None = None,
        external_url: str | None = None,
    ) -> ExtTodo: ...

    async def update(
        self,
        todo_id: str,
        *,
        description: str | None = None,
        status: str | None = None,
        assigned_to: str | None = None,
        due_date: str | None = None,
        external_ref: str | None = None,
        external_url: str | None = None,
    ) -> ExtTodo: ...

    async def complete(self, todo_id: str) -> ExtTodo: ...

    async def delete(self, todo_id: str) -> None: ...


@dataclass(frozen=True)
class ExtUser:
    """Read model returned by the users bridge (SDK 1.3). Deliberately the
    same least-privilege shape core's user pickers receive (see
    ``_user_response_lite`` in the users API) — id, email, display name and
    the active flag; no role, login or preference data. Wire-shaped: the id
    is a string, ready to serialize as-is."""

    id: str
    email: str
    display_name: str
    is_active: bool


class UsersBridge(Protocol):
    """Read-only typed access to the user directory (SDK 1.3).

    Every call requires the ``core.users.read`` grant, re-evaluated per
    call so disabling the extension or a license lapse revokes access
    immediately. ``list`` excludes deactivated accounts unless
    ``include_inactive=True`` (matching core's own pickers);
    ``find_by_email`` matches case-insensitively. There is no write
    surface — user management stays core-only.
    """

    async def list(self, *, include_inactive: bool = False) -> list[ExtUser]: ...

    async def get(self, user_id: str) -> ExtUser | None: ...

    async def find_by_email(self, email: str) -> ExtUser | None: ...


@dataclass
class ExtensionContext:
    """Runtime services handed to extension jobs and ``on_startup``.

    SDK 1.2 additions (all defaulted, so 1.1-era direct constructions keep
    working): ``todos`` — the core-data bridge (grant-checked per call);
    ``get_secret`` / ``set_secret`` — encrypted credential storage (``str``
    only; a ``SECRET_KEY`` rotation makes ``get_secret`` return ``""``,
    which means "re-prompt the operator"). SDK 1.3 adds ``users`` — the
    read-only user-directory bridge (grant ``core.users.read``). SDK 1.4
    adds ``get_settings`` / ``set_settings`` — batch variants that cost one
    database transaction for N keys (``set_settings`` refuses ``secret.``
    names; use ``set_secret``).
    """

    key: str
    session_factory: Callable[[], AsyncSession]
    logger: logging.Logger
    get_setting: Callable[[str], Awaitable[Any]]
    set_setting: Callable[[str, Any], Awaitable[None]]
    settings_namespace: str = ""
    todos: TodosBridge | None = None
    get_secret: Callable[[str], Awaitable[str | None]] | None = None
    set_secret: Callable[[str, str], Awaitable[None]] | None = None
    users: UsersBridge | None = None
    get_settings: Callable[[Sequence[str]], Awaitable[dict[str, Any]]] | None = None
    set_settings: Callable[[dict[str, Any]], Awaitable[None]] | None = None

    def __post_init__(self) -> None:
        if not self.settings_namespace:
            self.settings_namespace = f"ext.{self.key}."


@dataclass(frozen=True)
class EventSubscription:
    """A declarative subscription to core events (SDK 1.2).

    ``prefix`` matches event types by prefix (``"todo."`` matches
    ``todo.created``, ``todo.completed``, …) and must be covered by a
    ``core.events.*`` grant in the extension's manifest or the subscription
    is skipped at registration with a warning. ``handler`` receives the
    extension's :class:`ExtensionContext` and the raw event message
    (``{"event", "data", "card_id", "batch_id", "timestamp"}``); it runs
    with a 30s timeout and a crash is logged, never fatal. ``include_self``
    controls whether events caused by this extension's own bridge writes
    (``data["ext"] == key``) are delivered — the default ``False`` breaks
    the write→event→handler→write sync loop by construction.
    """

    prefix: str
    handler: Callable[["ExtensionContext", dict[str, Any]], Awaitable[None]]
    include_self: bool = False


class SupportsEventHandlers(Protocol):
    """Typing helper for extensions that implement the OPTIONAL
    ``get_event_handlers`` hook. Deliberately not ``runtime_checkable`` and
    deliberately not part of :class:`TurboExtension` — the loader discovers
    the hook via ``getattr``, so extensions without it keep loading."""

    def get_event_handlers(self) -> list[EventSubscription]: ...


@runtime_checkable
class TurboExtension(Protocol):
    """The backend extension contract (all hooks optional in effect —
    return ``None`` / empty collections for surfaces you don't use)."""

    key: str
    sdk_version: str

    def get_router(self) -> APIRouter | None:
        """Router mounted under ``/api/v1/ext/{key}/``, request-gated by
        ``require_extension(key)``."""
        ...

    def get_permissions(self) -> dict[str, str]:
        """``{"ext.{key}.something": "description"}`` — merged into the
        app permission registry under the Extensions group."""
        ...

    def get_migrations(self) -> list[ExtensionMigration]:
        """Sequential schema migrations for ``ext_{key}_*`` tables."""
        ...

    def get_jobs(self) -> list[ExtensionJob]:
        """Periodic background jobs."""
        ...

    async def on_startup(self, ctx: ExtensionContext) -> None:
        """One-shot hook after migrations, before jobs start."""
        ...


def sdk_compatible(declared: str) -> bool:
    """An extension built for SDK ``declared`` loads iff majors match."""
    try:
        ext_major = int(str(declared).split(".", 1)[0])
        core_major = int(SDK_VERSION.split(".", 1)[0])
    except ValueError:
        return False
    return ext_major == core_major


def sdk_minor_newer(declared: str) -> bool:
    """True when ``declared`` is the same major but a NEWER minor than this
    core's SDK — the extension may reference surfaces this core doesn't have
    yet. The loader logs a warning (it still loads; new surfaces are additive
    and fail with clear AttributeErrors, not silently)."""
    try:
        parts = str(declared).split(".")
        ext_major, ext_minor = int(parts[0]), int(parts[1])
        core_parts = SDK_VERSION.split(".")
        core_major, core_minor = int(core_parts[0]), int(core_parts[1])
    except (ValueError, IndexError):
        return False
    return ext_major == core_major and ext_minor > core_minor
