"""The slowapi limiter, keyed per client.

Behind the bundled edge nginx every request's socket peer is nginx itself, so
keying on ``get_remote_address`` alone put every user into one shared bucket:
one client hammering ``/auth/login`` locked everyone else out of it. The key is
therefore ``client_ip`` — the same address the audit log records, ``X-Real-IP``
when ``TRUST_PROXY_HEADERS`` is on and the header parses, else the socket peer
— with ``get_remote_address`` as the fallback when neither is a valid address.
"""

from __future__ import annotations

from typing import Any

from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.request_context import client_ip


def rate_limit_key(request: Any) -> str:
    """The bucket a request is counted in: its client address."""
    return client_ip(request) or get_remote_address(request)


limiter = Limiter(key_func=rate_limit_key)
