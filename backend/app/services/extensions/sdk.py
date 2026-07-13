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
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from fastapi import APIRouter
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

# --- SDK 1.1 — route dependencies -------------------------------------------
# Sanctioned FastAPI dependencies for extension route handlers, re-exported so
# extensions never import core internals directly:
#
# - ``get_db`` — request-scoped AsyncSession (``db: AsyncSession = Depends(get_db)``).
#   Use it ONLY on the extension's own ``ext_{key}_*`` tables; core tables stay
#   off-limits (no core model imports — see the write-bridge plan for the
#   future sanctioned path to core data).
# - ``get_current_user`` — the authenticated user. Treat it as an opaque
#   record; the supported attributes are ``id``, ``email``, ``display_name``,
#   and ``role_key``.
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

SDK_VERSION = "1.1"


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


@dataclass
class ExtensionContext:
    """Runtime services handed to extension jobs and ``on_startup``."""

    key: str
    session_factory: Callable[[], AsyncSession]
    logger: logging.Logger
    get_setting: Callable[[str], Awaitable[Any]]
    set_setting: Callable[[str, Any], Awaitable[None]]
    settings_namespace: str = ""

    def __post_init__(self) -> None:
        if not self.settings_namespace:
            self.settings_namespace = f"ext.{self.key}."


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
