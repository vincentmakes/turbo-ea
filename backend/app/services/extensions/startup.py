"""Lifespan-time initialization of the Extension Store.

Runs inside ``app.main``'s lifespan after core Alembic migrations and
seeds: reconciles the ``extensions`` table with what the boot-time
loader actually loaded, refreshes the in-memory registry, runs
per-extension schema migrations, fires ``on_startup`` hooks, and spawns
job loops. Every step is fail-soft per extension.
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select

from app.database import async_session
from app.services.extensions.agent_tools import start_agent_tools
from app.services.extensions.events import start_extension_event_dispatchers
from app.services.extensions.field_contributions import heal_contributions
from app.services.extensions.jobs import (
    build_context,
    extension_may_run,
    start_extension_jobs,
)
from app.services.extensions.loader import LoadReport
from app.services.extensions.migrations import run_extension_migrations
from app.services.extensions.notification_channels import start_notification_channels
from app.services.extensions.notification_types import start_notification_types
from app.services.extensions.registry import extension_registry

logger = logging.getLogger(__name__)


async def _reconcile_rows(report: LoadReport) -> None:
    """Sync extension row statuses with the actual boot outcome."""
    from app.models.extension import Extension

    failed_by_key = {f.key: f.error for f in report.failed}
    loaded_keys = {ext.key for ext in report.loaded}

    async with async_session() as db:
        rows = (
            (await db.execute(select(Extension).where(Extension.status != "removed")))
            .scalars()
            .all()
        )
        for row in rows:
            if row.key in failed_by_key:
                row.status = "failed"
                row.last_error = failed_by_key[row.key]
            elif row.key in loaded_keys:
                if row.status in ("needs_restart", "failed"):
                    row.status = "installed" if row.enabled else "disabled"
                row.last_error = None
            elif set(row.capabilities or []) & {"backend", "frontend"}:
                # Row says code should exist, but the volume has nothing —
                # e.g. the extensions volume was recreated. Fail loudly in
                # the admin UI instead of silently serving nothing.
                row.status = "failed"
                row.last_error = "Extension files are missing from the extensions volume"
        await db.commit()


async def _heal_metamodel_contributions() -> None:
    """Put back field sections and subtypes an active extension contributed
    and the metamodel no longer carries. Its own short session; a failure is
    logged and never blocks boot."""
    try:
        async with async_session() as db:
            healed = await heal_contributions(db)
            await db.commit()
    except Exception:
        logger.exception("Restoring extension metamodel contributions failed")
        return
    for key in healed:
        logger.info("Extension %s: restored missing metamodel contributions", key)


async def initialize_extensions(report: LoadReport) -> list[asyncio.Task]:
    """Full lifespan init. Returns job tasks for the caller to cancel on shutdown."""
    try:
        await _reconcile_rows(report)
        async with async_session() as db:
            await extension_registry.refresh_from_db(db)
    except Exception:
        logger.exception("Extension registry initialization failed")
        return []

    # From the rows, not ``report.loaded``: a metamodel-only extension has no
    # code to load and must be healed all the same.
    await _heal_metamodel_contributions()

    if not report.loaded and not report.failed:
        return []

    should_run = {ext.key: extension_may_run(ext.key) for ext in report.loaded}

    migration_errors = await run_extension_migrations(report, should_run=should_run)
    if migration_errors:
        from app.models.extension import Extension

        async with async_session() as db:
            for key, error in migration_errors.items():
                row = (
                    await db.execute(select(Extension).where(Extension.key == key))
                ).scalar_one_or_none()
                if row is not None:
                    row.status = "failed"
                    row.last_error = f"Migration failed: {error}"[:1000]
                should_run[key] = False
            await db.commit()
            await extension_registry.refresh_from_db(db)

    for ext in report.loaded:
        if ext.instance is None or not should_run.get(ext.key, False):
            continue
        try:
            # build_context is memoized per key, so on_startup, job loops and
            # event handlers all share one ExtensionContext instance.
            await ext.instance.on_startup(build_context(ext.key))
        except Exception:
            logger.exception("Extension %s on_startup() failed", ext.key)

    # Manifest-driven, no task: the types must be known before the first
    # job or event handler sends under one of them.
    start_notification_types(report)
    # Checked against the routers mounted at import time; liveness (enabled,
    # licensed) is re-checked on every read, so this needs no task either.
    start_agent_tools(report)

    return (
        start_extension_jobs(report)
        + start_extension_event_dispatchers(report)
        + start_notification_channels(report)
    )
