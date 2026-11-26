"""Stored custom languages: the database side of ``language_pack``.

Route handlers are never mutated by mutmut, so the logic behind
``api/v1/custom_locales.py`` lives here as plain functions. None of them
commits: the caller owns the session.

A locale is read as a set of **views**, one per namespace: the namespace's
English (a ``language_pack.Namespace``), the stored translations and their
``meta``. The 14 UI namespaces come from the English catalogue and the
``custom_locale_strings`` rows; the ``metamodel`` namespace comes from the
database labels (``metamodel_strings``), always listed first. Every status,
listing, export and merge then runs the same ``language_pack`` code on either.
"""

from __future__ import annotations

import json
import re
import uuid
from collections import OrderedDict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Text, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import APP_VERSION
from app.config import settings as app_config
from app.models.custom_locale import CustomLocale, CustomLocaleString
from app.models.user import User
from app.services import language_pack as lp
from app.services import metamodel_strings as mm

METAMODEL = mm.NAMESPACE
#: What a value served without an English source to check against may not
#: hold: anything that could open a tag, nest a translation or interpolate.
_UNCHECKABLE = re.compile(r"[<{}]|\$t\(")
SOURCE_CHANGED = "source_changed"
SOURCE_HASH_MISSING = "source_hash_missing"

#: The origin of a string installed from the community library
#: (``services/language_catalogue.py``). Like ``import``, it comes from a
#: language-pack file, so the ``metamodel`` rules of a file import apply.
ORIGIN_COMMUNITY = "community"
#: Origins whose strings come from a pack file: every ``metamodel`` value must
#: carry the hash of the English it translates.
FILE_ORIGINS = frozenset({"import", ORIGIN_COMMUNITY})


def catalog() -> lp.Catalog | None:
    """The English catalogue (``I18N_EN_DIR`` overrides where it is read)."""
    return lp.load_catalog(app_config.I18N_EN_DIR or None)


def known_namespace(cat: lp.Catalog, name: str) -> bool:
    return name == METAMODEL or cat.namespace(name) is not None


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


async def get_locale(db: AsyncSession, code: str, *, lock: bool = False) -> CustomLocale | None:
    """The locale ``code``; with ``lock`` its row is read ``FOR UPDATE`` (and
    refreshed), so a decision taken on it holds until the commit."""
    stmt = select(CustomLocale).where(CustomLocale.code == code)
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    return (await db.execute(stmt)).scalar_one_or_none()


def transfer_problem(row: Mapping[str, Any]) -> str | None:
    """Why a workspace bundle's ``CustomLocales`` row must not land: the same
    checks as the create route (a built-in or malformed code, an English name
    unfit for a prompt or a header, a native name with forbidden characters).
    ``metamodel_strings.apply`` refuses a built-in code as well."""
    code = row.get("code")
    error = lp.code_error(code, mm.built_in_locales())  # type: ignore[arg-type]
    if error is not None:
        return f"language code {code!r}: {error}"
    if not lp.is_valid_english_name(row.get("english_name")):  # type: ignore[arg-type]
        return f"language {code!r}: invalid English name"
    if not lp.is_valid_native_name(row.get("name")):  # type: ignore[arg-type]
        return f"language {code!r}: invalid name"
    if not is_valid_provenance(
        row.get("source"), row.get("source_sha256"), row.get("source_commit")
    ):
        return f"language {code!r}: invalid source"
    return None


_SHA256 = re.compile(r"[0-9a-f]{64}")
_COMMIT = re.compile(r"[0-9a-f]{40}")


def is_sha256(value: Any) -> bool:
    """A lower-case hex SHA-256 digest."""
    return isinstance(value, str) and bool(_SHA256.fullmatch(value))


def is_commit(value: Any) -> bool:
    """A full lower-case hex git commit id."""
    return isinstance(value, str) and bool(_COMMIT.fullmatch(value))


def is_valid_provenance(source: Any, sha256: Any, commit: Any) -> bool:
    """Whether a language's ``source`` / ``source_sha256`` / ``source_commit``
    have the shape an install writes: all empty (added by hand), or the
    community origin with a digest and, where the library named one, a commit."""
    if source is None:
        return sha256 is None and commit is None
    return (
        source == ORIGIN_COMMUNITY and is_sha256(sha256) and (commit is None or is_commit(commit))
    )


#: Bounds of one ``POST …/strings``: keys across all namespaces, and the
#: longest value accepted before the validator even looks at it.
MAX_KEYS_PER_WRITE = 10_000


def payload_problem(strings: Mapping[str, Mapping[str, Any]]) -> str | None:
    """Why a write's ``strings`` is too large to look at, or ``None``."""
    total = 0
    for entries in strings.values():
        total += len(entries)
        if total > MAX_KEYS_PER_WRITE:
            return f"at most {MAX_KEYS_PER_WRITE} strings per request"
        for value in entries.values():
            if isinstance(value, str) and len(value) > lp.MAX_VALUE_LENGTH:
                return f"a value is longer than {lp.MAX_VALUE_LENGTH} characters"
    return None


async def list_locales(db: AsyncSession) -> list[CustomLocale]:
    return list((await db.execute(select(CustomLocale).order_by(CustomLocale.code))).scalars())


async def is_enabled_code(db: AsyncSession, code: str) -> bool:
    """Whether ``code`` is a custom locale a user may choose."""
    found = await db.execute(
        select(CustomLocale.id).where(CustomLocale.code == code, CustomLocale.enabled.is_(True))
    )
    return found.scalar_one_or_none() is not None


async def english_name_for(db: AsyncSession, code: str | None) -> str | None:
    """The stored English name of the custom locale ``code`` (what an AI
    prompt names the language by), or ``None`` when it is not one."""
    if not code:
        return None
    found = await db.execute(select(CustomLocale.english_name).where(CustomLocale.code == code))
    return found.scalar_one_or_none()


async def load_rows(
    db: AsyncSession, locale_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, dict[str, CustomLocaleString]]:
    """``{locale_id: {namespace: row}}`` for the given locales."""
    ids = list(locale_ids)
    out: dict[uuid.UUID, dict[str, CustomLocaleString]] = {i: {} for i in ids}
    if not ids:
        return out
    rows = await db.execute(select(CustomLocaleString).where(CustomLocaleString.locale_id.in_(ids)))
    for row in rows.scalars():
        out[row.locale_id][row.namespace] = row
    return out


def _stored(rows: Mapping[str, CustomLocaleString], namespace: str) -> tuple[dict, dict]:
    row = rows.get(namespace)
    if row is None:
        return {}, {}
    return dict(row.strings or {}), dict(row.meta or {})


@dataclass
class View:
    """One namespace of one locale: its English, the translations, their meta."""

    ns: lp.Namespace
    strings: dict[str, Any]
    meta: dict[str, Any]
    #: ``metamodel`` only: the keys whose key and English are the built-in seed's.
    shareable: frozenset[str] = field(default_factory=frozenset)


def metamodel_view(snap: mm.Snapshot, code: str, row: CustomLocaleString | None) -> View:
    """The ``metamodel`` namespace of ``code``. A label that holds a value
    under the code but has no ``meta`` entry was written by someone else (the
    field editor, an extension manifest, a workspace import): it reads as a
    current manual translation — never as stale, or the next AI run would
    overwrite it — and that meta is stored on the next write."""
    pack_strings = dict(row.strings or {}) if row is not None else {}
    meta = dict(row.meta or {}) if row is not None else {}
    items = mm.entries(snap, code, pack_strings)
    ns = mm.namespace_of(items)
    strings = mm.values_of(items)
    full_meta = dict(meta)
    for key in strings:
        if not isinstance(full_meta.get(key), Mapping):
            full_meta[key] = {"h": ns.hashes[key], "o": "manual"}
    return View(
        ns=ns,
        strings=strings,
        meta=full_meta,
        shareable=frozenset(e.key for e in items if e.built_in),
    )


def build_views(
    cat: lp.Catalog | None,
    snap: mm.Snapshot | None,
    code: str,
    rows: Mapping[str, CustomLocaleString],
    names: Iterable[str] | None = None,
) -> dict[str, View]:
    """``{namespace: View}``, ``metamodel`` first, then the catalogue order.
    ``names`` restricts it; a name nobody knows is left out."""
    wanted = set(names) if names is not None else None
    out: dict[str, View] = {}
    if snap is not None and (wanted is None or METAMODEL in wanted):
        out[METAMODEL] = metamodel_view(snap, code, rows.get(METAMODEL))
    if cat is None:
        return out
    for name, ns in cat.namespaces.items():
        if wanted is not None and name not in wanted:
            continue
        strings, meta = _stored(rows, name)
        out[name] = View(ns=ns, strings=strings, meta=meta)
    return out


async def load_views(
    db: AsyncSession,
    locale: CustomLocale,
    cat: lp.Catalog | None,
    names: Iterable[str] | None = None,
) -> dict[str, View]:
    wanted = list(names) if names is not None else None
    rows = (await load_rows(db, [locale.id]))[locale.id]
    snap = await mm.load(db) if wanted is None or METAMODEL in wanted else None
    return build_views(cat, snap, locale.code, rows, wanted)


def namespace_stats(views: Mapping[str, View]) -> list[dict[str, Any]]:
    """Per-namespace ``{namespace, total, translated, missing, stale}``."""
    return [
        {"namespace": name, **lp.namespace_stats(v.ns, v.strings, v.meta)}
        for name, v in views.items()
    ]


def last_change(locale: CustomLocale, rows: Mapping[str, CustomLocaleString]) -> datetime | None:
    stamps = [s for s in [locale.updated_at, *(r.updated_at for r in rows.values())] if s]
    return max(stamps) if stamps else None


def serialize(
    locale: CustomLocale,
    rows: Mapping[str, CustomLocaleString],
    views: Mapping[str, View] | None,
    *,
    with_namespaces: bool = False,
) -> dict[str, Any]:
    """The admin payload of one locale. ``stats`` is ``None`` when there is
    nothing to count against (no English catalogue)."""
    per_ns = namespace_stats(views) if views is not None else []
    stamp = last_change(locale, rows)
    out: dict[str, Any] = {
        "code": locale.code,
        "name": locale.name,
        "english_name": locale.english_name,
        "rtl": bool(locale.rtl),
        "enabled": bool(locale.enabled),
        "updated_at": stamp.isoformat() if stamp else None,
        "stats": lp.sum_stats(per_ns) if views is not None else None,
        "job": locale.translate_job,
        # ``"community"`` for a language installed from the community library.
        "source": locale.source,
    }
    if with_namespaces:
        out["namespaces"] = per_ns
    return out


async def serialize_all(db: AsyncSession, locales: list[CustomLocale]) -> list[dict[str, Any]]:
    """The admin list: every locale with its progress (one read of the
    metamodel labels for all of them)."""
    if not locales:
        return []
    cat = catalog()
    rows = await load_rows(db, [loc.id for loc in locales])
    snap = await mm.load(db) if cat is not None else None
    return [
        serialize(
            loc,
            rows[loc.id],
            build_views(cat, snap, loc.code, rows[loc.id]) if cat is not None else None,
        )
        for loc in locales
    ]


async def serialize_one(db: AsyncSession, locale: CustomLocale) -> dict[str, Any]:
    cat = catalog()
    rows = (await load_rows(db, [locale.id]))[locale.id]
    views = build_views(cat, await mm.load(db), locale.code, rows) if cat is not None else None
    return serialize(locale, rows, views, with_namespaces=True)


def list_strings(
    views: Mapping[str, View], *, namespace: str | None, status: str, search: str
) -> list[dict[str, Any]]:
    """The review rows over one namespace or all of them."""
    out: list[dict[str, Any]] = []
    for name, v in views.items():
        if namespace and name != namespace:
            continue
        out.extend(lp.list_entries(v.ns, v.strings, v.meta, status=status, search=search))
    return out


# ---------------------------------------------------------------------------
# Identical English text: shown once, translated once
# ---------------------------------------------------------------------------


def _text_class(source_hash: Any, key: str) -> tuple[Any, str | None]:
    """What makes two keys "the same text": the hash of their English and their
    plural category, so a ``_few`` form never stands for an ``_other`` key or a
    plain one with the same English."""
    parts = lp.plural_parts(key)
    return source_hash, parts[1] if parts else None


def collapse_identical(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The review rows with each English text once: the first row of every
    text stands for the others and carries ``same_text``, how many rows have
    it (itself included). For a translator who fills all of them with one
    answer (``POST …/strings`` with ``fill_identical``)."""
    first: dict[tuple[Any, str | None], dict[str, Any]] = {}
    out: list[dict[str, Any]] = []
    for item in items:
        kind = _text_class(item.get("source_hash"), item["key"])
        if kind in first:
            first[kind]["same_text"] += 1
            continue
        row = {**item, "same_text": 1}
        first[kind] = row
        out.append(row)
    return out


def _given_hash(source_hashes: Mapping[str, Any] | None, name: str, key: str) -> Any:
    given = (source_hashes or {}).get(name)
    return given.get(key) if isinstance(given, Mapping) else None


def identical_text_fills(
    views: Mapping[str, View],
    submitted: Mapping[str, Any],
    skip: set[tuple[str, str]],
    source_hashes: Mapping[str, Any] | None = None,
) -> dict[str, dict[str, str]]:
    """For every text value submitted for a key English has (and not in
    ``skip``, the keys the merge refused), the same value for every OTHER key
    of the language with the same English and plural category that holds no
    translation at all — never one already translated, whatever its origin.

    A value translated from older English (its ``source_hashes`` entry is not
    the current hash) fills nothing: its twins would read as current. Two
    different values for one text fill nothing either — which is right is
    not ours to guess."""
    by_text: dict[tuple[Any, str | None], str | None] = {}
    for name, entries in submitted.items():
        view = views.get(name)
        if view is None or not isinstance(entries, Mapping):
            continue
        for key, value in entries.items():
            if not isinstance(value, str) or key not in view.ns.strings or (name, key) in skip:
                continue
            current = view.ns.current_hash(key)
            given = _given_hash(source_hashes, name, key)
            if given is not None and given != current:
                continue
            kind = _text_class(current, key)
            by_text[kind] = value if by_text.get(kind, value) == value else None
    fills: dict[str, dict[str, str]] = {}
    for name, view in views.items():
        sent = submitted.get(name)
        sent = sent if isinstance(sent, Mapping) else {}
        for key in view.ns.strings:
            if key in sent or view.strings.get(key):
                continue
            value = by_text.get(_text_class(view.ns.current_hash(key), key))
            if value is not None:
                fills.setdefault(name, {})[key] = value
    return fills


async def fill_identical(
    db: AsyncSession,
    locale: CustomLocale,
    cat: lp.Catalog,
    submitted: Mapping[str, Any],
    report: Mapping[str, Any],
    *,
    origin: str,
    dry_run: bool,
    source_hashes: Mapping[str, Any] | None = None,
) -> tuple[dict[str, int], list[str]]:
    """After a write, give its accepted translations to every key with the
    same English and no translation (:func:`identical_text_fills`), through
    the same merge and validator. Returns ``({filled, fill_rejected}, the
    namespaces filled)``. The write is conditional on each key still being
    empty (``expected``), so a label the field editor set meanwhile stays."""
    skip = {(r.get("namespace"), r.get("key")) for r in report.get("rejected") or []}
    views = await load_views(db, locale, cat)
    fills = identical_text_fills(views, submitted, skip, source_hashes)  # type: ignore[arg-type]
    if not fills:
        return {"filled": 0, "fill_rejected": 0}, []
    empty = {name: dict.fromkeys(keys) for name, keys in fills.items()}
    filled = await apply_strings(
        db, locale, cat, fills, origin=origin, dry_run=dry_run, expected=empty
    )
    counts = {"filled": filled["applied"], "fill_rejected": len(filled["rejected"])}
    return counts, sorted(fills)


def export_parts(views: Mapping[str, View], mode: str) -> dict[str, tuple[dict, dict]]:
    """``{namespace: (strings, source_hashes)}`` of an export.

    ``share`` is the community pack: every UI namespace as ``current``, and of
    ``metamodel`` only the entries whose key and English are the built-in
    seed's and whose translation was made from that English — nothing an
    installation made up, renamed or added."""
    parts: dict[str, tuple[dict, dict]] = {}
    for name, v in views.items():
        if mode != "share":
            parts[name] = lp.export_namespace(v.ns, v.strings, v.meta, mode)
            continue
        strings, hashes = lp.export_namespace(v.ns, v.strings, v.meta, "current")
        if name == METAMODEL:
            # Built-in key and English, and translated from that English: a
            # label renamed, translated and renamed back is not shareable.
            strings = {
                k: text
                for k, text in strings.items()
                if k in v.shareable and hashes.get(k) == v.ns.hashes.get(k)
            }
            hashes = {k: h for k, h in hashes.items() if k in strings}
        parts[name] = (strings, hashes)
    return parts


def export_pack(locale: CustomLocale, views: Mapping[str, View], *, mode: str) -> dict[str, Any]:
    return lp.build_pack(
        locale={
            "code": locale.code,
            "name": locale.name,
            "english_name": locale.english_name,
            "rtl": locale.rtl,
        },
        mode=mode,
        app_version=APP_VERSION,
        namespaces=export_parts(views, mode),
    )


# ---------------------------------------------------------------------------
# Bundle and bootstrap
# ---------------------------------------------------------------------------


async def namespace_digests(
    db: AsyncSession, locale_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, list[tuple[str, str]]]:
    """``{locale_id: [(namespace, md5 of the stored strings)]}`` of the UI
    namespaces — computed by PostgreSQL, so a bundle's hash never needs the
    strings themselves. ``metamodel`` is not in the bundle and not hashed."""
    ids = list(locale_ids)
    out: dict[uuid.UUID, list[tuple[str, str]]] = {i: [] for i in ids}
    if not ids:
        return out
    rows = await db.execute(
        select(
            CustomLocaleString.locale_id,
            CustomLocaleString.namespace,
            func.md5(cast(CustomLocaleString.strings, Text)),
        ).where(
            CustomLocaleString.locale_id.in_(ids),
            CustomLocaleString.namespace != METAMODEL,
        )
    )
    for locale_id, namespace, digest in rows.all():
        out[locale_id].append((namespace, digest))
    return out


def locale_hash(
    locale: CustomLocale, digests: Iterable[tuple[str, str]], cat: lp.Catalog | None
) -> str:
    fingerprint = cat.fingerprint if cat is not None else "no-catalog"
    return lp.bundle_hash(
        fingerprint, locale.code, locale.name, bool(locale.rtl), digests, APP_VERSION
    )


async def enabled_locales(db: AsyncSession) -> list[CustomLocale]:
    return list(
        (
            await db.execute(
                select(CustomLocale)
                .where(CustomLocale.enabled.is_(True))
                .order_by(CustomLocale.code)
            )
        ).scalars()
    )


async def bootstrap_payload(
    db: AsyncSession, phase_help: Mapping[str, Mapping[str, str]]
) -> tuple[list[dict[str, Any]], dict[str, dict[str, str]]]:
    """``(custom_locales, lifecycle_phase_help)`` for ``/settings/bootstrap``,
    in one read of the enabled locales and one of their rows.

    ``custom_locales`` is ``[{code, name, rtl, hash}]`` of the enabled custom
    locales; the phase help gets every enabled locale's phase texts laid over
    it (``metamodel_strings.overlay_phase_help``)."""
    locales = await enabled_locales(db)
    if not locales:
        return [], {phase: dict(texts) for phase, texts in phase_help.items()}
    by_id = {loc.id: loc for loc in locales}
    rows = await db.execute(
        select(
            CustomLocaleString.locale_id,
            CustomLocaleString.namespace,
            func.md5(cast(CustomLocaleString.strings, Text)),
        ).where(CustomLocaleString.locale_id.in_(list(by_id)))
    )
    digests: dict[uuid.UUID, list[tuple[str, str]]] = {i: [] for i in by_id}
    with_help: list[uuid.UUID] = []
    for locale_id, namespace, digest in rows.all():
        if namespace == METAMODEL:
            with_help.append(locale_id)
        else:
            digests[locale_id].append((namespace, digest))
    per_locale: dict[str, Any] = {}
    if with_help:
        help_rows = await db.execute(
            select(CustomLocaleString.locale_id, CustomLocaleString.strings).where(
                CustomLocaleString.locale_id.in_(with_help),
                CustomLocaleString.namespace == METAMODEL,
            )
        )
        per_locale = {by_id[i].code: strings or {} for i, strings in help_rows.all()}
    cat = catalog()
    entries = [
        {
            "code": loc.code,
            "name": loc.name,
            "rtl": bool(loc.rtl),
            "hash": locale_hash(loc, digests[loc.id], cat),
        }
        for loc in locales
    ]
    return entries, mm.overlay_phase_help(phase_help, per_locale)


def bundle_resources(
    cat: lp.Catalog | None, rows: Mapping[str, CustomLocaleString], code: str
) -> dict[str, dict[str, Any]]:
    """``{namespace: resource}`` of the UI namespaces, every value re-checked
    by the validator (``language_pack.servable``). Without the English
    catalogue nothing can be checked, so nothing that could carry markup is
    served: the stored strings go out flat (i18next resolves a dotted flat key
    all the same) only when they hold no ``<``, ``$t(`` or brace."""
    if cat is None:
        return {
            name: {
                key: value
                for key, value in (row.strings or {}).items()
                if isinstance(value, str) and not _UNCHECKABLE.search(value)
            }
            for name, row in sorted(rows.items())
            if name != METAMODEL
        }
    out: dict[str, dict[str, Any]] = {}
    for name, ns in cat.namespaces.items():
        strings, _meta = _stored(rows, name)
        tree = lp.build_namespace_bundle(ns, strings, code)
        if tree:
            out[name] = tree
    return out


def bundle_body(
    locale: CustomLocale, tag: str, cat: lp.Catalog | None, rows: Mapping[str, CustomLocaleString]
) -> bytes:
    """The serialised bundle response: ``{code, name, rtl, hash, resources}``."""
    payload = {
        "code": locale.code,
        "name": locale.name,
        "rtl": bool(locale.rtl),
        "hash": tag,
        "resources": bundle_resources(cat, rows, locale.code),
    }
    text = json.dumps(payload, ensure_ascii=False)  # pragma: no mutate, None is falsy like False
    return text.encode()


class BundleCache:
    """The last few serialised bundles, keyed by ``(code, hash)``: the hash
    changes with every stored string, the English catalogue, the locale's name
    and direction and the app version, so an entry is never stale — a bundle
    is built (and every value re-validated) once per version, not per
    request."""

    def __init__(self, size: int = 16):
        self.size = size
        self._entries: OrderedDict[tuple[str, str], bytes] = OrderedDict()

    def get(self, code: str, tag: str) -> bytes | None:
        body = self._entries.get((code, tag))
        if body is not None:
            self._entries.move_to_end((code, tag))
        return body

    def put(self, code: str, tag: str, body: bytes) -> None:
        self._entries[(code, tag)] = body
        self._entries.move_to_end((code, tag))
        while len(self._entries) > self.size:
            del self._entries[next(iter(self._entries))]

    def clear(self) -> None:
        self._entries.clear()


BUNDLE_CACHE = BundleCache()


def etag_matches(header: str | None, tag: str) -> bool:
    """Whether an ``If-None-Match`` header names ``tag`` (quoted or weak)."""
    if not header:
        return False
    for part in header.split(","):
        candidate = part.strip()
        if candidate == "*":
            return True
        if candidate.startswith("W/"):
            candidate = candidate[2:]
        if candidate.strip('"') == tag:
            return True
    return False


# ---------------------------------------------------------------------------
# Writes (never commit)
# ---------------------------------------------------------------------------


async def lock_locale(db: AsyncSession, locale: CustomLocale) -> None:
    """Lock the locale's row (``SELECT … FOR UPDATE``): every write to its
    strings takes it first, so two first writes to a namespace that has no row
    yet cannot both insert one."""
    await db.execute(select(CustomLocale.id).where(CustomLocale.id == locale.id).with_for_update())


async def locked_row(
    db: AsyncSession, locale: CustomLocale, namespace: str, *, create: bool
) -> CustomLocaleString | None:
    """The namespace row, locked for the merge (``SELECT … FOR UPDATE``);
    created (and flushed) when missing and ``create`` is true. The caller
    holds the locale's lock (:func:`lock_locale`)."""
    row = (
        await db.execute(
            select(CustomLocaleString)
            .where(
                CustomLocaleString.locale_id == locale.id,
                CustomLocaleString.namespace == namespace,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None and create:
        row = CustomLocaleString(locale_id=locale.id, namespace=namespace)
        db.add(row)
        await db.flush()
    return row


@dataclass
class MetamodelSplit:
    """``incoming`` for the ``metamodel`` namespace, sorted by
    :func:`source_changed`."""

    kept: dict[str, Any] = field(default_factory=dict)
    refused: list[dict[str, str]] = field(default_factory=list)
    unchanged: int = 0


def source_changed(
    view: View,
    incoming: Mapping[str, Any],
    hashes: Mapping[str, Any] | None,
    *,
    origin: str,
) -> MetamodelSplit:
    """Sort ``incoming`` for the ``metamodel`` namespace into what may be
    merged, what is refused and what is unchanged.

    * A value equal to the stored one that comes with a hash, or from an
      import, is ``unchanged`` — never refused: re-importing a ``current``
      export does not report every stale label.
    * A given source hash that is not the current English hash means the value
      was translated from a label that has changed since (an admin renamed the
      type): ``source_changed``.
    * An import or a community install must carry the hash of every
      ``metamodel`` value (every export writes one): ``source_hash_missing``.
    * A manual or MCP write without a hash, a clear (``None``) and a key the
      namespace does not have (the merge counts it unknown) pass through."""
    split = MetamodelSplit()
    for key, value in incoming.items():
        given = (hashes or {}).get(key)
        current = view.ns.current_hash(key)
        has_hash = lp.is_source_hash(given)
        if value is None or current is None:
            split.kept[key] = value
        elif view.strings.get(key) == value and (has_hash or origin in FILE_ORIGINS):
            split.unchanged += 1
        elif has_hash and given != current:
            split.refused.append({"namespace": METAMODEL, "key": key, "reason": SOURCE_CHANGED})
        elif origin in FILE_ORIGINS and not has_hash:
            split.refused.append(
                {"namespace": METAMODEL, "key": key, "reason": SOURCE_HASH_MISSING}
            )
        else:
            split.kept[key] = value
    return split


def label_changes(before: Mapping[str, Any], after: Mapping[str, Any]) -> dict[str, str | None]:
    """``{key: new value | None}`` for every key whose value changed."""
    return {
        key: after.get(key)
        for key in sorted(set(before) | set(after))
        if before.get(key) != after.get(key)
    }


async def _merge_metamodel(
    db: AsyncSession,
    locale: CustomLocale,
    entries: Mapping[str, Any],
    *,
    origin: str,
    hashes: Mapping[str, Any] | None,
    dry_run: bool,
    expected: Mapping[str, Any] | None,
) -> lp.MergeResult:
    row = await locked_row(db, locale, METAMODEL, create=not dry_run)
    snap = await mm.load(db)
    view = metamodel_view(snap, locale.code, row)
    split = source_changed(view, entries, hashes, origin=origin)
    # No source hashes here: ``source_changed`` has refused every value whose
    # hash differs, so what is left is stored with the current English hash.
    merged = lp.merge_strings(
        view.ns, view.strings, view.meta, split.kept, origin=origin, expected=expected
    )
    merged.rejected = [*split.refused, *merged.rejected]
    merged.unchanged += split.unchanged
    if not dry_run and row is not None:
        await mm.apply(db, locale.code, label_changes(view.strings, merged.strings), snap)
        # Reassigned whatever they hold: an equal value is not an UPDATE.
        row.strings = {k: v for k, v in merged.strings.items() if k in snap.lifecycle}
        row.meta = merged.meta
    return merged


def _unknown_namespace(namespace: str, entries: Any) -> lp.MergeResult:
    """A namespace English does not have: every key in it is unknown."""
    result = lp.MergeResult()
    if isinstance(entries, Mapping):
        for key in entries:
            result.add_unknown(namespace, key)
    return result


async def apply_strings(
    db: AsyncSession,
    locale: CustomLocale,
    cat: lp.Catalog,
    payload: Mapping[str, Mapping[str, Any]],
    *,
    origin: str,
    source_hashes: Mapping[str, Mapping[str, Any]] | None = None,
    dry_run: bool = False,
    expected: Mapping[str, Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Merge ``payload`` (``{namespace: {key: value | None}}``) into the stored
    strings and return the summed report ``{applied, unchanged, cleared,
    rejected, unknown, unknown_keys}``. With ``dry_run`` nothing is written.
    ``expected`` makes each namespace's write conditional (see
    ``language_pack.merge_strings``).

    The locale's row is locked first and the namespaces are merged in sorted
    order, so two writers can neither both create a namespace row nor lock
    two rows in opposite orders."""
    totals = lp.MergeResult()
    hashes = source_hashes or {}
    await lock_locale(db, locale)
    for namespace in sorted(payload):
        entries = payload[namespace]
        ns_hashes = hashes.get(namespace)
        ns_hashes = ns_hashes if isinstance(ns_hashes, Mapping) else None
        ns_expected = expected.get(namespace) if expected is not None else None
        ns = cat.namespace(namespace)
        if not isinstance(entries, Mapping) or (ns is None and namespace != METAMODEL):
            merged = _unknown_namespace(namespace, entries)
        elif namespace == METAMODEL:
            merged = await _merge_metamodel(
                db,
                locale,
                entries,
                origin=origin,
                hashes=ns_hashes,
                dry_run=dry_run,
                expected=ns_expected,
            )
        else:
            row = await locked_row(db, locale, namespace, create=not dry_run)
            strings = dict(row.strings or {}) if row is not None else {}
            meta = dict(row.meta or {}) if row is not None else {}
            merged = lp.merge_strings(
                ns,  # type: ignore[arg-type]
                strings,
                meta,
                entries,
                origin=origin,
                source_hashes=ns_hashes,
                expected=ns_expected,
            )
            if not dry_run and row is not None:
                if merged.strings != strings:
                    row.strings = merged.strings
                if merged.meta != meta:
                    row.meta = merged.meta
        totals.add(merged)
    return totals.report()


async def reset_users(db: AsyncSession, code: str) -> int:
    """Set every user whose locale is ``code`` back to English; return how many."""
    users = list((await db.execute(select(User).where(User.locale == code))).scalars())
    for user in users:
        user.locale = "en"
    return len(users)


async def mark_interrupted_jobs(db: AsyncSession) -> int:
    """Mark every AI translation job still ``running`` as ``interrupted`` —
    called once at startup, when no job task can still be alive."""
    count = 0
    for locale in await list_locales(db):
        job = locale.translate_job
        if isinstance(job, dict) and job.get("status") == "running":
            locale.translate_job = {
                **job,
                "status": "interrupted",
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }
            count += 1
    if count:
        await db.flush()
    return count
