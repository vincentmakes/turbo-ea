"""The license catalogue as one read-only value: metrics, each with its types, archived
ones included. Types are keyed by ``(metric_key, key)``: the same type key may exist under
two metrics. Load it once per request and pass it down."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import license_metrics, license_types


@dataclass(frozen=True)
class CatalogueType:
    metric_key: str
    key: str
    label: str
    archived: bool
    sort_order: int
    translations: dict


@dataclass(frozen=True)
class CatalogueMetric:
    key: str
    label: str
    archived: bool
    sort_order: int
    translations: dict
    types: tuple[CatalogueType, ...]


@dataclass(frozen=True)
class LicenseCatalogue:
    metrics: tuple[CatalogueMetric, ...]

    def metric(self, key: str) -> CatalogueMetric | None:
        return next((m for m in self.metrics if m.key == key), None)

    def type(self, metric_key: str, key: str) -> CatalogueType | None:
        metric = self.metric(metric_key)
        return next((t for t in metric.types if t.key == key), None) if metric else None

    def metric_order(self) -> list[str]:
        return [m.key for m in self.metrics]

    def type_order(self, metric_key: str) -> list[str]:
        metric = self.metric(metric_key)
        return [t.key for t in metric.types] if metric else []


async def load_catalogue(db: AsyncSession) -> LicenseCatalogue:
    """Every metric and type (archived included), sorted by ``sort_order`` then label."""
    types = await license_types.list_items(db)
    return LicenseCatalogue(
        tuple(
            CatalogueMetric(
                key=m.key,
                label=m.label,
                archived=m.archived,
                sort_order=m.sort_order,
                translations=m.translations or {},
                types=tuple(
                    CatalogueType(
                        metric_key=t.metric_key,
                        key=t.key,
                        label=t.label,
                        archived=t.archived,
                        sort_order=t.sort_order,
                        translations=t.translations or {},
                    )
                    for t in types
                    if t.metric_key == m.key
                ),
            )
            for m in await license_metrics.list_items(db)
        )
    )
