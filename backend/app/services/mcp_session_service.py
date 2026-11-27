"""MCP connections: the durable record behind an AI tool's refresh token.

The MCP server is the OAuth face an AI tool talks to, and it holds no database.
This module is the state it relies on (issue #1449): one ``mcp_sessions`` row
per connection, so a connection survives a restart of the MCP server, renews
itself while it is used, and can be ended.

**The refresh token is rotated on every use, and a replayed one ends the
connection** (RFC 9700 §4.14.2, for public clients). The row is the whole token
family: ``generation`` counts the rotations, and the token for a generation is
``tea1r.<session id>.<generation>.<HMAC>``, signed with a key derived from
SECRET_KEY. So the database holds no token and no hash of one, and a leaked
database yields nothing that can be presented.

- The current generation rotates: the caller gets the next one.
- The generation just before it, presented within ``ROTATION_GRACE_SECONDS`` of
  the rotation, gets that same next token again and changes nothing. A response
  lost on the network and two workers refreshing at once both look like this.
- Anything older is a token somebody kept after it was replaced: the connection
  is revoked, for the thief and the owner alike, and the caller records it.

**Two ends.** ``idle_expires_at`` moves forward on every rotation
(``MCP_SESSION_IDLE_DAYS``); ``expires_at`` is fixed when the connection is
made (``MCP_SESSION_MAX_DAYS``, none when 0).

Nothing here commits: the route that calls it owns the transaction.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import derive_key
from app.models.mcp_session import McpSession

REFRESH_PREFIX = "tea1r."
REFRESH_KEY_CONTEXT = b"turbo-ea/mcp-refresh-token/v1"
# Longest refresh token this module mints, with room to spare: prefix, 32 hex
# characters, a generation, a 43-character signature and two dots.
MAX_REFRESH_TOKEN_LENGTH = 200

# How long a Turbo EA token minted for a connection lives. The AI tool's access
# token is this token sealed by the MCP server, so it is also how long the tool
# goes between two renewals.
ACCESS_TOKEN_MINUTES = 60
# See the module docstring: the window in which the previous token is answered
# with the token that replaced it.
ROTATION_GRACE_SECONDS = 60
# Live connections one person may hold. One more ends the one unused longest.
MAX_LIVE_SESSIONS_PER_USER = 25
# How long an ended connection's row is kept, for whoever reads the log entry
# that names it.
ENDED_RETENTION_DAYS = 30

REASON_REPLAYED = "replayed"
REASON_BY_USER = "revoked_by_user"
REASON_BY_ADMIN = "revoked_by_admin"
REASON_TOO_MANY = "too_many_connections"
REASON_ACCOUNT_BLOCKED = "account_blocked"

OK = "ok"
INVALID = "invalid"
REPLAYED = "replayed"


@dataclass
class RotateResult:
    """What a presented refresh token led to.

    ``status`` is ``OK`` (``refresh_token`` is the one to hand back),
    ``INVALID`` (unknown, forged, ended or expired: nothing changed) or
    ``REPLAYED`` (a replaced token came back: ``session`` is now revoked)."""

    status: str
    session: McpSession | None = None
    refresh_token: str | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _signature(body: str) -> str:
    digest = hmac.new(derive_key(REFRESH_KEY_CONTEXT), body.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def mint_refresh_token(session_id: uuid.UUID, generation: int) -> str:
    """The refresh token of one generation of one connection."""
    body = f"{session_id.hex}.{generation}"
    return f"{REFRESH_PREFIX}{body}.{_signature(body)}"


def parse_refresh_token(token: object) -> tuple[uuid.UUID, int] | None:
    """The ``(session id, generation)`` a refresh token names, or ``None`` for
    anything this instance did not sign."""
    if not isinstance(token, str) or len(token) > MAX_REFRESH_TOKEN_LENGTH:
        return None
    if not token.startswith(REFRESH_PREFIX):
        return None
    body, _, signature = token[len(REFRESH_PREFIX) :].rpartition(".")
    if not hmac.compare_digest(_signature(body).encode(), signature.encode()):
        return None
    # Signed here, so the shape below is the one ``mint_refresh_token`` wrote.
    session_hex, _, generation = body.partition(".")
    return uuid.UUID(hex=session_hex), int(generation)


def is_live(session: McpSession, now: datetime | None = None) -> bool:
    """Whether the connection can still be used: not revoked, and before both ends."""
    moment = now or _now()
    if session.revoked_at is not None:
        return False
    if session.idle_expires_at <= moment:
        return False
    return session.expires_at is None or session.expires_at > moment


def ends_at(session: McpSession) -> datetime:
    """When the connection ends if it is never used again."""
    if session.expires_at is None:
        return session.idle_expires_at
    return min(session.idle_expires_at, session.expires_at)


def revoke(session: McpSession, reason: str, now: datetime | None = None) -> None:
    """End a connection. A connection already ended keeps its first reason."""
    if session.revoked_at is None:
        session.revoked_at = now or _now()
        session.revoked_reason = reason


def _idle_end(now: datetime) -> datetime:
    return now + timedelta(days=settings.MCP_SESSION_IDLE_DAYS)


async def _make_room(db: AsyncSession, user_id: uuid.UUID, now: datetime) -> None:
    """Drop the rows of connections that ended long ago, and end the connections
    unused longest once the person holds ``MAX_LIVE_SESSIONS_PER_USER``."""
    await db.execute(
        delete(McpSession).where(
            McpSession.user_id == user_id,
            McpSession.revoked_at < now - timedelta(days=ENDED_RETENTION_DAYS),
        )
    )
    await db.execute(
        delete(McpSession).where(
            McpSession.user_id == user_id,
            McpSession.idle_expires_at < now - timedelta(days=ENDED_RETENTION_DAYS),
        )
    )
    rows = (
        (
            await db.execute(
                select(McpSession)
                .where(McpSession.user_id == user_id, McpSession.revoked_at.is_(None))
                .order_by(McpSession.last_used_at.desc(), McpSession.id)
            )
        )
        .scalars()
        .all()
    )
    live = [row for row in rows if is_live(row, now)]
    for row in live[MAX_LIVE_SESSIONS_PER_USER - 1 :]:
        revoke(row, REASON_TOO_MANY, now)


async def create(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    client_name: str,
    scope: str,
    now: datetime | None = None,
) -> tuple[McpSession, str]:
    """Record a new connection for ``user_id``; returns it with its first refresh token."""
    moment = now or _now()
    await _make_room(db, user_id, moment)
    max_days = settings.MCP_SESSION_MAX_DAYS
    session = McpSession(
        id=uuid.uuid4(),
        user_id=user_id,
        client_name=client_name,
        scope=scope,
        generation=0,
        created_at=moment,
        last_used_at=moment,
        idle_expires_at=_idle_end(moment),
        expires_at=moment + timedelta(days=max_days) if max_days > 0 else None,
    )
    db.add(session)
    await db.flush()
    return session, mint_refresh_token(session.id, 0)


async def rotate(db: AsyncSession, token: object, now: datetime | None = None) -> RotateResult:
    """Answer a presented refresh token (see the module docstring).

    The row is locked for the length of the caller's transaction, so two
    requests presenting the same token are answered one after the other."""
    named = parse_refresh_token(token)
    if named is None:
        return RotateResult(INVALID)
    session_id, generation = named
    session = (
        await db.execute(select(McpSession).where(McpSession.id == session_id).with_for_update())
    ).scalar_one_or_none()
    moment = now or _now()
    if session is None or not is_live(session, moment):
        return RotateResult(INVALID, session)

    if generation == session.generation:
        session.generation = generation + 1
        session.rotated_at = moment
        session.last_used_at = moment
        session.idle_expires_at = _idle_end(moment)
        return RotateResult(OK, session, mint_refresh_token(session.id, session.generation))

    just_replaced = (
        generation == session.generation - 1
        and session.rotated_at is not None
        and moment - session.rotated_at <= timedelta(seconds=ROTATION_GRACE_SECONDS)
    )
    if just_replaced:
        return RotateResult(OK, session, mint_refresh_token(session.id, session.generation))

    revoke(session, REASON_REPLAYED, moment)
    return RotateResult(REPLAYED, session)


async def token_session_is_live(db: AsyncSession, payload: dict) -> bool:
    """Whether a decoded user token may still be used, as far as MCP goes.

    A token minted for an MCP connection carries that connection's id
    (``msid``) and is good only while the connection is live; any other token
    is not this module's business and passes."""
    claimed = payload.get("msid")
    if claimed is None:
        return True
    try:
        session_id = uuid.UUID(str(claimed))
    except ValueError:
        return False
    session = await db.get(McpSession, session_id)
    return session is not None and is_live(session)
