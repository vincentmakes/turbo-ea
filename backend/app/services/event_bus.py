from __future__ import annotations

import asyncio
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event

# Set by `OriginMiddleware` in `app.main` from the `X-Turbo-EA-Origin`
# request header. ``publish()`` reads this and stamps the event payload so
# admins can filter MCP-driven writes out of the audit log separately from
# web-UI actions. Unset (None) means a request without the header — typical
# web-UI or system-initiated event — and we omit the key entirely so the
# audit log stays clean for pre-existing rows.
request_origin: ContextVar[str | None] = ContextVar("request_origin", default=None)

# Set by the mutation-batch service when an MCP tool wrapper opens a batch
# at the start of a request. ``publish()`` stamps the batch id onto every
# event emitted during the request so ``GET /mutation-batches/{id}/events``
# can return the whole batch's audit trail in a single query — that is the
# foundation S6 (change history) and S7 (rollback) ride on.
request_batch_id: ContextVar[uuid.UUID | None] = ContextVar("request_batch_id", default=None)

# Captured by the same middleware as ``request_origin``: the HTTP method +
# path of the in-flight request. Used to label auto-created batches when a
# web-UI or direct-API write publishes events without an MCP-style explicit
# batch — gives admins something more useful than "POST /api/v1/cards" in
# the audit log's Tool column.
request_endpoint: ContextVar[str | None] = ContextVar("request_endpoint", default=None)

# Set by ``capture_request_origin`` in ``app.main`` when the request's JWT
# carries an ``impersonated_role`` claim — i.e. an admin has activated a
# "View as role" session from the user menu. Tuple is
# (impersonator_user_id, impersonated_role_key). ``publish()`` stamps both
# onto every event's data payload so an auditor can later reconstruct
# "who, real-identity-wise, performed this action while pretending to be
# what role". Permission checks read this via
# ``PermissionService._effective_role(user)`` to evaluate the impersonated
# role instead of the user's real role.
request_impersonation: ContextVar[tuple[str, str] | None] = ContextVar(
    "request_impersonation", default=None
)

# Event types whose ``publish()`` calls should NOT lazy-create an
# auto-batch. Notifications fire once per recipient per relevant write —
# the underlying card / relation / ADR / risk write that triggered them is
# already captured by its own event under the same request, so the
# notification event alone would just create a noisy duplicate batch. The
# ``event.stream.`` / ``kpi.`` prefixes are reserved for any future
# per-user UI-state events (none today). MCP-driven publishes are
# unaffected — they always carry an explicit batch_id and short-circuit
# the lazy branch entirely.
_NO_AUTO_BATCH_PREFIXES: frozenset[str] = frozenset(
    {
        "notification.",
        "kpi.",
        "event.stream.",
    }
)


class EventBus:
    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue] = []

    async def publish(
        self,
        event_type: str,
        data: dict[str, Any],
        db: AsyncSession | None = None,
        card_id: uuid.UUID | None = None,
        user_id: uuid.UUID | None = None,
        batch_id: uuid.UUID | None = None,
    ) -> None:
        origin = request_origin.get()
        if origin and "origin" not in data:
            # Stamp into the JSONB payload so downstream queries (the
            # /events endpoint, the per-card history timeline, the SSE
            # stream) all see the origin without a schema change.
            data = {**data, "origin": origin}
        impersonation = request_impersonation.get()
        if impersonation and "impersonator_user_id" not in data:
            impersonator_id, impersonated_role = impersonation
            data = {
                **data,
                "impersonator_user_id": impersonator_id,
                "impersonated_role": impersonated_role,
            }
        effective_batch_id = batch_id if batch_id is not None else request_batch_id.get()

        # Lazy auto-batch creation: web-UI and direct-API writes do not
        # open a mutation batch the way MCP tools do, so without this
        # their events would land in the audit log with batch_id=NULL
        # and never surface on the Admin → Audit log page. Create one on
        # the first publish in the request and stash it on the
        # contextvar so any subsequent publish in the same request
        # shares it. MCP requests already set request_batch_id via the
        # X-Turbo-EA-Batch header, so they short-circuit this branch.
        if (
            effective_batch_id is None
            and db is not None
            and not any(event_type.startswith(p) for p in _NO_AUTO_BATCH_PREFIXES)
        ):
            from app.models.mutation_batch import MutationBatch

            endpoint = request_endpoint.get()
            # ``mutation_batches.tool_name`` is ``String(100)``. Real
            # routes with two embedded UUIDs (e.g. ``PATCH /api/v1/risks/
            # <uuid>/cards/<uuid>`` = 99 chars,
            # ``POST /api/v1/diagrams/<uuid>/cards/<uuid>`` = 101 chars,
            # ``POST /api/v1/mitigation-tasks/<uuid>/occurrences/<uuid>/
            # complete`` = 124 chars) blow that cap and PG raises
            # ``22001 value too long``. Truncate so any sufficiently
            # long path still fits — losing the tail of one UUID is an
            # acceptable trade-off for the audit-log Tool column.
            tool_label = (endpoint or f"event:{event_type}")[:100]
            auto = MutationBatch(
                tool_name=tool_label,
                actor_user_id=user_id,
                origin=origin or "api",
                dry_run=False,
                # Auto-batches don't follow the open → write → commit
                # dance; they're closed the moment they're opened
                # because they represent a single in-flight request.
                committed_at=datetime.now(timezone.utc),
            )
            db.add(auto)
            await db.flush()
            effective_batch_id = auto.id
            request_batch_id.set(effective_batch_id)

        if db:
            event = Event(
                card_id=card_id,
                user_id=user_id,
                event_type=event_type,
                data=data,
                batch_id=effective_batch_id,
            )
            db.add(event)
            await db.flush()

        message = {
            "event": event_type,
            "data": data,
            "card_id": str(card_id) if card_id else None,
            "batch_id": str(effective_batch_id) if effective_batch_id else None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        dead: list[asyncio.Queue] = []
        for q in self._subscribers:
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self._subscribers.remove(q)

    async def subscribe(self) -> AsyncGenerator[dict[str, Any], None]:
        """Yield each published event as a raw dict.

        The SSE endpoint (`events.py`) is responsible for filtering events per
        subscriber (so non-admins don't receive audit / ops-sensitive events)
        and for SSE serialization. Keeping this generic — yielding the raw
        message rather than a pre-formatted ``data: …`` string — is what lets
        the route apply per-user authorization before anything is sent.
        """
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._subscribers.append(q)
        try:
            while True:
                msg = await q.get()
                yield msg
        finally:
            if q in self._subscribers:
                self._subscribers.remove(q)


event_bus = EventBus()
