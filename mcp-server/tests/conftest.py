"""Suite-wide fixtures."""

from __future__ import annotations

import pytest

from tests.refresh_tokens import KEY
from turbo_ea_mcp import oauth


@pytest.fixture(autouse=True)
def _refresh_token_key(monkeypatch):
    """Verify refresh tokens with the key ``tests.refresh_tokens`` signs
    with, as a process given SECRET_KEY would; a test of the keyless case
    sets ``oauth._refresh_token_key`` to ``None`` itself."""
    monkeypatch.setattr(oauth, "_refresh_token_key", KEY)
