"""MCP connections: the endpoints behind an AI tool's sign-in and its renewals.

Two callers. The **MCP server** creates a connection when a person signs in to
it and renews it when the AI tool presents its refresh token; both calls carry
the service token only this instance's MCP server can sign
(``verify_mcp_service_token``), so a refresh token is worth nothing presented
anywhere else. A **person** lists and ends their own connections; a holder of
``admin.mcp`` lists and ends everyone's.

The state and its rules are ``app/services/mcp_session_service.py``.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.auth import _session_block
from app.core.rate_limit import limiter
from app.core.security import create_access_token, verify_mcp_service_token
from app.database import get_db
from app.models.mcp_session import McpSession
from app.models.user import User
from app.services import audit_log
from app.services import mcp_session_service as sessions
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/auth/mcp/sessions", tags=["auth"])

SERVICE_HEADER = "X-Turbo-EA-Service"
DEFAULT_CLIENT_NAME = "MCP Client"
_TARGET_TYPE = "mcp_session"


class McpSessionCreate(BaseModel):
    client_name: str = Field(default=DEFAULT_CLIENT_NAME, max_length=200)
    scope: str = Field(default="mcp:read", max_length=200)


class McpSessionRefresh(BaseModel):
    refresh_token: str = Field(max_length=sessions.MAX_REFRESH_TOKEN_LENGTH)


class McpSessionTokens(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    refresh_token: str
    scope: str


def _require_mcp_server(request: Request) -> None:
    """Refuse a caller that is not this instance's MCP server."""
    if not verify_mcp_service_token(request.headers.get(SERVICE_HEADER, "")):
        raise HTTPException(status_code=401, detail="MCP service authentication required")


def _tokens(user: User, session: McpSession, refresh_token: str) -> McpSessionTokens:
    lifetime = timedelta(minutes=sessions.ACCESS_TOKEN_MINUTES)
    return McpSessionTokens(
        access_token=create_access_token(
            user.id, user.role, expires=lifetime, mcp_session_id=session.id
        ),
        expires_in=int(lifetime.total_seconds()),
        refresh_token=refresh_token,
        scope=session.scope,
    )


@router.post("", response_model=McpSessionTokens, status_code=201)
@limiter.limit("120/minute")
async def create_mcp_session(
    request: Request,
    body: McpSessionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Open a connection for the signed-in person. MCP server only."""
    _require_mcp_server(request)
    client_name = body.client_name.strip() or DEFAULT_CLIENT_NAME
    session, refresh_token = await sessions.create(
        db, user.id, client_name=client_name, scope=body.scope
    )
    await audit_log.record(
        db,
        action="auth.mcp.connected",
        category="auth",
        actor=user,
        target=(_TARGET_TYPE, str(session.id), client_name),
    )
    await db.commit()
    return _tokens(user, session, refresh_token)


@router.post("/refresh", response_model=McpSessionTokens)
@limiter.limit("600/minute")
async def refresh_mcp_session(
    request: Request,
    body: McpSessionRefresh,
    db: AsyncSession = Depends(get_db),
):
    """Renew a connection: a new access token and the next refresh token. MCP server only.

    400 ``invalid_grant`` for a token that is unknown, ended or expired, and for
    a replaced token that comes back, which also ends the connection and is
    recorded. 403 when the account may no longer hold a session, which also
    ends the connection and is recorded."""
    _require_mcp_server(request)
    result = await sessions.rotate(db, body.refresh_token)
    session = result.session
    if result.status == sessions.REPLAYED and session is not None:
        owner = await db.get(User, session.user_id)
        await audit_log.record(
            db,
            action="auth.mcp.replay_detected",
            category="auth",
            outcome="failure",
            subject_email=owner.email if owner is not None else None,
            target=(_TARGET_TYPE, str(session.id), session.client_name),
        )
        await db.commit()
    if result.status != sessions.OK or session is None or result.refresh_token is None:
        raise HTTPException(status_code=400, detail="invalid_grant")

    user = await db.get(User, session.user_id)
    if user is None:
        raise HTTPException(status_code=400, detail="invalid_grant")
    blocked = _session_block(user)
    if blocked is not None:
        # The connection ends with the account's right to a session, so enabling
        # the account again never brings back a connection made before.
        sessions.revoke(session, sessions.REASON_ACCOUNT_BLOCKED)
        await audit_log.record(
            db,
            action="auth.mcp.revoked",
            category="auth",
            subject_email=user.email,
            target=(_TARGET_TYPE, str(session.id), session.client_name),
            reason=blocked[0],
        )
        await db.commit()
        raise HTTPException(status_code=403, detail=blocked[1])
    await db.commit()
    return _tokens(user, session, result.refresh_token)


def _session_row(session: McpSession, owner: User | None = None) -> dict:
    row = {
        "id": str(session.id),
        "client_name": session.client_name,
        "created_at": session.created_at,
        "last_used_at": session.last_used_at,
        "expires_at": sessions.ends_at(session),
    }
    if owner is not None:
        # Least privilege: who it is, never the address or the role.
        row["user"] = {"id": str(owner.id), "display_name": owner.display_name}
    return row


@router.get("")
async def list_mcp_sessions(
    everyone: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Live connections: the caller's own, or with ``everyone=true`` and
    ``admin.mcp`` every person's, each then naming its person."""
    query = select(McpSession).where(McpSession.revoked_at.is_(None))
    if everyone:
        await PermissionService.require_permission(db, user, "admin.mcp")
    else:
        query = query.where(McpSession.user_id == user.id)
    rows = (
        (await db.execute(query.order_by(McpSession.last_used_at.desc(), McpSession.id)))
        .scalars()
        .all()
    )
    live = [row for row in rows if sessions.is_live(row)]
    if not everyone:
        return [_session_row(row) for row in live]
    owner_ids = {row.user_id for row in live}
    owners: dict[uuid.UUID, User] = {}
    if owner_ids:
        found = (await db.execute(select(User).where(User.id.in_(owner_ids)))).scalars().all()
        owners = {owner.id: owner for owner in found}
    return [_session_row(row, owners.get(row.user_id)) for row in live]


@router.delete("/{session_id}", status_code=204)
@limiter.limit("60/minute")
async def revoke_mcp_session(
    request: Request,
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """End a connection: one's own, or anyone's with ``admin.mcp``.

    Somebody else's connection is 404 without that permission, the same answer
    as one that does not exist."""
    session = (
        await db.execute(select(McpSession).where(McpSession.id == session_id).with_for_update())
    ).scalar_one_or_none()
    own = session is not None and session.user_id == user.id
    if session is None or not (
        own or await PermissionService.check_permission(db, user, "admin.mcp")
    ):
        raise HTTPException(status_code=404, detail="Connection not found")
    if session.revoked_at is None:
        owner = user if own else await db.get(User, session.user_id)
        sessions.revoke(session, sessions.REASON_BY_USER if own else sessions.REASON_BY_ADMIN)
        await audit_log.record(
            db,
            action="auth.mcp.revoked",
            category="auth",
            actor=user,
            subject_email=owner.email if owner is not None else None,
            target=(_TARGET_TYPE, str(session.id), session.client_name),
        )
        await db.commit()
    return Response(status_code=204)
