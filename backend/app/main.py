from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.config import settings
from app.database import engine
from app.models import Base


def _run_alembic_stamp(alembic_cfg, revision):
    """Run alembic stamp in a thread-safe way."""
    from alembic import command
    command.stamp(alembic_cfg, revision)


def _run_alembic_upgrade(alembic_cfg, revision):
    """Run alembic upgrade in a thread-safe way."""
    from alembic import command
    command.upgrade(alembic_cfg, revision)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from alembic.config import Config
    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    alembic_cfg = Config("alembic.ini")

    if settings.RESET_DB:
        # Full reset: drop everything and recreate
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        # Stamp so future non-reset runs just upgrade
        await asyncio.to_thread(_run_alembic_stamp, alembic_cfg, "head")
    else:
        # Ensure all tables exist (first run / new install)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        # If DB existed before Alembic, stamp baseline then upgrade
        async with engine.connect() as conn:
            has_table = await conn.run_sync(
                lambda sync_conn: sa_inspect(sync_conn).has_table("alembic_version")
            )
            if not has_table:
                # First Alembic run on existing DB – stamp current state
                await asyncio.to_thread(_run_alembic_stamp, alembic_cfg, "head")
            else:
                row = await conn.execute(
                    text("SELECT version_num FROM alembic_version LIMIT 1")
                )
                if row.first() is None:
                    await asyncio.to_thread(_run_alembic_stamp, alembic_cfg, "head")
                else:
                    # Normal path: run pending migrations
                    await asyncio.to_thread(_run_alembic_upgrade, alembic_cfg, "head")

    # Load DB-persisted email settings into runtime config
    from sqlalchemy import select as _sel

    from app.database import async_session
    from app.models.app_settings import AppSettings

    async with async_session() as _db:
        _res = await _db.execute(
            _sel(AppSettings).where(AppSettings.id == "default")
        )
        _row = _res.scalar_one_or_none()
        if _row and _row.email_settings:
            _email = _row.email_settings
            if _email.get("smtp_host"):
                settings.SMTP_HOST = _email["smtp_host"]
            if _email.get("smtp_port"):
                settings.SMTP_PORT = int(_email["smtp_port"])
            if _email.get("smtp_user"):
                settings.SMTP_USER = _email["smtp_user"]
            if _email.get("smtp_password"):
                settings.SMTP_PASSWORD = _email["smtp_password"]
            if _email.get("smtp_from"):
                settings.SMTP_FROM = _email["smtp_from"]
            if "smtp_tls" in _email:
                settings.SMTP_TLS = bool(_email["smtp_tls"])
            if _email.get("app_base_url"):
                settings._app_base_url = _email["app_base_url"]

    # Seed default metamodel
    from app.services.seed import seed_metamodel

    async with async_session() as db:
        await seed_metamodel(db)

    # Optionally seed demo data (NexaTech Industries dataset)
    if settings.SEED_DEMO:
        from app.services.seed_demo import seed_demo_data

        async with async_session() as db:
            result = await seed_demo_data(db)
            if not result.get("skipped"):
                print(f"[seed_demo] Seeded {result['fact_sheets']} fact sheets, "
                      f"{result['relations']} relations, {result['tag_groups']} tag groups")
            else:
                print(f"[seed_demo] Skipped: {result.get('reason', 'unknown')}")

    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.get("/api/health")
async def health():
    return {"status": "ok", "app": settings.PROJECT_NAME}
