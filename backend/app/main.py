from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.v1.router import api_router
from app.config import APP_VERSION, _DEFAULT_SECRET_KEYS, settings
from app.core.rate_limit import limiter
from app.database import engine
from app.models import Base

logger = logging.getLogger(__name__)


def _run_alembic_stamp(alembic_cfg, revision):
    """Run alembic stamp in a thread-safe way."""
    from alembic import command
    command.stamp(alembic_cfg, revision)


def _run_alembic_upgrade(alembic_cfg, revision):
    """Run alembic upgrade in a thread-safe way."""
    from alembic import command
    command.upgrade(alembic_cfg, revision)


_PURGE_INTERVAL_SECONDS = 3600  # Run once per hour
_PURGE_RETENTION_DAYS = 30


async def _purge_archived_cards_loop() -> None:
    """Background loop that permanently deletes cards archived for 30+ days."""
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import or_, select

    from app.database import async_session
    from app.models.card import Card
    from app.models.relation import Relation

    while True:
        try:
            await asyncio.sleep(_PURGE_INTERVAL_SECONDS)
            cutoff = datetime.now(timezone.utc) - timedelta(days=_PURGE_RETENTION_DAYS)
            async with async_session() as db:
                result = await db.execute(
                    select(Card).where(
                        Card.status == "ARCHIVED",
                        Card.archived_at.isnot(None),
                        Card.archived_at <= cutoff,
                    )
                )
                cards_to_purge = result.scalars().all()
                if not cards_to_purge:
                    continue

                purged_ids = [c.id for c in cards_to_purge]
                # Delete relations referencing these cards
                rels = await db.execute(
                    select(Relation).where(
                        or_(
                            Relation.source_id.in_(purged_ids),
                            Relation.target_id.in_(purged_ids),
                        )
                    )
                )
                for rel in rels.scalars().all():
                    await db.delete(rel)

                for card in cards_to_purge:
                    await db.delete(card)

                await db.commit()
                logger.info(
                    "Auto-purged %d archived cards (archived before %s)",
                    len(purged_ids),
                    cutoff.isoformat(),
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error in archived card purge loop")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── C2: Refuse startup with default secret key in non-development envs ──
    if settings.SECRET_KEY in _DEFAULT_SECRET_KEYS:
        env = settings.ENVIRONMENT
        if env != "development":
            raise RuntimeError(
                "SECRET_KEY must be set to a strong random value in production. "
                'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(64))"'
            )
        else:
            logger.warning(
                "Using default SECRET_KEY — acceptable for development only. "
                "Set a strong SECRET_KEY before deploying to production."
            )

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
        # Determine DB state before touching anything
        async with engine.connect() as conn:
            has_alembic = await conn.run_sync(
                lambda sync_conn: sa_inspect(sync_conn).has_table("alembic_version")
            )
            alembic_version = None
            if has_alembic:
                row = await conn.execute(
                    text("SELECT version_num FROM alembic_version LIMIT 1")
                )
                first = row.first()
                alembic_version = first[0] if first else None

        if not has_alembic or alembic_version is None:
            # Fresh DB or pre-Alembic: create tables from models, then stamp
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            await asyncio.to_thread(_run_alembic_stamp, alembic_cfg, "head")
        else:
            # Existing DB: run migrations FIRST (they may rename tables),
            # then create_all to pick up any genuinely new tables.
            try:
                await asyncio.to_thread(_run_alembic_upgrade, alembic_cfg, "head")
            except Exception:
                logger.exception("Alembic migration failed")
                raise
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)

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
                print(f"[seed_demo] Seeded {result['cards']} cards, "
                      f"{result['relations']} relations, {result['tag_groups']} tag groups")
            else:
                print(f"[seed_demo] Skipped: {result.get('reason', 'unknown')}")

    # Ensure a demo admin user exists before BPM seed (needed for assessments).
    if settings.SEED_DEMO or settings.SEED_BPM:
        from app.models.user import User
        from app.core.security import hash_password

        async with async_session() as db:
            admin_exists = await db.execute(
                _sel(User.id).where(User.role == "admin").limit(1)
            )
            if admin_exists.scalar_one_or_none() is None:
                demo_admin = User(
                    email="admin@turboea.demo",
                    display_name="Demo Admin",
                    password_hash=hash_password("TurboEA!2025"),
                    role="admin",
                    is_active=True,
                )
                db.add(demo_admin)
                await db.commit()
                print("[seed] Created demo admin user (admin@turboea.demo)")

    # Seed BPM demo data
    if settings.SEED_DEMO or settings.SEED_BPM:
        from app.services.seed_demo_bpm import seed_bpm_demo_data

        async with async_session() as db:
            result = await seed_bpm_demo_data(db)
            if not result.get("skipped"):
                print(f"[seed_bpm] Seeded {result['cards']} processes, "
                      f"{result['relations']} relations, {result['diagrams']} diagrams, "
                      f"{result['elements']} elements, {result['assessments']} assessments")
            else:
                print(f"[seed_bpm] Skipped: {result.get('reason', 'unknown')}")

    # Start background task for auto-purging archived cards after 30 days
    purge_task = asyncio.create_task(_purge_archived_cards_loop())

    yield

    # Cancel background purge task on shutdown
    purge_task.cancel()
    try:
        await purge_task
    except asyncio.CancelledError:
        pass


# ── H6: Conditionally disable OpenAPI docs in production ──
app = FastAPI(
    title=settings.PROJECT_NAME,
    lifespan=lifespan,
    docs_url="/api/docs" if settings.ENVIRONMENT == "development" else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.ENVIRONMENT == "development" else None,
)

# ── C7: Rate limiter ──
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── C1: CORS — restrict origins instead of wildcard ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": APP_VERSION}
