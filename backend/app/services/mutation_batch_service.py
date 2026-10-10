"""Mutation-batch lifecycle helpers.

A mutation batch is the audit handle every MCP write tool opens before
it performs writes. The id flows through:

1. ``POST /mutation-batches`` opens the batch (records actor + tool +
   origin) and returns ``batch_id``.
2. The MCP wrapper sets ``request_batch_id`` on the contextvar so every
   ``event_bus.publish`` call during the subsequent backend write
   stamps the same id onto its event row.
3. ``POST /mutation-batches/{id}/commit`` closes the batch with a
   per-row summary (status, error if any).

Dry-run batches above the per-call confirmation threshold (S3) are
issued a ``confirm_token`` here; the matching commit call must echo it
back. The token has a 15-minute TTL — older tokens are rejected so a
stale dry-run preview cannot be replayed unattended hours later.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.mutation_batch import MutationBatch
from app.models.user import User

CONFIRM_TOKEN_TTL = timedelta(minutes=15)


async def create_batch(
    db: AsyncSession,
    tool_name: str,
    actor: User | None,
    origin: str,
    dry_run: bool = False,
    confirm_token: str | None = None,
) -> MutationBatch:
    """Open a new batch row. The caller is responsible for setting
    ``request_batch_id`` on the contextvar so subsequent ``publish``
    calls in the same request stamp the id."""
    batch = MutationBatch(
        tool_name=tool_name,
        actor_user_id=actor.id if actor else None,
        origin=origin,
        dry_run=dry_run,
        confirm_token=confirm_token,
    )
    db.add(batch)
    await db.flush()
    return batch


def issue_confirm_token() -> str:
    """Short, URL-safe token bound to a dry-run batch. The matching
    commit call must echo this back. 15-minute TTL enforced in
    :func:`verify_confirm_token`."""
    return secrets.token_urlsafe(24)


async def commit_batch(
    db: AsyncSession,
    batch: MutationBatch,
    summary: dict[str, Any] | None = None,
) -> MutationBatch:
    batch.committed_at = datetime.now(timezone.utc)
    if summary is not None:
        batch.summary = summary
    await db.flush()
    return batch


async def get_batch(db: AsyncSession, batch_id: uuid.UUID) -> MutationBatch | None:
    res = await db.execute(select(MutationBatch).where(MutationBatch.id == batch_id))
    return res.scalar_one_or_none()


def verify_confirm_token(batch: MutationBatch, token: str) -> bool:
    """Return ``True`` iff the batch carries a matching, non-expired
    confirm token. The TTL is anchored on ``created_at`` so a long-lived
    dry-run preview cannot be replayed indefinitely."""
    if not batch.confirm_token or not token:
        return False
    if not secrets.compare_digest(batch.confirm_token, token):
        return False
    age = datetime.now(timezone.utc) - batch.created_at
    if age > CONFIRM_TOKEN_TTL:
        return False
    return True


def batch_to_dict(batch: MutationBatch, actor_display_name: str | None = None) -> dict[str, Any]:
    return {
        "id": batch.id,
        "tool_name": batch.tool_name,
        "actor_user_id": batch.actor_user_id,
        "actor_display_name": actor_display_name,
        "origin": batch.origin,
        "dry_run": batch.dry_run,
        # Only surface the token before commit; once committed it's spent
        # and noise. Same goes for read endpoints aimed at history (S6).
        "confirm_token": batch.confirm_token if batch.committed_at is None else None,
        "summary": batch.summary,
        "created_at": batch.created_at,
        "committed_at": batch.committed_at,
    }
