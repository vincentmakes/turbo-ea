"""Refresh tokens signed the way the backend signs them (#1449).

The MCP server checks a refresh token's signature before it relays it
(``oauth._refresh_token_signed``), so a test that relays one needs a real one.
``tests/conftest.py`` sets ``oauth._refresh_token_key`` to ``KEY`` for every
test; ``signed_refresh`` mints with it, as the backend's ``mint_refresh_token``
(app/services/mcp_session_service.py) does with its own.
"""

from __future__ import annotations

import base64
import hashlib
import hmac

from turbo_ea_mcp import config

KEY = config.refresh_token_key("known-answer-secret")


def signed_refresh(session: str = "5" * 32, generation: int = 1, key: bytes = KEY) -> str:
    """``tea1r.<session>.<generation>.<signature>`` under ``key``."""
    body = f"{session}.{generation}"
    digest = hmac.new(key, body.encode(), hashlib.sha256).digest()
    return f"tea1r.{body}.{base64.urlsafe_b64encode(digest).rstrip(b'=').decode()}"
