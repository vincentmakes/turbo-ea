"""Shared seams for tests that reach code which talks to the outside world.

Everything here is importable without a database — the unit job runs
``tests/core`` and ``tests/services`` with no PostgreSQL, so this module
never imports ``app.database`` at import time.

- :func:`session_factory_for` — hands the test's savepoint session to
  code that opens its own ``async_session()`` (background jobs, loops).
- :class:`FakeCallAi` — a scripted stand-in for ``turbolens_ai.call_ai``,
  installed on the *consuming* modules (they import it by name).
- :func:`ai_settings` — upserts the singleton ``app_settings`` row with
  an AI configuration, the way Admin → Settings → AI stores it.
- :func:`patch_httpx_client` / :func:`snow_table_handler` — route a
  module's outbound ``httpx.AsyncClient`` through a ``MockTransport``.
- :func:`one_shot_asyncio` — lets a ``while True`` loop run one iteration.
"""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any, Callable
from urllib.parse import parse_qs

import httpx

# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


def session_factory_for(db):
    """A stand-in for ``app.database.async_session`` that yields the test's
    savepoint session instead of a fresh connection — a real one could not
    see the test's uncommitted rows, and must not be closed by the code
    under test."""

    @asynccontextmanager
    async def factory():
        yield db

    return factory


# ---------------------------------------------------------------------------
# AI
# ---------------------------------------------------------------------------

CALL_AI_CONSUMERS = (
    "turbolens_vendors",
    "turbolens_duplicates",
    "turbolens_architect",
    "compliance_scanner",
)


@dataclass
class _Route:
    contains: str | None
    max_tokens: int | None
    text: str
    truncated: bool
    raises: BaseException | None


@dataclass
class FakeCallAi:
    """Scripted ``call_ai(prompt, max_tokens, system_prompt)``.

    Responses are served from the FIFO ``queue`` first, then from the first
    ``route`` whose ``contains`` / ``max_tokens`` match, then from
    ``default``. An unscripted call fails the test rather than returning
    something plausible. Every call is recorded in ``calls``.
    """

    default: str | None = None
    calls: list[tuple[str, int, str]] = field(default_factory=list)
    _queue: list[tuple[str, bool]] = field(default_factory=list)
    _routes: list[_Route] = field(default_factory=list)

    def queue(self, text: Any, *, truncated: bool = False) -> FakeCallAi:
        """Append a response; a non-string is JSON-encoded."""
        self._queue.append((_as_text(text), truncated))
        return self

    def route(
        self,
        *,
        contains: str | None = None,
        max_tokens: int | None = None,
        text: Any = "",
        truncated: bool = False,
        raises: BaseException | None = None,
    ) -> FakeCallAi:
        """Answer every call whose prompt contains ``contains`` and/or whose
        ``max_tokens`` equals ``max_tokens``; ``raises`` raises instead."""
        self._routes.append(_Route(contains, max_tokens, _as_text(text), truncated, raises))
        return self

    async def __call__(self, prompt: str, max_tokens: int = 2048, system_prompt: str = "") -> dict:
        self.calls.append((prompt, max_tokens, system_prompt))
        if self._queue:
            text, truncated = self._queue.pop(0)
            return {"text": text, "truncated": truncated}
        for r in self._routes:
            if r.contains is not None and r.contains not in prompt:
                continue
            if r.max_tokens is not None and r.max_tokens != max_tokens:
                continue
            if r.raises is not None:
                raise r.raises
            return {"text": r.text, "truncated": r.truncated}
        if self.default is not None:
            return {"text": self.default, "truncated": False}
        raise AssertionError(f"unscripted call_ai(max_tokens={max_tokens}): {prompt[:120]!r}")

    def install(self, monkeypatch, modules: tuple[str, ...] = CALL_AI_CONSUMERS) -> FakeCallAi:
        """Patch ``call_ai`` on each consuming module. They bind the name at
        import (``from app.services.turbolens_ai import call_ai``), so
        patching ``app.services.turbolens_ai.call_ai`` would change nothing."""
        for m in modules:
            monkeypatch.setattr(f"app.services.{m}.call_ai", self)
        return self


def _as_text(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value)


async def ai_settings(
    db,
    *,
    enabled: bool = True,
    provider_type: str = "openai",
    provider_url: str = "https://llm.test",
    model: str = "test-model",
    api_key: str | None = "sk-test",
    general: dict | None = None,
    **ai: Any,
):
    """Upsert the singleton ``app_settings`` row with an AI configuration.

    Keys are the camelCase ones ``PATCH /settings/ai`` writes; the key is
    stored through ``encrypt_value`` so the real decrypt path runs.
    ``general`` merges further ``general_settings`` keys (``turboLensEnabled``,
    ``archiveRetentionDays``, ``sso`` …); ``**ai`` adds to the ``ai`` block
    (``enabledTypes``, ``portfolioInsightsEnabled``, ``apiVersion`` …).
    """
    from sqlalchemy import select

    from app.core.encryption import encrypt_value
    from app.models.app_settings import AppSettings

    block: dict[str, Any] = {
        "enabled": enabled,
        "providerType": provider_type,
        "providerUrl": provider_url,
        "model": model,
        "apiKey": encrypt_value(api_key) if api_key else "",
    }
    block.update(ai)

    row = (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one_or_none()
    if row is None:
        row = AppSettings(id="default", general_settings={})
        db.add(row)
    merged = dict(row.general_settings or {})
    merged.update(general or {})
    merged["ai"] = block
    row.general_settings = merged  # reassign: plain JSONB, no mutation tracking
    await db.flush()
    return row


# ---------------------------------------------------------------------------
# Outbound HTTP
# ---------------------------------------------------------------------------


def patch_httpx_client(monkeypatch, module, handler: Callable[[httpx.Request], httpx.Response]):
    """Route every ``httpx.AsyncClient`` the module constructs through a
    ``MockTransport`` running ``handler``. Returns the list of requests seen.

    The module must do ``import httpx`` (both ``sso_service`` and
    ``servicenow_service`` do); the patch is scoped to that module's
    ``httpx`` reference so the test client is untouched.
    """
    seen: list[httpx.Request] = []

    def recording(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    transport = httpx.MockTransport(recording)
    real_client = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs.pop("transport", None)
        return real_client(*args, transport=transport, **kwargs)

    target = getattr(module, "httpx", httpx)
    monkeypatch.setattr(target, "AsyncClient", factory)
    return seen


def snow_table_handler(
    *,
    records: tuple[dict, ...] | list[dict] = (),
    total: int | None = None,
    created_sys_id: str = "a" * 32,
    fail_status: int | None = None,
    tables: tuple[dict, ...] | list[dict] = (),
    dictionary: tuple[dict, ...] | list[dict] = (),
) -> Callable[[httpx.Request], httpx.Response]:
    """A fake ServiceNow Table API.

    ``GET /api/now/table/sys_db_object`` → ``tables``; ``…/sys_dictionary`` →
    ``dictionary``; ``GET …/{table}`` pages ``records`` by
    ``sysparm_offset`` / ``sysparm_limit`` and sets ``X-Total-Count`` to
    ``total`` (default ``len(records)``); ``POST …/{table}`` answers with
    ``created_sys_id``; ``PATCH …/{table}/{sys_id}`` echoes the body.
    ``fail_status`` makes every call answer with that status.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        if fail_status is not None:
            return httpx.Response(fail_status, json={"error": {"message": "failed"}})
        path = request.url.path
        if not path.startswith("/api/now/table/"):
            return httpx.Response(404, json={"error": {"message": "not found"}})
        rest = path[len("/api/now/table/") :].strip("/")
        parts = rest.split("/")
        table = parts[0]
        if request.method == "GET":
            if table == "sys_db_object":
                return httpx.Response(200, json={"result": list(tables)})
            if table == "sys_dictionary":
                return httpx.Response(200, json={"result": list(dictionary)})
            qs = parse_qs(request.url.query.decode())
            offset = int(qs.get("sysparm_offset", ["0"])[0])
            limit = int(qs.get("sysparm_limit", ["500"])[0])
            page = list(records)[offset : offset + limit]
            count = total if total is not None else len(records)
            return httpx.Response(200, json={"result": page}, headers={"X-Total-Count": str(count)})
        if request.method == "POST":
            body = json.loads(request.content or b"{}")
            return httpx.Response(201, json={"result": {"sys_id": created_sys_id, **body}})
        if request.method == "PATCH":
            body = json.loads(request.content or b"{}")
            sys_id = parts[1] if len(parts) > 1 else ""
            return httpx.Response(200, json={"result": {"sys_id": sys_id, **body}})
        return httpx.Response(405)

    return handler


# ---------------------------------------------------------------------------
# Background loops
# ---------------------------------------------------------------------------


def one_shot_asyncio() -> SimpleNamespace:
    """A stand-in for the ``asyncio`` module a ``while True`` loop reads.

    The first ``sleep`` returns at once and the second raises
    ``CancelledError``, so the loop body runs exactly once and the loop
    exits the way the lifespan cancels it. Every requested delay is
    recorded in ``sleeps``.
    """
    ns = SimpleNamespace(
        CancelledError=asyncio.CancelledError,
        create_task=asyncio.create_task,
        sleeps=[],
    )

    async def sleep(delay):
        ns.sleeps.append(delay)
        if len(ns.sleeps) > 1:
            raise asyncio.CancelledError
        return None

    ns.sleep = sleep
    return ns
