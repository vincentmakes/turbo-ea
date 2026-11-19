"""The license catalogue of a workspace bundle, made importable whatever its age.

A bundle written before license metrics existed has no ``LicenseMetrics`` sheet and its
``LicenseTypes`` rows carry no ``metric_key``. ``derive_catalogue`` reproduces for it what
migration 192 does to a database (the same ``derive_type_metrics`` rule); the caller decides
that a bundle is old, from the sheet being absent and never from it being empty.
``items_of`` reads a ``CardLicenses`` row's cells; ``keep_known_cells`` drops the cells
whose metric or type exists nowhere, ``drop_invalid_cells`` those that break the rules of
the API's cell schema, and ``catalogue_row_error`` a metric or type row that breaks the
API's key and label rules.
Pure: no database, nothing written.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ValidationError

from app.schemas.licenses import LicenseCellWrite
from app.services.license_types import DEFAULT_METRICS
from app.services.licensing_migration import derive_type_metrics
from app.services.workspace_io.bundle import from_cell


def items_of(row: dict[str, Any]) -> dict:
    """A ``CardLicenses`` row's ``items`` object; ``{}`` for bad JSON or anything else."""
    try:
        items = from_cell(row.get("items"), is_json=True)
    except ValueError:  # the entity pass reports a row it cannot read
        return {}
    return items if isinstance(items, dict) else {}


def derive_catalogue(
    metric_rows: list[dict], type_rows: list[dict], card_license_rows: list[dict]
) -> tuple[list[dict], list[dict]]:
    """``(metric rows, type rows)`` of an old bundle: its own metric rows plus the default
    metrics it lacks, and each type without ``metric_key`` under every one of those metrics
    the bundle's ``CardLicenses`` holds a cell of it for (under both defaults when none; a
    metric the bundle does not have does not count). A type row that already names its metric
    is kept as it is; a pair listed twice is kept once."""
    have = {row.get("key") for row in metric_rows}
    metrics = list(metric_rows) + [
        {"key": key, "label": label, "sort_order": order, "archived": False, "translations": {}}
        for order, (key, label) in enumerate(DEFAULT_METRICS)
        if key not in have
    ]
    own = [k for row in metric_rows if isinstance(k := row.get("key"), str)]
    used: dict[str, set[str]] = {}
    for row in card_license_rows:
        for metric, cells in items_of(row).items():
            for type_key in cells if isinstance(cells, dict) else {}:
                used.setdefault(type_key, set()).add(metric)
    types: list[dict] = []
    seen: set[tuple[Any, Any]] = set()
    for row in type_rows:
        if row.get("metric_key"):
            derived = [row]
        else:
            plan = derive_type_metrics([(row.get("key"), False)], used, own)
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


def catalogue_row_error(data: dict[str, Any], schema: type[BaseModel]) -> str | None:
    """Why a metric or type row breaks the API's key / label / translations rules
    (``schema`` is ``LicenseMetricCreate`` or ``LicenseTypeCreate``), or ``None``. An empty
    label cell is fine: the new row takes its key. The offending value is not echoed."""
    payload = {k: data.get(k) for k in ("key", "label", "translations")}
    if payload["label"] is None:
        payload["label"] = payload["key"]
    try:
        schema.model_validate(payload)
    except ValidationError as exc:
        first = exc.errors()[0]
        return f"{'.'.join(str(p) for p in first['loc'])}: {first['msg']}"
    return None


def _cell_ok(cell: Any) -> bool:
    try:
        LicenseCellWrite.model_validate(cell)
    except ValidationError:
        return False
    return True


def drop_invalid_cells(items: dict) -> tuple[dict, list[str]]:
    """``items`` without the cells the API's ``LicenseCellWrite`` would refuse (a non-int or
    out-of-range count, a cell that is not an object) and without a metric that is not an
    object, plus the dropped names (``metric:type``, or ``metric``), sorted."""
    kept: dict = {}
    dropped: list[str] = []
    for metric, cells in items.items():
        if not isinstance(cells, dict):
            dropped.append(metric)
            continue
        good = {t: c for t, c in cells.items() if _cell_ok(c)}
        dropped.extend(f"{metric}:{t}" for t in cells if t not in good)
        if good or not cells:
            kept[metric] = good
    return kept, sorted(dropped)
