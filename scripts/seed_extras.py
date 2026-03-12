#!/usr/bin/env python3
"""Standalone script to seed extra demo data on an existing database.

Seeds comments, stakeholders, history events, diagrams, saved reports,
surveys, todos, documents, and bookmarks for the NexaTech demo dataset.

Usage (from the repo root):

    cd backend && python ../scripts/seed_extras.py

Or inside the backend container:

    docker compose cp scripts/seed_extras.py backend:/app/
    docker compose exec backend python /app/seed_extras.py

Requires: POSTGRES_* env vars set (or defaults), base demo data already seeded.
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

from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.services.seed_demo_extras import seed_extras_demo_data  # noqa: E402


def _build_database_url() -> str:
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    db = os.getenv("POSTGRES_DB", "turboea")
    user = os.getenv("POSTGRES_USER", "turboea")
    password = os.getenv("POSTGRES_PASSWORD", "turboea")
    return f"postgresql+asyncpg://{user}:{password}@{host}:{port}/{db}"


async def main() -> None:
    url = _build_database_url()
    host = os.environ.get("POSTGRES_HOST", "localhost")
    db_name = os.environ.get("POSTGRES_DB", "turboea")
    print(f"[seed_extras] Connecting to {host}/{db_name}...")

    engine = create_async_engine(url, echo=False)
    session_factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with session_factory() as db:
        result = await seed_extras_demo_data(db)

    await engine.dispose()

    if result.get("skipped"):
        print(f"[seed_extras] Skipped: {result.get('reason')}")
    else:
        print(
            f"[seed_extras] Done: {result.get('comments', 0)} comments, "
            f"{result.get('stakeholders', 0)} stakeholders, "
            f"{result.get('events', 0)} events, "
            f"{result.get('diagrams', 0)} diagrams, "
            f"{result.get('saved_reports', 0)} saved reports, "
            f"{result.get('surveys', 0)} surveys, "
            f"{result.get('survey_responses', 0)} survey responses, "
            f"{result.get('todos', 0)} todos, "
            f"{result.get('documents', 0)} documents, "
            f"{result.get('bookmarks', 0)} bookmarks"
        )


if __name__ == "__main__":
    asyncio.run(main())
