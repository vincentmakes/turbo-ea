"""Record provenance: which channel created and last changed a row.

``created_by`` / ``updated_by`` name the *person* behind a write. Every MCP
write forwards the user's own token, so the person alone cannot tell a record
an AI agent wrote from one typed in the web UI. ``created_via`` /
``updated_via`` carry the *channel* beside it: ``web``, ``mcp``, ``api``,
``ext`` (an extension bridge) or ``system`` (work outside any request — a
background job, the seeders, a startup task).

The value comes from the same request contextvars the audit log stamps
(``request_origin`` from ``X-Turbo-EA-Origin``, ``request_endpoint`` set by the
middleware on every request), resolved by ``audit_log.resolve_origin``. Both
columns are Python-side ``default`` / ``onupdate`` callables, so every write
path — routes, bulk endpoints, importers, extension bridges, background jobs —
stamps them without per-route code. ``derived_writes.pin_updated_at`` pins
``updated_via`` alongside ``updated_at`` so derived-value maintenance does not
re-stamp the channel.

A NULL value means the row predates migration 157; it renders as nothing.
"""

from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

ORIGIN_VALUES = ("web", "mcp", "api", "ext", "system")


def current_origin() -> str:
    """The channel the current write comes from.

    The imports are local on purpose: ``audit_log`` and ``event_bus`` import
    ``app.models``, which imports this module — a module-level import would be
    a cycle. ``request_endpoint`` is set unconditionally by the request
    middleware, so it is the in-request detector: a request with no
    ``X-Turbo-EA-Origin`` header is ``api``, work outside any request is
    ``system``.
    """
    from app.services.audit_log import resolve_origin
    from app.services.event_bus import request_endpoint, request_origin

    return resolve_origin(request_origin.get(), request_endpoint.get() is not None)


class ProvenanceMixin:
    created_via: Mapped[str | None] = mapped_column(String(20), default=current_origin)
    updated_via: Mapped[str | None] = mapped_column(
        String(20), default=current_origin, onupdate=current_origin
    )
