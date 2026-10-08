"""``RequireBearerForMcp``: the 401 that tells an MCP client to do OAuth.

Without it an anonymous POST to ``/mcp`` is accepted and handed a session id,
and the client never learns it must authenticate. The gate covers ``/mcp``
and everything under it, nothing else: the OAuth and well-known routes have
to stay public, or a client could never fetch the metadata that the 401
points it to.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from turbo_ea_mcp.server import RequireBearerForMcp

METADATA = "https://mcp.example/.well-known/oauth-protected-resource"


def call(
    scope_type: str = "http", path: str = "/mcp", auth: bytes | None = None, **extra
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
    gate = RequireBearerForMcp(inner, resource_metadata_url=METADATA)
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


@pytest.mark.parametrize(
    "auth", [b"Bearer abc", b"bearer abc", b"BEARER abc", b"Bearer "]
)
def test_a_bearer_request_passes_through(auth):
    reached, sent = call(auth=auth)
    assert reached and sent == []


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
    reached, sent = call(path=path)
    assert reached and sent == []


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

    asyncio.run(RequireBearerForMcp(inner, METADATA)(scope, receive, send))
    return bool(reached), sent


def test_a_scope_with_no_path_key_passes_through():
    reached, sent = run_raw({"type": "http", "headers": []})
    assert reached and sent == []


def test_a_protocol_request_with_no_headers_key_is_challenged():
    reached, sent = run_raw({"type": "http", "path": "/mcp", "method": "POST"})
    assert not reached
    assert response_of(sent)[0] == 401
