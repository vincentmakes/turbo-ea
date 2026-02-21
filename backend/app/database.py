from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import Pool

from app.config import settings
from app.core.metrics import db_pool_checked_in, db_pool_checked_out, db_pool_overflow, db_pool_size

engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
    pool_size=20,
    max_overflow=10,
    pool_timeout=30,
    pool_recycle=1800,
    pool_pre_ping=True,
)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


def _update_pool_metrics(pool: Pool) -> None:
    """Snapshot current pool state into Prometheus gauges."""
    db_pool_size.set(pool.size())
    db_pool_checked_in.set(pool.checkedin())
    db_pool_checked_out.set(pool.checkedout())
    db_pool_overflow.set(pool.overflow())


# Update pool metrics on every checkout / checkin / overflow event
@event.listens_for(engine.sync_engine, "checkout")
def _on_checkout(dbapi_conn, connection_record, connection_proxy):
    _update_pool_metrics(engine.sync_engine.pool)


@event.listens_for(engine.sync_engine, "checkin")
def _on_checkin(dbapi_conn, connection_record):
    _update_pool_metrics(engine.sync_engine.pool)


async def get_db() -> AsyncSession:  # type: ignore[misc]
    async with async_session() as session:
        yield session
