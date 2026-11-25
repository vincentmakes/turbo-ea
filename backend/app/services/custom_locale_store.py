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

import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Text, cast, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import APP_VERSION
from app.config import settings as app_config
from app.models.custom_locale import CustomLocale, CustomLocaleString
from app.models.user import User
from app.services import language_pack as lp
from app.services import metamodel_strings as mm

METAMODEL = mm.NAMESPACE
SOURCE_CHANGED = "source_changed"


def catalog() -> lp.Catalog | None:
    """The English catalogue (``I18N_EN_DIR`` overrides where it is read)."""
    return lp.load_catalog(app_config.I18N_EN_DIR or None)


def known_namespace(cat: lp.Catalog, name: str) -> bool:
    return name == METAMODEL or cat.namespace(name) is not None


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


async def get_locale(db: AsyncSession, code: str) -> CustomLocale | None:
    return (
        await db.execute(select(CustomLocale).where(CustomLocale.code == code))
    ).scalar_one_or_none()


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


def metamodel_view(snap: mm.Snapshot, code: str, rows: Mapping[str, CustomLocaleString]) -> View:
    pack_strings, meta = _stored(rows, METAMODEL)
    items = mm.entries(snap, code, pack_strings)
    return View(
        ns=mm.namespace_of(items),
        strings=mm.values_of(items),
        meta=meta,
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
        out[METAMODEL] = metamodel_view(snap, code, rows)
    for name in cat.names if cat is not None else []:
        if wanted is not None and name not in wanted:
            continue
        strings, meta = _stored(rows, name)
        out[name] = View(ns=cat.namespaces[name], strings=strings, meta=meta)
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


def export_parts(views: Mapping[str, View], mode: str) -> dict[str, tuple[dict, dict]]:
    """``{namespace: (strings, source_hashes)}`` of an export.

    ``share`` is the community pack: every UI namespace as ``current``, and of
    ``metamodel`` only the entries whose key and English are the built-in
    seed's — nothing an installation made up, renamed or added."""
    parts: dict[str, tuple[dict, dict]] = {}
    for name, v in views.items():
        if mode != "share":
            parts[name] = lp.export_namespace(v.ns, v.strings, v.meta, mode)
            continue
        strings, hashes = lp.export_namespace(v.ns, v.strings, v.meta, "current")
        if name == METAMODEL:
            strings = {k: s for k, s in strings.items() if k in v.shareable}
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
    return lp.bundle_hash(fingerprint, locale.code, locale.name, bool(locale.rtl), digests)


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


async def bootstrap_entries(db: AsyncSession) -> list[dict[str, Any]]:
    """``[{code, name, rtl, hash}]`` of the enabled custom locales."""
    locales = await enabled_locales(db)
    if not locales:
        return []
    digests = await namespace_digests(db, [loc.id for loc in locales])
    cat = catalog()
    return [
        {
            "code": loc.code,
            "name": loc.name,
            "rtl": bool(loc.rtl),
            "hash": locale_hash(loc, digests[loc.id], cat),
        }
        for loc in locales
    ]


async def phase_help_with_custom_locales(
    db: AsyncSession, phase_help: Mapping[str, Mapping[str, str]]
) -> dict[str, dict[str, str]]:
    """The bootstrap ``lifecycle_phase_help`` with every enabled custom
    locale's phase texts laid over it (``metamodel_strings.overlay_phase_help``)."""
    locales = await enabled_locales(db)
    if not locales:
        return {phase: dict(texts) for phase, texts in phase_help.items()}
    by_id = {loc.id: loc.code for loc in locales}
    rows = await db.execute(
        select(CustomLocaleString.locale_id, CustomLocaleString.strings).where(
            CustomLocaleString.locale_id.in_(list(by_id)),
            CustomLocaleString.namespace == METAMODEL,
        )
    )
    per_locale = {by_id[locale_id]: strings or {} for locale_id, strings in rows.all()}
    return mm.overlay_phase_help(phase_help, per_locale)


def bundle_resources(
    cat: lp.Catalog | None, rows: Mapping[str, CustomLocaleString]
) -> dict[str, dict[str, Any]]:
    """``{namespace: resource}`` of the UI namespaces. Without the English
    catalogue the stored strings are served flat (i18next resolves a dotted
    flat key all the same)."""
    if cat is None:
        return {
            name: dict(row.strings or {}) for name, row in sorted(rows.items()) if name != METAMODEL
        }
    out: dict[str, dict[str, Any]] = {}
    for name, ns in cat.namespaces.items():
        strings, _meta = _stored(rows, name)
        tree = lp.build_namespace_bundle(ns, strings)
        if tree:
            out[name] = tree
    return out


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


async def locked_row(
    db: AsyncSession, locale: CustomLocale, namespace: str, *, create: bool
) -> CustomLocaleString | None:
    """The namespace row, locked for the merge (``SELECT … FOR UPDATE``);
    created (and flushed) when missing and ``create`` is true."""
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
        row = CustomLocaleString(locale_id=locale.id, namespace=namespace, strings={}, meta={})
        db.add(row)
        await db.flush()
    return row


def source_changed(
    ns: lp.Namespace, incoming: Mapping[str, Any], hashes: Mapping[str, Any] | None
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Split ``incoming`` for the ``metamodel`` namespace: a key whose given
    source hash is not the current English hash was translated from a label
    that has changed since (an admin renamed the type), so it is refused as
    ``source_changed`` rather than stored."""
    kept: dict[str, Any] = {}
    refused: list[dict[str, str]] = []
    for key, value in incoming.items():
        given = (hashes or {}).get(key)
        current = ns.current_hash(key)
        if value is not None and lp.is_source_hash(given) and current and given != current:
            refused.append({"namespace": ns.name, "key": key, "reason": SOURCE_CHANGED})
        else:
            kept[key] = value
    return kept, refused


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
    rows = {METAMODEL: row} if row is not None else {}
    view = metamodel_view(snap, locale.code, rows)
    kept, refused = source_changed(view.ns, entries, hashes)
    merged = lp.merge_strings(
        view.ns,
        view.strings,
        view.meta,
        kept,
        origin=origin,
        source_hashes=hashes,
        expected=expected,
    )
    merged.rejected = [*refused, *(merged.rejected or [])]
    if not dry_run and row is not None:
        await mm.apply(db, locale.code, label_changes(view.strings, merged.strings), snap)
        pack_strings = {k: v for k, v in merged.strings.items() if k in snap.lifecycle}
        if pack_strings != (row.strings or {}):
            row.strings = pack_strings
        if merged.meta != (row.meta or {}):
            row.meta = merged.meta
    return merged


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
    strings, namespace by namespace, and return the summed report
    ``{applied, unchanged, cleared, rejected, unknown}`` (``unknown`` is a
    count). With ``dry_run`` nothing is written. ``expected`` makes each
    namespace's write conditional (see ``language_pack.merge_strings``)."""
    totals = lp.MergeResult(strings={}, meta={}, rejected=[])
    hashes = source_hashes or {}
    for namespace, entries in payload.items():
        ns_hashes = hashes.get(namespace)
        ns_hashes = ns_hashes if isinstance(ns_hashes, Mapping) else None
        ns_expected = expected.get(namespace) if expected is not None else None
        ns = cat.namespace(namespace)
        if not isinstance(entries, Mapping) or (ns is None and namespace != METAMODEL):
            merged = lp.MergeResult(
                strings={},
                meta={},
                unknown=len(entries) if isinstance(entries, Mapping) else 0,
                rejected=[],
            )
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
        totals.applied += merged.applied
        totals.unchanged += merged.unchanged
        totals.cleared += merged.cleared
        totals.unknown += merged.unknown
        totals.rejected.extend(merged.rejected or [])  # type: ignore[union-attr]
    if not dry_run:
        await db.flush()
    return totals.report()


async def reset_users(db: AsyncSession, code: str) -> int:
    """Set every user whose locale is ``code`` back to English; return how many."""
    result = await db.execute(
        update(User).where(User.locale == code).values(locale="en").returning(User.id)
    )
    return len(result.all())


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
