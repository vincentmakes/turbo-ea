"""Custom languages: UI languages an administrator adds (they do not ship with
the app), filled by file import, AI translation, MCP or by hand.

Every management route needs ``admin.settings``. The bundle route is public for
an enabled locale — the browser loads it before anyone signs in — and needs
``admin.settings`` for a disabled one (anyone else gets a 404). The logic lives
in ``services/custom_locale_store.py`` / ``language_pack.py`` /
``custom_locale_translate.py``; see ``.claude/rules/custom-locales.md``.
"""

from __future__ import annotations

import json
import re
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_optional_user
from app.api.v1.settings import SUPPORTED_LOCALES
from app.core.rate_limit import limiter
from app.database import get_db
from app.models.app_settings import AppSettings
from app.models.custom_locale import CustomLocale
from app.models.user import User
from app.services import audit_log
from app.services import custom_locale_store as store
from app.services import custom_locale_translate as translate
from app.services import language_pack as lp
from app.services.ai_service import ai_config_from_settings, provider_usable
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/custom-locales", tags=["Custom languages"])

_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")


def _clean_name(value: str) -> str:
    value = value.strip()
    if not value or _CONTROL.search(value):
        raise ValueError("must be a non-empty name without control characters")
    return value


def _clean_english_name(value: str) -> str:
    value = value.strip()
    if not lp.is_valid_english_name(value):
        raise ValueError(
            "must be the language's English name: letters, spaces, brackets and hyphens"
        )
    return value


class CustomLocaleCreate(BaseModel):
    code: str = Field(max_length=10)
    name: str = Field(max_length=100)
    english_name: str = Field(max_length=100)
    rtl: bool = False

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return _clean_name(value)

    @field_validator("english_name")
    @classmethod
    def _english(cls, value: str) -> str:
        return _clean_english_name(value)


class CustomLocaleUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    english_name: str | None = Field(default=None, max_length=100)
    rtl: bool | None = None
    enabled: bool | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        return None if value is None else _clean_name(value)

    @field_validator("english_name")
    @classmethod
    def _english(cls, value: str | None) -> str | None:
        return None if value is None else _clean_english_name(value)


class StringsWrite(BaseModel):
    strings: dict[str, dict[str, Any]]
    source_hashes: dict[str, dict[str, Any]] | None = None
    origin: Literal["manual", "import", "mcp"] = "manual"


class TranslateRequest(BaseModel):
    mode: Literal["missing", "all"] = "missing"
    namespaces: list[str] | None = None
    include_manual: bool = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _require_admin(db: AsyncSession, user: User) -> None:
    await PermissionService.require_permission(db, user, "admin.settings")


async def _locale_or_404(db: AsyncSession, code: str) -> CustomLocale:
    locale = await store.get_locale(db, code)
    if locale is None:
        raise HTTPException(404, "locale_not_found")
    return locale


def _catalog_or_503() -> lp.Catalog:
    cat = store.catalog()
    if cat is None:
        raise HTTPException(503, "catalog_unavailable")
    return cat


def _target(locale: CustomLocale) -> tuple[str, str, str]:
    return ("custom_locale", str(locale.id), locale.name)


async def _ai_config(db: AsyncSession) -> dict:
    row = (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one_or_none()
    return ai_config_from_settings((row.general_settings if row else None) or {})


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("")
async def list_custom_locales(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Every custom locale with its translation progress and AI job state."""
    await _require_admin(db, user)
    return await store.serialize_all(db, await store.list_locales(db))


@router.post("", status_code=201)
async def create_custom_locale(
    body: CustomLocaleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_admin(db, user)
    error = lp.code_error(body.code, SUPPORTED_LOCALES)
    if error is not None:
        raise HTTPException(400, error)
    if await store.get_locale(db, body.code) is not None:
        raise HTTPException(409, "locale_exists")
    locale = CustomLocale(
        code=body.code,
        name=body.name,
        english_name=body.english_name,
        rtl=body.rtl,
        enabled=False,
    )
    db.add(locale)
    await db.flush()
    await audit_log.record(
        db,
        action="admin.custom_locale.created",
        category="admin",
        actor=user,
        target=_target(locale),
        context={
            "code": locale.code,
            "english_name": locale.english_name,
            "rtl": locale.rtl,
        },
    )
    await db.commit()
    await db.refresh(locale)
    return await store.serialize_one(db, locale)


@router.get("/{code}")
async def get_custom_locale(
    code: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """One locale with its per-namespace progress."""
    await _require_admin(db, user)
    locale = await _locale_or_404(db, code)
    return await store.serialize_one(db, locale)


@router.patch("/{code}")
async def update_custom_locale(
    code: str,
    body: CustomLocaleUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_admin(db, user)
    locale = await _locale_or_404(db, code)
    data = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    keys = ("name", "english_name", "rtl", "enabled")
    before = {k: getattr(locale, k) for k in keys}
    for field, value in data.items():
        setattr(locale, field, value)
    changes = audit_log.diff(before, data, keys=keys)
    if changes:
        await audit_log.record(
            db,
            action="admin.custom_locale.updated",
            category="admin",
            actor=user,
            target=_target(locale),
            changes=changes,
            context={"code": locale.code},
        )
    await db.commit()
    await db.refresh(locale)
    return await store.serialize_one(db, locale)


@router.delete("/{code}", status_code=204)
async def delete_custom_locale(
    code: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a locale and its strings; its users go back to English."""
    await _require_admin(db, user)
    locale = await _locale_or_404(db, code)
    translate.cancel(code)
    users_reset = await store.reset_users(db, code)
    await audit_log.record(
        db,
        action="admin.custom_locale.deleted",
        category="admin",
        actor=user,
        target=_target(locale),
        context={"code": locale.code, "users_reset": users_reset},
    )
    await db.delete(locale)
    await db.commit()
    return Response(status_code=204)


@router.get("/{code}/export")
async def export_custom_locale(
    code: str,
    mode: Literal["missing", "all", "current", "share"] = "missing",
    namespaces: str | None = Query(default=None, max_length=1000),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The language-pack file: ``missing`` / ``all`` English text to translate,
    ``current`` — the stored translations — or ``share``, the community pack
    (the UI translations plus only the built-in seed's database labels)."""
    await _require_admin(db, user)
    locale = await _locale_or_404(db, code)
    cat = _catalog_or_503()
    wanted = [n.strip() for n in namespaces.split(",") if n.strip()] if namespaces else None
    views = await store.load_views(db, locale, cat, wanted)
    pack = store.export_pack(locale, views, mode=mode)
    await audit_log.record(
        db,
        action="access.export.language_pack",
        category="access",
        actor=user,
        target=_target(locale),
        context={"code": locale.code, "mode": mode, "namespaces": list(pack["strings"])},
    )
    await db.commit()
    return Response(
        content=json.dumps(pack, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="turbo-ea-{locale.code}-{mode}.json"'
        },
    )


@router.get("/{code}/strings")
async def list_custom_locale_strings(
    code: str,
    namespace: str | None = Query(default=None, max_length=50),
    status: Literal["missing", "stale", "translated", "untranslated", "all"] = "all",
    search: str = Query(default="", max_length=200),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The review rows, the English source beside the translation."""
    await _require_admin(db, user)
    locale = await _locale_or_404(db, code)
    cat = _catalog_or_503()
    if namespace and not store.known_namespace(cat, namespace):
        raise HTTPException(400, "unknown_namespace")
    views = await store.load_views(db, locale, cat, [namespace] if namespace else None)
    items = store.list_strings(views, namespace=namespace, status=status, search=search)
    return {"total": len(items), "items": items[offset : offset + limit]}


@router.post("/{code}/strings")
async def write_custom_locale_strings(
    code: str,
    body: StringsWrite,
    dry_run: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Merge translations, per key: ``null`` clears a key; a value the
    validator refuses is reported and never blocks the others."""
    await _require_admin(db, user)
    locale = await _locale_or_404(db, code)
    cat = _catalog_or_503()
    report = await store.apply_strings(
        db,
        locale,
        cat,
        body.strings,
        origin=body.origin,
        source_hashes=body.source_hashes,
        dry_run=dry_run,
    )
    if not dry_run and (report["applied"] or report["cleared"]):
        await audit_log.record(
            db,
            action="admin.custom_locale.strings_updated",
            category="admin",
            actor=user,
            target=_target(locale),
            context={
                "code": locale.code,
                "origin": body.origin,
                "namespaces": sorted(body.strings),
                "applied": report["applied"],
                "cleared": report["cleared"],
                "rejected": len(report["rejected"]),
            },
        )
    if not dry_run:
        await db.commit()
    return report


@router.post("/{code}/translate", status_code=202)
@limiter.limit("10/minute")
async def translate_custom_locale(
    request: Request,
    code: str,
    body: TranslateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Start the AI translation job (one per locale)."""
    await _require_admin(db, user)
    locale = await _locale_or_404(db, code)
    cat = _catalog_or_503()
    job = locale.translate_job if isinstance(locale.translate_job, dict) else {}
    if translate.is_running(code) or job.get("status") == "running":
        raise HTTPException(409, "job_running")
    ai_cfg = await _ai_config(db)
    if not provider_usable(ai_cfg):
        raise HTTPException(400, "ai_not_configured")
    if body.namespaces and not all(store.known_namespace(cat, n) for n in body.namespaces):
        raise HTTPException(400, "unknown_namespace")
    views = await store.load_views(db, locale, cat, body.namespaces or None)
    items = translate.select_work(views, mode=body.mode, include_manual=body.include_manual)
    locale.translate_job = translate.new_job(body.mode, len(items))
    await audit_log.record(
        db,
        action="admin.custom_locale.translation_started",
        category="admin",
        actor=user,
        target=_target(locale),
        context={
            "code": locale.code,
            "mode": body.mode,
            "strings": len(items),
            "include_manual": body.include_manual,
        },
    )
    await db.commit()
    # The session is committed before the job starts: the job opens its own
    # short sessions and never holds one across an LLM call.
    translate.launch(code, locale.english_name, items, ai_cfg)
    return {"job": locale.translate_job}


@router.post("/{code}/translate/cancel")
async def cancel_custom_locale_translation(
    code: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _require_admin(db, user)
    locale = await _locale_or_404(db, code)
    was_running = isinstance(locale.translate_job, dict) and (
        locale.translate_job.get("status") == "running"
    )
    translate.cancel(code)
    if was_running:
        locale.translate_job = translate.cancelled_job(locale.translate_job)
        await audit_log.record(
            db,
            action="admin.custom_locale.translation_cancelled",
            category="admin",
            actor=user,
            target=_target(locale),
            context={"code": locale.code},
        )
    await db.commit()
    return {"job": locale.translate_job}


@router.get("/{code}/bundle")
async def get_custom_locale_bundle(
    code: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """The locale's i18next resources, in the shape of a built-in locale file.

    Public for an enabled locale (the browser loads it before sign-in); a
    disabled one is visible to ``admin.settings`` holders only — to anyone
    else it does not exist (404)."""
    locale = await store.get_locale(db, code)
    if locale is None:
        raise HTTPException(404, "locale_not_found")
    if not locale.enabled and (
        user is None or not await PermissionService.check_permission(db, user, "admin.settings")
    ):
        raise HTTPException(404, "locale_not_found")
    cat = store.catalog()
    digests = await store.namespace_digests(db, [locale.id])
    tag = store.locale_hash(locale, digests[locale.id], cat)
    headers = {"ETag": f'"{tag}"', "Cache-Control": "no-cache"}
    if store.etag_matches(request.headers.get("if-none-match"), tag):
        return Response(status_code=304, headers=headers)
    rows = await store.load_rows(db, [locale.id])
    payload = {
        "code": locale.code,
        "name": locale.name,
        "rtl": bool(locale.rtl),
        "hash": tag,
        "resources": store.bundle_resources(cat, rows[locale.id]),
    }
    return Response(
        content=json.dumps(payload, ensure_ascii=False),
        headers=headers,
        media_type="application/json; charset=utf-8",
    )
