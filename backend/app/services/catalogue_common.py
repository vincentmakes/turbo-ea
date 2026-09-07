"""Shared helpers for the three reference catalogues (capability / process /
value stream).

The three catalogues all back onto the same wheel published as
`turbo-ea-capabilities` on PyPI: a single download contains capabilities,
business processes, and value streams. This module owns the cross-catalogue
concerns so each per-domain service can stay focused on its own import
semantics.

Concerns owned here:

- PyPI fetch + wheel extraction (one HTTP round-trip hydrates all three caches)
- Settings cache read/write
- Locale resolution (BCP-47 fallback) + i18n table merge
- Existing-card lookup (by `attributes.catalogueId` first, then by
  case-insensitive English-anchored name)
- BFS ordering so parents land before children during import
- Loose semver-ish version comparison
"""

from __future__ import annotations

import io
import json
import logging
import os
import zipfile
from datetime import datetime, timezone
from importlib.resources import as_file, files
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_settings import AppSettings
from app.models.card import Card

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PYPI_PROJECT_NAME: str = "turbo-ea-capabilities"
PYPI_INDEX_URL: str = os.environ.get(
    "CAPABILITY_CATALOGUE_PYPI_URL",
    f"https://pypi.org/pypi/{PYPI_PROJECT_NAME}/json",
)
CATALOGUE_FETCH_TIMEOUT_SECONDS: float = 30.0

# Cache keys — one `catalogue_cache` row each (2.133.1; they were keys inside
# `app_settings.general_settings` until then, which made every settings save
# in the product round-trip megabytes of catalogue JSON). A single fetch
# action still updates all three in one transaction.
CAPABILITY_CACHE_KEY: str = "capability_catalogue"
PROCESS_CACHE_KEY: str = "process_catalogue"
VALUE_STREAM_CACHE_KEY: str = "value_stream_catalogue"

# Wheel paths (POSIX-style, as stored in zip).
WHEEL_VERSION_PATH: str = "turbo_ea_capabilities/data/version.json"
WHEEL_CAPABILITIES_PATH: str = "turbo_ea_capabilities/data/capabilities.json"
WHEEL_PROCESSES_PATH: str = "turbo_ea_capabilities/data/business-processes.json"
WHEEL_VALUE_STREAMS_PATH: str = "turbo_ea_capabilities/data/value-streams.json"
WHEEL_MACROS_PATH: str = "turbo_ea_capabilities/data/macro-capabilities.json"
WHEEL_I18N_DIR: str = "turbo_ea_capabilities/data/i18n/"

# Subset of fields that translation tables may carry. Same shape as the
# bundled `LocalizedFields` model — anything outside this set is ignored when
# a cached i18n table is applied to a flat payload.
LOCALIZABLE_FIELDS: tuple[str, ...] = (
    "name",
    "stage_name",
    "description",
    "notes",
    "aliases",
    "in_scope",
    "out_of_scope",
)
LIST_LOCALIZABLE_FIELDS: tuple[str, ...] = ("aliases", "in_scope", "out_of_scope")


# ---------------------------------------------------------------------------
# Locale + version utilities (pure)
# ---------------------------------------------------------------------------


def normalize_name(s: str) -> str:
    """Canonicalize a display name for case-insensitive matching."""
    return " ".join(s.split()).strip().casefold()


def version_tuple(v: str) -> tuple[int, ...]:
    """Best-effort semver-ish parse so '1.10.0' > '1.9.0'."""
    parts: list[int] = []
    for chunk in v.split("."):
        digits = ""
        for ch in chunk:
            if ch.isdigit():
                digits += ch
            else:
                break
        parts.append(int(digits) if digits else 0)
    return tuple(parts)


def resolve_effective_locale(locale: str, available: tuple[str, ...] | list[str]) -> str:
    """Pick the locale to actually serve, normalizing BCP-47 regional tags.

    Match the canonical list first, then fall back to the primary subtag
    ("fr-FR" → "fr"), then to "en".
    """
    if locale in available:
        return locale
    primary = locale.split("-", 1)[0].lower()
    if primary in available:
        return primary
    return "en"


def localize_flat_with_table(
    flat: list[dict[str, Any]],
    table: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Apply a {entry_id → localized fields} table to a flat payload.

    Mirrors the upstream `LocalizedFields` overlay semantics: only fields
    that the table actually carries are overwritten; everything else
    (including a missing entry for the whole node) silently falls back to
    the cached English source.
    """
    if not table:
        return flat
    out: list[dict[str, Any]] = []
    for entry in flat:
        overrides = table.get(entry["id"])
        if not overrides:
            out.append(entry)
            continue
        merged = dict(entry)
        for field in LOCALIZABLE_FIELDS:
            value = overrides.get(field)
            if value is None:
                continue
            if field in LIST_LOCALIZABLE_FIELDS:
                if value:
                    merged[field] = list(value)
            else:
                if value:
                    merged[field] = value
        out.append(merged)
    return out


# ---------------------------------------------------------------------------
# Settings cache (sync DB I/O — async wrappers below)
# ---------------------------------------------------------------------------


async def get_app_settings(db: AsyncSession) -> AppSettings:
    res = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    settings: AppSettings | None = res.scalar_one_or_none()
    if settings is None:
        settings = AppSettings(id="default", general_settings={})
        db.add(settings)
        await db.flush()
    return settings


async def get_cached_remote(db: AsyncSession, key: str) -> dict[str, Any] | None:
    """Read a cached-remote payload from its `catalogue_cache` row.

    Returns the dict (or None) without copying — callers must not mutate.
    """
    from app.models.catalogue_cache import CatalogueCache

    row = await db.get(CatalogueCache, key)
    cached = row.payload if row is not None else None
    if not isinstance(cached, dict) or not cached.get("data"):
        return None
    return cached


async def set_cached_remote(db: AsyncSession, updates: dict[str, dict[str, Any]]) -> None:
    """Write multiple cache keys, one row each, in the caller's transaction.

    `updates` maps cache key → payload. Used by the unified PyPI fetch to
    write all three catalogue caches from a single wheel download. Never the
    settings row: a cache is not a setting, and the settings blob is what
    every save in the product reads and rewrites whole.
    """
    from app.models.catalogue_cache import CatalogueCache

    for key, payload in updates.items():
        row = await db.get(CatalogueCache, key)
        if row is None:
            db.add(CatalogueCache(key=key, payload=payload))
        else:
            row.payload = payload
    await db.flush()


# ---------------------------------------------------------------------------
# BFS ordering (pure)
# ---------------------------------------------------------------------------


def bfs_order_by_parent(
    selected_ids: set[str],
    by_id: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return selected nodes in parent-before-child order.

    Within the same depth, preserve catalogue id ordering for stable output.
    Nodes whose parent is missing from `by_id` are treated as roots.
    """
    depths: dict[str, int] = {}

    def depth_of(node_id: str) -> int:
        if node_id in depths:
            return depths[node_id]
        node = by_id.get(node_id)
        parent = node.get("parent_id") if node else None
        if not parent or parent not in by_id:
            depths[node_id] = 0
        else:
            depths[node_id] = depth_of(parent) + 1
        return depths[node_id]

    selected = [by_id[i] for i in selected_ids if i in by_id]
    selected.sort(key=lambda c: (depth_of(c["id"]), c["id"]))
    return selected


# ---------------------------------------------------------------------------
# Bundled-JSON readers (sidestep the upstream Pydantic loader)
# ---------------------------------------------------------------------------
#
# Backwards-compatibility shield. The upstream ``turbo-ea-capabilities``
# package ships ``data/*.json`` plus a Pydantic model layer. The model has
# fallen behind the data at least once (FrameworkRef.framework Literal
# rejected new framework codes the data already used, breaking
# ``load_business_processes()`` on every call). We don't need the Pydantic
# layer — the rest of the catalogue services operate on plain dicts —
# so we read the JSON directly and stay independent of the model. That
# means a future stricter validator on any artefact type cannot break
# Turbo EA's catalogue endpoints.


def read_bundled_json(name: str) -> Any | None:
    """Read a ``data/<name>`` JSON file from the installed wheel.

    Returns ``None`` when the file is missing — older wheels pre-date
    ``business-processes.json`` / ``value-streams.json`` and locale
    files only exist for shipped locales.
    """
    res = files("turbo_ea_capabilities") / "data" / name
    try:
        with as_file(res) as path:
            if not path.is_file():
                return None
            return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ModuleNotFoundError):
        return None


def load_bundled_capabilities_raw() -> list[dict[str, Any]]:
    """Flat list of bundled capabilities as plain dicts. Strips ``children``."""
    raw = read_bundled_json("capabilities.json")
    if not isinstance(raw, list):
        return []
    return [{k: v for k, v in c.items() if k != "children"} for c in raw]


def load_bundled_processes_raw() -> list[dict[str, Any]]:
    """Flat list of bundled business processes as plain dicts. Strips ``children``."""
    raw = read_bundled_json("business-processes.json")
    if not isinstance(raw, list):
        return []
    return [{k: v for k, v in p.items() if k != "children"} for p in raw]


def load_bundled_value_streams_raw() -> list[dict[str, Any]]:
    """Nested list of bundled value streams (``stream`` → ``stages``)."""
    raw = read_bundled_json("value-streams.json")
    if not isinstance(raw, list):
        return []
    return list(raw)


def load_bundled_macros_raw() -> list[dict[str, Any]]:
    """Flat list of bundled macro capabilities as plain dicts.

    Macros are an additive overlay above L1 capabilities (executive-level
    grouping). Older wheels pre-date the artefact and the file is absent —
    we return ``[]`` so the catalogue endpoints continue to work unchanged.
    """
    raw = read_bundled_json("macro-capabilities.json")
    if not isinstance(raw, list):
        return []
    return list(raw)


def bundled_i18n_table(locale: str) -> dict[str, dict[str, Any]] | None:
    """Read ``data/i18n/<locale>.json`` (returns None for ``en`` or missing)."""
    if locale == "en":
        return None
    table = read_bundled_json(f"i18n/{locale}.json")
    return table if isinstance(table, dict) else None


# ---------------------------------------------------------------------------
# Existing-card lookups (async)
# ---------------------------------------------------------------------------


async def existing_card_index_by_name(
    db: AsyncSession,
    *,
    card_type: str,
    subtypes: tuple[str, ...] | None = None,
) -> dict[str, str]:
    """Return {normalized_name: card_id} for active cards of `card_type`.

    `subtypes`, when given, restricts the index to cards whose `subtype` is
    in the tuple. Used by Value Stream import to look up only valueStream-
    subtyped BusinessContext cards instead of all business contexts.
    """
    stmt = select(Card.id, Card.name, Card.subtype).where(
        Card.type == card_type,
        Card.status != "ARCHIVED",
    )
    res = await db.execute(stmt)
    out: dict[str, str] = {}
    for card_id, name, subtype in res.all():
        if not name:
            continue
        if subtypes and subtype not in subtypes:
            continue
        out.setdefault(normalize_name(name), str(card_id))
    return out


async def existing_card_index_by_catalogue_id(
    db: AsyncSession,
    *,
    card_type: str,
    subtypes: tuple[str, ...] | None = None,
) -> dict[str, str]:
    """Return {catalogueId: card_id} for active cards of `card_type` that
    were previously imported from a reference catalogue.

    More robust than name matching: survives display-name edits and ties to
    the immutable catalogue identifier.
    """
    stmt = select(Card.id, Card.attributes, Card.subtype).where(
        Card.type == card_type,
        Card.status != "ARCHIVED",
    )
    res = await db.execute(stmt)
    out: dict[str, str] = {}
    for card_id, attrs, subtype in res.all():
        if subtypes and subtype not in subtypes:
            continue
        cat_id = (attrs or {}).get("catalogueId")
        if isinstance(cat_id, str) and cat_id and cat_id not in out:
            out[cat_id] = str(card_id)
    return out


# ---------------------------------------------------------------------------
# Wheel fetch + extraction
# ---------------------------------------------------------------------------


def wheel_url_from_pypi_payload(payload: dict[str, Any]) -> tuple[str, str]:
    """Pick the wheel artefact URL and version from a PyPI JSON response.

    Falls back to a sdist if no wheel is published — the extraction logic
    only depends on the `data/*.json` paths which both distribution formats
    use.
    """
    info = payload.get("info") or {}
    version = info.get("version")
    if not isinstance(version, str) or not version:
        raise ValueError("PyPI response missing info.version")
    urls = payload.get("urls") or []
    wheel = next((u for u in urls if u.get("packagetype") == "bdist_wheel"), None)
    fallback = next((u for u in urls if u.get("packagetype") == "sdist"), None)
    chosen = wheel or fallback
    if not chosen or not chosen.get("url"):
        raise ValueError(f"PyPI did not list a downloadable artefact for {PYPI_PROJECT_NAME}")
    return str(chosen["url"]), version


async def fetch_wheel_from_pypi() -> tuple[bytes, str]:
    """Download the latest published wheel as raw bytes.

    Returns `(wheel_bytes, pypi_version)`. Caller is responsible for
    extracting + caching. Raises `httpx.HTTPError` / `ValueError` on
    upstream issues.
    """
    async with httpx.AsyncClient(
        timeout=CATALOGUE_FETCH_TIMEOUT_SECONDS, follow_redirects=True
    ) as client:
        meta_resp = await client.get(PYPI_INDEX_URL, headers={"Accept": "application/json"})
        meta_resp.raise_for_status()
        wheel_url, pypi_version = wheel_url_from_pypi_payload(meta_resp.json())
        wheel_resp = await client.get(wheel_url)
        wheel_resp.raise_for_status()
        return wheel_resp.content, pypi_version


def extract_all_catalogues_from_wheel(
    wheel_bytes: bytes,
) -> dict[str, Any]:
    """Read every artefact bundle out of a wheel byte-string.

    Returns a dict with:
        - `version`: parsed `data/version.json`
        - `capabilities`: flat list (children stripped) — always present, the
          wheel has shipped this since the very first release.
        - `processes`: flat list — None if the wheel pre-dates schema_version 2.
        - `value_streams`: nested list of stream + stages — None if old wheel.
        - `macros`: flat list of macro capabilities — None if the wheel
          pre-dates the macro artefact.
        - `i18n`: `{locale: {entry_id: {field: value, ...}}}`

    The flat-form `capabilities.json` and `business-processes.json` files
    in the wheel store `children` as a list of child ids, so we drop the
    `children` field to keep cached payloads compact (downstream code
    rebuilds hierarchy from `parent_id`). Value streams are tiny by
    comparison and ship as a nested list, so we cache them as-is.

    Macros are stored as a flat list and never carry `children` — they
    reference L1 capabilities by id (``capability_ids``) instead.
    """
    out: dict[str, Any] = {
        "version": None,
        "capabilities": None,
        "processes": None,
        "value_streams": None,
        "macros": None,
        "i18n": {},
    }
    with zipfile.ZipFile(io.BytesIO(wheel_bytes)) as zf:
        names = set(zf.namelist())

        if WHEEL_VERSION_PATH in names:
            with zf.open(WHEEL_VERSION_PATH) as vf:
                out["version"] = json.loads(vf.read().decode("utf-8"))

        if WHEEL_CAPABILITIES_PATH in names:
            with zf.open(WHEEL_CAPABILITIES_PATH) as cf:
                caps_raw = json.loads(cf.read().decode("utf-8"))
            if isinstance(caps_raw, list):
                out["capabilities"] = [
                    {k: v for k, v in c.items() if k != "children"} for c in caps_raw
                ]

        if WHEEL_PROCESSES_PATH in names:
            with zf.open(WHEEL_PROCESSES_PATH) as pf:
                procs_raw = json.loads(pf.read().decode("utf-8"))
            if isinstance(procs_raw, list):
                out["processes"] = [
                    {k: v for k, v in p.items() if k != "children"} for p in procs_raw
                ]

        if WHEEL_VALUE_STREAMS_PATH in names:
            with zf.open(WHEEL_VALUE_STREAMS_PATH) as vsf:
                vs_raw = json.loads(vsf.read().decode("utf-8"))
            if isinstance(vs_raw, list):
                out["value_streams"] = vs_raw

        if WHEEL_MACROS_PATH in names:
            with zf.open(WHEEL_MACROS_PATH) as mf:
                macros_raw = json.loads(mf.read().decode("utf-8"))
            if isinstance(macros_raw, list):
                out["macros"] = list(macros_raw)

        i18n_tables: dict[str, dict[str, Any]] = {}
        for name in names:
            if not name.startswith(WHEEL_I18N_DIR) or not name.endswith(".json"):
                continue
            lang = name[len(WHEEL_I18N_DIR) : -len(".json")]
            if not lang:
                continue
            with zf.open(name) as lf:
                table = json.loads(lf.read().decode("utf-8"))
            if isinstance(table, dict):
                i18n_tables[lang] = table
        out["i18n"] = i18n_tables

    return out


def now_iso() -> str:
    """Single source of UTC ISO timestamps used in cache + import metadata."""
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Unified PyPI version check + wheel fetch (shared across catalogues)
# ---------------------------------------------------------------------------


async def check_remote_version_for(
    db: AsyncSession,
    *,
    cache_key: str,
    bundled_version: str,
) -> dict[str, Any]:
    """Per-catalogue PyPI version probe.

    `bundled_version` is the version of the catalogue currently shipped
    inside the installed `turbo-ea-capabilities` wheel — the caller passes
    `catalogue_pkg.VERSION`. `cache_key` selects which cached-remote payload
    to compare against, so the "update available" badge reflects the right
    artefact even though all three caches are filled by the same wheel.
    """
    cached = await get_cached_remote(db, cache_key)
    active_version = (
        cached["catalogue_version"]
        if cached
        and version_tuple(cached.get("catalogue_version", "0")) > version_tuple(bundled_version)
        else bundled_version
    )

    remote_meta: dict[str, Any] | None = None
    error: str | None = None
    try:
        async with httpx.AsyncClient(
            timeout=CATALOGUE_FETCH_TIMEOUT_SECONDS, follow_redirects=True
        ) as client:
            resp = await client.get(PYPI_INDEX_URL, headers={"Accept": "application/json"})
            resp.raise_for_status()
            payload = resp.json()
        info = payload.get("info") or {}
        latest = info.get("version")
        if isinstance(latest, str) and latest:
            remote_meta = {
                "catalogue_version": latest,
                "source": "pypi",
                "project": PYPI_PROJECT_NAME,
            }
    except (httpx.HTTPError, ValueError):
        logger.exception("PyPI version check failed")
        error = "Could not reach PyPI"

    update_available = False
    if remote_meta and "catalogue_version" in remote_meta:
        update_available = version_tuple(remote_meta["catalogue_version"]) > version_tuple(
            active_version
        )

    return {
        "active_version": active_version,
        "active_source": "remote" if cached else "bundled",
        "bundled_version": bundled_version,
        "cached_remote_version": cached["catalogue_version"] if cached else None,
        "remote": remote_meta,
        "update_available": update_available,
        "error": error,
    }


async def fetch_and_cache_all(db: AsyncSession) -> dict[str, Any]:
    """Download the latest wheel from PyPI and cache all three artefact
    payloads atomically.

    A single wheel ships capabilities, business processes, and value
    streams, so any of the three "Fetch update" admin actions only needs
    to call this once. The return value includes per-artefact counts so
    each route can surface a domain-appropriate summary.
    """
    wheel_bytes, pypi_version = await fetch_wheel_from_pypi()
    artefacts = extract_all_catalogues_from_wheel(wheel_bytes)
    ver = artefacts["version"] or {}
    i18n = artefacts["i18n"] or {}
    fetched_at = now_iso()
    catalogue_version = ver.get("catalogue_version") or pypi_version
    schema_version = str(ver.get("schema_version", ""))
    generated_at = ver.get("generated_at")

    updates: dict[str, dict[str, Any]] = {}

    if artefacts.get("capabilities") is not None:
        caps = artefacts["capabilities"]
        macros = artefacts.get("macros") or []
        updates[CAPABILITY_CACHE_KEY] = {
            "data": caps,
            "macros": macros,
            "i18n": i18n,
            "catalogue_version": catalogue_version,
            "schema_version": schema_version,
            "generated_at": generated_at,
            "node_count": ver.get("node_count", len(caps)),
            "fetched_at": fetched_at,
            "source": "pypi",
        }
    if artefacts.get("processes") is not None:
        procs = artefacts["processes"]
        updates[PROCESS_CACHE_KEY] = {
            "data": procs,
            "i18n": i18n,
            "catalogue_version": catalogue_version,
            "schema_version": schema_version,
            "generated_at": generated_at,
            "process_count": ver.get("process_count", len(procs)),
            "fetched_at": fetched_at,
            "source": "pypi",
        }
    if artefacts.get("value_streams") is not None:
        vss = artefacts["value_streams"]
        updates[VALUE_STREAM_CACHE_KEY] = {
            "data": vss,
            "i18n": i18n,
            "catalogue_version": catalogue_version,
            "schema_version": schema_version,
            "generated_at": generated_at,
            "value_stream_count": len(vss),
            "fetched_at": fetched_at,
            "source": "pypi",
        }

    if updates:
        await set_cached_remote(db, updates)
    await db.commit()

    return {
        "catalogue_version": catalogue_version,
        "node_count": updates.get(CAPABILITY_CACHE_KEY, {}).get("node_count"),
        "process_count": updates.get(PROCESS_CACHE_KEY, {}).get("process_count"),
        "value_stream_count": updates.get(VALUE_STREAM_CACHE_KEY, {}).get("value_stream_count"),
        "fetched_at": fetched_at,
        "available_locales": sorted(set(i18n.keys()) | {"en"}),
    }
