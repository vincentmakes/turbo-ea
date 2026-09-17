"""Serialise the boot-time database phase across Turbo EA instances.

The backend migrates the schema, seeds the metamodel and runs extension
migrations when it starts, with nothing stopping a second instance from doing
the same at the same moment. Docker Compose and the Helm chart never start two
backends at once (one container; a ``Recreate`` Deployment), but the managed
container services do: Azure Container Apps and Cloud Run keep the old revision
serving until the new one is ready, so for a few seconds to a few minutes two
backends run side by side on every deploy.

``startup_lock`` takes a PostgreSQL **session-level** advisory lock on a
dedicated connection for the whole phase. A second instance blocks on it, then
re-reads ``alembic_version`` inside the lock, finds the schema at head and
skips the upgrade; every seeder is idempotent, so it re-checks and moves on.

Two things make the connection handling deliberate:

* The lock is session-level rather than transaction-level so it survives the
  commits Alembic, ``create_all`` and the seeders make on *other* pooled
  connections. The autobegun transaction on the lock connection is committed
  right after acquiring, which does not release a session-level lock.
* The pool's reset-on-return does **not** release session advisory locks, so
  the lock is released explicitly, and if that fails the physical connection
  is invalidated so PostgreSQL drops the lock when the socket closes.

``key`` is a parameter only so tests can use random keys against a shared
database; production always uses ``STARTUP_LOCK_KEY``.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Final

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

logger = logging.getLogger(__name__)

# "TURBOEA" as bytes, read as a big-endian integer — fits a signed bigint.
STARTUP_LOCK_KEY: Final[int] = int.from_bytes(b"TURBOEA", "big")


@asynccontextmanager
async def startup_lock(engine: AsyncEngine, *, key: int = STARTUP_LOCK_KEY) -> AsyncIterator[None]:
    """Hold the boot-time advisory lock for the duration of the block."""
    async with engine.connect() as conn:
        acquired = (
            await conn.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": key})
        ).scalar_one()
        if not acquired:
            logger.warning(
                "[startup] Another Turbo EA instance holds the startup lock — waiting for it "
                "to finish migrating and seeding (expected during a rolling deploy on "
                "Container Apps or Cloud Run; if this never clears, the old instance is stuck)"
            )
            await conn.execute(text("SELECT pg_advisory_lock(:key)"), {"key": key})
            logger.info("[startup] Startup lock acquired after waiting")
        # End the autobegun transaction; a session-level lock outlives it.
        await conn.commit()
        try:
            yield
        finally:
            try:
                await conn.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": key})
                await conn.commit()
            except Exception:
                # Never return a connection that still holds the lock to the pool.
                await conn.invalidate()
                raise
