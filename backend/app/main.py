from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import engine
from app.models import Base
from app.api.v1.router import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    from alembic.config import Config
    from alembic import command
    from sqlalchemy import text, inspect as sa_inspect

    alembic_cfg = Config("alembic.ini")

    if settings.RESET_DB:
        # Full reset: drop everything and recreate
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        # Stamp so future non-reset runs just upgrade
        command.stamp(alembic_cfg, "head")
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
                command.stamp(alembic_cfg, "head")
            else:
                row = await conn.execute(
                    text("SELECT version_num FROM alembic_version LIMIT 1")
                )
                if row.first() is None:
                    command.stamp(alembic_cfg, "head")
                else:
                    # Normal path: run pending migrations
                    command.upgrade(alembic_cfg, "head")

    # Seed default metamodel
    from app.database import async_session
    from app.services.seed import seed_metamodel

    async with async_session() as db:
        await seed_metamodel(db)

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
