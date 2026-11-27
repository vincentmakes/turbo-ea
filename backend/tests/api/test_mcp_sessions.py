"""MCP connections: opened and renewed by the MCP server, listed and ended by
people (issue #1449)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from sqlalchemy import select

from app.core import security
from app.core.security import decode_access_token
from app.models.audit_log import AuditLogEntry
from app.models.mcp_session import McpSession
from app.services import mcp_session_service as sessions
from tests.conftest import auth_headers, create_role, create_user

URL = "/api/v1/auth/mcp/sessions"
REFRESH = f"{URL}/refresh"


def service_headers(**claims) -> dict[str, str]:
    """What the MCP server sends to prove it is this instance's own."""
    now = datetime.now(timezone.utc)
    payload = {
        "iss": security.MCP_SERVICE_ISS,
        "aud": security.MCP_SERVICE_AUD,
        "iat": now,
        "exp": now + timedelta(seconds=60),
    }
    payload.update(claims)
    key = security.derive_key(security.MCP_SERVICE_KEY_CONTEXT)
    return {"X-Turbo-EA-Service": jwt.encode(payload, key, algorithm=security.ALGORITHM)}


async def _connect(client, user, **body):
    return await client.post(URL, json=body, headers={**auth_headers(user), **service_headers()})


async def _renew(client, refresh_token, headers=None):
    return await client.post(
        REFRESH,
        json={"refresh_token": refresh_token},
        headers=service_headers() if headers is None else headers,
    )


async def _audit(db) -> list[AuditLogEntry]:
    await db.rollback()
    result = await db.execute(
        select(AuditLogEntry)
        .where(AuditLogEntry.action.like("auth.mcp.%"))
        .order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars().all())


# ── Opening a connection ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_mcp_server_opens_a_connection_for_the_signed_in_person(client, db, member_user):
    resp = await _connect(client, member_user, client_name="  Copilot Studio ", scope="mcp:read")

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert set(body) == {"access_token", "token_type", "expires_in", "refresh_token", "scope"}
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 3600
    assert body["scope"] == "mcp:read"

    stored = (await db.execute(select(McpSession))).scalar_one()
    assert stored.user_id == member_user.id
    assert stored.client_name == "Copilot Studio"
    assert stored.scope == "mcp:read"
    assert sessions.parse_refresh_token(body["refresh_token"]) == (stored.id, 0)

    claims = decode_access_token(body["access_token"])
    assert claims["sub"] == str(member_user.id)
    assert claims["role"] == member_user.role
    assert claims["msid"] == str(stored.id)
    assert claims["exp"] - claims["iat"] == 3600


@pytest.mark.asyncio
async def test_a_connection_without_a_name_gets_the_default_one(client, db, member_user):
    assert (await _connect(client, member_user)).status_code == 201
    assert (await _connect(client, member_user, client_name="   ")).status_code == 201
    stored = (await db.execute(select(McpSession))).scalars().all()
    assert [row.client_name for row in stored] == ["MCP Client", "MCP Client"]
    assert {row.scope for row in stored} == {"mcp:read"}


@pytest.mark.asyncio
async def test_opening_is_recorded(client, db, member_user):
    email = member_user.email
    resp = await _connect(client, member_user, client_name="Claude")
    session_id = sessions.parse_refresh_token(resp.json()["refresh_token"])[0]

    (row,) = await _audit(db)
    assert row.action == "auth.mcp.connected"
    assert row.category == "auth"
    assert row.outcome == "success"
    assert row.actor_email == email
    assert (row.target_type, row.target_id, row.target_label) == (
        "mcp_session",
        str(session_id),
        "Claude",
    )


@pytest.mark.asyncio
async def test_opening_needs_the_mcp_servers_proof(client, db, member_user):
    resp = await client.post(URL, json={}, headers=auth_headers(member_user))
    assert resp.status_code == 401
    assert resp.json()["detail"] == "MCP service authentication required"

    wrong = service_headers(aud="turbo-ea")
    resp = await client.post(URL, json={}, headers={**auth_headers(member_user), **wrong})
    assert resp.status_code == 401

    assert (await db.execute(select(McpSession))).scalars().all() == []


@pytest.mark.asyncio
async def test_opening_needs_a_signed_in_person(client, db):
    resp = await client.post(URL, json={}, headers=service_headers())
    assert resp.status_code == 401
    assert (await db.execute(select(McpSession))).scalars().all() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["client_name", "scope"])
async def test_an_overlong_value_is_refused(client, member_user, field):
    assert (await _connect(client, member_user, **{field: "x" * 200})).status_code == 201
    assert (await _connect(client, member_user, **{field: "x" * 201})).status_code == 422


# ── The token a connection hands out ────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_access_token_works_until_the_connection_is_ended(client, db, member_user):
    body = (await _connect(client, member_user)).json()
    bearer = {"Authorization": f"Bearer {body['access_token']}"}
    assert (await client.get("/api/v1/auth/me", headers=bearer)).status_code == 200

    stored = (await db.execute(select(McpSession))).scalar_one()
    sessions.revoke(stored, sessions.REASON_BY_ADMIN)
    await db.flush()

    resp = await client.get("/api/v1/auth/me", headers=bearer)
    assert resp.status_code == 401
    assert resp.json()["detail"] == "MCP connection ended"
    # A token of the same person that belongs to no connection is untouched.
    assert (
        await client.get("/api/v1/auth/me", headers=auth_headers(member_user))
    ).status_code == 200


# ── Renewing ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_renewing_rotates_the_refresh_token(client, db, member_user):
    first = (await _connect(client, member_user, scope="mcp:write")).json()

    resp = await _renew(client, first["refresh_token"])

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"access_token", "token_type", "expires_in", "refresh_token", "scope"}
    assert body["expires_in"] == 3600
    assert body["scope"] == "mcp:write"
    stored = (await db.execute(select(McpSession))).scalar_one()
    assert stored.generation == 1
    assert sessions.parse_refresh_token(body["refresh_token"]) == (stored.id, 1)
    assert decode_access_token(body["access_token"])["msid"] == str(stored.id)
    # Renewals are not written to the log: one an hour per connection.
    assert [row.action for row in await _audit(db)] == ["auth.mcp.connected"]


@pytest.mark.asyncio
async def test_renewing_reads_the_role_again(client, db, member_user):
    await create_role(db, key="viewer", label="Viewer", permissions={})
    first = (await _connect(client, member_user)).json()
    member_user.role = "viewer"
    await db.flush()

    body = (await _renew(client, first["refresh_token"])).json()

    assert decode_access_token(body["access_token"])["role"] == "viewer"


@pytest.mark.asyncio
async def test_renewing_needs_the_mcp_servers_proof(client, db, member_user):
    first = (await _connect(client, member_user)).json()

    resp = await _renew(client, first["refresh_token"], headers={})
    assert resp.status_code == 401
    # A person's own session is not the proof either.
    resp = await _renew(client, first["refresh_token"], headers=auth_headers(member_user))
    assert resp.status_code == 401

    assert (await db.execute(select(McpSession))).scalar_one().generation == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("token", ["nonsense", "tea1r.abc.0.sig", ""])
async def test_a_token_that_is_not_ours_is_an_invalid_grant(client, token):
    resp = await _renew(client, token)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "invalid_grant"


@pytest.mark.asyncio
async def test_an_overlong_token_is_refused_before_it_is_read(client):
    resp = await _renew(client, "x" * (sessions.MAX_REFRESH_TOKEN_LENGTH + 1))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_a_replaced_token_coming_back_ends_the_connection_and_is_recorded(
    client, db, member_user
):
    email = member_user.email
    first = (await _connect(client, member_user)).json()
    second = (await _renew(client, first["refresh_token"])).json()
    stored = (await db.execute(select(McpSession))).scalar_one()
    session_id = stored.id
    # Past the grace in which a repeat is a retry.
    stored.rotated_at = datetime.now(timezone.utc) - timedelta(seconds=61)
    await db.flush()

    resp = await _renew(client, first["refresh_token"])

    assert resp.status_code == 400
    assert resp.json()["detail"] == "invalid_grant"
    rows = await _audit(db)
    assert [row.action for row in rows] == ["auth.mcp.connected", "auth.mcp.replay_detected"]
    replay = rows[-1]
    assert replay.outcome == "failure"
    assert replay.category == "auth"
    assert replay.subject_email == email
    assert (replay.target_type, replay.target_id, replay.target_label) == (
        "mcp_session",
        str(session_id),
        "MCP Client",
    )
    stored = (await db.execute(select(McpSession))).scalar_one()
    assert stored.revoked_reason == "replayed"
    # The token that was current is dead with it, and so is its access token.
    assert (await _renew(client, second["refresh_token"])).status_code == 400
    bearer = {"Authorization": f"Bearer {second['access_token']}"}
    assert (await client.get("/api/v1/auth/me", headers=bearer)).status_code == 401


@pytest.mark.asyncio
async def test_a_repeat_within_the_grace_is_a_retry(client, db, member_user):
    first = (await _connect(client, member_user)).json()
    second = (await _renew(client, first["refresh_token"])).json()

    again = await _renew(client, first["refresh_token"])

    assert again.status_code == 200
    assert again.json()["refresh_token"] == second["refresh_token"]
    assert (await db.execute(select(McpSession))).scalar_one().revoked_at is None


@pytest.mark.asyncio
async def test_a_disabled_account_cannot_renew_and_keeps_its_token(client, db, member_user):
    first = (await _connect(client, member_user)).json()
    member_user.is_active = False
    await db.flush()

    resp = await _renew(client, first["refresh_token"])

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Account disabled"


@pytest.mark.asyncio
async def test_an_account_past_its_access_end_cannot_renew(client, db, member_user):
    first = (await _connect(client, member_user)).json()
    member_user.access_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await db.flush()

    resp = await _renew(client, first["refresh_token"])

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Account access has expired"


@pytest.mark.asyncio
async def test_an_ended_connection_cannot_renew(client, db, member_user):
    first = (await _connect(client, member_user)).json()
    stored = (await db.execute(select(McpSession))).scalar_one()
    sessions.revoke(stored, sessions.REASON_BY_USER)
    await db.flush()

    resp = await _renew(client, first["refresh_token"])

    assert resp.status_code == 400
    assert [row.action for row in await _audit(db)] == ["auth.mcp.connected"]


# ── Listing ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_person_lists_their_own_live_connections(client, db, member_user, admin_user):
    await _connect(client, member_user, client_name="Claude")
    await _connect(client, admin_user, client_name="Someone else's")
    ended = (await _connect(client, member_user, client_name="Ended")).json()
    ended_id = sessions.parse_refresh_token(ended["refresh_token"])[0]
    sessions.revoke(await db.get(McpSession, ended_id), sessions.REASON_BY_USER)
    idle = (await _connect(client, member_user, client_name="Idle")).json()
    idle_row = await db.get(McpSession, sessions.parse_refresh_token(idle["refresh_token"])[0])
    idle_row.idle_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db.flush()

    resp = await client.get(URL, headers=auth_headers(member_user))

    assert resp.status_code == 200
    (row,) = resp.json()
    assert set(row) == {"id", "client_name", "created_at", "last_used_at", "expires_at"}
    assert row["client_name"] == "Claude"
    stored = await db.get(McpSession, uuid.UUID(row["id"]))
    assert datetime.fromisoformat(row["expires_at"]) == stored.idle_expires_at


@pytest.mark.asyncio
async def test_listing_everyone_needs_admin_mcp(client, member_user):
    resp = await client.get(f"{URL}?everyone=true", headers=auth_headers(member_user))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_an_admin_lists_everyones_and_sees_only_who_it_is(
    client, db, member_user, admin_user
):
    await _connect(client, member_user, client_name="Claude")
    await _connect(client, admin_user, client_name="Copilot Studio")

    resp = await client.get(f"{URL}?everyone=true", headers=auth_headers(admin_user))

    assert resp.status_code == 200
    rows = {row["client_name"]: row for row in resp.json()}
    assert set(rows) == {"Claude", "Copilot Studio"}
    assert rows["Claude"]["user"] == {
        "id": str(member_user.id),
        "display_name": member_user.display_name,
    }
    assert set(rows["Claude"]) == {
        "id",
        "client_name",
        "created_at",
        "last_used_at",
        "expires_at",
        "user",
    }
    # Without the flag an admin sees their own, like anyone.
    own = await client.get(URL, headers=auth_headers(admin_user))
    assert [row["client_name"] for row in own.json()] == ["Copilot Studio"]


@pytest.mark.asyncio
async def test_the_list_is_most_recently_used_first(client, db, member_user):
    for name in ("first", "second", "third"):
        await _connect(client, member_user, client_name=name)
    rows = (await db.execute(select(McpSession))).scalars().all()
    now = datetime.now(timezone.utc)
    by_name = {row.client_name: row for row in rows}
    by_name["first"].last_used_at = now
    by_name["second"].last_used_at = now - timedelta(hours=2)
    by_name["third"].last_used_at = now - timedelta(hours=1)
    await db.flush()

    resp = await client.get(URL, headers=auth_headers(member_user))

    assert [row["client_name"] for row in resp.json()] == ["first", "third", "second"]


@pytest.mark.asyncio
async def test_listing_needs_a_session(client):
    assert (await client.get(URL)).status_code == 401


# ── Ending ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_person_ends_their_own_connection(client, db, member_user):
    email = member_user.email
    body = (await _connect(client, member_user, client_name="Claude")).json()
    session_id = sessions.parse_refresh_token(body["refresh_token"])[0]

    resp = await client.delete(f"{URL}/{session_id}", headers=auth_headers(member_user))

    assert resp.status_code == 204
    rows = await _audit(db)
    assert [row.action for row in rows] == ["auth.mcp.connected", "auth.mcp.revoked"]
    assert rows[-1].actor_email == email
    assert rows[-1].subject_email == email
    assert rows[-1].category == "auth"
    assert (rows[-1].target_type, rows[-1].target_id, rows[-1].target_label) == (
        "mcp_session",
        str(session_id),
        "Claude",
    )
    stored = await db.get(McpSession, session_id)
    assert stored.revoked_reason == "revoked_by_user"
    assert (await _renew(client, body["refresh_token"])).status_code == 400
    assert (await client.get(URL, headers=auth_headers(member_user))).json() == []


@pytest.mark.asyncio
async def test_an_admin_ends_someone_elses_connection(client, db, member_user, admin_user):
    member_email, admin_email = member_user.email, admin_user.email
    body = (await _connect(client, member_user)).json()
    session_id = sessions.parse_refresh_token(body["refresh_token"])[0]

    resp = await client.delete(f"{URL}/{session_id}", headers=auth_headers(admin_user))

    assert resp.status_code == 204
    revoked = (await _audit(db))[-1]
    assert revoked.action == "auth.mcp.revoked"
    assert revoked.actor_email == admin_email
    assert revoked.subject_email == member_email
    assert (await db.get(McpSession, session_id)).revoked_reason == "revoked_by_admin"


@pytest.mark.asyncio
async def test_someone_elses_connection_is_not_found_without_admin_mcp(
    client, db, member_user, admin_user
):
    body = (await _connect(client, admin_user)).json()
    session_id = sessions.parse_refresh_token(body["refresh_token"])[0]

    resp = await client.delete(f"{URL}/{session_id}", headers=auth_headers(member_user))

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Connection not found"
    assert (await db.get(McpSession, session_id)).revoked_at is None
    # The same answer as for a connection that does not exist.
    missing = await client.delete(f"{URL}/{uuid.uuid4()}", headers=auth_headers(member_user))
    assert (missing.status_code, missing.json()) == (resp.status_code, resp.json())


@pytest.mark.asyncio
async def test_ending_twice_is_quiet(client, db, member_user):
    body = (await _connect(client, member_user)).json()
    session_id = sessions.parse_refresh_token(body["refresh_token"])[0]
    await client.delete(f"{URL}/{session_id}", headers=auth_headers(member_user))
    first_end = (await db.get(McpSession, session_id)).revoked_at

    resp = await client.delete(f"{URL}/{session_id}", headers=auth_headers(member_user))

    assert resp.status_code == 204
    assert [row.action for row in await _audit(db)] == ["auth.mcp.connected", "auth.mcp.revoked"]
    assert (await db.get(McpSession, session_id)).revoked_at == first_end


@pytest.mark.asyncio
async def test_ending_needs_a_session(client):
    assert (await client.delete(f"{URL}/{uuid.uuid4()}")).status_code == 401


@pytest.mark.asyncio
async def test_deleting_the_person_deletes_their_connections(client, db):
    user = await create_user(db, email="leaver@example.com")
    await _connect(client, user)
    await db.delete(user)
    await db.flush()
    assert (await db.execute(select(McpSession))).scalars().all() == []
