"""The slowapi limiter, keyed per client.

Behind the bundled edge nginx every request's socket peer is nginx itself, so
keying on ``get_remote_address`` alone put every user into one shared bucket:
one client hammering ``/auth/login`` locked everyone else out of it. The key
therefore also carries ``client_ip`` — the same address the audit log records,
``X-Real-IP`` when ``TRUST_PROXY_HEADERS`` is on and the header parses.

The socket peer stays in the key. ``X-Real-IP`` is only as honest as whatever
set it: nginx overwrites it, but a caller that reaches the backend without
going through nginx writes it itself. Keyed on the forwarded address alone,
such a caller could rotate the header to mint a fresh bucket per attempt, or
name another client's address to exhaust that client's bucket. Keyed on
``peer|forwarded`` it can still split its own traffic, but only inside its own
peer's address space — it can never land in a bucket another peer is counted
in. When there is no forwarded address, or it equals the peer, the key is the
peer alone (``get_remote_address``, slowapi's default, which also covers a
peer that is not an IP at all).
"""

from __future__ import annotations

from typing import Any

from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.request_context import client_ip


def rate_limit_key(request: Any) -> str:
    """The bucket a request is counted in: its socket peer plus its client address."""
    peer = get_remote_address(request)
    forwarded = client_ip(request)
    if not forwarded or forwarded == peer:
        return peer
    return f"{peer}|{forwarded}"


limiter = Limiter(key_func=rate_limit_key)
