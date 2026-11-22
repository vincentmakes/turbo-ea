"""Catalogue snapshots and reusable workbooks for cost imports."""

from __future__ import annotations

import asyncio
import re
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO

from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cost_item_type import CostItemType

COST_IMPORT_HEADERS = ("Card ID", "Fiscal Year", "Cost Item", "Amount", "Renewal Date")
_CACHE_LIMIT = 8
_ILLEGAL_XML = re.compile(r"[\x00-\x08\x0b-\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")


@dataclass(frozen=True)
class CatalogueItem:
    key: str
    label: str
    translations: tuple[tuple[str, str], ...]
    archived: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime


CatalogueSnapshot = tuple[CatalogueItem, ...]
_cache: OrderedDict[CatalogueSnapshot, bytes] = OrderedDict()
_inflight: dict[CatalogueSnapshot, asyncio.Task[bytes]] = {}


async def catalogue_snapshot(db: AsyncSession) -> CatalogueSnapshot:
    rows = await db.execute(
        select(
            CostItemType.key,
            CostItemType.label,
            CostItemType.translations,
            CostItemType.archived,
            CostItemType.sort_order,
            CostItemType.created_at,
            CostItemType.updated_at,
        ).order_by(CostItemType.sort_order, CostItemType.label, CostItemType.key)
    )
    return tuple(
        CatalogueItem(
            row.key,
            row.label,
            tuple(sorted((row.translations or {}).items())),
            row.archived,
            row.sort_order,
            row.created_at,
            row.updated_at,
        )
        for row in rows
    )


def _build(snapshot: CatalogueSnapshot) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Costs"
    sheet.append(COST_IMPORT_HEADERS)
    reference = workbook.create_sheet("Cost Items")
    reference.append(["Open a card and copy its UUID from the URL into Card ID."])
    reference.append(["Cost Item", "Label"])
    for row, item in enumerate((item for item in snapshot if not item.archived), start=3):
        reference.cell(row, 1, item.key)
        label = reference.cell(row, 2, _ILLEGAL_XML.sub(" ", item.label))
        # Labels are data, even when they start with Excel's formula prefix.
        label.data_type = "s"
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


async def _generate(snapshot: CatalogueSnapshot) -> bytes:
    result = await asyncio.to_thread(_build, snapshot)
    _cache[snapshot] = result
    _cache.move_to_end(snapshot)
    while len(_cache) > _CACHE_LIMIT:
        _cache.popitem(last=False)
    return result


def _finished(snapshot: CatalogueSnapshot, task: asyncio.Task[bytes]) -> None:
    if _inflight.get(snapshot) is task:
        del _inflight[snapshot]
    if not task.cancelled():
        task.exception()  # Retrieve errors even if all waiting callers were cancelled.


async def template_bytes(snapshot: CatalogueSnapshot) -> bytes:
    if snapshot in _cache:
        _cache.move_to_end(snapshot)
        return _cache[snapshot]
    task = _inflight.get(snapshot)
    if task is None:
        task = asyncio.create_task(_generate(snapshot))
        _inflight[snapshot] = task
        task.add_done_callback(lambda completed: _finished(snapshot, completed))
    return await asyncio.shield(task)
