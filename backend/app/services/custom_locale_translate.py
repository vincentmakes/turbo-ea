"""The AI translation job of a custom language.

One in-process ``asyncio`` task per locale, started by
``POST /custom-locales/{code}/translate``. The job never holds a database
session across an LLM call: the route reads what to translate and commits,
then each chunk is ``LLM call → a fresh short session that merges the chunk
and updates the progress``.

Chunks carry numeric ids, never keys, and every value the model returns goes
through ``language_pack.validate_value`` like any other untrusted value; a
rejected or missing id counts as ``failed`` and stays untranslated (the next
"missing" run retries it). A chunk whose call raises is retried once; three
failed chunks in a row end the job ``failed``. A cancelled job ends
``cancelled``; a job still ``running`` at startup is marked ``interrupted``
(``custom_locale_store.mark_interrupted_jobs``).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from app.models.custom_locale import CustomLocale
from app.services import custom_locale_store as store
from app.services import language_pack as lp
from app.services import metamodel_strings as mm
from app.services.ai_service import call_llm

logger = logging.getLogger("turboea.custom_locales")

MODES = ("missing", "all")
MAX_CONSECUTIVE_FAILURES = 3
ATTEMPTS_PER_CHUNK = 2

#: Running job tasks by locale code, and the codes whose cancel was asked for.
_TASKS: dict[str, asyncio.Task] = {}
_CANCELLED: set[str] = set()


@dataclass(frozen=True)
class WorkItem:
    namespace: str
    key: str
    english: str
    current: str | None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_job(mode: str, total: int) -> dict[str, Any]:
    return {
        "status": "running",
        "mode": mode,
        "total": total,
        "done": 0,
        "failed": 0,
        "started_at": _now(),
        "finished_at": None,
        "error": None,
    }


def is_running(code: str) -> bool:
    task = _TASKS.get(code)
    return task is not None and not task.done()


def select_work(
    views: Mapping[str, store.View],
    *,
    mode: str,
    include_manual: bool,
) -> list[WorkItem]:
    """What a job translates, in view order (``metamodel`` first, so the UI
    strings can be translated with the names it settles on).

    ``missing``: every missing or stale key (an extra plural key that went
    stale included). ``all``: every English key and every stored extra plural
    key, except a string an admin wrote by hand (origin ``manual``) unless
    ``include_manual``."""
    items: list[WorkItem] = []
    for name, view in views.items():
        ns, strings, meta = view.ns, view.strings, view.meta
        for key in [*ns.strings, *lp.extra_keys(ns, strings)]:
            status = lp.key_status(ns, key, strings, meta)
            if mode == "missing":
                if status not in (lp.STATUS_MISSING, lp.STATUS_STALE):
                    continue
            else:
                entry = meta.get(key)
                origin = entry.get("o") if isinstance(entry, Mapping) else None
                if origin == "manual" and not include_manual:
                    continue
            value = strings.get(key)
            items.append(
                WorkItem(
                    namespace=name,
                    key=key,
                    english=ns.source_text(key) or "",
                    current=value if isinstance(value, str) else None,
                )
            )
    return items


def chunks_of(items: list[WorkItem]) -> list[list[WorkItem]]:
    """Chunks of one namespace each, at most 40 strings / ~6000 characters."""
    by_ns: dict[str, list[WorkItem]] = {}
    for item in items:
        by_ns.setdefault(item.namespace, []).append(item)
    out: list[list[WorkItem]] = []
    for group in by_ns.values():
        out.extend(lp.chunk(group, lambda item: len(item.english)))
    return out


def accept_answer(
    chunk: list[WorkItem], answer: Any
) -> tuple[dict[str, str], dict[str, str | None], int]:
    """``(translations, expected, failed)`` for one chunk's LLM answer.

    Ids are the 1-based positions in the chunk. ``translations`` maps a key to
    a validated translation, ``expected`` maps the same keys to the value they
    held when the job read them (the merge only writes a key nobody changed
    since); everything missing or refused counts as failed."""
    ids = [str(i) for i in range(1, len(chunk) + 1)]
    answers = lp.answer_map(answer, ids)
    translations: dict[str, str] = {}
    expected: dict[str, str | None] = {}
    failed = 0
    for ident, item in zip(ids, chunk, strict=True):
        value = answers.get(ident)
        if isinstance(value, str):
            value = value.strip()
        if lp.validate_value(item.english, value) is not None:
            failed += 1
            continue
        translations[item.key] = value  # type: ignore[assignment]
        expected[item.key] = item.current
    return translations, expected, failed


def _session():
    # Looked up on each call so tests can hand the job their own session.
    from app.database import async_session

    return async_session()


async def _update_job(code: str, **changes: Any) -> bool:
    """Write ``changes`` into the locale's job while it is still running;
    ``False`` when it is not (cancelled meanwhile, locale deleted)."""
    async with _session() as db:
        locale = (
            await db.execute(
                select(CustomLocale).where(CustomLocale.code == code).with_for_update()
            )
        ).scalar_one_or_none()
        job = locale.translate_job if locale is not None else None
        if not isinstance(job, dict) or job.get("status") != "running":
            return False
        locale.translate_job = {**job, **changes}
        await db.commit()
        return True


def type_name_pairs(view: store.View, limit: int = lp.MAX_REFERENCE_PAIRS) -> list[tuple[str, str]]:
    """``(English, translation)`` of the translated card-type names — the
    terminology every UI string about a card type should reuse."""
    pairs = []
    for key, english in view.ns.strings.items():
        if len(pairs) >= limit:
            break
        parts = mm.split_key(key)
        if len(parts) == 3 and parts[0] == "type" and parts[2] == "label":
            value = view.strings.get(key)
            if isinstance(value, str) and value:
                pairs.append((english, value))
    return pairs


async def _references(code: str, namespace: str, exclude: list[str]) -> list[tuple[str, str]]:
    """The terminology reference for one chunk: up-to-date translations of the
    same namespace, and for a UI chunk the translated card-type names."""
    cat = store.catalog()
    async with _session() as db:
        locale = await store.get_locale(db, code)
        if locale is None:
            return []
        views = await store.load_views(db, locale, cat, [namespace, store.METAMODEL])
    view = views.get(namespace)
    if view is None:
        return []
    pairs = lp.reference_pairs(view.ns, view.strings, view.meta, exclude=exclude)
    if namespace != store.METAMODEL and store.METAMODEL in views:
        pairs = type_name_pairs(views[store.METAMODEL]) + pairs
    return pairs


async def _merge(code: str, chunk: list[WorkItem], translations, expected) -> bool:
    """Merge one chunk's translations (origin ``ai``) in a short session."""
    cat = store.catalog()
    if cat is None or not translations:
        return True
    namespace = chunk[0].namespace
    async with _session() as db:
        locale = await store.get_locale(db, code)
        if locale is None:
            return False
        await store.apply_strings(
            db,
            locale,
            cat,
            {namespace: translations},
            origin="ai",
            expected={namespace: expected},
        )
        await db.commit()
    return True


async def _call(ai_cfg: Mapping[str, Any], messages: list[dict[str, str]]) -> Any:
    return await call_llm(
        ai_cfg["provider_url"],
        ai_cfg["model"],
        messages,
        provider_type=ai_cfg["provider_type"],
        api_key=ai_cfg["api_key"],
        api_version=ai_cfg["api_version"],
    )


async def run_job(
    code: str, language: str, items: list[WorkItem], ai_cfg: Mapping[str, Any]
) -> None:
    """Translate ``items`` into ``language`` chunk by chunk, keeping the
    locale's ``translate_job`` up to date. Holds no session across a call."""
    done = 0
    failed = 0
    consecutive = 0
    try:
        for chunk in chunks_of(items):
            references = await _references(code, chunk[0].namespace, [i.key for i in chunk])
            sources = {str(i): item.english for i, item in enumerate(chunk, start=1)}
            messages = lp.translation_messages(language, sources, references)
            answer: Any = None
            error: Exception | None = None
            for _attempt in range(ATTEMPTS_PER_CHUNK):
                try:
                    answer = await _call(ai_cfg, messages)
                    error = None
                    break
                except Exception as exc:  # a provider error of any kind
                    error = exc
                    logger.warning("Translation chunk for %s failed: %s", code, exc)
            done += len(chunk)
            if error is not None:
                consecutive += 1
                failed += len(chunk)
                if consecutive >= MAX_CONSECUTIVE_FAILURES:
                    await _update_job(
                        code,
                        done=done,
                        failed=failed,
                        status="failed",
                        finished_at=_now(),
                        error=(
                            f"The AI provider failed {MAX_CONSECUTIVE_FAILURES} times in a "
                            f"row; the last error was: {type(error).__name__}"
                        ),
                    )
                    return
                if not await _update_job(code, done=done, failed=failed):
                    return
                continue
            consecutive = 0
            translations, expected, chunk_failed = accept_answer(chunk, answer)
            failed += chunk_failed
            if not await _merge(code, chunk, translations, expected):
                return
            if not await _update_job(code, done=done, failed=failed):
                return
        await _update_job(code, status="completed", finished_at=_now())
    except asyncio.CancelledError:
        status = "cancelled" if code in _CANCELLED else "interrupted"
        try:
            await asyncio.shield(_update_job(code, status=status, finished_at=_now()))
        except Exception:  # best effort: the loop may be shutting down
            logger.exception("Could not record the end of the translation job for %s", code)
        raise
    except Exception as exc:
        logger.exception("Translation job for %s failed", code)
        await _update_job(
            code,
            status="failed",
            finished_at=_now(),
            error=f"Unexpected error: {type(exc).__name__}",
        )
    finally:
        _CANCELLED.discard(code)
        if _TASKS.get(code) is asyncio.current_task():
            _TASKS.pop(code, None)


def launch(code: str, language: str, items: list[WorkItem], ai_cfg: Mapping[str, Any]):
    """Start the job task for ``code`` (the caller has committed the
    ``running`` job state first)."""
    task = asyncio.create_task(run_job(code, language, items, dict(ai_cfg)))
    _TASKS[code] = task
    return task


def cancel(code: str) -> bool:
    """Cancel the running task of ``code``; ``False`` when there is none."""
    task = _TASKS.get(code)
    if task is None or task.done():
        return False
    _CANCELLED.add(code)
    task.cancel()
    return True


def cancelled_job(job: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """The job state a cancel writes: ``cancelled`` when it was running,
    otherwise unchanged."""
    if not isinstance(job, Mapping) or job.get("status") != "running":
        return dict(job) if isinstance(job, Mapping) else None
    return {**job, "status": "cancelled", "finished_at": _now()}
