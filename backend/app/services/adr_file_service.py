"""Files on a decision: the pointer rows, the shared bytes and their cleanup.

A decision's file is two rows: an ``ArchitectureDecisionFile`` (name, type,
size, who added it) owned by the decision, and the
``ArchitectureDecisionFileContent`` holding the bytes. A revision or a
duplicate copies the pointer rows (``adr_service.copy_file_pointers``), so
several decisions can share one content row; the content goes only when the
last pointer to it does. The content FK is ``RESTRICT``, so nothing cascades
from one decision into the bytes another still shows.

Plain async functions: they flush and never commit (the caller owns the
transaction). Nothing here loads the bytes except :func:`load_for_download`.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_file import (
    ArchitectureDecisionFile,
    ArchitectureDecisionFileContent,
)
from app.models.user import User


def file_row(f: ArchitectureDecisionFile, creator_name: str | None) -> dict[str, Any]:
    """One file on the wire: ``{id, name, mime_type, size, created_at, created_by}``.

    ``created_by`` is ``{user_id, display_name}``, or ``None`` once nobody is
    recorded (the user was deleted, or a workspace import could not match them).
    """
    return {
        "id": str(f.id),
        "name": f.name,
        "mime_type": f.mime_type,
        "size": f.size,
        "created_at": f.created_at.isoformat() if f.created_at else None,
        "created_by": (
            {"user_id": str(f.created_by), "display_name": creator_name}
            if f.created_by is not None
            else None
        ),
    }


async def add_file(
    db: AsyncSession,
    decision: ArchitectureDecision,
    *,
    name: str,
    mime_type: str,
    data: bytes,
    created_by: uuid.UUID | None,
) -> ArchitectureDecisionFile:
    """Store ``data`` as a new file on ``decision``: one content row, one file row; flush."""
    content = ArchitectureDecisionFileContent(size=len(data), data=data)
    db.add(content)
    await db.flush()
    f = ArchitectureDecisionFile(
        architecture_decision_id=decision.id,
        content_id=content.id,
        name=name,
        mime_type=mime_type,
        size=len(data),
        created_by=created_by,
    )
    db.add(f)
    await db.flush()
    await db.refresh(f)
    return f


async def files_payload(
    db: AsyncSession, decision_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[dict[str, Any]]]:
    """The files of each decision in ``decision_ids``, oldest first, in one query.

    Every id is a key, with ``[]`` when it has no file. The bytes are never
    selected: the query reads the pointer table and the creator's name only.
    """
    out: dict[uuid.UUID, list[dict[str, Any]]] = {did: [] for did in decision_ids}
    if not out:
        return out
    rows = await db.execute(
        select(ArchitectureDecisionFile, User.display_name)
        .outerjoin(User, User.id == ArchitectureDecisionFile.created_by)
        .where(ArchitectureDecisionFile.architecture_decision_id.in_(list(out)))
        .order_by(ArchitectureDecisionFile.created_at, ArchitectureDecisionFile.id)
    )
    for f, creator_name in rows.all():
        out[f.architecture_decision_id].append(file_row(f, creator_name))
    return out


async def list_files(db: AsyncSession, decision_id: uuid.UUID) -> list[dict[str, Any]]:
    """The files of one decision, oldest first, without their bytes."""
    return (await files_payload(db, [decision_id]))[decision_id]


async def get_file(
    db: AsyncSession, decision_id: uuid.UUID, file_id: uuid.UUID
) -> ArchitectureDecisionFile | None:
    """The file ``file_id`` when it belongs to ``decision_id``, else ``None``."""
    return (
        await db.execute(
            select(ArchitectureDecisionFile).where(
                ArchitectureDecisionFile.id == file_id,
                ArchitectureDecisionFile.architecture_decision_id == decision_id,
            )
        )
    ).scalar_one_or_none()


@dataclass(frozen=True)
class Download:
    """A file and its bytes, ready to send."""

    name: str
    mime_type: str
    data: bytes


async def load_for_download(
    db: AsyncSession, decision_id: uuid.UUID, file_id: uuid.UUID
) -> Download | None:
    """The file ``file_id`` of ``decision_id`` with its bytes, or ``None``."""
    f = await get_file(db, decision_id, file_id)
    if f is None:
        return None
    content = (
        await db.execute(
            select(ArchitectureDecisionFileContent)
            .options(undefer(ArchitectureDecisionFileContent.data))
            .where(ArchitectureDecisionFileContent.id == f.content_id)
        )
    ).scalar_one()
    return Download(name=f.name, mime_type=f.mime_type, data=content.data)


async def delete_orphan_contents(
    db: AsyncSession, content_ids: Iterable[uuid.UUID] | None = None
) -> int:
    """Delete the contents no file row points at any more; flush. Returns the count.

    ``content_ids`` limits the sweep to those candidates (the contents a
    deleted file or decision held); ``None`` sweeps the whole table.
    """
    candidates = None if content_ids is None else set(content_ids)
    if candidates is not None and not candidates:
        return 0
    content = ArchitectureDecisionFileContent
    stmt = select(content.id).where(
        ~exists().where(ArchitectureDecisionFile.content_id == content.id)
    )
    if candidates is not None:
        stmt = stmt.where(content.id.in_(candidates))
    orphans = list((await db.execute(stmt)).scalars().all())
    if orphans:
        await db.execute(delete(content).where(content.id.in_(orphans)))
        await db.flush()
    return len(orphans)


async def remove_file(db: AsyncSession, decision_id: uuid.UUID, file_id: uuid.UUID) -> bool:
    """Delete one file of ``decision_id``, and its bytes when no other decision
    shares them; flush. ``False`` when the file is not on that decision."""
    f = await get_file(db, decision_id, file_id)
    if f is None:
        return False
    content_id = f.content_id
    await db.delete(f)
    await db.flush()
    await delete_orphan_contents(db, [content_id])
    return True


async def content_ids_of(db: AsyncSession, decision_id: uuid.UUID) -> list[uuid.UUID]:
    """The content rows the files of ``decision_id`` point at."""
    return list(
        (
            await db.execute(
                select(ArchitectureDecisionFile.content_id)
                .where(ArchitectureDecisionFile.architecture_decision_id == decision_id)
                .distinct()
            )
        )
        .scalars()
        .all()
    )
