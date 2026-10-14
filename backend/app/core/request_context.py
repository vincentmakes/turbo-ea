"""Who is on the other end of the in-flight request: client address and agent.

The security audit log (``services/audit_log.py``) stamps every row with the
client's IP and user agent, and records are written from deep inside handlers
and helpers that never see the ``Request``. ``capture_request_origin`` in
``app.main`` therefore resolves both once per request and parks them on
``request_client``, beside the origin / batch / impersonation contextvars it
already maintains.

**Which address.** The backend sits behind the bundled edge nginx, so
``request.client.host`` is nginx's address, not the user's. nginx overwrites
``X-Real-IP`` with ``$remote_addr`` on every proxied location, so that header
is the one to read — never ``X-Forwarded-For``, which nginx *appends* to and a
client can therefore seed with any value it likes. Even ``X-Real-IP`` is only
trustworthy when nothing can reach the backend except through that nginx, so
it is read only when ``settings.TRUST_PROXY_HEADERS`` is on (the backend image
sets it; a bare development ``uvicorn`` does not). Every candidate is parsed
with ``ipaddress`` and dropped when it does not parse, so a forged header can
never put arbitrary text in the audit log.

This lives in ``core/`` rather than ``services/`` so the rate limiter
(``core/rate_limit.py``) can key on the same address without a
``core → services`` import.
"""

from __future__ import annotations

import ipaddress
from contextvars import ContextVar
from typing import Any

from app.config import settings

USER_AGENT_MAX_LENGTH = 255

# ``(ip, user_agent)`` of the in-flight request, either element ``None`` when
# unknown. ``None`` as a whole means "not inside a request" — a background job
# or a startup task.
request_client: ContextVar[tuple[str | None, str | None] | None] = ContextVar(
    "request_client", default=None
)


def _valid_ip(raw: str | None) -> str | None:
    """Return ``raw`` normalised as an IP address, or ``None`` if it is not one."""
    if not raw:
        return None
    try:
        return str(ipaddress.ip_address(raw.strip()))
    except ValueError:
        return None


def client_ip(request: Any) -> str | None:
    """The client address of ``request``.

    ``X-Real-IP`` when proxy headers are trusted and it parses; otherwise the
    socket peer. ``None`` when neither is a valid address.
    """
    if settings.TRUST_PROXY_HEADERS:
        forwarded = _valid_ip(request.headers.get("X-Real-IP"))
        if forwarded:
            return forwarded
    client = getattr(request, "client", None)
    return _valid_ip(getattr(client, "host", None))


def user_agent(request: Any) -> str | None:
    """The ``User-Agent`` header, truncated to fit the audit column."""
    raw = request.headers.get("User-Agent")
    if not raw:
        return None
    return raw[:USER_AGENT_MAX_LENGTH]
