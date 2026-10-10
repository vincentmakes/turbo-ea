"""Background-job supervisor for extensions.

One asyncio task per declared :class:`ExtensionJob`, following the same
try/except-CancelledError loop pattern as core background tasks. Every
tick re-checks the in-memory registry, so disabling an extension or
letting its license lapse pauses its jobs immediately — no restart.
A crashing job tick is logged and retried next interval; it can never
take the process down.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import cast, func, literal, select, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.encryption import decrypt_value, encrypt_value
from app.database import async_session
from app.services.extensions.adr_bridge import ExtensionDecisions
from app.services.extensions.cron import CronError, next_fire
from app.services.extensions.data_service import ExtensionData, open_context_batch
from app.services.extensions.loader import LoadReport
from app.services.extensions.notify_bridge import ExtensionNotify
from app.services.extensions.registry import extension_registry
from app.services.extensions.risks_bridge import ExtensionRisks
from app.services.extensions.sdk import ExtensionContext, ExtensionJob
from app.services.extensions.surveys_bridge import ExtensionSurveys
from app.services.extensions.todos_bridge import ExtensionTodos
from app.services.extensions.users_bridge import ExtensionUsers

logger = logging.getLogger(__name__)

# One context per extension per process. startup's on_startup hook and the
# job loops (and the event dispatcher) must all see the SAME instance —
# anything an extension stashes on the context at startup has to be visible
# from its jobs and handlers.
_contexts: dict[str, ExtensionContext] = {}


def reset_contexts() -> None:
    """Test helper — drop memoized contexts so fixtures start clean."""
    _contexts.clear()


def build_context(key: str) -> ExtensionContext:
    """Runtime services for one extension: sessions, logging, namespaced
    settings persisted under ``app_settings.general_settings["ext.{key}.*"]``,
    encrypted secrets under ``ext.{key}.secret.*``, and the core-data
    bridges (todos, users, data, decisions, risks, notify, surveys). Memoized per
    key (see ``_contexts``)."""

    cached = _contexts.get(key)
    if cached is not None:
        return cached

    namespace = f"ext.{key}."

    # 2.133.1: key-scoped in SQL, both ways. Until then every call SELECTed the
    # whole ``general_settings`` blob and every write rewrote it from Python —
    # every setting in the product shares that one row, so a large value
    # stored under any key (a cached catalogue, once) made every extension
    # save round-trip megabytes it never looked at. A read now selects only
    # its keys (``general_settings -> 'ext.<key>.<name>'``); a write is one
    # server-side ``||``, which also makes concurrent writers of different
    # keys stop clobbering each other's read-modify-write.
    def _ensure_row_stmt():
        from app.models.app_settings import AppSettings

        return (
            pg_insert(AppSettings)
            .values(id="default", general_settings={}, email_settings={})
            .on_conflict_do_nothing(index_elements=["id"])
        )

    async def get_settings(names: Sequence[str]) -> dict[str, Any]:
        from app.models.app_settings import AppSettings

        names = list(names)
        if not names:
            return {}
        async with async_session() as db:
            row = (
                await db.execute(
                    select(*[AppSettings.general_settings[namespace + n] for n in names]).where(
                        AppSettings.id == "default"
                    )
                )
            ).first()
        if row is None:
            return {name: None for name in names}
        return {name: row[i] for i, name in enumerate(names)}

    async def _write(values: dict[str, Any]) -> None:
        from app.models.app_settings import AppSettings

        if not values:
            return
        patch = {namespace + name: value for name, value in values.items()}
        async with async_session() as db:
            await db.execute(_ensure_row_stmt())
            await db.execute(
                update(AppSettings)
                .where(AppSettings.id == "default")
                .values(
                    general_settings=func.coalesce(
                        AppSettings.general_settings, cast(literal({}, JSONB), JSONB)
                    ).op("||")(literal(patch, JSONB))
                )
            )
            await db.commit()

    async def set_settings(values: dict[str, Any]) -> None:
        for name in values:
            if name.startswith("secret."):
                # Secrets must go through set_secret (Fernet encryption +
                # workspace-transfer scrub) — never a plaintext batch write.
                raise ValueError("set_settings cannot write secret.* names; use set_secret")
        await _write(values)

    async def get_setting(name: str) -> Any:
        return (await get_settings([name]))[name]

    async def set_setting(name: str, value: Any) -> None:
        await set_settings({name: value})

    # Secrets ride the same settings row under a ``secret.`` sub-namespace,
    # but Fernet-encrypted (``enc:``-prefixed). The prefix is what makes them
    # export-safe: workspace transfer's defensive scrub strips every ``enc:``
    # value, so an extension credential can never leave the instance in a
    # bundle. str-only by design (mirrors core's SMTP/SSO secret handling).
    async def get_secret(name: str) -> str | None:
        raw = await get_setting(f"secret.{name}")
        if raw is None:
            return None
        # decrypt_value returns "" when SECRET_KEY rotated — surfaced as-is
        # so the extension treats it as "missing, re-prompt the operator".
        return decrypt_value(raw)

    async def set_secret(name: str, value: str) -> None:
        if not isinstance(value, str):
            raise TypeError("extension secrets must be str")
        # Straight to the write: the encrypted value is the one thing the
        # ``secret.`` refusal on set_settings exists to let through.
        await _write({f"secret.{name}": encrypt_value(value)})

    def batch(label: str):
        # SDK 1.13 — gated per call inside, like every bridge.
        return open_context_batch(key, label)

    ctx = ExtensionContext(
        key=key,
        session_factory=async_session,
        logger=logging.getLogger(f"ext.{key}"),
        get_setting=get_setting,
        set_setting=set_setting,
        todos=ExtensionTodos(key),
        get_secret=get_secret,
        set_secret=set_secret,
        users=ExtensionUsers(key),
        get_settings=get_settings,
        set_settings=set_settings,
        data=ExtensionData(key),
        decisions=ExtensionDecisions(key),
        risks=ExtensionRisks(key),
        notify=ExtensionNotify(key),
        batch=batch,
        surveys=ExtensionSurveys(key),
    )
    _contexts[key] = ctx
    return ctx


def extension_may_run(key: str) -> bool:
    """Whether an extension is enabled, healthy and licensed right now.

    The one predicate startup gates migrations, ``on_startup`` and job
    scheduling on, and every job tick re-checks, so disabling an extension
    or letting its license lapse pauses its jobs with no restart.
    """
    info = extension_registry.get(key)
    if info is None or not info.enabled or info.status in ("removed", "disabled", "failed"):
        return False
    return extension_registry.entitlement(key).usable


def validate_job_schedule(job: ExtensionJob, now: datetime | None = None) -> str | None:
    """Return a problem string when the job's schedule is invalid, else None.

    Exactly one of ``interval_seconds`` / ``cron`` must be set; an interval
    must be positive, and a cron expression must parse AND fire at least once
    in the next search window (``"0 0 31 2 *"``, February 31st, parses but
    never fires). A schedule that cannot fire used to reach the job loop,
    where ``next_fire`` raised before the loop's sleep, so the loop logged
    and retried with no pause at all, forever. Kept pure so startup can skip
    (never crash on) a misdeclared job and tests can pin the rule.
    """
    if (job.interval_seconds is None) == (job.cron is None):
        return "exactly one of interval_seconds / cron must be set"
    if job.interval_seconds is not None:
        if job.interval_seconds <= 0:
            return f"interval_seconds must be positive, got {job.interval_seconds}"
        return None
    try:
        next_fire(job.cron or "", now or datetime.now(UTC))
    except CronError as e:
        return str(e)
    return None


def next_sleep_seconds(job: ExtensionJob, now: datetime) -> float:
    """How long a job's loop sleeps before its next run: never under a second."""
    if job.cron is not None:
        return max(1.0, (next_fire(job.cron, now) - now).total_seconds())
    return float(max(1, int(job.interval_seconds or 1)))


async def _job_loop(key: str, job: ExtensionJob, ctx: ExtensionContext) -> None:
    while True:
        try:
            await asyncio.sleep(next_sleep_seconds(job, datetime.now(UTC)))
            if not extension_may_run(key):
                continue
            await job.run(ctx)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Extension %s job %s failed — retrying next tick", key, job.name)


def plan_jobs(report: LoadReport) -> list[tuple[str, ExtensionJob]]:
    """``(extension key, job)`` for every job a loaded extension may schedule.

    Skips an extension with no instance or whose ``get_jobs()`` raises, and a
    job whose schedule ``validate_job_schedule`` refuses, logging each.
    """
    planned: list[tuple[str, ExtensionJob]] = []
    for ext in report.loaded:
        if ext.instance is None:
            continue
        try:
            jobs = ext.instance.get_jobs() or []
        except Exception:  # noqa: BLE001
            logger.exception("Extension %s get_jobs() failed", ext.key)
            continue
        for job in jobs:
            problem = validate_job_schedule(job)
            if problem:
                logger.error(
                    "Extension %s job %s has an invalid schedule (%s) — job skipped",
                    ext.key,
                    job.name,
                    problem,
                )
                continue
            planned.append((ext.key, job))
    return planned


def start_extension_jobs(report: LoadReport) -> list[asyncio.Task]:
    """Spawn a loop task per declared job. Caller cancels them on shutdown."""
    tasks: list[asyncio.Task] = []
    for key, job in plan_jobs(report):
        ctx = build_context(key)
        tasks.append(asyncio.create_task(_job_loop(key, job, ctx), name=f"ext:{key}:{job.name}"))
        logger.info(
            "Started extension job %s/%s (%s)",
            key,
            job.name,
            f"cron {job.cron}" if job.cron else f"every {job.interval_seconds}s",
        )
    return tasks
