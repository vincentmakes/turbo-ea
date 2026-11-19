"""The license-metric catalogue (``license_metrics``): what licenses are counted in. Same
rules as every item catalogue (``item_catalogue``): key fixed at create time, archived,
never deleted. Flushes, never commits."""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license_metric import LicenseMetric
from app.models.license_type import LicenseType
from app.services import item_catalogue, license_types
from app.services.item_catalogue import CatalogueError
from app.services.item_catalogue import serialize as _serialize

__all__ = ["CatalogueError", "create_item", "get_item", "list_items", "serialize", "update_item"]

NOUN = "License metric"


def serialize(row: LicenseMetric, types: Iterable[LicenseType] = ()) -> dict:
    return {**_serialize(row), "types": [license_types.serialize(t) for t in types]}


async def get_item(db: AsyncSession, key: str) -> LicenseMetric | None:
    return await item_catalogue.get_item(db, LicenseMetric, key)


async def list_items(db: AsyncSession) -> list[LicenseMetric]:
    """Every metric, archived included."""
    return await item_catalogue.list_items(db, LicenseMetric)


async def create_item(
    db: AsyncSession, key: str, label: str, translations: dict | None = None
) -> LicenseMetric:
    return await item_catalogue.create_item(db, LicenseMetric, key, label, translations, noun=NOUN)


async def update_item(
    db: AsyncSession,
    key: str,
    label: str | None = None,
    translations: dict | None = None,
    archived: bool | None = None,
    sort_order: int | None = None,
) -> LicenseMetric:
    return await item_catalogue.update_item(
        db, LicenseMetric, key, label, translations, archived, sort_order, noun=NOUN
    )
