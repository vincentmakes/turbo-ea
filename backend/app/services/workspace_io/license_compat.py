"""The license catalogue of a workspace bundle, made importable whatever its age.

A bundle written before license metrics existed has no ``LicenseMetrics`` sheet and its
``LicenseTypes`` rows carry no ``metric_key``. ``derive_catalogue`` reproduces for it what
migration 192 does to a database (the same ``derive_type_metrics`` rule); the caller decides
that a bundle is old, from the sheet being absent and never from it being empty.
``keep_known_cells`` drops the ``CardLicenses`` cells whose metric or type exists nowhere.
Pure: no database, nothing written.
"""

from __future__ import annotations

from typing import Any

from app.services.licensing_migration import DEFAULT_METRICS, derive_type_metrics
from app.services.workspace_io.bundle import from_cell


def _items(row: dict[str, Any]) -> dict:
    try:
        items = from_cell(row.get("items"), is_json=True)
    except ValueError:  # the entity pass reports a row it cannot read
        return {}
    return items if isinstance(items, dict) else {}


def derive_catalogue(
    metric_rows: list[dict], type_rows: list[dict], card_license_rows: list[dict]
) -> tuple[list[dict], list[dict]]:
    """``(metric rows, type rows)`` of an old bundle: its own metric rows plus the default
    metrics it lacks, and each type without ``metric_key`` under every metric the bundle's
    ``CardLicenses`` holds a cell of it for (under both defaults when none). A type row that
    already names its metric is kept as it is; a pair listed twice is kept once."""
    have = {row.get("key") for row in metric_rows}
    metrics = list(metric_rows) + [
        {"key": key, "label": label, "sort_order": order, "archived": False, "translations": {}}
        for order, (key, label) in enumerate(DEFAULT_METRICS)
        if key not in have
    ]
    used: dict[str, set[str]] = {}
    for row in card_license_rows:
        for metric, cells in _items(row).items():
            for type_key in cells if isinstance(cells, dict) else {}:
                used.setdefault(type_key, set()).add(metric)
    types: list[dict] = []
    seen: set[tuple[Any, Any]] = set()
    for row in type_rows:
        if row.get("metric_key"):
            derived = [row]
        else:
            plan = derive_type_metrics([(row.get("key"), False)], used)
            derived = [{**row, "metric_key": metric} for _, metric in plan]
        for out in derived:
            pair = (out["metric_key"], out.get("key"))
            if pair not in seen:
                seen.add(pair)
                types.append(out)
    return metrics, types


def keep_known_cells(items: dict, known: set[tuple[str, str]]) -> tuple[dict, list[str]]:
    """``items`` without the cells whose ``(metric, type)`` is not in ``known``, and the
    dropped ``metric:type`` names (sorted). A metric left with no cell goes too."""
    kept: dict = {}
    dropped: list[str] = []
    for metric, cells in items.items():
        if not isinstance(cells, dict):
            kept[metric] = cells
            continue
        mine = {t: cell for t, cell in cells.items() if (metric, t) in known}
        dropped.extend(f"{metric}:{t}" for t in cells if t not in mine)
        if mine or not cells:
            kept[metric] = mine
    return kept, sorted(dropped)
