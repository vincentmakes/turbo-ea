"""Background-job supervisor for extensions.

One asyncio task per declared :class:`ExtensionJob`, following the same
try/except-CancelledError loop pattern as core background tasks. Every
tick re-checks the in-memory registry, so disabling an extension or
letting its license lapse pauses its jobs immediately — no restart.
A crashing job tick is logged and retried next interval; it can never
take the process down.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence
from typing import Any

from sqlalchemy import select

from app.core.encryption import decrypt_value, encrypt_value
from app.database import async_session
from app.services.extensions.loader import LoadReport
from app.services.extensions.registry import extension_registry
from app.services.extensions.sdk import ExtensionContext, ExtensionJob
from app.services.extensions.todos_bridge import ExtensionTodos
from app.services.extensions.users_bridge import ExtensionUsers

logger = logging.getLogger(__name__)

# One context per extension per process. startup's on_startup hook and the
# job loops (and the event dispatcher) must all see the SAME instance —
# anything an extension stashes on the context at startup has to be visible
# from its jobs and handlers.
_contexts: dict[str, ExtensionContext] = {}


def reset_contexts() -> None:
    """Test helper — drop memoized contexts so fixtures start clean."""
    _contexts.clear()


def build_context(key: str) -> ExtensionContext:
    """Runtime services for one extension: sessions, logging, namespaced
    settings persisted under ``app_settings.general_settings["ext.{key}.*"]``,
    encrypted secrets under ``ext.{key}.secret.*``, and the core-data
    bridges (todos, users). Memoized per key (see ``_contexts``)."""

    cached = _contexts.get(key)
    if cached is not None:
        return cached

    namespace = f"ext.{key}."

    async def get_setting(name: str) -> Any:
        from app.models.app_settings import AppSettings

        async with async_session() as db:
            row = (
                await db.execute(select(AppSettings).where(AppSettings.id == "default"))
            ).scalar_one_or_none()
            return ((row.general_settings if row else None) or {}).get(namespace + name)

    async def set_setting(name: str, value: Any) -> None:
        from app.models.app_settings import AppSettings

        async with async_session() as db:
            row = (
                await db.execute(select(AppSettings).where(AppSettings.id == "default"))
            ).scalar_one_or_none()
            if row is None:
                row = AppSettings(id="default", general_settings={}, email_settings={})
                db.add(row)
            general = dict(row.general_settings or {})
            general[namespace + name] = value
            row.general_settings = general
            await db.commit()

    # SDK 1.4 — batch variants. The per-key pair above is one full
    # transaction per call, which turns an N-key config into N sequential
    # round-trips on the settings row; these do N keys in one.
    async def get_settings(names: Sequence[str]) -> dict[str, Any]:
        from app.models.app_settings import AppSettings

        async with async_session() as db:
            row = (
                await db.execute(select(AppSettings).where(AppSettings.id == "default"))
            ).scalar_one_or_none()
            general = (row.general_settings if row else None) or {}
            return {name: general.get(namespace + name) for name in names}

    async def set_settings(values: dict[str, Any]) -> None:
        from app.models.app_settings import AppSettings

        for name in values:
            if name.startswith("secret."):
                # Secrets must go through set_secret (Fernet encryption +
                # workspace-transfer scrub) — never a plaintext batch write.
                raise ValueError("set_settings cannot write secret.* names; use set_secret")
        async with async_session() as db:
            row = (
                await db.execute(select(AppSettings).where(AppSettings.id == "default"))
            ).scalar_one_or_none()
            if row is None:
                row = AppSettings(id="default", general_settings={}, email_settings={})
                db.add(row)
            general = dict(row.general_settings or {})
            for name, value in values.items():
                general[namespace + name] = value
            row.general_settings = general
            await db.commit()

    # Secrets ride the same settings row under a ``secret.`` sub-namespace,
    # but Fernet-encrypted (``enc:``-prefixed). The prefix is what makes them
    # export-safe: workspace transfer's defensive scrub strips every ``enc:``
    # value, so an extension credential can never leave the instance in a
    # bundle. str-only by design (mirrors core's SMTP/SSO secret handling).
    async def get_secret(name: str) -> str | None:
        raw = await get_setting(f"secret.{name}")
        if raw is None:
            return None
        # decrypt_value returns "" when SECRET_KEY rotated — surfaced as-is
        # so the extension treats it as "missing, re-prompt the operator".
        return decrypt_value(raw)

    async def set_secret(name: str, value: str) -> None:
        if not isinstance(value, str):
            raise TypeError("extension secrets must be str")
        await set_setting(f"secret.{name}", encrypt_value(value))

    ctx = ExtensionContext(
        key=key,
        session_factory=async_session,
        logger=logging.getLogger(f"ext.{key}"),
        get_setting=get_setting,
        set_setting=set_setting,
        todos=ExtensionTodos(key),
        get_secret=get_secret,
        set_secret=set_secret,
        users=ExtensionUsers(key),
        get_settings=get_settings,
        set_settings=set_settings,
    )
    _contexts[key] = ctx
    return ctx


def _job_may_run(key: str) -> bool:
    info = extension_registry.get(key)
    if info is None or not info.enabled or info.status in ("removed", "disabled", "failed"):
        return False
    return extension_registry.entitlement(key).usable


async def _job_loop(key: str, job: ExtensionJob, ctx: ExtensionContext) -> None:
    interval = max(1, int(job.interval_seconds))
    while True:
        try:
            await asyncio.sleep(interval)
            if not _job_may_run(key):
                continue
            await job.run(ctx)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Extension %s job %s failed — retrying next tick", key, job.name)


def start_extension_jobs(report: LoadReport) -> list[asyncio.Task]:
    """Spawn a loop task per declared job. Caller cancels them on shutdown."""
    tasks: list[asyncio.Task] = []
    for ext in report.loaded:
        if ext.instance is None:
            continue
        try:
            jobs = ext.instance.get_jobs() or []
        except Exception:  # noqa: BLE001
            logger.exception("Extension %s get_jobs() failed", ext.key)
            continue
        ctx = build_context(ext.key)
        for job in jobs:
            task = asyncio.create_task(
                _job_loop(ext.key, job, ctx), name=f"ext:{ext.key}:{job.name}"
            )
            tasks.append(task)
            logger.info(
                "Started extension job %s/%s (every %ss)", ext.key, job.name, job.interval_seconds
            )
    return tasks
