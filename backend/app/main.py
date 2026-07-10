from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.v1.router import api_router
from app.config import _DEFAULT_SECRET_KEYS, APP_VERSION, settings
from app.core.logging_config import configure_logging
from app.core.rate_limit import limiter
from app.database import engine
from app.models import Base

configure_logging(environment=settings.ENVIRONMENT)
logger = logging.getLogger(__name__)


def _alembic_stamp_sync(sync_connection, alembic_cfg):
    """Stamp alembic_version using an existing sync connection."""
    from alembic import command

    alembic_cfg.attributes["connection"] = sync_connection
    command.stamp(alembic_cfg, "head")


def _alembic_upgrade_sync(sync_connection, alembic_cfg):
    """Run alembic upgrade using an existing sync connection."""
    from alembic import command

    alembic_cfg.attributes["connection"] = sync_connection
    command.upgrade(alembic_cfg, "head")


_PURGE_INTERVAL_SECONDS = 3600  # Run once per hour
_PURGE_RETENTION_DAYS = 30  # Fallback when the admin setting is unset


def _archive_purge_cutoff(retention_days, now):
    """Return the purge cutoff datetime, or ``None`` to skip purging.

    ``retention_days`` of ``0`` (or anything falsy/negative) means "keep
    archived cards indefinitely" — auto-purge is disabled. Otherwise cards
    archived on or before ``now - retention_days`` are eligible for purge.
    """
    from datetime import timedelta

    if not retention_days or retention_days <= 0:
        return None
    return now - timedelta(days=retention_days)


_OLLAMA_PULL_TIMEOUT = 600  # 10 minutes max for model pull
_KPI_SNAPSHOT_HOUR_UTC = 2  # Capture daily snapshot at 02:00 UTC
_TASK_PROMOTION_HOUR_UTC = 3  # Promote scheduled task occurrences at 03:00 UTC


async def _purge_mutation_batches_loop() -> None:
    """Background loop that permanently deletes mutation_batches rows
    older than ``settings.MUTATION_BATCH_RETENTION_DAYS`` (default 15).

    Events that reference the deleted batches keep their rows — the FK
    on ``events.batch_id`` is ``ON DELETE SET NULL`` (migration 094) so
    the per-card History tab and other event readers stay intact. The
    audit log just loses the handle to roll those old batches back,
    which is the point of retention.
    """
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import delete

    from app.database import async_session
    from app.models.mutation_batch import MutationBatch

    while True:
        try:
            await asyncio.sleep(_PURGE_INTERVAL_SECONDS)
            retention_days = max(1, settings.MUTATION_BATCH_RETENTION_DAYS)
            cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
            async with async_session() as db:
                result = await db.execute(
                    delete(MutationBatch).where(MutationBatch.created_at <= cutoff)
                )
                deleted = result.rowcount or 0
                if deleted:
                    await db.commit()
                    logger.info(
                        "Auto-purged %d mutation batch(es) older than %s (%d-day retention).",
                        deleted,
                        cutoff.isoformat(),
                        retention_days,
                    )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error in mutation-batch purge loop")


async def _ops_access_maintenance_loop() -> None:
    """Hourly maintenance for the control-plane ops API: deactivate time-boxed
    rescue accounts past ``access_expires_at`` (defense in depth on top of the
    ``get_current_user`` check) and purge old signed-request nonces. A no-op on
    self-hosted installs — no rescue accounts, no nonces ever exist."""
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import delete, select

    from app.database import async_session
    from app.models.ops_nonce import OpsRequestNonce
    from app.models.user import User

    while True:
        try:
            await asyncio.sleep(3600)
            async with async_session() as db:
                now = datetime.now(timezone.utc)
                expired = (
                    (
                        await db.execute(
                            select(User).where(
                                User.access_expires_at.isnot(None),
                                User.access_expires_at < now,
                                User.is_active == True,  # noqa: E712
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                for user in expired:
                    user.is_active = False
                    user.password_setup_token = None
                    logger.info("Deactivated expired rescue account %s", user.id)
                await db.execute(
                    delete(OpsRequestNonce).where(
                        OpsRequestNonce.created_at < now - timedelta(hours=1)
                    )
                )
                await db.commit()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error in ops access maintenance loop")


async def _purge_archived_cards_loop() -> None:
    """Background loop that permanently deletes cards archived past the
    admin-configured retention window.

    The retention period is read fresh each cycle from the singleton
    ``app_settings`` row (``general_settings.archiveRetentionDays``, default
    30). A value of ``0`` disables auto-purge entirely so archived cards — and
    their history — are kept indefinitely. Because it is re-read every cycle,
    changing the setting takes effect without a restart.
    """
    from datetime import datetime, timezone

    from sqlalchemy import or_, select

    from app.database import async_session
    from app.models.app_settings import AppSettings
    from app.models.card import Card
    from app.models.relation import Relation

    while True:
        try:
            await asyncio.sleep(_PURGE_INTERVAL_SECONDS)
            async with async_session() as db:
                settings_row = (
                    await db.execute(select(AppSettings).where(AppSettings.id == "default"))
                ).scalar_one_or_none()
                general = (settings_row.general_settings if settings_row else None) or {}
                retention_days = general.get("archiveRetentionDays", _PURGE_RETENTION_DAYS)
                cutoff = _archive_purge_cutoff(retention_days, datetime.now(timezone.utc))
                if cutoff is None:
                    # Retention disabled (0) — keep archived cards indefinitely.
                    continue
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

                # Self-heal stranded children: any card whose `parent_id` still
                # points at a card we're about to purge gets disconnected first.
                # Without this the self-FK on `cards.parent_id` (no ON DELETE
                # rule) blocks the delete. Covers historical data created before
                # the child-strategy feature shipped.
                stranded_res = await db.execute(
                    select(Card).where(Card.parent_id.in_(purged_ids), Card.id.not_in(purged_ids))
                )
                stranded_count = 0
                for stranded in stranded_res.scalars().all():
                    stranded.parent_id = None
                    stranded_count += 1

                for card in cards_to_purge:
                    await db.delete(card)

                await db.commit()
                logger.info(
                    "Auto-purged %d archived cards (archived before %s); "
                    "disconnected %d stranded child(ren).",
                    len(purged_ids),
                    cutoff.isoformat(),
                    stranded_count,
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error in archived card purge loop")


async def _kpi_snapshot_loop() -> None:
    """Background loop that captures one KPI snapshot per day at 02:00 UTC.

    The dashboard endpoint reads these rows to compute "vs previous 30 days"
    trend indicators. The capture is idempotent on snapshot_date, so a
    transient restart that triggers a second run on the same day is safe.
    """
    from datetime import datetime, timedelta, timezone

    from app.database import async_session
    from app.services.kpi_snapshot_service import capture_snapshot

    while True:
        try:
            now = datetime.now(timezone.utc)
            next_run = now.replace(hour=_KPI_SNAPSHOT_HOUR_UTC, minute=0, second=0, microsecond=0)
            if next_run <= now:
                next_run += timedelta(days=1)
            await asyncio.sleep((next_run - now).total_seconds())

            async with async_session() as db:
                snap = await capture_snapshot(db)
                await db.commit()
                logger.info(
                    "Captured KPI snapshot for %s (total=%d, dq=%.1f, approved=%d, broken=%d)",
                    snap.snapshot_date.isoformat(),
                    snap.total_cards,
                    snap.avg_data_quality,
                    snap.approved_count,
                    snap.broken_count,
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error in KPI snapshot loop")
            # Avoid tight retry loop if something is broken.
            await asyncio.sleep(3600)


async def _license_refresh_loop() -> None:
    """Daily loop that auto-renews the extension license from the store.

    Only acts when the active license carries a store-issued renewal
    credential and an entitlement is close to expiry; a renewing Stripe
    subscription then extends the license with no customer action. Silent
    on air-gapped / offline installs (the fetch just fails debug-quietly),
    and manually issued licenses are never touched. Runs shortly after
    boot (catch-up after downtime) and then every 24h.
    """
    from app.database import async_session
    from app.services.extensions.license_refresh import refresh_license_if_due

    delay = 120  # first attempt shortly after boot, then daily
    while True:
        try:
            await asyncio.sleep(delay)
            delay = 24 * 3600
            async with async_session() as db:
                await refresh_license_if_due(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error in extension license refresh loop")


async def _promote_recurring_tasks_loop() -> None:
    """Daily background loop that flips eligible ``scheduled`` recurring
    items to ``open`` once their lead-time window opens.

    Covers both risk mitigation-task occurrences and recurring card todos
    in the same pass. Runs once per UTC day at ``_TASK_PROMOTION_HOUR_UTC``
    (03:00). Each promotion fires the relevant ``task_assigned`` /
    ``todo_assigned`` notification (and, for tasks, the system Todo +
    ``risk_mitigation_task.activated`` event). Both promotion services are
    idempotent on already-open rows, so a transient restart that doubles a
    tick is safe.
    """
    from datetime import datetime, timedelta, timezone

    from app.database import async_session
    from app.services.risk_mitigation_task_service import promote_scheduled_occurrences
    from app.services.todo_recurrence_service import promote_scheduled_todos

    while True:
        try:
            now = datetime.now(timezone.utc)
            next_run = now.replace(hour=_TASK_PROMOTION_HOUR_UTC, minute=0, second=0, microsecond=0)
            if next_run <= now:
                next_run += timedelta(days=1)
            await asyncio.sleep((next_run - now).total_seconds())

            async with async_session() as db:
                promoted = await promote_scheduled_occurrences(db)
                promoted_todos = await promote_scheduled_todos(db)
                await db.commit()
                if promoted:
                    logger.info(
                        "Promoted %d scheduled mitigation task occurrence(s) to open",
                        promoted,
                    )
                if promoted_todos:
                    logger.info(
                        "Promoted %d scheduled recurring todo(s) to open",
                        promoted_todos,
                    )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error in recurring item promotion loop")
            # Same backoff pattern as the KPI loop — avoid a tight retry
            # spiral if the DB is unavailable.
            await asyncio.sleep(3600)


# Marker in app_settings.general_settings recording that the one-shot
# canonical data-quality rescore has run on this install.
_DQ_RESCORE_FLAG = "dataQualityCanonicalRescoreDone"


async def _one_shot_data_quality_rescore() -> None:
    """Rescore every card with the canonical scorer, once per install.

    Existing installs can carry non-canonical ``data_quality`` values from two
    historic sources: the demo seed's insert-time approximation (which cannot
    see the relation/tag/stakeholder buckets) and workspace imports made by
    importer versions that scored cards before their relations were applied.
    Both inflate or depress the Dashboard's Average Completion until each card
    is individually edited. This one-shot heals the whole inventory on the
    first startup after upgrading; a marker in ``app_settings`` makes every
    later boot a no-op (discussion #667).
    """
    from app.database import async_session

    try:
        async with async_session() as db:
            changed = await run_dq_rescore_once(db)
            await db.commit()
            if changed:
                logger.info(
                    "One-shot data-quality rescore updated %d card(s) to canonical scores",
                    changed,
                )
    except asyncio.CancelledError:
        raise
    except Exception:
        # Marker not written — the rescore retries on the next startup.
        logger.exception("One-shot data-quality rescore failed")


async def run_dq_rescore_once(db) -> int | None:
    """Rescore all cards unless the settings marker says it already ran.

    Returns the changed-card count, or ``None`` when the marker was set and
    nothing was done. The caller commits.
    """
    from sqlalchemy import select

    from app.models.app_settings import AppSettings
    from app.services.data_quality import recompute_all_data_quality

    row = (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one_or_none()
    if row is not None and (row.general_settings or {}).get(_DQ_RESCORE_FLAG):
        return None
    changed = await recompute_all_data_quality(db)
    if row is None:
        row = AppSettings(id="default", general_settings={}, email_settings={})
        db.add(row)
    row.general_settings = {**(row.general_settings or {}), _DQ_RESCORE_FLAG: True}
    await db.flush()
    return changed


async def _ensure_initial_kpi_snapshot() -> None:
    """Capture an immediate snapshot on startup if the table is empty.

    Without this, fresh installs would have to wait until the first 02:00 UTC
    tick to record any baseline.
    """
    from sqlalchemy import select as _sel

    from app.database import async_session
    from app.models.kpi_snapshot import KpiSnapshot
    from app.services.kpi_snapshot_service import capture_snapshot

    try:
        async with async_session() as db:
            existing = await db.execute(_sel(KpiSnapshot.id).limit(1))
            if existing.scalar_one_or_none() is not None:
                return
            await capture_snapshot(db)
            await db.commit()
            logger.info("Captured initial KPI snapshot baseline")
    except Exception:
        logger.exception("Failed to capture initial KPI snapshot")


async def _auto_configure_ai() -> None:
    """Write AI config into app_settings when AI_AUTO_CONFIGURE is enabled.

    Runs on startup — only writes the DB row if AI is not already configured.
    """
    from sqlalchemy import select as _sel

    from app.database import async_session
    from app.models.app_settings import AppSettings

    provider_url = settings.AI_PROVIDER_URL
    model = settings.AI_MODEL
    if not provider_url or not model:
        return

    async with async_session() as db:
        result = await db.execute(_sel(AppSettings).where(AppSettings.id == "default"))
        row = result.scalar_one_or_none()
        if not row:
            row = AppSettings(id="default")
            db.add(row)

        general = dict(row.general_settings or {})
        ai = general.get("ai", {})

        # Skip if admin already configured AI manually
        if ai.get("enabled") and ai.get("providerUrl") and ai.get("model"):
            logger.info("[ai] AI already configured — skipping auto-configure")
            return

        general["ai"] = {
            "enabled": True,
            "providerType": "ollama",
            "providerUrl": provider_url,
            "apiKey": "",
            "model": model,
            "searchProvider": "duckduckgo",
            "searchUrl": "",
            "enabledTypes": ai.get("enabledTypes", []),
            "portfolioInsightsEnabled": ai.get("portfolioInsightsEnabled", False),
        }
        row.general_settings = general
        await db.commit()
        logger.info("[ai] Auto-configured AI: provider=%s  model=%s", provider_url, model)


async def _ensure_ollama_model() -> None:
    """Background task: pull the configured model if Ollama doesn't have it yet.

    Only runs when providerType is 'ollama' (or unset, for backward compat).
    """
    import httpx
    from sqlalchemy import select as _sel2

    from app.database import async_session as _async_session2
    from app.models import app_settings as _as_mod

    provider_url = settings.AI_PROVIDER_URL
    model = settings.AI_MODEL
    if not provider_url or not model:
        return

    # Check if provider type is Ollama (skip model pull for commercial providers)
    try:
        async with _async_session2() as db:
            result = await db.execute(
                _sel2(_as_mod.AppSettings).where(_as_mod.AppSettings.id == "default")
            )
            row = result.scalar_one_or_none()
            if row:
                ai = (row.general_settings or {}).get("ai", {})
                pt = ai.get("providerType", "ollama")
                if pt != "ollama":
                    logger.info("[ai] Provider type is '%s' — skipping Ollama model pull", pt)
                    return
    except Exception:
        pass  # Proceed with pull attempt if DB check fails

    tags_url = f"{provider_url.rstrip('/')}/api/tags"
    pull_url = f"{provider_url.rstrip('/')}/api/pull"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(tags_url)
            resp.raise_for_status()
            available = [m.get("name", "") for m in resp.json().get("models", [])]
            # Check both exact match and name without tag (e.g. "gemma3:4b" or "gemma3")
            if any(model in m or m.startswith(model.split(":")[0]) for m in available):
                logger.info("[ai] Model '%s' already available in Ollama", model)
                return
    except httpx.HTTPError as exc:
        logger.warning("[ai] Cannot reach Ollama at %s: %s", tags_url, exc)
        return

    logger.info("[ai] Pulling model '%s' from Ollama (this may take several minutes)...", model)
    try:
        async with httpx.AsyncClient(timeout=_OLLAMA_PULL_TIMEOUT) as client:
            resp = await client.post(pull_url, json={"name": model, "stream": False})
            resp.raise_for_status()
        logger.info("[ai] Model '%s' pulled successfully", model)
    except httpx.HTTPError as exc:
        logger.warning("[ai] Failed to pull model '%s': %s", model, exc)
    except Exception:
        logger.exception("[ai] Unexpected error pulling model '%s'", model)


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

    logger.info("[startup] RESET_DB=%s, checking database state...", settings.RESET_DB)

    if settings.RESET_DB:
        # Full reset: drop everything and recreate
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        # Stamp in a separate connection so Alembic can manage its own
        # transaction (avoids SAVEPOINT deadlock through greenlet bridge).
        async with engine.connect() as conn:
            await conn.run_sync(lambda sc: _alembic_stamp_sync(sc, alembic_cfg))
        logger.info("[startup] RESET_DB complete")
    else:
        # Determine DB state before touching anything
        async with engine.connect() as conn:
            has_alembic = await conn.run_sync(
                lambda sync_conn: sa_inspect(sync_conn).has_table("alembic_version")
            )
            alembic_version = None
            if has_alembic:
                row = await conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))
                first = row.first()
                alembic_version = first[0] if first else None

        logger.info(
            "[startup] has_alembic=%s, alembic_version=%s",
            has_alembic,
            alembic_version,
        )

        if not has_alembic or alembic_version is None:
            # Fresh DB or pre-Alembic: create tables from models, then stamp
            logger.info("[startup] Fresh DB — running create_all + stamp...")
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            logger.info("[startup] create_all done, stamping head...")
            async with engine.connect() as conn:
                await conn.run_sync(lambda sc: _alembic_stamp_sync(sc, alembic_cfg))
            logger.info("[startup] Stamp complete")
        else:
            # Existing DB: run migrations, then create_all for new tables.
            # Use engine.connect() (not engine.begin()) so Alembic manages
            # its own transaction — avoids SAVEPOINT deadlock via greenlet.
            from alembic.script import ScriptDirectory

            head_rev = ScriptDirectory.from_config(alembic_cfg).get_current_head()
            if alembic_version == head_rev:
                logger.info(
                    "[startup] Already at head revision %s, skipping upgrade",
                    head_rev,
                )
            else:
                logger.info(
                    "[startup] Upgrading from %s to %s...",
                    alembic_version,
                    head_rev,
                )
                try:
                    async with engine.connect() as conn:
                        await conn.run_sync(lambda sc: _alembic_upgrade_sync(sc, alembic_cfg))
                except Exception:
                    logger.exception("Alembic migration failed")
                    raise
                logger.info("[startup] Alembic upgrade complete")
            logger.info("[startup] Running create_all for any new tables...")
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            logger.info("[startup] create_all complete")

    logger.info("[startup] Loading email settings...")
    # Load DB-persisted email settings into runtime config
    from sqlalchemy import select as _sel

    from app.database import async_session
    from app.models.app_settings import AppSettings

    async with async_session() as _db:
        _res = await _db.execute(_sel(AppSettings).where(AppSettings.id == "default"))
        _row = _res.scalar_one_or_none()
        if _row and _row.email_settings:
            from app.services.email_backends.runtime import apply_email_settings_to_runtime

            # Shared with PATCH /settings/email and the workspace importer, so
            # the method + OAuth/Graph fields survive a restart like smtp_*.
            apply_email_settings_to_runtime(_row.email_settings)
        # Seed the app title from the general_settings JSONB so email templates
        # and any other consumers can read it off the singleton without a DB query.
        if _row and _row.general_settings:
            _title = (_row.general_settings.get("app_title") or "").strip()
            if _title:
                settings.APP_TITLE = _title

    logger.info("[startup] Email settings loaded, seeding metamodel...")
    # Seed default metamodel
    from app.services.seed import seed_metamodel

    async with async_session() as db:
        await seed_metamodel(db)
    logger.info("[startup] Metamodel seed complete")

    # Optionally seed demo data (NexaTech Industries dataset)
    if settings.SEED_DEMO:
        from app.services.seed_demo import seed_demo_data

        async with async_session() as db:
            result = await seed_demo_data(db)
            if not result.get("skipped"):
                print(
                    f"[seed_demo] Seeded {result['cards']} cards, "
                    f"{result['relations']} relations, {result['tag_groups']} tag groups, "
                    f"{result['adrs']} ADRs, {result['soaws']} SoAWs"
                )
            else:
                print(f"[seed_demo] Skipped: {result.get('reason', 'unknown')}")

    # Ensure a demo admin user exists before BPM/PPM seed (needed for assessments/reports).
    if settings.SEED_DEMO or settings.SEED_BPM or settings.SEED_PPM:
        from app.core.security import hash_password
        from app.models.user import User

        async with async_session() as db:
            admin_exists = await db.execute(_sel(User.id).where(User.role == "admin").limit(1))
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
                print(
                    f"[seed_bpm] Seeded {result['cards']} processes, "
                    f"{result['relations']} relations, {result['diagrams']} diagrams, "
                    f"{result['elements']} elements, {result['assessments']} assessments"
                )
            else:
                print(f"[seed_bpm] Skipped: {result.get('reason', 'unknown')}")

    # Seed PPM demo data
    if settings.SEED_DEMO or settings.SEED_PPM:
        from sqlalchemy import select as _sel

        from app.models.app_settings import AppSettings
        from app.services.seed_demo_ppm import seed_ppm_demo_data

        async with async_session() as db:
            result = await seed_ppm_demo_data(db)
            if not result.get("skipped"):
                print(
                    f"[seed_ppm] Seeded {result['status_reports']} status reports, "
                    f"{result['wbs_items']} WBS items, {result['tasks']} tasks, "
                    f"{result['budget_lines']} budget lines, {result['cost_lines']} cost lines, "
                    f"{result['risks']} risks"
                )
                # Auto-enable the PPM module so the seeded data is reachable in the UI.
                row_result = await db.execute(_sel(AppSettings).where(AppSettings.id == "default"))
                row = row_result.scalar_one_or_none()
                if row is None:
                    row = AppSettings(id="default")
                    db.add(row)
                general = dict(row.general_settings or {})
                if not general.get("ppmEnabled"):
                    general["ppmEnabled"] = True
                    row.general_settings = general
                    await db.commit()
                    print("[seed_ppm] Enabled PPM module (ppmEnabled=true)")
            else:
                print(f"[seed_ppm] Skipped: {result.get('reason', 'unknown')}")

    # Seed extras demo data (comments, stakeholders, diagrams, etc.)
    if settings.SEED_DEMO:
        from app.services.seed_demo_extras import seed_extras_demo_data

        async with async_session() as db:
            result = await seed_extras_demo_data(db)
            if not result.get("skipped"):
                print(
                    f"[seed_extras] Seeded {result['comments']} comments, "
                    f"{result['stakeholders']} stakeholders, "
                    f"{result['events']} events, "
                    f"{result['diagrams']} diagrams, "
                    f"{result['saved_reports']} saved reports, "
                    f"{result['surveys']} surveys"
                )
            else:
                print(f"[seed_extras] Skipped: {result.get('reason', 'unknown')}")

    if settings.SEED_DEMO or settings.SEED_SECURITY:
        from app.services.seed_demo_security import seed_security_demo_data

        async with async_session() as db:
            result = await seed_security_demo_data(db)
            if not result.get("skipped"):
                print(
                    f"[seed_security] Seeded {result['compliance_findings']} compliance findings, "
                    f"{result['analysis_runs']} analysis runs"
                )
            else:
                print(f"[seed_security] Skipped: {result.get('reason', 'unknown')}")

    # ── Extension Store: mint/load the instance ID (licensing identity —
    # must exist before the registry evaluates license binding), then
    # reconcile statuses, load license/registry, run per-extension
    # migrations, fire on_startup hooks, spawn job loops.
    from app.services.extensions.instance_id import ensure_instance_id
    from app.services.extensions.startup import initialize_extensions

    async with async_session() as db:
        await ensure_instance_id(db)
    extension_job_tasks = await initialize_extensions(extension_load_report)

    # Auto-configure bundled Ollama AI when AI_AUTO_CONFIGURE=true
    ollama_task = None
    if settings.AI_AUTO_CONFIGURE:
        await _auto_configure_ai()
        ollama_task = asyncio.create_task(_ensure_ollama_model())

    # Start background task for auto-purging archived cards after 30 days
    purge_task = asyncio.create_task(_purge_archived_cards_loop())

    # Audit-log retention loop — deletes mutation_batches older than the
    # configured window (default 15 days). Same cadence as the archived-
    # card purge; events with batch_id pointing at the deleted rows just
    # have their batch_id NULLed (FK is ON DELETE SET NULL).
    batch_purge_task = asyncio.create_task(_purge_mutation_batches_loop())

    # Capture an initial KPI baseline (no-op if table already has rows) and
    # start the daily snapshot loop that powers dashboard trend indicators.
    await _ensure_initial_kpi_snapshot()
    kpi_task = asyncio.create_task(_kpi_snapshot_loop())

    # Start the daily mitigation-task promotion loop that lifts
    # scheduled cycles to open once their lead window opens.
    promote_task = asyncio.create_task(_promote_recurring_tasks_loop())

    # Daily extension-license auto-renewal from the store (no-op for
    # manually issued licenses and on air-gapped installs).
    license_refresh_task = asyncio.create_task(_license_refresh_loop())

    # One-shot canonical data-quality rescore (guarded by a settings marker;
    # a no-op on every boot after the first successful run).
    dq_rescore_task = asyncio.create_task(_one_shot_data_quality_rescore())

    # Hourly ops-access maintenance: expire rescue accounts + purge ops nonces.
    ops_access_task = asyncio.create_task(_ops_access_maintenance_loop())

    yield

    # Cancel background tasks on shutdown
    for ext_task in extension_job_tasks:
        ext_task.cancel()
    for ext_task in extension_job_tasks:
        try:
            await ext_task
        except asyncio.CancelledError:
            pass
    purge_task.cancel()
    try:
        await purge_task
    except asyncio.CancelledError:
        pass
    batch_purge_task.cancel()
    try:
        await batch_purge_task
    except asyncio.CancelledError:
        pass
    kpi_task.cancel()
    try:
        await kpi_task
    except asyncio.CancelledError:
        pass
    promote_task.cancel()
    try:
        await promote_task
    except asyncio.CancelledError:
        pass
    license_refresh_task.cancel()
    try:
        await license_refresh_task
    except asyncio.CancelledError:
        pass
    ops_access_task.cancel()
    try:
        await ops_access_task
    except asyncio.CancelledError:
        pass
    if not dq_rescore_task.done():
        dq_rescore_task.cancel()
        try:
            await dq_rescore_task
        except asyncio.CancelledError:
            pass
    if ollama_task and not ollama_task.done():
        ollama_task.cancel()
        try:
            await ollama_task
        except asyncio.CancelledError:
            pass


# ── H6: Conditionally disable OpenAPI docs in production ──
app = FastAPI(
    title=settings.PROJECT_NAME,
    version=APP_VERSION,
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
    allow_headers=["Authorization", "Content-Type", "X-Turbo-EA-Origin", "X-Turbo-EA-Batch"],
)


# ── Request origin tracking ──
# The MCP server sets `X-Turbo-EA-Origin: mcp` on every backend call so the
# audit trail can distinguish AI-agent-driven writes from web-UI writes.
# `event_bus.publish` reads this contextvar and stamps it into the event
# payload. Unknown / absent header => no tag (keeps existing UI events clean).
import uuid as _uuid_for_batch  # noqa: E402

from app.core.security import decode_access_token as _decode_token_for_impersonation  # noqa: E402
from app.services.event_bus import (  # noqa: E402
    request_batch_id as _request_batch_id,
)
from app.services.event_bus import (  # noqa: E402
    request_endpoint as _request_endpoint,
)
from app.services.event_bus import (  # noqa: E402
    request_impersonation as _request_impersonation,
)
from app.services.event_bus import (  # noqa: E402
    request_origin as _request_origin,
)

_ORIGIN_ALLOWED = {"mcp", "web", "api"}


async def capture_request_origin(request, call_next):
    """Middleware that mirrors the request's ``X-Turbo-EA-Origin`` header
    into a contextvar consumed by ``event_bus.publish``. Exported for
    re-use in the test app fixture so audit-tagging behaviour is covered
    end-to-end."""
    raw = request.headers.get("X-Turbo-EA-Origin", "").strip().lower()
    # Whitelist accepted values so a misbehaving caller can't smuggle
    # arbitrary strings into the audit log.
    origin: str | None = raw if raw in _ORIGIN_ALLOWED else None
    token = _request_origin.set(origin)

    # MCP write tools open a mutation batch and pass the id back on every
    # subsequent write via ``X-Turbo-EA-Batch``. Mirror it into the
    # event-bus contextvar so emitted events stamp the batch id. A bogus
    # / malformed UUID is silently dropped — we never want a header value
    # an attacker can forge to land on the audit log as a real batch.
    batch_raw = request.headers.get("X-Turbo-EA-Batch", "").strip()
    batch_id: _uuid_for_batch.UUID | None = None
    if batch_raw:
        try:
            batch_id = _uuid_for_batch.UUID(batch_raw)
        except ValueError:
            batch_id = None
    batch_token = _request_batch_id.set(batch_id)

    # Capture an endpoint label (e.g. "PATCH /api/v1/cards/<id>") so
    # auto-created mutation batches for non-MCP web/api writes land with
    # a meaningful Tool column in the audit log. The matched FastAPI
    # route isn't on ``request.scope`` yet at this point (routing runs
    # downstream of this middleware), so the raw URL path is the best
    # we can do — concrete UUIDs included.
    endpoint_token = _request_endpoint.set(f"{request.method} {request.url.path}")

    # Role-impersonation context: when an admin has activated a "View as
    # role" session, the JWT carries an ``impersonated_role`` claim. Decode
    # the token here (no DB round-trip — it's pure-Python) so that downstream
    # permission checks via PermissionService and audit stamping via
    # event_bus.publish both see the same impersonation state. JWT decode
    # failures (missing/expired/tampered) silently leave the contextvar
    # unset — request auth itself runs later in get_current_user and will
    # reject the request there.
    raw_auth = request.headers.get("Authorization", "")
    raw_token = (
        raw_auth[7:] if raw_auth.startswith("Bearer ") else request.cookies.get("access_token", "")
    )
    impersonation_pair: tuple[str, str] | None = None
    if raw_token:
        payload = _decode_token_for_impersonation(raw_token)
        if payload:
            impersonated_role = payload.get("impersonated_role")
            sub = payload.get("sub")
            if impersonated_role and sub:
                impersonation_pair = (str(sub), str(impersonated_role))
    impersonation_token = _request_impersonation.set(impersonation_pair)

    try:
        return await call_next(request)
    finally:
        _request_origin.reset(token)
        _request_batch_id.reset(batch_token)
        _request_endpoint.reset(endpoint_token)
        _request_impersonation.reset(impersonation_token)


app.middleware("http")(capture_request_origin)

# ── Extension Store: load vendor-signed extensions BEFORE mounting the API ──
# Routes are static once the app serves, so extension routers must be mounted
# here; activation (enabled + license entitlement) is enforced per-request by
# require_extension. Every installed bundle's signature is re-verified on each
# boot; a broken extension is quarantined and can never block core startup.
from app.services.extensions.loader import (  # noqa: E402
    load_extensions,
    merge_extension_permissions,
    mount_extension_routers,
)

extension_load_report = load_extensions()
mount_extension_routers(api_router, extension_load_report)
merge_extension_permissions(extension_load_report)

app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": APP_VERSION}
