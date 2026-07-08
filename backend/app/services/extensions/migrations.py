"""Sequential schema-migration runner for extensions.

Extensions never touch the core Alembic chain. Each declares an ordered
list of :class:`ExtensionMigration` steps (version 1, 2, 3, …) creating
and evolving its own ``ext_{key}_*`` tables; the applied set is tracked
in the core-owned ``extension_schema_versions`` table.

Each step runs in its own transaction. A failing step marks that
extension as failed (recorded by the caller) and stops ITS migrations —
other extensions and core startup continue untouched.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import text

from app.database import engine
from app.services.extensions.loader import LoadReport
from app.services.extensions.sdk import ExtensionMigration

logger = logging.getLogger(__name__)


async def _applied_versions(key: str) -> set[int]:
    async with engine.connect() as conn:
        rows = await conn.execute(
            text(
                "SELECT version FROM extension_schema_versions WHERE extension_key = :key"
            ).bindparams(key=key)
        )
        return {int(v) for (v,) in rows}


async def _run_one(key: str, migration: ExtensionMigration) -> None:
    async with engine.begin() as conn:
        await migration.upgrade(conn)
        await conn.execute(
            text(
                "INSERT INTO extension_schema_versions (extension_key, version, name, applied_at) "
                "VALUES (:key, :version, :name, :applied_at)"
            ).bindparams(
                key=key,
                version=migration.version,
                name=migration.name[:255],
                applied_at=datetime.now(timezone.utc),
            )
        )


async def run_extension_migrations(
    report: LoadReport, *, should_run: dict[str, bool] | None = None
) -> dict[str, str]:
    """Run pending migrations for every loaded backend extension.

    ``should_run`` maps extension key → whether its migrations may run
    (enabled + usable entitlement, decided by the caller from the
    registry). Returns ``{key: error}`` for extensions whose migration
    failed.
    """
    errors: dict[str, str] = {}
    for ext in report.loaded:
        if ext.instance is None:
            continue
        if should_run is not None and not should_run.get(ext.key, False):
            logger.info("Skipping migrations for %s (disabled or unlicensed)", ext.key)
            continue
        try:
            migrations = sorted(ext.instance.get_migrations() or [], key=lambda m: m.version)
        except Exception as exc:  # noqa: BLE001
            errors[ext.key] = f"get_migrations() failed: {exc}"[:1000]
            logger.exception("Extension %s get_migrations() failed", ext.key)
            continue

        seen: set[int] = set()
        for m in migrations:
            if m.version < 1 or m.version in seen:
                errors[ext.key] = f"invalid migration version sequence at {m.version}"
                break
            seen.add(m.version)
        if ext.key in errors:
            continue

        try:
            applied = await _applied_versions(ext.key)
            for migration in migrations:
                if migration.version in applied:
                    continue
                await _run_one(ext.key, migration)
                logger.info(
                    "Extension %s migration %d (%s) applied",
                    ext.key,
                    migration.version,
                    migration.name,
                )
        except Exception as exc:  # noqa: BLE001
            errors[ext.key] = str(exc)[:1000]
            logger.exception("Extension %s migration failed", ext.key)
    return errors
