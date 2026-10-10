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
import uuid
import zipfile
from collections import Counter
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from importlib.resources import as_file, files
from typing import Any

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.relation import Relation
from app.models.user import User
from app.services.card_reference import ReferenceAllocator
from app.services.event_bus import event_bus

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


Flat = list[dict[str, Any]]


@dataclass(frozen=True)
class ActiveCatalogue:
    """The catalogue a payload or an import works from, remote or bundled."""

    flat: Flat
    meta: dict[str, Any]
    # Applies the same locale to another list (the capability macros).
    localize: Callable[[Flat], Flat]
    # The cached remote row when it is the source being served, else None. A
    # cache that lost to a newer bundled wheel is stale, and nothing derived
    # from it (the capability macros) may be served beside the bundled list.
    remote: dict[str, Any] | None


def remote_wins(cached: dict[str, Any] | None, bundled_version: str) -> bool:
    """A cached remote is served only when strictly newer than the bundled wheel."""
    return cached is not None and version_tuple(
        cached.get("catalogue_version", "0")
    ) > version_tuple(bundled_version)


def localize_via_bundled_table(flat: Flat, locale: str) -> Flat:
    """Overlay the bundled package's table for ``locale``; ``en`` is the source."""
    table = bundled_i18n_table(locale)
    return localize_flat_with_table(flat, table) if table else flat


async def resolve_active_catalogue(
    db: AsyncSession,
    *,
    cache_key: str,
    locale: str,
    bundled: tuple[Flat, dict[str, Any]],
    bundled_locales: Iterable[str],
    count_key: str,
    flatten: Callable[[Flat], Flat] = list,
) -> ActiveCatalogue:
    """The catalogue to serve, honouring a newer cached remote.

    The cached remote wins only when its version is strictly greater than the
    bundled one. It is localized from its own i18n table for the requested
    locale or, for a cache stored before i18n tables were cached, from the
    bundled package's table, so every catalogue translates the same way.
    """
    bundled_flat, bundled_meta = bundled
    cached = await get_cached_remote(db, cache_key)
    if cached is None or not remote_wins(cached, bundled_meta["catalogue_version"]):
        active_locale = bundled_meta.get("active_locale", "en")
        return ActiveCatalogue(
            flat=bundled_flat,
            meta={
                **bundled_meta,
                "source": "bundled",
                "bundled_version": bundled_meta["catalogue_version"],
            },
            localize=lambda flat: localize_via_bundled_table(flat, active_locale),
            remote=None,
        )

    cached_i18n = cached.get("i18n") or {}
    available = sorted({"en"} | set(cached_i18n) | set(bundled_locales))
    effective = resolve_effective_locale(locale, available)
    table = cached_i18n.get(effective)

    def localize(flat: Flat) -> Flat:
        if effective == "en":
            return flat
        if table:
            return localize_flat_with_table(flat, table)
        return localize_via_bundled_table(flat, effective)

    return ActiveCatalogue(
        flat=localize(flatten(list(cached["data"]))),
        meta={
            "catalogue_version": cached["catalogue_version"],
            "schema_version": str(cached.get("schema_version", "")),
            "generated_at": cached.get("generated_at"),
            count_key: cached.get(count_key, len(cached["data"])),
            "source": "remote",
            "fetched_at": cached.get("fetched_at"),
            "bundled_version": bundled_meta["catalogue_version"],
            "available_locales": available,
            "active_locale": effective,
        },
        localize=localize,
        remote=cached,
    )


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


def bundled_payload(
    pkg: Any,
    *,
    locale: str,
    raw: list[dict[str, Any]],
    count_key: str,
    count: int | None = None,
    flatten: Callable[[Flat], Flat] = list,
) -> tuple[Flat, dict[str, Any]]:
    """A catalogue's bundled flat list, localized, and its version meta.

    ``pkg`` is the installed ``turbo_ea_capabilities`` module as the calling
    service sees it, ``raw`` the artefact as read from the wheel. ``count``
    defaults to the length of the flat list.
    """
    available = list(pkg.available_locales())
    effective = resolve_effective_locale(locale, available)
    flat = flatten(raw)
    if effective != "en":
        table = bundled_i18n_table(effective)
        if table:
            flat = localize_flat_with_table(flat, table)
    return flat, {
        "catalogue_version": pkg.VERSION,
        "schema_version": str(pkg.SCHEMA_VERSION),
        "generated_at": pkg.GENERATED_AT,
        count_key: len(flat) if count is None else count,
        "available_locales": available,
        "active_locale": effective,
    }


async def english_index(
    resolve: Callable[..., Awaitable[tuple[Flat, dict[str, Any]]]],
    db: AsyncSession,
    flat: Flat,
    meta: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """``{entry id: entry}`` of the catalogue in English, the language names match on.

    ``resolve`` is the calling service's own active-catalogue resolver; it is
    asked again only when ``flat`` is in another language.
    """
    if meta.get("active_locale", "en") == "en":
        return {node["id"]: node for node in flat}
    english_flat, _ = await resolve(db, locale="en")
    return {node["id"]: node for node in english_flat}


async def match_existing_cards(
    db: AsyncSession,
    *,
    flat: Flat,
    english: dict[str, dict[str, Any]],
    card_type: str,
    subtypes: tuple[str, ...] | None = None,
    by_id_only: Callable[[dict[str, Any]], bool] = lambda node: False,
) -> dict[str, str]:
    """``{catalogue id: card id}`` for every entry a card already stands for.

    One definition for the browser's green tick and for the import's skip, so
    the two cannot disagree. An entry matches a card by ``attributes.catalogueId``
    first, which survives renames. Failing that it matches by its canonical
    English name, but only when no other entry of the catalogue carries the
    same name. The catalogues repeat names across branches (157 capability
    names, 6 process names, 7 value-stream stage names in the 2026.9 wheel),
    and a name shared by two entries tied both to one card: importing the
    second branch skipped its entry, created that entry's children under the
    first branch's card, and re-parented that card under the second branch.
    ``by_id_only`` names entries that never match by name (macro capabilities).
    """
    name_index = await existing_card_index_by_name(db, card_type=card_type, subtypes=subtypes)
    cat_id_index = await existing_card_index_by_catalogue_id(
        db, card_type=card_type, subtypes=subtypes
    )
    names = {
        node["id"]: normalize_name(english.get(node["id"], node).get("name") or "") for node in flat
    }
    repeats = Counter(names.values())
    matches: dict[str, str] = {}
    for node in flat:
        existing = cat_id_index.get(node["id"])
        name = names[node["id"]]
        if existing is None and name and repeats[name] == 1 and not by_id_only(node):
            existing = name_index.get(name)
        if existing:
            matches[node["id"]] = existing
    return matches


async def card_lookup(db: AsyncSession, card_type: str) -> dict[str, str]:
    """``{catalogue id or normalised name: card id}`` for the cards a relation targets.

    Catalogue ids (``BC-*``, ``BP-*``) and normalised English names live in
    disjoint key spaces, so one dict serves both; a catalogue id wins.
    """
    cat_id_index = await existing_card_index_by_catalogue_id(db, card_type=card_type)
    name_index = await existing_card_index_by_name(db, card_type=card_type)
    return {**name_index, **cat_id_index}


PARENT_NOT_IMPORTED = "parent not imported"


async def create_catalogue_card(
    db: AsyncSession,
    user: User,
    *,
    type_key: str,
    name: str,
    subtype: str | None,
    description: str | None,
    parent_id: str | None,
    attributes: dict[str, Any],
    allocator: ReferenceAllocator,
) -> tuple[Card | None, str]:
    """Create one imported card through the shared write path, in its own savepoint.

    A catalogue card takes the road every other card takes
    (``card_write_service.create_card``): validation, the sibling-name check,
    its reference when the type numbers cards automatically, the hierarchy
    depth guard and level sync, calculations, data quality and the
    ``card.created`` event that puts it in the History tab (CLAUDE.md, *A
    write path that can move cards.updated_at must also persist a card
    event*). The imports used to build ``Card`` rows directly and got none
    of that. A row the write path refuses rolls back alone and comes back as
    ``(None, reason)``, so one taken name cannot fail a 500-card batch — the
    bulk-create shape. ``reason`` is empty when the card was created.

    ``card_write_service`` is imported here, not at module level: it reaches
    ``extensions.bundle`` through ``card_approval`` → ``notification_service``,
    and ``bundle`` imports ``version_tuple`` from this module, so a top-level
    import closes a cycle that breaks whichever side is imported first.
    """
    from app.services import card_write_service

    savepoint = await db.begin_nested()
    try:
        card = await card_write_service.create_card(
            db,
            card_write_service.WriteActor.from_user(user),
            type_key=type_key,
            name=name,
            subtype=subtype,
            description=description,
            parent_id=uuid.UUID(parent_id) if parent_id else None,
            attributes=attributes,
            reference_allocator=allocator,
        )
    except HTTPException as exc:
        await savepoint.rollback()
        # The sibling-name check raises a structured detail whose ``message``
        # is what the API client shows; other refusals are plain strings.
        detail = exc.detail
        if isinstance(detail, dict) and isinstance(detail.get("message"), str):
            return None, detail["message"]
        return None, str(detail)
    await savepoint.commit()
    return card, ""


async def add_relation_once(
    db: AsyncSession,
    *,
    relation_type: str,
    source_id: uuid.UUID,
    target_id: uuid.UUID,
) -> bool:
    """Stage the relation unless an identical one exists; True when one was added.

    Each caller passes the ends in the relation type's own direction.
    """
    exists = await db.execute(
        select(Relation.id).where(
            Relation.type == relation_type,
            Relation.source_id == source_id,
            Relation.target_id == target_id,
        )
    )
    if exists.scalar_one_or_none() is not None:
        return False
    db.add(Relation(type=relation_type, source_id=source_id, target_id=target_id, attributes={}))
    return True


async def relink_pre_existing(
    db: AsyncSession,
    *,
    pre_existing: Iterable[str],
    by_id: dict[str, dict[str, Any]],
    created_in_batch: set[str],
    card_ids: dict[str, str],
    user_id: uuid.UUID,
) -> list[dict[str, str]]:
    """Move each existing card under its catalogue parent when this import created it.

    The move is recorded on the card's History tab: it changes the card, and
    a card whose Modified date moved with nothing in its history is one nobody
    can triage (CLAUDE.md, *A write path that can move cards.updated_at…*).
    """
    relinked: list[dict[str, str]] = []
    for cat_id in sorted(pre_existing):
        node = by_id.get(cat_id)
        if node is None:
            continue
        cat_parent = node.get("parent_id")
        if not cat_parent or cat_parent not in created_in_batch:
            continue
        card = await db.get(Card, uuid.UUID(card_ids[cat_id]))
        if card is None:
            continue
        new_parent = uuid.UUID(card_ids[cat_parent])
        old_parent = card.parent_id
        card.parent_id = new_parent
        card.updated_by = user_id
        await db.flush()
        await event_bus.publish(
            "card.updated",
            {
                "id": str(card.id),
                "changes": {
                    "parent_id": {
                        "old": str(old_parent) if old_parent else None,
                        "new": str(new_parent),
                    }
                },
            },
            db=db,
            card_id=card.id,
            user_id=user_id,
        )
        relinked.append(
            {
                "catalogue_id": cat_id,
                "card_id": card_ids[cat_id],
                "new_parent_card_id": card_ids[cat_parent],
            }
        )
    return relinked


def catalogue_attributes(
    node: dict[str, Any],
    meta: dict[str, Any],
    now: str,
    level: tuple[str, str],
    copied: Iterable[tuple[str, str]] = (),
) -> dict[str, Any]:
    """The attributes every imported card carries, plus ``copied`` node fields.

    ``level`` is the ``(attribute key, value)`` naming the card's catalogue
    level; ``copied`` maps a node field to the attribute that keeps it when
    the node's value is truthy (a list is copied, never shared). A field
    whose zero is meaningful, such as a stage order, is the caller's to add.
    """
    attrs: dict[str, Any] = {
        "catalogueId": node["id"],
        "catalogueVersion": meta.get("catalogue_version"),
        "catalogueImportedAt": now,
        level[0]: level[1],
    }
    if meta.get("active_locale", "en") != "en":
        attrs["catalogueLocale"] = meta["active_locale"]
    for field, key in copied:
        value = node.get(field)
        if value:
            attrs[key] = list(value) if isinstance(value, list) else value
    return attrs


# ---------------------------------------------------------------------------
# Wheel fetch + extraction
# ---------------------------------------------------------------------------


def wheel_url_from_pypi_payload(payload: dict[str, Any]) -> tuple[str, str]:
    """Pick the wheel artefact URL and version from a PyPI JSON response.

    Only a wheel will do. The extractor reads the wheel's zip layout and its
    ``turbo_ea_capabilities/data/*.json`` paths; an sdist is a ``.tar.gz``
    with everything under a ``<name>-<version>/`` folder, so it has neither
    the container nor the paths. This used to fall back to the sdist, which
    then failed inside ``zipfile`` and surfaced as a generic fetch error.
    """
    info = payload.get("info") or {}
    version = info.get("version")
    if not isinstance(version, str) or not version:
        raise ValueError("PyPI response missing info.version")
    urls = payload.get("urls") or []
    wheel = next((u for u in urls if u.get("packagetype") == "bdist_wheel"), None)
    if not wheel or not wheel.get("url"):
        raise ValueError(f"PyPI lists no wheel for {PYPI_PROJECT_NAME} {version}")
    return str(wheel["url"]), version


async def fetch_wheel_from_pypi() -> tuple[bytes, str]:
    """Download the latest published wheel as raw bytes.

    Returns `(wheel_bytes, pypi_version)`. Caller is responsible for
    extracting + caching. Raises `httpx.HTTPError` / `ValueError` on
    upstream issues, a release published without a wheel included.
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

    The PyPI probe runs BEFORE the cache read. The route hands its pooled
    connection back (``await db.commit()``) before calling this, and a query
    issued ahead of the probe would take it out again for the whole 30 s
    round-trip (CLAUDE.md, *Never hold a database session across work that
    is not database work*).
    """
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

    cached = await get_cached_remote(db, cache_key)
    serving_remote = remote_wins(cached, bundled_version)
    active_version = cached["catalogue_version"] if cached and serving_remote else bundled_version

    update_available = False
    if remote_meta and "catalogue_version" in remote_meta:
        update_available = version_tuple(remote_meta["catalogue_version"]) > version_tuple(
            active_version
        )

    return {
        "active_version": active_version,
        "active_source": "remote" if serving_remote else "bundled",
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

    Stages the cache rows in the caller's transaction and never commits:
    the route commits once the download is over, so the pooled connection
    is not held across the PyPI round-trip (the route also commits BEFORE
    calling this, for the same reason).
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

    return {
        "catalogue_version": catalogue_version,
        "node_count": updates.get(CAPABILITY_CACHE_KEY, {}).get("node_count"),
        "process_count": updates.get(PROCESS_CACHE_KEY, {}).get("process_count"),
        "value_stream_count": updates.get(VALUE_STREAM_CACHE_KEY, {}).get("value_stream_count"),
        "fetched_at": fetched_at,
        "available_locales": sorted(set(i18n.keys()) | {"en"}),
    }
