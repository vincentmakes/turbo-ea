"""``RequireBearerForMcp``: the 401 that tells an MCP client to do OAuth.

Without it an anonymous POST to ``/mcp`` is accepted and handed a session id,
and the client never learns it must authenticate. A bearer token that does not
resolve gets the same challenge with ``error="invalid_token"``, so a client
holding a token lost in a restart refreshes instead of calling tools that can
only answer "Not authenticated". The gate covers ``/mcp``
and everything under it, nothing else: the OAuth and well-known routes have
to stay public, or a client could never fetch the metadata that the 401
points it to.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from turbo_ea_mcp import oauth
from turbo_ea_mcp.api_client import RefreshUnavailable
from turbo_ea_mcp.server import RequireBearerForMcp

METADATA = "https://mcp.example/.well-known/oauth-protected-resource"
KNOWN = {"abc": "jwt-abc"}


class Resolver:
    """Stands in for ``oauth.resolve_token``; records what it was asked."""

    def __init__(self, known=KNOWN):
        self.known = known
        self.asked: list[str] = []

    async def __call__(self, token):
        self.asked.append(token)
        return self.known.get(token)


def call(
    scope_type: str = "http",
    path: str = "/mcp",
    auth: bytes | None = None,
    resolver: Resolver | None = None,
    **extra,
):
    """Run the gate once; return (inner app reached?, messages sent)."""
    reached = []
    sent = []

    async def inner(scope, receive, send):
        reached.append(scope)

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    headers = [(b"content-type", b"application/json")]
    if auth is not None:
        headers.append((b"authorization", auth))
    scope = {"type": scope_type, "path": path, "headers": headers, **extra}
    if scope_type == "http":
        scope.update(method="POST", query_string=b"", http_version="1.1")
    gate = RequireBearerForMcp(
        inner, resource_metadata_url=METADATA, resolve=resolver or Resolver()
    )
    asyncio.run(gate(scope, receive, send))
    return bool(reached), sent


def response_of(sent):
    start = next(m for m in sent if m["type"] == "http.response.start")
    body = b"".join(
        m.get("body", b"") for m in sent if m["type"] == "http.response.body"
    )
    headers = {k.decode().lower(): v.decode() for k, v in start["headers"]}
    return start["status"], headers, json.loads(body)


@pytest.mark.parametrize("path", ["/mcp", "/mcp/", "/mcp/messages"])
@pytest.mark.parametrize(
    "auth", [None, b"", b"Basic dXNlcjpwYXNz", b"Bearer", b"token abc"]
)
def test_an_unauthenticated_protocol_request_gets_the_oauth_challenge(path, auth):
    reached, sent = call(path=path, auth=auth)
    assert not reached
    status, headers, body = response_of(sent)
    assert status == 401
    assert headers["www-authenticate"] == f'Bearer resource_metadata="{METADATA}"'
    assert body == {
        "error": "unauthorized",
        "error_description": "Bearer token required",
    }


@pytest.mark.parametrize("auth", [b"Bearer abc", b"bearer abc", b"BEARER abc"])
def test_a_bearer_request_with_a_known_token_passes_through(auth):
    resolver = Resolver()
    reached, sent = call(auth=auth, resolver=resolver)
    assert reached and sent == []
    assert resolver.asked == [auth.decode()[7:]]


@pytest.mark.parametrize("path", ["/mcp", "/mcp/", "/mcp/messages"])
@pytest.mark.parametrize(
    "auth", [b"Bearer stale", b"bearer nope", b"Bearer abcd", b"Bearer "]
)
def test_a_token_that_does_not_resolve_gets_the_invalid_token_challenge(path, auth):
    resolver = Resolver()
    reached, sent = call(path=path, auth=auth, resolver=resolver)
    assert not reached
    status, headers, body = response_of(sent)
    assert status == 401
    assert headers["www-authenticate"] == (
        f'Bearer error="invalid_token", resource_metadata="{METADATA}"'
    )
    assert body == {
        "error": "invalid_token",
        "error_description": "The access token is unknown or expired",
    }
    assert resolver.asked == [auth.decode()[7:]]


class Failing:
    def __init__(self, exc):
        self.exc = exc

    async def __call__(self, token):
        raise self.exc


@pytest.mark.parametrize("path", ["/mcp", "/mcp/"])
@pytest.mark.parametrize(
    "exc", [RefreshUnavailable("backend answered 502"), RuntimeError("boom")]
)
def test_a_backend_failure_while_resolving_is_a_503_not_a_500(path, exc):
    reached, sent = call(path=path, auth=b"Bearer abc", resolver=Failing(exc))
    assert not reached
    status, headers, body = response_of(sent)
    assert status == 503
    assert headers["retry-after"] == "5"
    assert "www-authenticate" not in headers
    assert body == {
        "error": "temporarily_unavailable",
        "error_description": "Turbo EA is not reachable, retry shortly",
    }


def test_the_header_without_a_token_is_never_resolved():
    resolver = Resolver()
    call(auth=b"Basic dXNlcjpwYXNz", resolver=resolver)
    assert resolver.asked == []


def test_the_default_resolver_is_the_oauth_store():
    gate = RequireBearerForMcp(lambda *a: None, resource_metadata_url=METADATA)
    assert gate.resolve is oauth.resolve_token


@pytest.mark.parametrize(
    "path",
    [
        "/",
        "/oauth/authorize",
        "/.well-known/oauth-protected-resource",
        "/mcpx",
        "/api/mcp",
        "/MCP",
    ],
)
def test_other_paths_stay_public(path):
    resolver = Resolver()
    reached, sent = call(path=path, auth=b"Bearer stale", resolver=resolver)
    assert reached and sent == []
    assert resolver.asked == []


def test_a_scope_without_a_path_passes_through():
    reached, sent = call(path="")
    assert reached and sent == []


@pytest.mark.parametrize("scope_type", ["lifespan", "websocket"])
def test_non_http_scopes_are_not_gated(scope_type):
    reached, sent = call(scope_type=scope_type)
    assert reached and sent == []


def run_raw(scope):
    reached, sent = [], []

    async def inner(scope, receive, send):
        reached.append(scope)

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    gate = RequireBearerForMcp(inner, METADATA, resolve=Resolver())
    asyncio.run(gate(scope, receive, send))
    return bool(reached), sent


def test_a_scope_with_no_path_key_passes_through():
    reached, sent = run_raw({"type": "http", "headers": []})
    assert reached and sent == []


def test_a_protocol_request_with_no_headers_key_is_challenged():
    reached, sent = run_raw({"type": "http", "path": "/mcp", "method": "POST"})
    assert not reached
    assert response_of(sent)[0] == 401
