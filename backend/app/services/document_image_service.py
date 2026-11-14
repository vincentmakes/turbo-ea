"""The store behind pictures in decision and SoAW text.

A picture is uploaded once (``POST /document-images/{kind}``) into an
immutable ``document_images`` row and referenced from the text by its route
(:mod:`app.services.document_image_markup`). Nothing here knows which
document holds a picture: revisions, duplicates, history versions and
restores share the row.

* :func:`store` — a new row (flushed, never committed);
* :func:`load` — a row with its bytes, by kind and id (``None`` otherwise);
* :func:`existing` — which of some ids are pictures of a kind (the save-time
  check of pictures new to a document);
* :func:`mark_used` — stamp ``used_at`` on the pictures a save stores;
* :func:`purge_unused_once` — delete the pictures no save ever stored, once
  they are older than :data:`UNUSED_GRACE` (an editor left open overnight
  still saves its pictures).

Every helper flushes at most and never commits: the caller owns the
transaction.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.models.document_image import DocumentImage
from app.services.document_image_markup import KINDS

#: How long an uploaded picture may wait for a save before it is purged.
UNUSED_GRACE = timedelta(days=7)


def _check_kind(kind: str) -> None:
    if kind not in KINDS:
        raise ValueError(f"Unknown document kind {kind!r}")


def _uuids(ids: Iterable[object]) -> set[uuid.UUID]:
    """The well-formed UUIDs among ``ids`` (strings or UUIDs); others are skipped."""
    out: set[uuid.UUID] = set()
    for value in ids:
        try:
            out.add(value if isinstance(value, uuid.UUID) else uuid.UUID(str(value)))
        except ValueError:
            continue
    return out


async def store(
    db: AsyncSession,
    kind: str,
    data: bytes,
    *,
    mime_type: str,
    created_by: uuid.UUID | None,
) -> DocumentImage:
    """A new picture of ``kind`` holding ``data`` (already validated); flushed."""
    _check_kind(kind)
    row = DocumentImage(
        kind=kind,
        mime_type=mime_type,
        size=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        data=data,
        created_by=created_by,
    )
    db.add(row)
    await db.flush()
    return row


async def load(db: AsyncSession, kind: str, image_id: object) -> DocumentImage | None:
    """The picture ``image_id`` of ``kind`` with its bytes, or ``None`` — for
    an unknown id, a malformed one and another kind's picture alike."""
    _check_kind(kind)
    wanted = _uuids([image_id])
    if not wanted:
        return None
    result = await db.execute(
        select(DocumentImage)
        .options(undefer(DocumentImage.data))
        .where(DocumentImage.id.in_(wanted), DocumentImage.kind == kind)
    )
    return result.scalar_one_or_none()


async def existing(db: AsyncSession, kind: str, ids: Iterable[object]) -> set[str]:
    """The ids (lower-case strings) among ``ids`` that are pictures of ``kind``.
    No query when there is nothing to look up."""
    _check_kind(kind)
    wanted = _uuids(ids)
    if not wanted:
        return set()
    rows = await db.execute(
        select(DocumentImage.id).where(DocumentImage.id.in_(wanted), DocumentImage.kind == kind)
    )
    return {str(found) for found in rows.scalars().all()}


async def mark_used(db: AsyncSession, ids: Iterable[object], *, now: datetime | None = None) -> int:
    """Stamp ``used_at`` on each of ``ids`` not stamped yet; the number stamped.
    No query when there is nothing to stamp."""
    wanted = _uuids(ids)
    if not wanted:
        return 0
    result = await db.execute(
        update(DocumentImage)
        .where(DocumentImage.id.in_(wanted), DocumentImage.used_at.is_(None))
        .values(used_at=now or datetime.now(timezone.utc))
        .execution_options(synchronize_session=False)
    )
    return int(getattr(result, "rowcount", 0) or 0)


async def purge_unused_once(db: AsyncSession, *, now: datetime | None = None) -> int:
    """Delete the pictures no save ever stored (``used_at`` unset) uploaded
    more than :data:`UNUSED_GRACE` before ``now``; the number deleted. Never
    commits: the caller does."""
    cutoff = (now or datetime.now(timezone.utc)) - UNUSED_GRACE
    result = await db.execute(
        delete(DocumentImage)
        .where(DocumentImage.used_at.is_(None), DocumentImage.created_at < cutoff)
        .execution_options(synchronize_session=False)
    )
    return int(getattr(result, "rowcount", 0) or 0)
