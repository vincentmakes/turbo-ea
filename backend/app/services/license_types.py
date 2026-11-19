"""The license-type catalogue (``license_types``), scoped by metric. No reserved keys: a type
key travels inside a list value of the event, never as a diff key, so it cannot hide a diff."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license_metric import LicenseMetric
from app.models.license_type import LicenseType
from app.services import item_catalogue
from app.services.item_catalogue import CatalogueError
from app.services.item_catalogue import serialize as _serialize

__all__ = [
    "CatalogueError",
    "create_item",
    "get_item",
    "list_items",
    "seed_default_metrics",
    "serialize",
    "update_item",
]

NOUN = "License type"
# The metrics a fresh install starts with, in this order. Migration 192 keeps its own frozen
# copy (``licensing_migration.DEFAULT_METRICS``): a change here must not rewrite history.
DEFAULT_METRICS = (("users", "Users"), ("installations", "Installations"))


async def seed_default_metrics(db: AsyncSession) -> None:
    """``users`` and ``installations`` on a fresh install, insert-only: a metric an admin
    renamed or archived is left as it is, and no type is seeded."""
    have = {m.key for m in await item_catalogue.list_items(db, LicenseMetric)}
    for order, (key, label) in enumerate(DEFAULT_METRICS):
        if key not in have:
            db.add(LicenseMetric(key=key, label=label, sort_order=order))
    await db.flush()


def serialize(row: LicenseType) -> dict:
    return {**_serialize(row), "metric_key": row.metric_key}


def _scope(metric_key: str | None) -> dict[str, str] | None:
    return None if metric_key is None else {"metric_key": metric_key}


async def get_item(db: AsyncSession, metric_key: str, key: str) -> LicenseType | None:
    return await item_catalogue.get_item(db, LicenseType, key, _scope(metric_key))


async def list_items(db: AsyncSession, metric_key: str | None = None) -> list[LicenseType]:
    """The types of one metric, or of every metric when ``metric_key`` is None (archived
    included)."""
    return await item_catalogue.list_items(db, LicenseType, scope=_scope(metric_key))


async def create_item(
    db: AsyncSession,
    metric_key: str,
    key: str,
    label: str,
    translations: dict | None = None,
) -> LicenseType:
    if await item_catalogue.get_item(db, LicenseMetric, metric_key) is None:
        raise CatalogueError("unknown_metric", f"License metric '{metric_key}' not found")
    return await item_catalogue.create_item(
        db, LicenseType, key, label, translations, noun=NOUN, scope=_scope(metric_key)
    )


async def update_item(
    db: AsyncSession,
    metric_key: str,
    key: str,
    label: str | None = None,
    translations: dict | None = None,
    archived: bool | None = None,
    sort_order: int | None = None,
) -> LicenseType:
    return await item_catalogue.update_item(
        db,
        LicenseType,
        key,
        label,
        translations,
        archived,
        sort_order,
        noun=NOUN,
        scope=_scope(metric_key),
    )
