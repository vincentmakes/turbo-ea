"""Diagrams on a decision: live links to existing free-draw diagrams.

A link is one ``ArchitectureDecisionDiagram`` row. It is live: the decision
shows the diagram as it is now, and deleting the diagram (or the decision)
removes the link by database cascade. Links follow the decision's lock like
card links (``adr_service.EDITABLE_IN_REVIEW``): changeable in draft and in
review, fixed once signed — the routes check that before calling here.

Diagrams have no per-diagram visibility: the flat ``diagrams.view``
permission decides whether a reader sees any of them. A reader without it is
shown no diagram, so to them no link exists: adding or removing one is a 404,
and a link set they send can only be empty, which changes nothing (they were
shown none, so every existing link is one they never saw — the
``hidden_card_ids`` rule of card links).

Plain async functions: they flush and never commit (the caller owns the
transaction). Nothing here loads a diagram's XML.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any

from fastapi import HTTPException
from sqlalchemy import case, func, null, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.architecture_decision_diagram import ArchitectureDecisionDiagram
from app.models.diagram import Diagram
from app.models.user import User
from app.services.permission_service import PermissionService

#: A stored thumbnail longer than this (characters of its SVG / data URI) is
#: sent as ``None``: the client supplies it and its size is unbounded.
MAX_THUMBNAIL_CHARS = 256 * 1024

NOT_FOUND = "Diagram not found"


async def can_view_diagrams(db: AsyncSession, user: User) -> bool:
    """Whether ``user`` may see diagrams at all (``diagrams.view``)."""
    return await PermissionService.check_permission(db, user, "diagrams.view")


async def diagrams_payload(db: AsyncSession, decision_id: uuid.UUID) -> list[dict[str, Any]]:
    """The diagrams linked to ``decision_id``: ``[{id, name, thumbnail, updated_at}]``.

    Ordered by name, then id. Reads one JSON key of the diagram, never its
    XML; a thumbnail over :data:`MAX_THUMBNAIL_CHARS` comes back ``None``
    (decided in SQL, so it never leaves the database). Never the diagram's
    linked cards. The caller decides whether the reader may see diagrams.
    """
    thumbnail = Diagram.data["thumbnail"].astext
    rows = (
        await db.execute(
            select(
                Diagram.id,
                Diagram.name,
                case(
                    (func.length(thumbnail) > MAX_THUMBNAIL_CHARS, null()),
                    else_=thumbnail,
                ).label("thumbnail"),
                Diagram.updated_at,
            )
            # Joined on the link's one foreign key to ``diagrams``.
            .join(ArchitectureDecisionDiagram)
            .where(ArchitectureDecisionDiagram.architecture_decision_id == decision_id)
            .order_by(Diagram.name, Diagram.id)
        )
    ).all()
    return [
        {
            "id": str(row.id),
            "name": row.name,
            "thumbnail": row.thumbnail,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
        for row in rows
    ]


async def diagrams_for_reader(
    db: AsyncSession, user: User, decision_id: uuid.UUID
) -> list[dict[str, Any]]:
    """:func:`diagrams_payload` for ``user``: ``[]`` without ``diagrams.view``."""
    if not await can_view_diagrams(db, user):
        return []
    return await diagrams_payload(db, decision_id)


def _parse(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError:
        raise HTTPException(404, NOT_FOUND) from None


async def resolve_diagram_ids(
    db: AsyncSession, user: User, values: Iterable[str] | None
) -> list[uuid.UUID] | None:
    """The diagram ids a write asks for, checked; ``None`` when ``values`` is.

    Without ``diagrams.view``, a non-empty list is a 404 and an empty one
    resolves to ``None`` (nothing to change: the caller was shown no link).
    With it, a malformed or unknown id is a 404. Duplicates collapse, in
    first-seen order.
    """
    if values is None:
        return None
    wanted = list(values)
    if not await can_view_diagrams(db, user):
        if wanted:
            raise HTTPException(404, NOT_FOUND)
        return None
    parsed = list(dict.fromkeys(_parse(v) for v in wanted))
    if parsed:
        found = set(
            (await db.execute(select(Diagram.id).where(Diagram.id.in_(parsed)))).scalars().all()
        )
        if any(did not in found for did in parsed):
            raise HTTPException(404, NOT_FOUND)
    return parsed


async def resolve_one(db: AsyncSession, user: User, value: str) -> uuid.UUID:
    """One diagram id a route names: 404 unless the caller holds
    ``diagrams.view`` and the id names an existing diagram."""
    if not await can_view_diagrams(db, user):
        raise HTTPException(404, NOT_FOUND)
    diagram_id = _parse(value)
    found = (
        await db.execute(select(Diagram.id).where(Diagram.id == diagram_id))
    ).scalar_one_or_none()
    if found is None:
        raise HTTPException(404, NOT_FOUND)
    return diagram_id


async def linked_ids(db: AsyncSession, decision_id: uuid.UUID) -> list[uuid.UUID]:
    """The ids of the diagrams linked to ``decision_id``, sorted."""
    return list(
        (
            await db.execute(
                select(ArchitectureDecisionDiagram.diagram_id)
                .where(ArchitectureDecisionDiagram.architecture_decision_id == decision_id)
                .order_by(ArchitectureDecisionDiagram.diagram_id)
            )
        )
        .scalars()
        .all()
    )


async def add_link(db: AsyncSession, decision_id: uuid.UUID, diagram_id: uuid.UUID) -> None:
    """Link ``diagram_id`` to the decision; 409 when it already is. Flush."""
    if diagram_id in await linked_ids(db, decision_id):
        raise HTTPException(409, "The diagram is already linked to this decision")
    db.add(ArchitectureDecisionDiagram(architecture_decision_id=decision_id, diagram_id=diagram_id))
    await db.flush()


async def remove_link(db: AsyncSession, decision_id: uuid.UUID, diagram_id: uuid.UUID) -> None:
    """Unlink ``diagram_id`` from the decision; 404 when it is not linked. Flush."""
    link = (
        await db.execute(
            select(ArchitectureDecisionDiagram).where(
                ArchitectureDecisionDiagram.architecture_decision_id == decision_id,
                ArchitectureDecisionDiagram.diagram_id == diagram_id,
            )
        )
    ).scalar_one_or_none()
    if link is None:
        raise HTTPException(404, "Link not found")
    await db.delete(link)
    await db.flush()


async def replace_links(
    db: AsyncSession, decision_id: uuid.UUID, desired: Iterable[uuid.UUID] | None
) -> None:
    """Make the decision's links exactly ``desired``; ``None`` changes nothing. Flush.

    ``desired`` comes from :func:`resolve_diagram_ids`, which returns ``None``
    for a caller who may not see diagrams, so their links are never touched.
    """
    if desired is None:
        return
    wanted = set(desired)
    existing = (
        (
            await db.execute(
                select(ArchitectureDecisionDiagram).where(
                    ArchitectureDecisionDiagram.architecture_decision_id == decision_id
                )
            )
        )
        .scalars()
        .all()
    )
    have = {link.diagram_id for link in existing}
    for link in existing:
        if link.diagram_id not in wanted:
            await db.delete(link)
    for diagram_id in sorted(wanted - have):
        db.add(
            ArchitectureDecisionDiagram(architecture_decision_id=decision_id, diagram_id=diagram_id)
        )
    await db.flush()


async def copy_links(db: AsyncSession, source_id: uuid.UUID, new_id: uuid.UUID) -> int:
    """Link ``new_id`` to every diagram ``source_id`` is linked to; flush. Returns the count."""
    diagram_ids = await linked_ids(db, source_id)
    for diagram_id in diagram_ids:
        db.add(ArchitectureDecisionDiagram(architecture_decision_id=new_id, diagram_id=diagram_id))
    await db.flush()
    return len(diagram_ids)
