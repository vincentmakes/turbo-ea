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
from typing import Any

from sqlalchemy import select

from app.database import async_session
from app.services.extensions.loader import LoadReport
from app.services.extensions.registry import extension_registry
from app.services.extensions.sdk import ExtensionContext, ExtensionJob

logger = logging.getLogger(__name__)


def build_context(key: str) -> ExtensionContext:
    """Runtime services for one extension: sessions, logging, namespaced
    settings persisted under ``app_settings.general_settings["ext.{key}.*"]``."""

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

    return ExtensionContext(
        key=key,
        session_factory=async_session,
        logger=logging.getLogger(f"ext.{key}"),
        get_setting=get_setting,
        set_setting=set_setting,
    )


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
