import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

import uuid

from app.api.v1.router import api_router
from app.config import settings
from app.core.security import hash_password
from app.database import async_session_factory, engine
from app.models import Base
from app.models.event import EventType
from app.models.user import User, UserRole
from app.services.completion_service import update_completion
from app.services.event_bus import event_bus

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def init_db() -> None:
    """Create all tables and seed a default admin user if none exists."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables ensured")

    async with async_session_factory() as session:
        result = await session.execute(select(User).limit(1))
        if result.scalar_one_or_none() is None:
            admin = User(
                email="admin@turboea.local",
                hashed_password=hash_password("admin123"),
                full_name="Admin",
                role=UserRole.ADMIN,
            )
            session.add(admin)
            await session.commit()
            logger.info("Default admin user created (admin@turboea.local / admin123)")


async def _on_fact_sheet_changed(event: dict) -> None:
    """Recalculate completion when a fact sheet is created or updated."""
    entity_id = uuid.UUID(event["entity_id"])
    async with async_session_factory() as session:
        await update_completion(session, entity_id)
        await session.commit()


async def _on_relation_changed(event: dict) -> None:
    """Recalculate completion for both sides of a relation."""
    payload = event.get("payload", {})
    for key in ("from_fact_sheet_id", "to_fact_sheet_id"):
        fs_id_str = payload.get(key)
        if fs_id_str:
            async with async_session_factory() as session:
                await update_completion(session, uuid.UUID(fs_id_str))
                await session.commit()


def _register_event_handlers() -> None:
    """Register event bus handlers for side effects."""
    event_bus.register_handler(EventType.FACT_SHEET_CREATED, _on_fact_sheet_changed)
    event_bus.register_handler(EventType.FACT_SHEET_UPDATED, _on_fact_sheet_changed)
    event_bus.register_handler(EventType.RELATION_CREATED, _on_relation_changed)
    event_bus.register_handler(EventType.RELATION_DELETED, _on_relation_changed)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    _register_event_handlers()
    yield
    await engine.dispose()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "version": settings.VERSION}
