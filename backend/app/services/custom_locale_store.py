"""Stored custom languages: the database side of ``language_pack``.

Route handlers are never mutated by mutmut, so the logic behind
``api/v1/custom_locales.py`` lives here as plain functions. None of them
commits: the caller owns the session.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Text, cast, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import APP_VERSION
from app.config import settings as app_config
from app.models.custom_locale import CustomLocale, CustomLocaleString
from app.models.user import User
from app.services import language_pack as lp

JOB_STATUSES = ("running", "completed", "failed", "cancelled", "interrupted")


def catalog() -> lp.Catalog | None:
    """The English catalogue (``I18N_EN_DIR`` overrides where it is read)."""
    return lp.load_catalog(app_config.I18N_EN_DIR or None)


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


def namespace_stats(
    cat: lp.Catalog, rows: Mapping[str, CustomLocaleString]
) -> list[dict[str, Any]]:
    """Per-namespace ``{namespace, total, translated, missing, stale}``."""
    out = []
    for name, ns in cat.namespaces.items():
        strings, meta = _stored(rows, name)
        out.append({"namespace": name, **lp.namespace_stats(ns, strings, meta)})
    return out


def last_change(locale: CustomLocale, rows: Mapping[str, CustomLocaleString]) -> datetime | None:
    stamps = [s for s in [locale.updated_at, *(r.updated_at for r in rows.values())] if s]
    return max(stamps) if stamps else None


def serialize(
    locale: CustomLocale,
    rows: Mapping[str, CustomLocaleString],
    cat: lp.Catalog | None,
    *,
    with_namespaces: bool = False,
) -> dict[str, Any]:
    """The admin payload of one locale. ``stats`` is ``None`` when the English
    catalogue is not available (nothing to count against)."""
    per_ns = namespace_stats(cat, rows) if cat is not None else []
    stamp = last_change(locale, rows)
    out: dict[str, Any] = {
        "code": locale.code,
        "name": locale.name,
        "english_name": locale.english_name,
        "rtl": bool(locale.rtl),
        "enabled": bool(locale.enabled),
        "updated_at": stamp.isoformat() if stamp else None,
        "stats": lp.sum_stats(per_ns) if cat is not None else None,
        "job": locale.translate_job,
    }
    if with_namespaces:
        out["namespaces"] = per_ns
    return out


def list_strings(
    cat: lp.Catalog,
    rows: Mapping[str, CustomLocaleString],
    *,
    namespace: str | None,
    status: str,
    search: str,
) -> list[dict[str, Any]]:
    """The review rows over one namespace or all of them, in catalogue order."""
    names = [namespace] if namespace else cat.names
    out: list[dict[str, Any]] = []
    for name in names:
        ns = cat.namespace(name)
        if ns is None:
            continue
        strings, meta = _stored(rows, name)
        out.extend(lp.list_entries(ns, strings, meta, status=status, search=search))
    return out


def export_pack(
    cat: lp.Catalog,
    locale: CustomLocale,
    rows: Mapping[str, CustomLocaleString],
    *,
    mode: str,
    namespaces: list[str] | None,
) -> dict[str, Any]:
    names = [n for n in (namespaces or cat.names) if cat.namespace(n) is not None]
    parts = {}
    for name in names:
        strings, meta = _stored(rows, name)
        parts[name] = lp.export_namespace(cat.namespaces[name], strings, meta, mode)
    return lp.build_pack(
        locale={
            "code": locale.code,
            "name": locale.name,
            "english_name": locale.english_name,
            "rtl": locale.rtl,
        },
        mode=mode,
        app_version=APP_VERSION,
        namespaces=parts,
    )


# ---------------------------------------------------------------------------
# Bundle
# ---------------------------------------------------------------------------


async def namespace_digests(
    db: AsyncSession, locale_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, list[tuple[str, str]]]:
    """``{locale_id: [(namespace, md5 of the stored strings)]}`` — computed by
    PostgreSQL, so a bundle's hash never needs the strings themselves."""
    ids = list(locale_ids)
    out: dict[uuid.UUID, list[tuple[str, str]]] = {i: [] for i in ids}
    if not ids:
        return out
    rows = await db.execute(
        select(
            CustomLocaleString.locale_id,
            CustomLocaleString.namespace,
            func.md5(cast(CustomLocaleString.strings, Text)),
        ).where(CustomLocaleString.locale_id.in_(ids))
    )
    for locale_id, namespace, digest in rows.all():
        out[locale_id].append((namespace, digest))
    return out


def locale_hash(
    locale: CustomLocale, digests: Iterable[tuple[str, str]], cat: lp.Catalog | None
) -> str:
    fingerprint = cat.fingerprint if cat is not None else "no-catalog"
    return lp.bundle_hash(fingerprint, locale.code, locale.name, bool(locale.rtl), digests)


async def bootstrap_entries(db: AsyncSession) -> list[dict[str, Any]]:
    """``[{code, name, rtl, hash}]`` of the enabled custom locales."""
    locales = list(
        (
            await db.execute(
                select(CustomLocale)
                .where(CustomLocale.enabled.is_(True))
                .order_by(CustomLocale.code)
            )
        ).scalars()
    )
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


def bundle_resources(
    cat: lp.Catalog | None, rows: Mapping[str, CustomLocaleString]
) -> dict[str, dict[str, Any]]:
    """``{namespace: resource}``. Without the English catalogue the stored
    strings are served flat (i18next resolves a dotted flat key all the same)."""
    if cat is None:
        return {name: dict(row.strings or {}) for name, row in sorted(rows.items())}
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


def unknown_namespace_report(namespace: str, keys: Mapping[str, Any]) -> lp.MergeResult:
    """A namespace English does not have: every key in it is unknown."""
    return lp.MergeResult(strings={}, meta={}, unknown=len(keys), rejected=[])


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
    ``{applied, unchanged, cleared, rejected, unknown}``. With ``dry_run``
    nothing is written. ``expected`` makes each namespace's write conditional
    (see ``language_pack.merge_strings``)."""
    totals = lp.MergeResult(strings={}, meta={}, rejected=[])
    hashes = source_hashes or {}
    for namespace, entries in payload.items():
        ns = cat.namespace(namespace)
        if ns is None or not isinstance(entries, Mapping):
            merged = unknown_namespace_report(namespace, entries or {})
        else:
            row = await locked_row(db, locale, namespace, create=not dry_run)
            strings = dict(row.strings or {}) if row is not None else {}
            meta = dict(row.meta or {}) if row is not None else {}
            ns_hashes = hashes.get(namespace)
            ns_expected = expected.get(namespace) if expected is not None else None
            merged = lp.merge_strings(
                ns,
                strings,
                meta,
                entries,
                origin=origin,
                source_hashes=ns_hashes if isinstance(ns_hashes, Mapping) else None,
                expected=ns_expected,
            )
            if not dry_run and row is not None:
                if merged.strings != strings or merged.meta != meta:
                    row.strings = merged.strings
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
