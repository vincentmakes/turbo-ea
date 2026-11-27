"""The durable record behind an AI tool's MCP refresh token (issue #1449)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.config import settings
from app.core.security import derive_key
from app.models.mcp_session import McpSession
from app.services import mcp_session_service as sessions
from tests.conftest import create_user

NOW = datetime(2026, 11, 27, 12, 0, tzinfo=timezone.utc)


async def _open(db, user, *, now=NOW, name="Copilot Studio"):
    return await sessions.create(db, user.id, client_name=name, scope="mcp:read", now=now)


# ── The token ───────────────────────────────────────────────────────────────


def test_a_refresh_token_names_its_connection_and_generation():
    session_id = uuid.uuid4()
    token = sessions.mint_refresh_token(session_id, 7)
    assert token.startswith("tea1r.")
    assert token.count(".") == 3
    assert sessions.parse_refresh_token(token) == (session_id, 7)


def test_the_longest_token_fits_the_length_cap():
    token = sessions.mint_refresh_token(uuid.uuid4(), 10**12)
    assert len(token) <= sessions.MAX_REFRESH_TOKEN_LENGTH


def test_the_signature_is_an_hmac_under_the_derived_key():
    import base64
    import hashlib
    import hmac

    session_id = uuid.UUID("00000000-0000-0000-0000-0000000000aa")
    body = f"{session_id.hex}.3"
    key = derive_key(b"turbo-ea/mcp-refresh-token/v1")
    digest = hmac.new(key, body.encode(), hashlib.sha256).digest()
    expected = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    assert sessions.mint_refresh_token(session_id, 3) == f"tea1r.{body}.{expected}"


@pytest.mark.parametrize(
    "mangle",
    [
        lambda t: t[:-1] + ("A" if t[-1] != "A" else "B"),  # signature
        lambda t: t.replace(".4.", ".5."),  # generation
        lambda t: "tea1x." + t[6:],  # prefix
        lambda t: t[6:],  # no prefix
        lambda t: t + "é",  # non-ASCII never raises
        lambda t: t + "x" * 300,  # too long
    ],
)
def test_a_changed_token_is_not_ours(mangle):
    token = sessions.mint_refresh_token(uuid.uuid4(), 4)
    assert sessions.parse_refresh_token(mangle(token)) is None


@pytest.mark.parametrize("value", [None, 12, b"tea1r.x", "", "tea1r.", "tea1r..."])
def test_what_is_not_a_token_is_not_ours(value):
    assert sessions.parse_refresh_token(value) is None


def test_a_token_signed_with_another_secret_is_not_ours(monkeypatch):
    token = sessions.mint_refresh_token(uuid.uuid4(), 0)
    monkeypatch.setattr(settings, "SECRET_KEY", "another-secret")
    assert sessions.parse_refresh_token(token) is None


def test_a_token_of_exactly_the_cap_is_read(monkeypatch):
    token = sessions.mint_refresh_token(uuid.uuid4(), 0)
    monkeypatch.setattr(sessions, "MAX_REFRESH_TOKEN_LENGTH", len(token))
    assert sessions.parse_refresh_token(token) is not None
    monkeypatch.setattr(sessions, "MAX_REFRESH_TOKEN_LENGTH", len(token) - 1)
    assert sessions.parse_refresh_token(token) is None


# ── Live or not ─────────────────────────────────────────────────────────────


def _row(**over) -> McpSession:
    values = {
        "id": uuid.uuid4(),
        "user_id": uuid.uuid4(),
        "client_name": "Claude",
        "scope": "mcp:read",
        "generation": 0,
        "idle_expires_at": NOW + timedelta(days=30),
        "expires_at": NOW + timedelta(days=180),
        "revoked_at": None,
    }
    values.update(over)
    return McpSession(**values)


def test_a_fresh_connection_is_live():
    assert sessions.is_live(_row(), NOW) is True
    assert sessions.is_live(_row(expires_at=None), NOW) is True


def test_a_revoked_connection_is_not_live():
    assert sessions.is_live(_row(revoked_at=NOW - timedelta(days=1)), NOW) is False


def test_the_idle_end_is_exclusive():
    assert sessions.is_live(_row(idle_expires_at=NOW), NOW) is False
    assert sessions.is_live(_row(idle_expires_at=NOW + timedelta(seconds=1)), NOW) is True


def test_the_absolute_end_is_exclusive():
    assert sessions.is_live(_row(expires_at=NOW), NOW) is False
    assert sessions.is_live(_row(expires_at=NOW + timedelta(seconds=1)), NOW) is True


def test_is_live_reads_the_clock_when_given_no_moment():
    past = datetime.now(timezone.utc) - timedelta(seconds=5)
    assert sessions.is_live(_row(idle_expires_at=past, expires_at=None)) is False
    future = datetime.now(timezone.utc) + timedelta(minutes=5)
    assert sessions.is_live(_row(idle_expires_at=future, expires_at=None)) is True


def test_ends_at_is_the_earlier_of_the_two_ends():
    idle, absolute = NOW + timedelta(days=30), NOW + timedelta(days=10)
    assert sessions.ends_at(_row(idle_expires_at=idle, expires_at=absolute)) == absolute
    assert sessions.ends_at(_row(idle_expires_at=absolute, expires_at=idle)) == absolute
    assert sessions.ends_at(_row(idle_expires_at=idle, expires_at=None)) == idle


def test_revoking_twice_keeps_the_first_reason():
    row = _row()
    sessions.revoke(row, sessions.REASON_REPLAYED, NOW)
    sessions.revoke(row, sessions.REASON_BY_ADMIN, NOW + timedelta(hours=1))
    assert row.revoked_at == NOW
    assert row.revoked_reason == "replayed"


def test_revoke_reads_the_clock_when_given_no_moment():
    row = _row()
    before = datetime.now(timezone.utc)
    sessions.revoke(row, sessions.REASON_BY_USER)
    assert before <= row.revoked_at <= datetime.now(timezone.utc)
    assert row.revoked_reason == "revoked_by_user"


# ── Creating ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_records_the_connection_and_both_ends(db):
    user = await create_user(db)
    session, token = await _open(db, user)

    assert sessions.parse_refresh_token(token) == (session.id, 0)
    stored = (await db.execute(select(McpSession))).scalar_one()
    assert stored.id == session.id
    assert stored.user_id == user.id
    assert stored.client_name == "Copilot Studio"
    assert stored.scope == "mcp:read"
    assert stored.generation == 0
    assert stored.rotated_at is None
    assert stored.revoked_at is None
    assert stored.created_at == NOW
    assert stored.last_used_at == NOW
    assert stored.idle_expires_at == NOW + timedelta(days=30)
    assert stored.expires_at == NOW + timedelta(days=180)


@pytest.mark.asyncio
async def test_create_follows_the_configured_lifetimes(db, monkeypatch):
    monkeypatch.setattr(settings, "MCP_SESSION_IDLE_DAYS", 7)
    monkeypatch.setattr(settings, "MCP_SESSION_MAX_DAYS", 1)
    user = await create_user(db)
    session, _ = await _open(db, user)
    assert session.idle_expires_at == NOW + timedelta(days=7)
    assert session.expires_at == NOW + timedelta(days=1)


@pytest.mark.asyncio
async def test_zero_max_days_means_no_absolute_end(db, monkeypatch):
    monkeypatch.setattr(settings, "MCP_SESSION_MAX_DAYS", 0)
    user = await create_user(db)
    session, _ = await _open(db, user)
    assert session.expires_at is None


@pytest.mark.asyncio
async def test_create_reads_the_clock_when_given_no_moment(db):
    user = await create_user(db)
    before = datetime.now(timezone.utc)
    session, _ = await sessions.create(db, user.id, client_name="Claude", scope="mcp:read")
    assert before <= session.created_at <= datetime.now(timezone.utc)


@pytest.mark.asyncio
async def test_one_connection_too_many_ends_the_one_unused_longest(db, monkeypatch):
    monkeypatch.setattr(sessions, "MAX_LIVE_SESSIONS_PER_USER", 3)
    user = await create_user(db)
    other = await create_user(db, email="other@example.com")
    kept_elsewhere, _ = await _open(db, other, now=NOW - timedelta(days=9))
    oldest, _ = await _open(db, user, now=NOW - timedelta(days=3))
    middle, _ = await _open(db, user, now=NOW - timedelta(days=2))
    newest, _ = await _open(db, user, now=NOW - timedelta(days=1))
    assert oldest.revoked_at is None  # three are allowed

    fourth, _ = await _open(db, user)

    assert oldest.revoked_at == NOW
    assert oldest.revoked_reason == "too_many_connections"
    assert [s.revoked_at for s in (middle, newest, fourth, kept_elsewhere)] == [None] * 4


@pytest.mark.asyncio
async def test_an_expired_connection_does_not_count_towards_the_cap(db, monkeypatch):
    monkeypatch.setattr(sessions, "MAX_LIVE_SESSIONS_PER_USER", 2)
    user = await create_user(db)
    expired, _ = await _open(db, user, now=NOW - timedelta(days=40))
    live, _ = await _open(db, user, now=NOW - timedelta(days=1))

    await _open(db, user)

    assert live.revoked_at is None
    assert expired.revoked_at is None


@pytest.mark.asyncio
async def test_create_drops_rows_that_ended_long_ago(db):
    user = await create_user(db)
    other = await create_user(db, email="other@example.com")
    long_revoked, _ = await _open(db, user, now=NOW - timedelta(days=50))
    sessions.revoke(long_revoked, sessions.REASON_BY_USER, NOW - timedelta(days=31))
    just_revoked, _ = await _open(db, user, now=NOW - timedelta(days=50))
    sessions.revoke(just_revoked, sessions.REASON_BY_USER, NOW - timedelta(days=30))
    long_idle, _ = await _open(db, user, now=NOW - timedelta(days=61))
    just_idle, _ = await _open(db, user, now=NOW - timedelta(days=60))
    theirs, _ = await _open(db, other, now=NOW - timedelta(days=50))
    sessions.revoke(theirs, sessions.REASON_BY_USER, NOW - timedelta(days=40))
    await db.flush()

    fresh, _ = await _open(db, user)

    left = set((await db.execute(select(McpSession.id))).scalars().all())
    assert left == {just_revoked.id, just_idle.id, theirs.id, fresh.id}


# ── Rotating ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_current_token_rotates_and_moves_the_idle_end(db):
    user = await create_user(db)
    session, token = await _open(db, user)
    later = NOW + timedelta(days=3)

    result = await sessions.rotate(db, token, later)

    assert result.status == "ok"
    assert result.session is session
    assert sessions.parse_refresh_token(result.refresh_token) == (session.id, 1)
    assert session.generation == 1
    assert session.rotated_at == later
    assert session.last_used_at == later
    assert session.idle_expires_at == later + timedelta(days=30)
    assert session.expires_at == NOW + timedelta(days=180)  # the absolute end never moves


@pytest.mark.asyncio
async def test_rotation_chains(db):
    user = await create_user(db)
    session, token = await _open(db, user)
    for generation in (1, 2, 3):
        result = await sessions.rotate(db, token, NOW + timedelta(hours=generation))
        token = result.refresh_token
        assert sessions.parse_refresh_token(token) == (session.id, generation)


@pytest.mark.asyncio
async def test_the_replaced_token_within_the_grace_gets_the_same_next_token(db):
    user = await create_user(db)
    session, token = await _open(db, user)
    first = await sessions.rotate(db, token, NOW)

    again = await sessions.rotate(db, token, NOW + timedelta(seconds=60))

    assert again.status == "ok"
    assert again.refresh_token == first.refresh_token
    assert session.generation == 1
    assert session.rotated_at == NOW  # nothing moved
    assert session.revoked_at is None


@pytest.mark.asyncio
async def test_the_replaced_token_after_the_grace_ends_the_connection(db):
    user = await create_user(db)
    session, token = await _open(db, user)
    await sessions.rotate(db, token, NOW)
    moment = NOW + timedelta(seconds=61)

    replay = await sessions.rotate(db, token, moment)

    assert replay.status == "replayed"
    assert replay.session is session
    assert replay.refresh_token is None
    assert session.revoked_at == moment
    assert session.revoked_reason == "replayed"


@pytest.mark.asyncio
async def test_a_token_two_generations_back_ends_the_connection_even_at_once(db):
    user = await create_user(db)
    session, token = await _open(db, user)
    second = (await sessions.rotate(db, token, NOW)).refresh_token
    await sessions.rotate(db, second, NOW)

    replay = await sessions.rotate(db, token, NOW)

    assert replay.status == "replayed"
    assert session.revoked_reason == "replayed"


@pytest.mark.asyncio
async def test_after_a_replay_the_current_token_is_dead_too(db):
    user = await create_user(db)
    session, token = await _open(db, user)
    current = (await sessions.rotate(db, token, NOW)).refresh_token
    await sessions.rotate(db, token, NOW + timedelta(hours=1))

    result = await sessions.rotate(db, current, NOW + timedelta(hours=2))

    assert result.status == "invalid"
    assert result.refresh_token is None
    assert session.generation == 1


@pytest.mark.asyncio
async def test_a_token_of_a_generation_never_issued_ends_the_connection(db):
    """Only a restored database can lag behind a signed token; whoever holds
    what the old copy calls current must not keep the connection."""
    user = await create_user(db)
    session, _ = await _open(db, user)
    ahead = sessions.mint_refresh_token(session.id, 5)

    result = await sessions.rotate(db, ahead, NOW)

    assert result.status == "replayed"
    assert session.revoked_at == NOW


@pytest.mark.asyncio
async def test_an_idle_connection_cannot_be_renewed(db):
    user = await create_user(db)
    session, token = await _open(db, user)

    result = await sessions.rotate(db, token, NOW + timedelta(days=30))

    assert result.status == "invalid"
    assert result.session is session
    assert session.generation == 0
    assert session.revoked_at is None


@pytest.mark.asyncio
async def test_a_used_connection_renews_past_the_first_idle_end(db):
    user = await create_user(db)
    session, token = await _open(db, user)
    token = (await sessions.rotate(db, token, NOW + timedelta(days=29))).refresh_token

    result = await sessions.rotate(db, token, NOW + timedelta(days=58))

    assert result.status == "ok"


@pytest.mark.asyncio
async def test_the_absolute_end_stops_a_connection_in_use(db, monkeypatch):
    monkeypatch.setattr(settings, "MCP_SESSION_MAX_DAYS", 40)
    user = await create_user(db)
    session, token = await _open(db, user)
    token = (await sessions.rotate(db, token, NOW + timedelta(days=29))).refresh_token

    result = await sessions.rotate(db, token, NOW + timedelta(days=40))

    assert result.status == "invalid"


@pytest.mark.asyncio
async def test_a_revoked_connection_cannot_be_renewed(db):
    user = await create_user(db)
    session, token = await _open(db, user)
    sessions.revoke(session, sessions.REASON_BY_USER, NOW)

    result = await sessions.rotate(db, token, NOW)

    assert result.status == "invalid"
    assert session.generation == 0
    assert session.revoked_reason == "revoked_by_user"


@pytest.mark.asyncio
async def test_a_token_for_a_connection_that_is_gone_is_invalid(db):
    result = await sessions.rotate(db, sessions.mint_refresh_token(uuid.uuid4(), 0), NOW)
    assert result.status == "invalid"
    assert result.session is None


@pytest.mark.asyncio
async def test_what_is_not_a_token_is_invalid_without_a_lookup(db):
    result = await sessions.rotate(db, "not-a-token", NOW)
    assert (result.status, result.session, result.refresh_token) == ("invalid", None, None)


@pytest.mark.asyncio
async def test_rotate_reads_the_clock_when_given_no_moment(db):
    user = await create_user(db)
    session, token = await sessions.create(db, user.id, client_name="Claude", scope="mcp:read")
    before = datetime.now(timezone.utc)

    result = await sessions.rotate(db, token)

    assert result.status == "ok"
    assert before <= session.rotated_at <= datetime.now(timezone.utc)


# ── A token bound to a connection ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_token_with_no_connection_claim_passes(db):
    assert await sessions.token_session_is_live(db, {"sub": str(uuid.uuid4())}) is True


@pytest.mark.asyncio
async def test_a_token_of_a_live_connection_passes_and_of_an_ended_one_does_not(db):
    user = await create_user(db)
    session, _ = await sessions.create(db, user.id, client_name="Claude", scope="mcp:read")
    payload = {"msid": str(session.id)}
    assert await sessions.token_session_is_live(db, payload) is True

    sessions.revoke(session, sessions.REASON_BY_ADMIN)

    assert await sessions.token_session_is_live(db, payload) is False


@pytest.mark.asyncio
@pytest.mark.parametrize("claimed", ["4aeca651-a8fd-4f2a-b3f6-29f0a0cb2f52", "not-a-uuid", 42, ""])
async def test_a_token_of_an_unknown_connection_does_not_pass(db, claimed):
    assert await sessions.token_session_is_live(db, {"msid": claimed}) is False
