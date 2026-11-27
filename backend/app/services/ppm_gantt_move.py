"""Saving a row dragged in the PPM Gantt task list.

A drop gives a row a parent work package (or none) and a place among the
siblings of its own kind: work packages and tasks keep separate orders, and
under any parent the work packages are drawn above the tasks.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import TypeVar

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ppm_task import PpmTask
from app.models.ppm_wbs import PpmWbs
from app.schemas.ppm import PpmGanttMove

Row = TypeVar("Row", PpmTask, PpmWbs)


async def assert_no_wbs_cycle(db: AsyncSession, wbs_id: str, new_parent_id: str) -> None:
    """400 when ``new_parent_id`` is ``wbs_id`` itself or one of its descendants."""
    cursor: str | None = str(new_parent_id)
    while cursor:
        if cursor == str(wbs_id):
            raise HTTPException(status_code=400, detail="Circular parent reference detected")
        anc = await db.execute(select(PpmWbs.parent_id).where(PpmWbs.id == cursor))
        row = anc.first()
        cursor = str(row[0]) if row and row[0] else None


def place_in_order(siblings: Sequence[Row], item: Row, position: int) -> list[Row]:
    """``item`` inserted at ``position`` among ``siblings`` (a position past the
    end appends), and every row's ``sort_order`` rewritten to its index.

    The whole group is renumbered because rows created without an explicit
    order all share ``sort_order = 0``, so a single new value could not place
    the item between two of them.
    """
    ordered = [row for row in siblings if row.id != item.id]
    ordered.insert(min(position, len(ordered)), item)
    for index, row in enumerate(ordered):
        row.sort_order = index
    return ordered


async def next_sort_order(
    db: AsyncSession,
    kind: str,
    initiative_id: uuid.UUID | str,
    parent_id: uuid.UUID | str | None,
) -> int:
    """The ``sort_order`` that puts a row last among its same-kind siblings.

    A row created (or moved under a new parent by a dialog) without an
    explicit order goes here. Once a drag has renumbered a group ``0..n-1``,
    the old default of 0 would slot a new row in second place.
    """
    if kind == "task":
        column, parent_col, initiative_col = (
            PpmTask.sort_order,
            PpmTask.wbs_id,
            PpmTask.initiative_id,
        )
    else:
        column, parent_col, initiative_col = (
            PpmWbs.sort_order,
            PpmWbs.parent_id,
            PpmWbs.initiative_id,
        )
    same_parent = parent_col.is_(None) if parent_id is None else parent_col == parent_id
    result = await db.execute(
        select(func.max(column)).where(initiative_col == initiative_id, same_parent)
    )
    highest = result.scalar_one_or_none()
    return 0 if highest is None else highest + 1


def parse_uuid(value: uuid.UUID | str) -> uuid.UUID | None:
    """``value`` as a UUID, or ``None`` when it is not one.

    The PPM schemas type their ids as plain strings, so a malformed id would
    otherwise reach the database and come back as a 500.
    """
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


async def wbs_of_initiative(
    db: AsyncSession,
    initiative_id: uuid.UUID | str,
    wbs_id: uuid.UUID | str,
    *,
    detail: str,
) -> PpmWbs:
    """The work package ``wbs_id`` when it belongs to ``initiative_id``.

    400 with ``detail`` when it does not: a malformed id, an unknown one, or a
    work package of another initiative. The one check every route that points
    a row at a work package (a task's package, a package's parent, a Gantt
    drop) goes through. Writes nothing.
    """
    wbs_uuid = parse_uuid(wbs_id)
    wbs = await db.get(PpmWbs, wbs_uuid) if wbs_uuid is not None else None
    if wbs is None or wbs.initiative_id != parse_uuid(initiative_id):
        raise HTTPException(status_code=400, detail=detail)
    return wbs


async def _check_new_parent(
    db: AsyncSession, initiative_id: uuid.UUID, parent_id: uuid.UUID
) -> None:
    """400 unless ``parent_id`` is a work package of this initiative that can
    hold items. Checked only when the parent changes, so rows that already sit
    under a milestone can still be reordered there."""
    parent = await wbs_of_initiative(
        db, initiative_id, parent_id, detail="Parent WBS item not found in this initiative"
    )
    if parent.is_milestone:
        raise HTTPException(status_code=400, detail="A milestone cannot contain items")


async def apply_gantt_move(db: AsyncSession, initiative_id: uuid.UUID, move: PpmGanttMove) -> bool:
    """Re-parent and re-order one row of ``initiative_id``'s Gantt.

    Raises 404 when the row is not this initiative's, 400 for a new parent
    that cannot hold it. Siblings are read in the list endpoints' order, with
    the id as the last tiebreaker so both agree on rows created together.
    Returns whether the parent changed, which is when the caller has to
    re-run the completion and date roll-ups. Does not commit.
    """
    parent_id = move.parent_wbs_id
    item: PpmTask | PpmWbs | None
    if move.kind == "task":
        item = await db.get(PpmTask, move.id)
    else:
        item = await db.get(PpmWbs, move.id)
    if item is None or item.initiative_id != initiative_id:
        raise HTTPException(status_code=404, detail="Item not found")
    old_parent = item.wbs_id if isinstance(item, PpmTask) else item.parent_id
    parent_changes = old_parent != parent_id
    if parent_changes and parent_id is not None:
        await _check_new_parent(db, initiative_id, parent_id)

    if isinstance(item, PpmTask):
        same_parent = PpmTask.wbs_id.is_(None) if parent_id is None else PpmTask.wbs_id == parent_id
        tasks = await db.execute(
            select(PpmTask)
            .where(PpmTask.initiative_id == initiative_id, same_parent)
            .order_by(PpmTask.sort_order, PpmTask.created_at, PpmTask.id)
        )
        place_in_order(list(tasks.scalars().all()), item, move.position)
        item.wbs_id = parent_id
    else:
        if parent_changes and parent_id is not None:
            await assert_no_wbs_cycle(db, str(item.id), str(parent_id))
        same_parent = (
            PpmWbs.parent_id.is_(None) if parent_id is None else PpmWbs.parent_id == parent_id
        )
        packages = await db.execute(
            select(PpmWbs)
            .where(PpmWbs.initiative_id == initiative_id, same_parent)
            .order_by(PpmWbs.sort_order, PpmWbs.created_at, PpmWbs.id)
        )
        place_in_order(list(packages.scalars().all()), item, move.position)
        item.parent_id = parent_id
    return parent_changes
