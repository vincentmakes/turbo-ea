"""The community language library: list its languages, install or update one.

The library (``LANGUAGE_CATALOGUE_URL``, by default the ``index.json`` of
``vincentmakes/turbo-ea-translations``) publishes one language pack per
language — the app's own "Share (community pack)" export — and a generated
index of them. Packs are written by the community and **not reviewed by the
project**, so everything read from the network here is untrusted:

* The index is fetched only when an administrator asks (opening the list, or
  Refresh) — never on a timer, never at startup — and cached in its own
  ``catalogue_cache`` row (``catalogue_common.set_cached_remote``), never in
  ``general_settings``.
* Every download is https only, follows no redirect to another host, has a
  timeout, and is capped while it streams (:data:`MAX_INDEX_BYTES`,
  :data:`MAX_PACK_BYTES` — the library's own cap on a pack).
* The index is validated field by field (:func:`parse_entry`): a bad entry is
  dropped, a bad file is an error the UI shows. Nothing in it steers where the
  app downloads from — its ``pack_url`` and ``path`` are ignored: a pack's URL
  is derived from the configured index URL and the language code
  (:func:`pack_url`), pinned to the commit the entry names when the library is
  on raw.githubusercontent.com.
* A pack must hash to the entry's ``sha256``, parse without duplicate keys, be
  a ``share`` export of the requested code, pass the file checks of
  ``language_pack.validate_pack``, and is then merged through the one write
  path of a file import (``custom_locale_store.apply_strings``) with its own
  origin, ``community``. ``instructions`` is never read.
* No database session is held across a download: the orchestrators
  (:func:`catalogue`, :func:`install`) open short sessions of their own
  around the network calls, and the install's writes are one transaction —
  a failure leaves nothing half-installed.
"""

from __future__ import annotations

import hashlib
import logging
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.custom_locale import CustomLocale
from app.services import audit_log
from app.services import catalogue_common as cc
from app.services import custom_locale_store as store
from app.services import language_pack as lp

logger = logging.getLogger(__name__)

CACHE_KEY = "language_catalogue"
INDEX_FORMAT = "turbo-ea-language-pack-index"
INDEX_FORMAT_VERSION = 1
#: The only export the library accepts: UI strings plus the built-in seed's
#: database labels, nothing specific to an installation.
PACK_MODE = "share"

MAX_INDEX_BYTES = 1024 * 1024
#: The library refuses a pack over 3 MB; so does the app.
MAX_PACK_BYTES = 3 * 1024 * 1024
MAX_LANGUAGES = 500
MAX_NAME_LENGTH = 100
MAX_COUNT = 1_000_000
MAX_REDIRECTS = 3
TIMEOUT = httpx.Timeout(20.0, connect=10.0)
#: Where a pack can be pinned to the commit the index names.
RAW_GITHUB_HOST = "raw.githubusercontent.com"

# Error codes (the frontend translates them).
DISABLED = "catalogue_disabled"
UNREACHABLE = "catalogue_unreachable"
TOO_LARGE = "catalogue_too_large"
INVALID = "catalogue_invalid"
NOT_LISTED = "not_in_catalogue"
PACK_UNREACHABLE = "pack_unreachable"
PACK_TOO_LARGE = "pack_too_large"
PACK_CHECKSUM = "pack_checksum_mismatch"
PACK_INVALID = "pack_invalid"
PACK_CODE_MISMATCH = "pack_code_mismatch"
CATALOG_UNAVAILABLE = "catalog_unavailable"
LOCALE_EXISTS = "locale_exists"

#: The HTTP status a route answers each error with.
STATUS = {
    DISABLED: 404,
    NOT_LISTED: 404,
    PACK_UNREACHABLE: 502,
    PACK_TOO_LARGE: 502,
    PACK_CHECKSUM: 502,
    PACK_INVALID: 422,
    PACK_CODE_MISMATCH: 422,
    CATALOG_UNAVAILABLE: 503,
    LOCALE_EXISTS: 409,
}

_VERSION = re.compile(r"(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,5})")
_STAMP = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")
_COUNT_FIELDS = ("strings", "ui_strings", "metamodel_strings")
_OPTIONAL_COUNT_FIELDS = ("english_strings", "translated", "current")


class CatalogueError(Exception):
    """A refusal with a code from this module (see :data:`STATUS`)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


# ---------------------------------------------------------------------------
# Downloads
# ---------------------------------------------------------------------------


def is_https_url(url: Any) -> bool:
    """An absolute https URL with a host, no credentials and no whitespace or
    control character."""
    if not isinstance(url, str) or any(ch.isspace() or ord(ch) < 32 for ch in url):
        return False
    try:
        parts = urlsplit(url)
        hostname = parts.hostname
    except ValueError:
        return False
    return parts.scheme == "https" and bool(hostname) and "@" not in parts.netloc


def _client() -> httpx.AsyncClient:
    """The HTTP client of every download (tests swap in a mock transport)."""
    return httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False)


async def fetch_limited(url: str, limit: int, *, unreachable: str, too_large: str) -> bytes:
    """GET ``url`` and return at most ``limit`` bytes of body.

    https only; a redirect is followed (at most :data:`MAX_REDIRECTS`) only to
    another https URL on the same host; anything but a 200 is ``unreachable``;
    a body over ``limit`` — declared, or counted while it streams — is
    ``too_large``."""
    if not is_https_url(url):
        raise CatalogueError(unreachable)
    host = urlsplit(url).hostname
    current = url
    try:
        async with _client() as client:
            for _hop in range(MAX_REDIRECTS + 1):
                async with client.stream("GET", current) as resp:
                    if resp.is_redirect:
                        target = urljoin(current, resp.headers.get("location", ""))
                        if not is_https_url(target) or urlsplit(target).hostname != host:
                            raise CatalogueError(unreachable)
                        current = target
                        continue
                    if resp.status_code != 200:
                        raise CatalogueError(unreachable)
                    declared = resp.headers.get("content-length", "")
                    if declared.isdigit() and int(declared) > limit:
                        raise CatalogueError(too_large)
                    body = bytearray()
                    async for chunk in resp.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > limit:
                            raise CatalogueError(too_large)
                    return bytes(body)
    except httpx.HTTPError as exc:
        logger.warning("Language library download failed: %s", type(exc).__name__)
        raise CatalogueError(unreachable) from exc
    raise CatalogueError(unreachable)


def pack_url(index_url: str, code: str, commit: str | None) -> str:
    """Where the pack of ``code`` is, derived from the configured index URL.

    ``…/<dir>/index.json`` → ``…/<dir>/packs/<code>/pack.json``; on
    raw.githubusercontent.com (``/<owner>/<repo>/<ref>/index.json``) the ref
    is replaced by the entry's commit, so the file fetched is exactly the one
    the index describes. The code is checked first, so it can only be a
    language code — never a path."""
    if lp.code_error(code) is not None:
        raise CatalogueError(NOT_LISTED)
    parts = urlsplit(index_url)
    segments = parts.path.split("/")
    if parts.hostname == RAW_GITHUB_HOST and commit is not None and len(segments) == 5:
        segments[3] = commit
    path = "/".join([*segments[:-1], "packs", code, "pack.json"])
    return urlunsplit(("https", parts.netloc, path, "", ""))


# ---------------------------------------------------------------------------
# The index
# ---------------------------------------------------------------------------


def _count(value: Any) -> bool:
    return type(value) is int and 0 <= value <= MAX_COUNT


def _is_size(value: Any) -> bool:
    return type(value) is int and 0 < value <= MAX_PACK_BYTES


def _is_name(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) <= MAX_NAME_LENGTH
        and value == value.strip()
        and lp.is_valid_native_name(value)
    )


def _is_coverage(value: Any) -> bool:
    return type(value) in (int, float) and 0 <= value <= 100


def parse_entry(raw: Any) -> dict[str, Any] | None:
    """One language of the index, or ``None`` when anything about it is off.

    Only the fields the app uses are kept; an optional field that is present
    must be valid too."""
    if not isinstance(raw, Mapping):
        return None
    code = raw.get("code")
    if lp.code_error(code) is not None:  # type: ignore[arg-type]
        return None
    if not _is_name(raw.get("name")) or not lp.is_valid_english_name(raw.get("english_name")):  # type: ignore[arg-type]
        return None
    version = raw.get("app_version")
    if not isinstance(raw.get("rtl"), bool) or not (
        isinstance(version, str) and _VERSION.fullmatch(version)
    ):
        return None
    size = raw.get("size")
    if not store.is_sha256(raw.get("sha256")) or not _is_size(size):
        return None
    commit, updated = raw.get("commit"), raw.get("updated")
    if commit is not None and not store.is_commit(commit):
        return None
    if updated is not None and not (isinstance(updated, str) and _STAMP.fullmatch(updated)):
        return None
    if not all(_count(raw.get(name)) for name in _COUNT_FIELDS):
        return None
    if any(name in raw and not _count(raw[name]) for name in _OPTIONAL_COUNT_FIELDS):
        return None
    if "coverage" in raw and not _is_coverage(raw["coverage"]):
        return None
    entry = {
        "code": code,
        "name": raw["name"],
        "english_name": raw["english_name"],
        "rtl": raw["rtl"],
        "app_version": version,
        "sha256": raw["sha256"],
        "size": size,
        "commit": commit,
        "updated": updated,
        "coverage": raw.get("coverage"),
    }
    for name in (*_COUNT_FIELDS, *_OPTIONAL_COUNT_FIELDS):
        entry[name] = raw.get(name)
    return entry


def parse_index(data: bytes) -> list[dict[str, Any]]:
    """The languages of an ``index.json``. A file that is not one (bad UTF-8
    or JSON, a duplicate key, the wrong format, too many entries) is
    :data:`INVALID`; a bad entry is dropped, and so is a second entry for a
    code already listed."""
    try:
        doc = lp.parse_pack(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError) as exc:
        raise CatalogueError(INVALID) from exc
    if not isinstance(doc, dict) or doc.get("format") != INDEX_FORMAT:
        raise CatalogueError(INVALID)
    version = doc.get("format_version")
    languages = doc.get("languages")
    if type(version) is not int or version != INDEX_FORMAT_VERSION:
        raise CatalogueError(INVALID)
    if not isinstance(languages, list) or len(languages) > MAX_LANGUAGES:
        raise CatalogueError(INVALID)
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in languages:
        entry = parse_entry(raw)
        if entry is not None and entry["code"] not in seen:
            seen.add(entry["code"])
            out.append(entry)
    return out


@dataclass
class Cached:
    languages: list[dict[str, Any]]
    fetched_at: str | None


async def read_cached(db: AsyncSession, url: str) -> Cached | None:
    """The cached index for ``url`` (a cache of another URL does not count),
    with every entry validated again on the way out."""
    payload = await cc.get_cached_remote(db, CACHE_KEY)
    data = payload.get("data") if payload else None
    if not isinstance(data, Mapping) or data.get("url") != url:
        return None
    raw = data.get("languages")
    languages = [e for e in (parse_entry(r) for r in raw) if e] if isinstance(raw, list) else []
    fetched = payload.get("fetched_at") if payload else None
    return Cached(languages=languages, fetched_at=fetched if isinstance(fetched, str) else None)


async def write_cached(db: AsyncSession, url: str, languages: list[dict[str, Any]]) -> str:
    """Cache the index (its own ``catalogue_cache`` row); returns the stamp."""
    stamp = datetime.now(timezone.utc).isoformat()
    payload = {"data": {"url": url, "languages": languages}, "fetched_at": stamp}
    await cc.set_cached_remote(db, {CACHE_KEY: payload})
    return stamp


def listing(
    url: str,
    cached: Cached | None,
    error: str | None,
    installed: Mapping[str, CustomLocale],
) -> dict[str, Any]:
    """The ``GET /custom-locales/catalogue`` payload: each language with
    whether it is installed here and whether the library has another pack
    than the one installed."""
    languages = []
    for entry in cached.languages if cached else []:
        locale = installed.get(entry["code"])
        languages.append(
            {
                **entry,
                "installed": locale is not None,
                "installed_from_community": bool(
                    locale is not None and locale.source == store.ORIGIN_COMMUNITY
                ),
                "update_available": bool(
                    locale is not None and locale.source_sha256 != entry["sha256"]
                ),
            }
        )
    return {
        "enabled": True,
        "url": url,
        "fetched_at": cached.fetched_at if cached else None,
        "error": error,
        "languages": languages,
    }


def disabled_listing() -> dict[str, Any]:
    return {"enabled": False, "url": None, "fetched_at": None, "error": None, "languages": []}


def _session():
    from app.database import async_session

    return async_session()


async def catalogue(url: str, *, refresh: bool) -> dict[str, Any]:
    """The library's languages. The index is downloaded when ``refresh`` is
    asked or nothing is cached for ``url`` yet; a failed download keeps the
    cached list and reports the error beside it. No session is open during
    the download."""
    if not url:
        return disabled_listing()
    async with _session() as db:
        cached = await read_cached(db, url)
    error: str | None = None
    if refresh or cached is None:
        try:
            data = await fetch_limited(
                url, MAX_INDEX_BYTES, unreachable=UNREACHABLE, too_large=TOO_LARGE
            )
            languages = parse_index(data)
        except CatalogueError as exc:
            error = exc.code
        else:
            async with _session() as db:
                stamp = await write_cached(db, url, languages)
                await db.commit()
            cached = Cached(languages=languages, fetched_at=stamp)
    async with _session() as db:
        installed = {loc.code: loc for loc in await store.list_locales(db)}
    return listing(url, cached, error, installed)


# ---------------------------------------------------------------------------
# Installing a pack
# ---------------------------------------------------------------------------


def read_pack(data: bytes, code: str, cat: lp.Catalog) -> dict[str, Any]:
    """The pack in ``data`` if it is a ``share`` export of ``code`` whose file
    checks pass (:func:`language_pack.validate_pack`: format, version, code —
    never a built-in one —, English name, the shape of ``source_hashes``).
    Problems with single strings are not fatal here: the merge reports each.
    """
    try:
        pack = lp.parse_pack(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError) as exc:
        raise CatalogueError(PACK_INVALID) from exc
    if not isinstance(pack, dict) or pack.get("mode") != PACK_MODE:
        raise CatalogueError(PACK_INVALID)
    locale = pack.get("locale")
    if not isinstance(locale, dict):
        raise CatalogueError(PACK_INVALID)
    if locale.get("code") != code:
        raise CatalogueError(PACK_CODE_MISMATCH)
    if not _is_name(locale.get("name")) or not isinstance(locale.get("rtl"), bool):
        raise CatalogueError(PACK_INVALID)
    problems = lp.validate_pack(pack, cat)
    if any(not p["namespace"] and not p["key"] for p in problems):
        raise CatalogueError(PACK_INVALID)
    return pack


@dataclass
class Payload:
    """What a pack asks to write, as ``apply_strings`` takes it."""

    strings: dict[str, dict[str, Any]]
    hashes: dict[str, dict[str, Any]]
    #: Values that are not strings: a pack cannot clear a translation.
    refused: list[dict[str, str]]


def pack_payload(pack: Mapping[str, Any]) -> Payload:
    """``strings`` / ``source_hashes`` of a checked pack. A ``null`` value would
    clear a key on the write path; from a pack it is refused instead."""
    strings: dict[str, dict[str, Any]] = {}
    refused: list[dict[str, str]] = []
    for namespace, entries in pack["strings"].items():
        if not isinstance(entries, Mapping):
            strings[namespace] = entries
            continue
        kept = {}
        for key, value in entries.items():
            if value is None:
                refused.append({"namespace": namespace, "key": key, "reason": lp.NOT_A_STRING})
            else:
                kept[key] = value
        strings[namespace] = kept
    hashes = pack.get("source_hashes") or {}
    return Payload(strings=strings, hashes=dict(hashes), refused=refused)


async def keep_manual(
    db: AsyncSession, locale: CustomLocale, cat: lp.Catalog, payload: Payload
) -> int:
    """Leave out of ``payload`` every key the language holds a hand-corrected
    (origin ``manual``) value for; returns how many were left out."""
    names = [n for n in payload.strings if n == store.METAMODEL or store.known_namespace(cat, n)]
    views = await store.load_views(db, locale, cat, names)
    kept = 0
    for name, view in views.items():
        entries = payload.strings.get(name)
        if not isinstance(entries, dict):
            continue
        for key in list(entries):
            meta = view.meta.get(key)
            if key in view.strings and isinstance(meta, Mapping) and meta.get("o") == "manual":
                del entries[key]
                kept += 1
    return kept


async def apply_pack(
    db: AsyncSession,
    pack: Mapping[str, Any],
    entry: Mapping[str, Any],
    cat: lp.Catalog,
    *,
    overwrite_manual: bool,
    actor: Any,
    action: str,
) -> dict[str, Any]:
    """Merge a checked pack into its language — created, **disabled**, from the
    pack's header when it does not exist yet — and record where it came from.
    Never commits."""
    code = entry["code"]
    locale = await store.get_locale(db, code, lock=True)
    created = locale is None
    if locale is None:
        header = pack["locale"]
        locale = CustomLocale(
            code=code,
            name=header["name"],
            english_name=header["english_name"],
            rtl=header["rtl"],
            enabled=False,
        )
        try:
            # A savepoint: a concurrent first install (or create) of the same
            # code is a 409 and leaves the session usable.
            async with db.begin_nested():
                db.add(locale)
                await db.flush()
        except IntegrityError as exc:
            raise CatalogueError(LOCALE_EXISTS) from exc
    payload = pack_payload(pack)
    kept_manual = 0
    if not created and not overwrite_manual:
        kept_manual = await keep_manual(db, locale, cat, payload)
    report = await store.apply_strings(
        db,
        locale,
        cat,
        payload.strings,
        origin=store.ORIGIN_COMMUNITY,
        source_hashes=payload.hashes,
    )
    report["rejected"] = [*payload.refused, *report["rejected"]]
    locale.source = store.ORIGIN_COMMUNITY
    locale.source_sha256 = entry["sha256"]
    locale.source_commit = entry["commit"]
    await audit_log.record(
        db,
        action=action,
        category="admin",
        actor=actor,
        target=("custom_locale", str(locale.id), locale.name),
        context={
            "code": code,
            "created": created,
            "sha256": entry["sha256"],
            "commit": entry["commit"],
            "overwrite_manual": overwrite_manual,
            "applied": report["applied"],
            "rejected": len(report["rejected"]),
            "kept_manual": kept_manual,
        },
    )
    await db.flush()
    return {
        **report,
        "created": created,
        "kept_manual": kept_manual,
        "locale": await store.serialize_one(db, locale),
    }


async def install(
    url: str, code: str, *, overwrite_manual: bool, actor: Any, action: str
) -> dict[str, Any]:
    """Download the library's pack of ``code`` and merge it (see the module
    docstring for every check). The language must be in the cached index —
    list it first. One short session reads the index entry, the download runs
    with none open, and one transaction writes everything or nothing.
    ``action`` is the audit action the route names."""
    if not url:
        raise CatalogueError(DISABLED)
    async with _session() as db:
        cached = await read_cached(db, url)
    entry = next((e for e in cached.languages if e["code"] == code), None) if cached else None
    if entry is None:
        raise CatalogueError(NOT_LISTED)
    data = await fetch_limited(
        pack_url(url, code, entry["commit"]),
        MAX_PACK_BYTES,
        unreachable=PACK_UNREACHABLE,
        too_large=PACK_TOO_LARGE,
    )
    if hashlib.sha256(data).hexdigest() != entry["sha256"]:
        raise CatalogueError(PACK_CHECKSUM)
    cat = store.catalog()
    if cat is None:
        raise CatalogueError(CATALOG_UNAVAILABLE)
    pack = read_pack(data, code, cat)
    async with _session() as db:
        result = await apply_pack(
            db, pack, entry, cat, overwrite_manual=overwrite_manual, actor=actor, action=action
        )
        await db.commit()
    return result
