"""The boot-time advisory lock serialises overlapping backend instances.

Each test uses a random key so parallel workers sharing one database never
contend, and each ``engine.connect()`` is a fresh asyncpg session (NullPool),
which is what a second Turbo EA instance would be.
"""

from __future__ import annotations

import asyncio
import logging
import secrets

import pytest
from sqlalchemy import text

from app.services.startup_lock import STARTUP_LOCK_KEY, startup_lock


def _key() -> int:
    return secrets.randbits(62)


async def _try_lock(engine, key: int) -> bool:
    async with engine.connect() as conn:
        got = (await conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": key})).scalar_one()
        if got:
            await conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
        await conn.commit()
        return got


def test_production_key_fits_a_signed_bigint():
    assert 0 < STARTUP_LOCK_KEY < 2**63


async def test_lock_is_held_for_the_block_and_released_after(test_engine):
    key = _key()
    async with startup_lock(test_engine, key=key):
        assert await _try_lock(test_engine, key) is False
    assert await _try_lock(test_engine, key) is True


async def test_lock_is_released_when_the_block_raises(test_engine):
    key = _key()
    with pytest.raises(RuntimeError, match="boom"):
        async with startup_lock(test_engine, key=key):
            raise RuntimeError("boom")
    assert await _try_lock(test_engine, key) is True


async def test_second_instance_waits_for_the_holder(test_engine, caplog):
    key = _key()
    holder = await test_engine.connect()
    await holder.execute(text("SELECT pg_advisory_lock(:k)"), {"k": key})
    await holder.commit()

    entered = asyncio.Event()

    async def second_instance() -> None:
        async with startup_lock(test_engine, key=key):
            entered.set()

    with caplog.at_level(logging.WARNING, logger="app.services.startup_lock"):
        task = asyncio.create_task(second_instance())
        await asyncio.sleep(0.3)
        assert not entered.is_set(), "the second instance must block while the lock is held"
        assert any("holds the startup lock" in r.message for r in caplog.records)

        await holder.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
        await holder.commit()
        await holder.close()
        await asyncio.wait_for(task, timeout=10)

    assert entered.is_set()
    assert await _try_lock(test_engine, key) is True
