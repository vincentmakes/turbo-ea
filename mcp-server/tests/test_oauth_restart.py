"""An AI tool's connection survives a restart of the MCP server (#1449).

Copilot Studio and Claude had to recreate their connection after every restart
of the MCP container: the access and refresh tokens lived only in this
process's memory. The access token is now the session's Turbo EA JWT sealed
under a key derived from SECRET_KEY, and the refresh token is the backend's
own, so a fresh process with the same SECRET_KEY takes both up where the last
one left off. Each "process" here is a reload of ``config`` and ``oauth``.
"""

from __future__ import annotations

import base64
import hashlib
import importlib
import json
import os
import time
from unittest.mock import AsyncMock

import pytest

from turbo_ea_mcp import api_client, config, oauth
from turbo_ea_mcp.api_client import McpSessionTokens

CB = "http://127.0.0.1:5000/cb"
VERIFIER = "restart-verifier"


def jwt_with(payload: dict) -> str:
    data = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    return f"h.{data}.s"


def challenge_of(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


@pytest.fixture
def boot():
    """Start a "process" with the given SECRET_KEY (``None``: unset).

    Afterwards the environment and both modules' namespaces are put back
    exactly — the same objects, not a reload — so everything that captured one
    (``RequireBearerForMcp``'s default resolver, the test modules' imports)
    still sees the original."""
    original = os.environ.get("SECRET_KEY")
    namespaces = {module: dict(vars(module)) for module in (config, oauth)}

    def start(secret: str | None):
        if secret is None:
            os.environ.pop("SECRET_KEY", None)
        else:
            os.environ["SECRET_KEY"] = secret
        importlib.reload(config)
        return importlib.reload(oauth)

    try:
        yield start
    finally:
        if original is None:
            os.environ.pop("SECRET_KEY", None)
        else:
            os.environ["SECRET_KEY"] = original
        for module, namespace in namespaces.items():
            vars(module).clear()
            vars(module).update(namespace)


@pytest.fixture
def backend(monkeypatch):
    session_jwt = jwt_with({"exp": time.time() + 3600, "msid": "s1"})
    tokens = McpSessionTokens(
        access_token=session_jwt, refresh_token="tea1r.s1.1.sig", expires_in=3600, scope="mcp:read"
    )
    renewed = tokens.model_copy(update={"refresh_token": "tea1r.s1.2.sig"})
    create = AsyncMock(return_value=tokens)
    refresh = AsyncMock(return_value=renewed)
    monkeypatch.setattr(api_client, "create_mcp_session", create)
    monkeypatch.setattr(api_client, "refresh_mcp_session", refresh)
    return session_jwt, create, refresh


async def sign_in(module, sso_jwt: str | None = None) -> dict:
    """Run the token exchange of one sign-in in ``module``'s process."""
    module.store.codes["code"] = module.AuthCode(
        code="code",
        client_id="cid",
        redirect_uri=CB,
        scope="mcp:read",
        code_challenge=challenge_of(VERIFIER),
        turbo_jwt=sso_jwt or jwt_with({"exp": time.time() + 86_400}),
    )
    resp = await module._handle_code_exchange(
        {"code": "code", "code_verifier": VERIFIER, "redirect_uri": CB}
    )
    assert resp.status_code == 200
    return json.loads(resp.body)


@pytest.mark.asyncio
class TestRestart:
    async def test_an_access_token_resolves_in_a_fresh_process(self, boot, backend):
        session_jwt, _, _ = backend
        tokens = await sign_in(boot("s3cret"))
        fresh = boot("s3cret")
        assert fresh.store.codes == {}
        assert await fresh.resolve_token(tokens["access_token"]) == session_jwt

    async def test_a_refresh_token_renews_in_a_fresh_process(self, boot, backend):
        session_jwt, _, refresh = backend
        tokens = await sign_in(boot("s3cret"))
        fresh = boot("s3cret")
        resp = await fresh._handle_refresh({"refresh_token": tokens["refresh_token"]})
        assert resp.status_code == 200
        renewed = json.loads(resp.body)
        refresh.assert_awaited_once_with("tea1r.s1.1.sig")
        assert renewed["refresh_token"] == "tea1r.s1.2.sig"
        assert await fresh.resolve_token(renewed["access_token"]) == session_jwt

    async def test_another_secret_key_opens_nothing(self, boot, backend):
        tokens = await sign_in(boot("s3cret"))
        assert await boot("another-secret").resolve_token(tokens["access_token"]) is None

    async def test_without_a_secret_key_tokens_die_with_the_process(self, boot, backend):
        session_jwt, _, _ = backend
        first = boot(None)
        assert first.CLIENT_KEY_IS_EPHEMERAL is True
        tokens = await sign_in(first)
        assert await first.resolve_token(tokens["access_token"]) == session_jwt
        assert await boot(None).resolve_token(tokens["access_token"]) is None

    async def test_with_a_secret_key_the_keys_are_not_ephemeral(self, boot):
        assert boot("s3cret").CLIENT_KEY_IS_EPHEMERAL is False

    async def test_a_refresh_token_never_resolves_as_an_access_token(self, boot, backend):
        module = boot("s3cret")
        tokens = await sign_in(module)
        assert await module.resolve_token(tokens["refresh_token"]) is None
        assert await boot("s3cret").resolve_token(tokens["refresh_token"]) is None

    async def test_an_expired_access_token_does_not_resolve(self, boot):
        module = boot("s3cret")
        expired = module.seal_access_token("jwt", time.time() - 1)
        assert await boot("s3cret").resolve_token(expired) is None


@pytest.mark.asyncio
class TestDegradedMode:
    """No SECRET_KEY: sign-in still works, no refresh token is handed out."""

    async def test_no_secret_key_issues_no_refresh_token(self, boot, monkeypatch):
        monkeypatch.setattr(api_client, "MCP_SERVICE_AUTH_KEY", None)
        module = boot(None)
        sso_jwt = jwt_with({"exp": time.time() + 86_400})
        tokens = await sign_in(module, sso_jwt)
        assert "refresh_token" not in tokens
        assert set(tokens) == {"access_token", "token_type", "expires_in", "scope"}
        assert 86_390 <= tokens["expires_in"] <= 86_400
        assert await module.resolve_token(tokens["access_token"]) == sso_jwt
