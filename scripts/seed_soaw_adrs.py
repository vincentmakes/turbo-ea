#!/usr/bin/env python3
"""One-time script to seed SoAW and ADR demo data on an existing database.

Wipes all existing SoAW and ADR records, then inserts the full demo dataset.

Usage (run inside the backend container where asyncpg is installed):

    docker compose exec backend python -c "
    import asyncio
    from app.database import async_session
    from app.services.seed_demo_soaw_adrs import seed
    async def run():
        async with async_session() as db:
            result = await seed(db)
        print(result)
    asyncio.run(run())
    "

Or copy this script into the container and run directly:

    docker compose cp scripts/seed_soaw_adrs.py backend:/app/
    docker compose exec backend python /app/seed_soaw_adrs.py
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

# When running outside the container, add backend/ to sys.path
backend_dir = Path(__file__).resolve().parent.parent / "backend"
if backend_dir.is_dir():
    sys.path.insert(0, str(backend_dir))

from sqlalchemy import delete, select  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.models.architecture_decision import ArchitectureDecision  # noqa: E402
from app.models.architecture_decision_card import ArchitectureDecisionCard  # noqa: E402
from app.models.soaw import SoAW  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.seed_demo import (  # noqa: E402
    DEMO_ADR_CARD_LINKS,
    DEMO_ADR_EXTRA_CARD_LINKS,
    DEMO_ADRS,
    DEMO_ADRS_EXTRA,
    DEMO_SOAWS,
    _id,
)


def _build_database_url() -> str:
    """Build the async database URL from environment variables."""
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    db = os.getenv("POSTGRES_DB", "turboea")
    user = os.getenv("POSTGRES_USER", "turboea")
    password = os.getenv("POSTGRES_PASSWORD", "turboea")
    return f"postgresql+asyncpg://{user}:{password}@{host}:{port}/{db}"


async def seed(db: AsyncSession) -> dict:
    """Wipe existing SoAW + ADR data, then insert demo dataset."""
    # Delete in FK order
    await db.execute(delete(ArchitectureDecisionCard))
    await db.execute(delete(ArchitectureDecision))
    await db.execute(delete(SoAW))
    await db.flush()
    print("[cleanup] Deleted all existing SoAW and ADR records")

    # Insert all ADRs (original 3 + extra 4)
    for adr_def in DEMO_ADRS + DEMO_ADRS_EXTRA:
        adr_data = {k: v for k, v in adr_def.items()}
        db.add(ArchitectureDecision(**adr_data))
    await db.flush()

    # Insert ADR-to-card links
    for link_def in DEMO_ADR_CARD_LINKS + DEMO_ADR_EXTRA_CARD_LINKS:
        db.add(
            ArchitectureDecisionCard(
                architecture_decision_id=_id(link_def["adr_ref"]),
                card_id=_id(link_def["card_ref"]),
            )
        )
    await db.flush()

    # Look up admin user for SoAW created_by
    admin_result = await db.execute(select(User.id).where(User.role == "admin").limit(1))
    admin_id = admin_result.scalar_one_or_none()

    # Insert SoAW documents
    for soaw_def in DEMO_SOAWS:
        soaw_data = {k: v for k, v in soaw_def.items()}
        if admin_id:
            soaw_data["created_by"] = admin_id
        db.add(SoAW(**soaw_data))
    await db.flush()

    await db.commit()
    return {
        "adrs": len(DEMO_ADRS) + len(DEMO_ADRS_EXTRA),
        "adr_links": len(DEMO_ADR_CARD_LINKS) + len(DEMO_ADR_EXTRA_CARD_LINKS),
        "soaws": len(DEMO_SOAWS),
    }


async def main() -> None:
    url = _build_database_url()
    print(f"[seed_soaw_adrs] Connecting to {url.split('@')[1]}...")
    engine = create_async_engine(url, echo=False)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as db:
        result = await seed(db)

    await engine.dispose()
    print(
        f"[seed_soaw_adrs] Done: {result['adrs']} ADRs, "
        f"{result['adr_links']} ADR-card links, {result['soaws']} SoAWs"
    )


if __name__ == "__main__":
    asyncio.run(main())
