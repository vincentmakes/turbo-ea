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
from sqlalchemy import select
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


async def _load_parent(db: AsyncSession, initiative_id: uuid.UUID, parent_id: uuid.UUID) -> PpmWbs:
    parent = await db.get(PpmWbs, parent_id)
    if parent is None or parent.initiative_id != initiative_id:
        raise HTTPException(status_code=400, detail="Parent WBS item not found in this initiative")
    if parent.is_milestone:
        raise HTTPException(status_code=400, detail="A milestone cannot contain items")
    return parent


async def apply_gantt_move(db: AsyncSession, initiative_id: uuid.UUID, move: PpmGanttMove) -> bool:
    """Re-parent and re-order one row of ``initiative_id``'s Gantt.

    Raises 404 when the row is not this initiative's, 400 for a parent that
    cannot hold it. Returns whether the parent changed, which is when the
    caller has to re-run the completion and date roll-ups. Does not commit.
    """
    parent_id = move.parent_wbs_id
    item: PpmTask | PpmWbs | None
    if move.kind == "task":
        item = await db.get(PpmTask, move.id)
    else:
        item = await db.get(PpmWbs, move.id)
    if item is None or item.initiative_id != initiative_id:
        raise HTTPException(status_code=404, detail="Item not found")
    if parent_id is not None:
        await _load_parent(db, initiative_id, parent_id)

    if isinstance(item, PpmTask):
        old_parent = item.wbs_id
        same_parent = PpmTask.wbs_id.is_(None) if parent_id is None else PpmTask.wbs_id == parent_id
        tasks = await db.execute(
            select(PpmTask)
            .where(PpmTask.initiative_id == initiative_id, same_parent)
            .order_by(PpmTask.sort_order, PpmTask.created_at)
        )
        place_in_order(list(tasks.scalars().all()), item, move.position)
        item.wbs_id = parent_id
    else:
        if parent_id is not None:
            await assert_no_wbs_cycle(db, str(item.id), str(parent_id))
        old_parent = item.parent_id
        same_parent = (
            PpmWbs.parent_id.is_(None) if parent_id is None else PpmWbs.parent_id == parent_id
        )
        packages = await db.execute(
            select(PpmWbs)
            .where(PpmWbs.initiative_id == initiative_id, same_parent)
            .order_by(PpmWbs.sort_order, PpmWbs.created_at)
        )
        place_in_order(list(packages.scalars().all()), item, move.position)
        item.parent_id = parent_id
    return old_parent != parent_id
