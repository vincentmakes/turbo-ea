"""A token minted for an MCP connection cannot be swapped for an ordinary
session: it would outlive the connection and survive its revocation (#1449)."""

from __future__ import annotations

import pytest

from app.api.v1.auth import MCP_TOKEN_NOT_EXCHANGEABLE
from app.core.security import create_access_token
from app.services import mcp_session_service as sessions


async def _connection_token(db, user) -> str:
    session, _ = await sessions.create(db, user.id, client_name="Claude", scope="mcp:read")
    await db.flush()
    return create_access_token(user.id, user.role, mcp_session_id=session.id)


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_the_refusal_says_why():
    assert MCP_TOKEN_NOT_EXCHANGEABLE == (
        "A token of an MCP connection cannot be exchanged for a new session"
    )


@pytest.mark.asyncio
async def test_refresh_refuses_a_connection_token(client, db, member_user):
    token = await _connection_token(db, member_user)

    resp = await client.post("/api/v1/auth/refresh", headers=_bearer(token))

    assert resp.status_code == 403
    assert resp.json()["detail"] == MCP_TOKEN_NOT_EXCHANGEABLE
    assert "access_token" not in resp.cookies


@pytest.mark.asyncio
async def test_refresh_refuses_a_connection_token_sent_as_the_cookie(client, db, member_user):
    token = await _connection_token(db, member_user)
    client.cookies.set("access_token", token)
    try:
        resp = await client.post("/api/v1/auth/refresh")
    finally:
        client.cookies.clear()

    assert resp.status_code == 403
    assert resp.json()["detail"] == MCP_TOKEN_NOT_EXCHANGEABLE


@pytest.mark.asyncio
async def test_refresh_still_renews_an_ordinary_session(client, member_user):
    token = create_access_token(member_user.id, member_user.role)

    resp = await client.post("/api/v1/auth/refresh", headers=_bearer(token))

    assert resp.status_code == 200
    assert resp.json()["access_token"]


@pytest.mark.asyncio
async def test_impersonation_refuses_a_connection_token(client, db, admin_user, member_role):
    token = await _connection_token(db, admin_user)

    resp = await client.post(
        "/api/v1/auth/impersonate", json={"role": "member"}, headers=_bearer(token)
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == MCP_TOKEN_NOT_EXCHANGEABLE


@pytest.mark.asyncio
async def test_impersonation_still_works_with_an_ordinary_session(client, admin_user, member_role):
    token = create_access_token(admin_user.id, admin_user.role)

    resp = await client.post(
        "/api/v1/auth/impersonate", json={"role": "member"}, headers=_bearer(token)
    )

    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_stopping_impersonation_refuses_a_connection_token(client, db, admin_user):
    token = await _connection_token(db, admin_user)

    resp = await client.post("/api/v1/auth/stop-impersonating", headers=_bearer(token))

    assert resp.status_code == 403
    assert resp.json()["detail"] == MCP_TOKEN_NOT_EXCHANGEABLE


@pytest.mark.asyncio
async def test_stopping_impersonation_still_works_with_an_ordinary_session(
    client, admin_user, member_role
):
    token = create_access_token(admin_user.id, admin_user.role, impersonated_role="member")

    resp = await client.post("/api/v1/auth/stop-impersonating", headers=_bearer(token))

    assert resp.status_code == 200
    assert resp.json()["access_token"]


@pytest.mark.asyncio
async def test_stopping_with_no_impersonation_is_still_a_bad_request(client, admin_user):
    token = create_access_token(admin_user.id, admin_user.role)

    resp = await client.post("/api/v1/auth/stop-impersonating", headers=_bearer(token))

    assert resp.status_code == 400
    assert resp.json()["detail"] == "No active impersonation session"
