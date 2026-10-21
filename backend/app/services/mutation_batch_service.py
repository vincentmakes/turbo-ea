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
issued a ``confirm_token`` when they are opened, and they are closed like
any other batch. The token authorises the *next* real (non-dry-run) open
of the same tool by the same actor: ``POST /mutation-batches`` refuses a
real batch above the threshold unless its ``confirm_token`` names a
dry-run batch that is the caller's own, was opened by the same tool, is
younger than 15 minutes and has not authorised a commit already.
:func:`resolve_confirm_token` is that rule. Single use is recorded on the
issuing dry-run row (``summary["confirmed_batch_id"]``); the real batch
stores the token it was opened with in its own ``confirm_token`` column as
the audit cross-reference ("authorised by this preview").
"""

from __future__ import annotations

import secrets
import uuid
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.mutation_batch import MutationBatch
from app.models.user import User

CONFIRM_TOKEN_TTL = timedelta(minutes=15)

# Above this row count a dry-run batch is issued a confirm token, and a
# real batch must present one. Mirrors the MCP-side
# ``MCP_BATCH_CONFIRMATION_THRESHOLD`` (default 20): the backend value is a
# floor, so the MCP setting can only tighten it.
CONFIRM_TOKEN_THRESHOLD = 20

# Key stamped onto the issuing dry-run batch's summary once its token has
# authorised a real batch. Its presence is what makes the token single-use.
CONFIRMED_BATCH_KEY = "confirmed_batch_id"


def needs_confirmation(dry_run: bool, row_count: int) -> bool:
    """A real (non-dry-run) batch above the threshold must present a token."""
    return not dry_run and row_count > CONFIRM_TOKEN_THRESHOLD


def issues_token(dry_run: bool, row_count: int) -> bool:
    """A dry-run batch above the threshold is issued a token."""
    return dry_run and row_count > CONFIRM_TOKEN_THRESHOLD


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


def close_summary(
    existing: dict[str, Any] | None, incoming: dict[str, Any] | None
) -> dict[str, Any] | None:
    """The summary a batch keeps when it is closed. The caller's summary
    replaces the stored one, except that a single-use stamp survives — a
    preview closed after its token was spent must not become reusable."""
    if incoming is None:
        return existing
    if existing and CONFIRMED_BATCH_KEY in existing:
        return {**incoming, CONFIRMED_BATCH_KEY: existing[CONFIRMED_BATCH_KEY]}
    return incoming


async def commit_batch(
    db: AsyncSession,
    batch: MutationBatch,
    summary: dict[str, Any] | None = None,
) -> MutationBatch:
    batch.committed_at = datetime.now(timezone.utc)
    batch.summary = close_summary(batch.summary, summary)
    await db.flush()
    return batch


async def get_batch(db: AsyncSession, batch_id: uuid.UUID) -> MutationBatch | None:
    res = await db.execute(select(MutationBatch).where(MutationBatch.id == batch_id))
    return res.scalar_one_or_none()


def verify_confirm_token(batch: MutationBatch, token: str, *, now: datetime | None = None) -> bool:
    """Return ``True`` iff the batch carries a matching, non-expired
    confirm token. The TTL is anchored on ``created_at`` so a long-lived
    dry-run preview cannot be replayed indefinitely."""
    if not batch.confirm_token or not token:
        return False
    if not secrets.compare_digest(batch.confirm_token, token):
        return False
    age = (now or datetime.now(timezone.utc)) - batch.created_at
    if age > CONFIRM_TOKEN_TTL:
        return False
    return True


def resolve_confirm_token(
    candidates: Sequence[MutationBatch],
    token: str,
    *,
    actor_id: uuid.UUID | None,
    tool_name: str,
    now: datetime | None = None,
) -> tuple[MutationBatch | None, str | None]:
    """Find the dry-run batch that authorises a real batch to open.

    ``candidates`` are every batch whose ``confirm_token`` equals ``token``
    (the issuing dry-run and any real batch it already authorised). Returns
    ``(dry_run_batch, None)`` when the token is valid for this actor and
    tool, else ``(None, reason)`` — ``missing``, ``unknown``,
    ``already_used``, ``wrong_actor``, ``wrong_tool`` or ``expired``, checked
    in that order.
    """
    if not token:
        return None, "missing"
    issuing = next((c for c in candidates if c.dry_run), None)
    if issuing is None:
        return None, "unknown"
    if CONFIRMED_BATCH_KEY in (issuing.summary or {}):
        return None, "already_used"
    if issuing.actor_user_id != actor_id:
        return None, "wrong_actor"
    if issuing.tool_name != tool_name:
        return None, "wrong_tool"
    if not verify_confirm_token(issuing, token, now=now):
        return None, "expired"
    return issuing, None


def mark_token_used(issuing: MutationBatch, confirmed_batch_id: uuid.UUID) -> None:
    """Stamp the issuing dry-run batch so its token cannot authorise a
    second commit. Assigns a new dict so SQLAlchemy sees the JSONB change."""
    issuing.summary = {**(issuing.summary or {}), CONFIRMED_BATCH_KEY: str(confirmed_batch_id)}


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
