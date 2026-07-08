"""Extension Store admin API + lightweight status endpoint.

``GET    /admin/extensions``                — installed extensions + entitlement states
``GET    /admin/extensions/license``        — active license summary
``PUT    /admin/extensions/license``        — upload/paste a signed license (supersedes)
``GET    /admin/extensions/install``        — recent bundle uploads
``POST   /admin/extensions/install``        — upload a ``.teax``, background verify+preview
``GET    /admin/extensions/install/{id}``   — poll upload status + dry-run diff
``POST   /admin/extensions/install/{id}/apply`` — background install + content apply
``DELETE /admin/extensions/install/{id}``   — discard an upload
``GET    /admin/extensions/store/catalog``  — proxy the vendor's public catalog.json
``POST   /admin/extensions/store/install``  — download a catalogue bundle → upload pipeline
``PUT    /admin/extensions/{key}/enabled``  — enable/disable (soft, immediate)
``DELETE /admin/extensions/{key}``          — uninstall (files removed, data retained)
``GET    /extensions/status``               — non-admin: key/version/entitlement per extension

Admin routes are gated by ``admin.manage_extensions``. Bundles must be
signed by the vendor key (verified in the background job and re-verified
at every boot by the loader); applying additionally requires a usable
license entitlement for the extension key. Everything works from files —
no network — so air-gapped installs are first-class. The Store tab is a
read-only convenience over public static vendor hosting (see the Store
section below); leaving ``EXTENSION_STORE_URL`` unset hides it.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.database import async_session, get_db
from app.models.extension import Extension, ExtensionInstall, ExtensionLicense
from app.models.user import User
from app.services.extensions.bundle import BundleError, read_bundle
from app.services.extensions.content_pack import (
    ContentPackError,
    apply_content,
    load_content_from_zip,
    preview_content,
)
from app.services.extensions.installer import install_bundle, uninstall
from app.services.extensions.license import LicenseError, parse_and_verify
from app.services.extensions.registry import extension_registry
from app.services.permission_service import PermissionService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/extensions", tags=["Extensions"])
status_router = APIRouter(prefix="/extensions", tags=["Extensions"])

_UPLOAD_DIR = Path("data/extension_installs")


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class EntitlementOut(BaseModel):
    state: str  # active | grace | expired | unlicensed
    plan: str = ""
    expires_at: datetime | None = None
    grace_until: datetime | None = None


class ExtensionOut(BaseModel):
    key: str
    name: str
    version: str
    status: str
    enabled: bool
    capabilities: list[str] = []
    last_error: str | None = None
    entitlement: EntitlementOut
    created_at: datetime | None = None
    updated_at: datetime | None = None


class LicenseOut(BaseModel):
    licensee: str
    customer_id: str = ""
    key_id: str = ""
    issued_at: datetime | None = None
    grace_days: int
    entitlements: list[dict]
    uploaded_at: datetime | None = None


class LicenseIn(BaseModel):
    text: str


class ExtensionInstallOut(BaseModel):
    id: str
    filename: str
    status: str
    extension_key: str | None = None
    extension_version: str | None = None
    diff: dict | None = None
    result: dict | None = None
    error_message: str | None = None
    created_at: datetime | None = None
    previewed_at: datetime | None = None
    applied_at: datetime | None = None


class EnabledIn(BaseModel):
    enabled: bool


class ExtensionStatusOut(BaseModel):
    key: str
    version: str
    entitlement_state: str


def _extension_out(row: Extension) -> ExtensionOut:
    ent = extension_registry.entitlement(row.key)
    return ExtensionOut(
        key=row.key,
        name=row.name,
        version=row.version,
        status=row.status,
        enabled=row.enabled,
        capabilities=list(row.capabilities or []),
        last_error=row.last_error,
        entitlement=EntitlementOut(
            state=ent.state,
            plan=ent.plan,
            expires_at=ent.expires_at,
            grace_until=ent.grace_until,
        ),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _install_out(row: ExtensionInstall) -> ExtensionInstallOut:
    return ExtensionInstallOut(
        id=str(row.id),
        filename=row.filename,
        status=row.status,
        extension_key=row.extension_key,
        extension_version=row.extension_version,
        diff=row.diff or None,
        result=row.result or None,
        error_message=row.error_message,
        created_at=row.created_at,
        previewed_at=row.previewed_at,
        applied_at=row.applied_at,
    )


# ---------------------------------------------------------------------------
# Installed extensions + license
# ---------------------------------------------------------------------------


@router.get("", response_model=list[ExtensionOut])
async def list_extensions(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ExtensionOut]:
    await PermissionService.require_permission(db, user, "admin.manage_extensions")
    await extension_registry.refresh_from_db(db)
    rows = (
        (
            await db.execute(
                select(Extension).where(Extension.status != "removed").order_by(Extension.key)
            )
        )
        .scalars()
        .all()
    )
    return [_extension_out(row) for row in rows]


@router.get("/license", response_model=LicenseOut)
async def get_license(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> LicenseOut:
    await PermissionService.require_permission(db, user, "admin.manage_extensions")
    row = (
        await db.execute(
            select(ExtensionLicense)
            .where(ExtensionLicense.is_active == True)  # noqa: E712
            .order_by(ExtensionLicense.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="No license installed")
    return LicenseOut(
        licensee=row.licensee,
        customer_id=row.customer_id or "",
        key_id=row.key_id or "",
        issued_at=row.issued_at,
        grace_days=row.grace_days,
        entitlements=list(row.entitlements or []),
        uploaded_at=row.created_at,
    )


async def _apply_license_text(db: AsyncSession, text: str, user_id: uuid.UUID) -> LicenseOut:
    """Verify a license and make it the active one (supersede + registry refresh).

    A license may be pasted directly or read from an uploaded file; either
    way it goes through the same signature verification here.
    """
    try:
        doc = parse_and_verify(text)
    except LicenseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Supersede: deactivate previous active rows, keep them as audit history.
    actives = (
        (
            await db.execute(
                select(ExtensionLicense).where(ExtensionLicense.is_active == True)  # noqa: E712
            )
        )
        .scalars()
        .all()
    )
    for old in actives:
        old.is_active = False
    row = ExtensionLicense(
        raw_text=doc.raw_text,
        key_id=doc.key_id or None,
        licensee=doc.licensee,
        customer_id=doc.customer_id or None,
        issued_at=doc.issued_at,
        grace_days=doc.grace_days,
        entitlements=[
            {
                "extension_key": ent.extension_key,
                "plan": ent.plan,
                "expires_at": ent.expires_at.isoformat() if ent.expires_at else None,
            }
            for ent in doc.entitlements
        ],
        is_active=True,
        created_by=user_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await extension_registry.refresh_from_db(db)
    logger.info("Extension license updated: licensee=%s", doc.licensee)
    return LicenseOut(
        licensee=row.licensee,
        customer_id=row.customer_id or "",
        key_id=row.key_id or "",
        issued_at=row.issued_at,
        grace_days=row.grace_days,
        entitlements=list(row.entitlements or []),
        uploaded_at=row.created_at,
    )


@router.put("/license", response_model=LicenseOut)
async def put_license(
    payload: LicenseIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> LicenseOut:
    await PermissionService.require_permission(db, user, "admin.manage_extensions")
    return await _apply_license_text(db, payload.text, user.id)


# ---------------------------------------------------------------------------
# Bundle upload → verify/preview → apply
# ---------------------------------------------------------------------------


@router.get("/install", response_model=list[ExtensionInstallOut])
async def list_installs(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ExtensionInstallOut]:
    await PermissionService.require_permission(db, user, "admin.manage_extensions")
    rows = (
        (
            await db.execute(
                select(ExtensionInstall).order_by(ExtensionInstall.created_at.desc()).limit(20)
            )
        )
        .scalars()
        .all()
    )
    return [_install_out(row) for row in rows]


async def _persist_upload(
    db: AsyncSession, filename: str, raw: bytes, user_id: uuid.UUID
) -> ExtensionInstall:
    """Land bundle bytes on disk + create the install row (status=verifying)."""
    _UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    install_id = uuid.uuid4()
    storage_path = _UPLOAD_DIR / f"{install_id}.bin"
    storage_path.write_bytes(raw)

    install = ExtensionInstall(
        id=install_id,
        filename=filename,
        file_size=len(raw),
        storage_path=str(storage_path),
        status="verifying",
        created_by=user_id,
    )
    db.add(install)
    await db.commit()
    await db.refresh(install)
    return install


@router.post("/install", response_model=ExtensionInstallOut, status_code=202)
async def upload_bundle(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ExtensionInstallOut:
    await PermissionService.require_permission(db, user, "admin.manage_extensions")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty bundle file")

    install = await _persist_upload(db, file.filename or "extension.teax", raw, user.id)
    background_tasks.add_task(_verify_and_preview_job, str(install.id), str(user.id))
    return _install_out(install)


@router.get("/install/{install_id}", response_model=ExtensionInstallOut)
async def get_install(
    install_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ExtensionInstallOut:
    await PermissionService.require_permission(db, user, "admin.manage_extensions")
    return _install_out(await _load_install(db, install_id))


@router.post("/install/{install_id}/apply", response_model=ExtensionInstallOut, status_code=202)
async def apply_install(
    install_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ExtensionInstallOut:
    await PermissionService.require_permission(db, user, "admin.manage_extensions")
    install = await _load_install(db, install_id)
    if install.status not in {"previewed", "failed"}:
        raise HTTPException(
            status_code=400, detail=f"Cannot apply an upload in status {install.status!r}"
        )
    # Second gate: installing an extension requires a usable entitlement for
    # its key (a valid signature alone is provenance, not activation).
    await extension_registry.refresh_from_db(db)
    if install.extension_key and not extension_registry.entitlement(install.extension_key).usable:
        raise HTTPException(
            status_code=403,
            detail=(
                "No usable license entitlement for this extension — upload the license file first"
            ),
        )
    install.status = "applying"
    await db.commit()
    await db.refresh(install)
    background_tasks.add_task(_apply_job, str(install.id), str(user.id))
    return _install_out(install)


@router.delete("/install/{install_id}", status_code=204)
async def delete_install(
    install_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    await PermissionService.require_permission(db, user, "admin.manage_extensions")
    install = await _load_install(db, install_id)
    if install.storage_path:
        try:
            Path(install.storage_path).unlink(missing_ok=True)
        except OSError:
            logger.warning("Could not delete bundle upload %s", install.storage_path)
    await db.delete(install)
    await db.commit()


# ---------------------------------------------------------------------------
# Store — read-only catalogue proxy + install-from-store
#
# The "store" is NOT a service the instance connects to: it is a static
# catalog.json + public .teax bundles on vendor hosting
# (settings.EXTENSION_STORE_URL). Bundles are inert without a signed
# license, so no account, token, or auth is involved — the instance only
# ever READS public files, and every downloaded bundle goes through the
# exact same signature verification + dry-run preview pipeline as a manual
# upload. Payment happens entirely outside (the catalogue's payment_link
# opens in a new browser tab); the license still arrives as a pasted file.
# Air-gapped installs leave EXTENSION_STORE_URL unset and nothing degrades.
# ---------------------------------------------------------------------------

_STORE_CATALOG_TIMEOUT = 6.0
_STORE_BUNDLE_TIMEOUT = 120.0
_STORE_BUNDLE_MAX_BYTES = 200 * 1024 * 1024  # generous; signature is the real gate


class StoreItemOut(BaseModel):
    key: str
    name: str
    description: str = ""
    price: str = ""
    payment_link: str = ""
    version: str = ""
    installed_version: str | None = None
    update_available: bool = False
    entitlement_state: str = "unlicensed"


class StoreCatalogOut(BaseModel):
    configured: bool
    reachable: bool = False
    store_url: str = ""
    items: list[StoreItemOut] = []


class StoreInstallIn(BaseModel):
    key: str


def _version_tuple(value: str) -> tuple[int, ...]:
    try:
        return tuple(int(p) for p in value.strip().split("."))
    except (ValueError, AttributeError):
        return ()


async def _fetch_store_catalog(base_url: str) -> list[dict]:
    """GET {base_url}/catalog.json and return its ``extensions`` list."""
    url = base_url.rstrip("/") + "/catalog.json"
    async with httpx.AsyncClient(timeout=_STORE_CATALOG_TIMEOUT) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()
    items = data.get("extensions") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise ValueError("catalog.json has no 'extensions' list")
    return [item for item in items if isinstance(item, dict) and item.get("key")]


@router.get("/store/catalog", response_model=StoreCatalogOut)
async def store_catalog(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StoreCatalogOut:
    await PermissionService.require_permission(db, user, "admin.manage_extensions")
    base_url = settings.EXTENSION_STORE_URL.strip()
    if not base_url:
        return StoreCatalogOut(configured=False)

    try:
        raw_items = await _fetch_store_catalog(base_url)
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Extension store catalogue unreachable (%s): %s", base_url, exc)
        return StoreCatalogOut(configured=True, reachable=False, store_url=base_url)

    installed = {
        row.key: row.version
        for row in (
            await db.execute(select(Extension).where(Extension.status != "removed"))
        ).scalars()
    }
    await extension_registry.refresh_from_db(db)

    items: list[StoreItemOut] = []
    for item in raw_items:
        key = str(item["key"])
        catalog_version = str(item.get("version") or "")
        installed_version = installed.get(key)
        items.append(
            StoreItemOut(
                key=key,
                name=str(item.get("name") or key),
                description=str(item.get("description") or ""),
                price=str(item.get("price") or ""),
                payment_link=str(item.get("payment_link") or ""),
                version=catalog_version,
                installed_version=installed_version,
                update_available=bool(
                    installed_version
                    and catalog_version
                    and _version_tuple(catalog_version) > _version_tuple(installed_version)
                ),
                entitlement_state=extension_registry.entitlement(key).state,
            )
        )
    return StoreCatalogOut(configured=True, reachable=True, store_url=base_url, items=items)


@router.post("/store/install", response_model=ExtensionInstallOut, status_code=202)
async def install_from_store(
    payload: StoreInstallIn,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ExtensionInstallOut:
    """Download a catalogue bundle and run it through the upload pipeline.

    Identical trust posture to a manual upload: the downloaded bytes are
    landed in ``data/extension_installs/`` and the background job verifies
    the vendor signature before anything is previewed or applied. Downloads
    are restricted to the configured store origin (SSRF guard) — a bundle
    hosted elsewhere must be installed via manual upload.
    """
    await PermissionService.require_permission(db, user, "admin.manage_extensions")
    base_url = settings.EXTENSION_STORE_URL.strip()
    if not base_url:
        raise HTTPException(status_code=400, detail="No extension store is configured")

    try:
        raw_items = await _fetch_store_catalog(base_url)
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"Extension store unreachable: {exc}") from exc

    item = next((i for i in raw_items if str(i.get("key")) == payload.key), None)
    if item is None or not str(item.get("bundle_url") or "").strip():
        raise HTTPException(
            status_code=404, detail="This extension is not available from the store"
        )

    bundle_url = urljoin(base_url.rstrip("/") + "/", str(item["bundle_url"]).strip())
    base_origin = urlsplit(base_url)
    bundle_origin = urlsplit(bundle_url)
    if (bundle_origin.scheme, bundle_origin.netloc) != (base_origin.scheme, base_origin.netloc):
        raise HTTPException(
            status_code=400,
            detail="Bundle download refused: not hosted on the configured store origin",
        )

    try:
        async with httpx.AsyncClient(timeout=_STORE_BUNDLE_TIMEOUT) as client:
            resp = await client.get(bundle_url)
            resp.raise_for_status()
            raw = resp.content
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Bundle download failed: {exc}") from exc
    if not raw:
        raise HTTPException(status_code=502, detail="Bundle download was empty")
    if len(raw) > _STORE_BUNDLE_MAX_BYTES:
        raise HTTPException(status_code=502, detail="Bundle download exceeds the size limit")

    filename = Path(urlsplit(bundle_url).path).name or f"{payload.key}.teax"
    install = await _persist_upload(db, filename, raw, user.id)
    background_tasks.add_task(_verify_and_preview_job, str(install.id), str(user.id))
    return _install_out(install)


# ---------------------------------------------------------------------------
# Enable / disable / uninstall
# ---------------------------------------------------------------------------


@router.put("/{key}/enabled", response_model=ExtensionOut)
async def set_extension_enabled(
    key: str,
    payload: EnabledIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ExtensionOut:
    await PermissionService.require_permission(db, user, "admin.manage_extensions")
    row = (
        await db.execute(
            select(Extension).where(Extension.key == key, Extension.status != "removed")
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Extension not found")
    row.enabled = payload.enabled
    if row.status in {"installed", "disabled"}:
        row.status = "installed" if payload.enabled else "disabled"
    await db.commit()
    await db.refresh(row)
    await extension_registry.refresh_from_db(db)
    return _extension_out(row)


@router.delete("/{key}", response_model=ExtensionOut)
async def uninstall_extension(
    key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ExtensionOut:
    await PermissionService.require_permission(db, user, "admin.manage_extensions")
    row = await uninstall(db, key)
    if row is None:
        raise HTTPException(status_code=404, detail="Extension not found")
    await db.commit()
    await db.refresh(row)
    await extension_registry.refresh_from_db(db)
    return _extension_out(row)


# ---------------------------------------------------------------------------
# Non-admin status (consumed by the frontend extension loader)
# ---------------------------------------------------------------------------


@status_router.get("/status", response_model=list[ExtensionStatusOut])
async def extensions_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ExtensionStatusOut]:
    """Least-privilege list of enabled extensions for any authenticated user."""
    await extension_registry.refresh_from_db(db)
    return [
        ExtensionStatusOut(
            key=info.key,
            version=info.version,
            entitlement_state=extension_registry.entitlement(info.key).state,
        )
        for info in extension_registry.all()
        if info.enabled and info.status != "removed"
    ]


class UiExtensionOut(BaseModel):
    key: str
    version: str
    entry: str
    entitlement_state: str


@status_router.get("/ui-manifest", response_model=list[UiExtensionOut])
async def ui_manifest(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[UiExtensionOut]:
    """UI bundles the frontend loader should import — THE entitlement gate
    for extension UI. Only enabled extensions with a usable (active or
    grace) entitlement and a frontend entry are listed."""
    await extension_registry.refresh_from_db(db)
    out: list[UiExtensionOut] = []
    for info in extension_registry.all():
        if not info.enabled or info.status in ("removed", "failed", "needs_restart"):
            continue
        entry = str(((info.manifest or {}).get("frontend") or {}).get("entry") or "")
        if not entry:
            continue
        ent = extension_registry.entitlement(info.key)
        if not ent.usable:
            continue
        rel = entry.removeprefix("frontend/")
        out.append(
            UiExtensionOut(
                key=info.key,
                version=info.version,
                entry=f"/api/v1/ext-assets/{info.key}/{info.version}/{rel}",
                entitlement_state=ent.state,
            )
        )
    return out


# ---------------------------------------------------------------------------
# Static UI assets (unauthenticated by design)
# ---------------------------------------------------------------------------

assets_router = APIRouter(prefix="/ext-assets", tags=["Extensions"])

_ASSET_MEDIA_TYPES = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".map": "application/json",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
}


@assets_router.get("/{key}/{version}/{asset_path:path}")
async def get_extension_asset(key: str, version: str, asset_path: str):
    """Serve an extension's frontend bundle files.

    Deliberately unauthenticated: dynamic ``import()`` cannot carry an
    Authorization header, and extension code is not a secret — the
    entitlement gate is the authenticated ``/extensions/ui-manifest``
    plus every ``/ext/{key}/`` data API. Same-origin serving keeps the
    strict ``script-src 'self'`` CSP intact. The version segment exists
    for cache-busting (assets are served immutable).
    """
    from fastapi.responses import FileResponse

    from app.services.extensions.installer import EXTENSIONS_DIR

    info = extension_registry.get(key)
    if info is None or not info.enabled or info.status == "removed":
        raise HTTPException(status_code=404, detail="Not found")

    base = (EXTENSIONS_DIR / key / "frontend").resolve()
    target = (base / asset_path).resolve()
    if not target.is_relative_to(base) or not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")

    media_type = _ASSET_MEDIA_TYPES.get(target.suffix.lower())
    return FileResponse(
        target,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


# ---------------------------------------------------------------------------
# Background jobs
# ---------------------------------------------------------------------------


async def _load_install(db: AsyncSession, install_id: uuid.UUID) -> ExtensionInstall:
    install = (
        await db.execute(select(ExtensionInstall).where(ExtensionInstall.id == install_id))
    ).scalar_one_or_none()
    if install is None:
        raise HTTPException(status_code=404, detail="Extension upload not found")
    return install


async def run_verify_and_preview(db: AsyncSession, install: ExtensionInstall, user: User) -> None:
    """Verify a bundle upload and dry-run its content pack.

    Session-agnostic core of the background job (also driven directly by
    tests under the savepoint fixture). Failures land on the install row,
    never raise.
    """
    install_id = install.id  # captured before any rollback expires the instance
    try:
        bundle = read_bundle(Path(install.storage_path))
        install.extension_key = bundle.key
        install.extension_version = bundle.version
        # "turboea-extension/1" -> "1" (column width mirrors workspace_transfers)
        install.format_version = str(bundle.manifest.get("schema", "")).rsplit("/", 1)[-1][:16]
        if "content" in bundle.capabilities:
            sheets = load_content_from_zip(Path(install.storage_path), bundle.manifest)
            result = await preview_content(db, sheets, user)
            install.diff = result.as_dict()
        else:
            install.diff = {}
        install.status = "previewed"
        install.previewed_at = datetime.now(timezone.utc)
        await db.commit()
    except (BundleError, ContentPackError) as exc:
        await db.rollback()
        await _mark_failed(db, install_id, str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.exception("extension verify/preview failed")
        await db.rollback()
        await _mark_failed(db, install_id, str(exc)[:1000])


async def run_apply(db: AsyncSession, install: ExtensionInstall, user: User) -> None:
    """Install a verified bundle: apply its content pack, then extract files.

    Content is applied first (straight from the verified zip; the
    workspace engine commits on success) so a content failure leaves no
    half-installed extension directory behind.
    """
    install_id = install.id  # captured before any rollback expires the instance
    try:
        # Re-verify from disk — the upload could predate a core upgrade.
        bundle = read_bundle(Path(install.storage_path))

        if "content" in bundle.capabilities:
            sheets = load_content_from_zip(Path(install.storage_path), bundle.manifest)
            result = await apply_content(db, sheets, user)
            install.result = result.as_dict()
            if result.total_failed:
                install.status = "failed"
                install.error_message = (
                    f"{result.total_failed} content section error(s) — see result"
                )
                await db.commit()
                return

        extension = await install_bundle(db, bundle, user.id)
        install.status = "installed"
        install.applied_at = datetime.now(timezone.utc)
        await db.commit()
        await extension_registry.refresh_from_db(db)
        logger.info(
            "Extension %s %s installed via upload %s (status=%s)",
            extension.key,
            extension.version,
            install.id,
            extension.status,
        )
    except (BundleError, ContentPackError) as exc:
        await db.rollback()
        await _mark_failed(db, install_id, str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.exception("extension apply failed")
        await db.rollback()
        await _mark_failed(db, install_id, str(exc)[:1000])


async def _mark_failed(db: AsyncSession, install_id: uuid.UUID, message: str) -> None:
    install = (
        await db.execute(select(ExtensionInstall).where(ExtensionInstall.id == install_id))
    ).scalar_one_or_none()
    if install is not None:
        install.status = "failed"
        install.error_message = message
        await db.commit()


async def _run_job(install_id_str: str, user_id_str: str, runner) -> None:
    async with async_session() as db:
        install = (
            await db.execute(
                select(ExtensionInstall).where(ExtensionInstall.id == uuid.UUID(install_id_str))
            )
        ).scalar_one_or_none()
        if install is None:
            return
        user = (
            await db.execute(select(User).where(User.id == uuid.UUID(user_id_str)))
        ).scalar_one_or_none()
        if user is None or not install.storage_path:
            install.status = "failed"
            install.error_message = "Upload user or bundle file no longer exists"
            await db.commit()
            return
        await runner(db, install, user)


async def _verify_and_preview_job(install_id_str: str, user_id_str: str) -> None:
    await _run_job(install_id_str, user_id_str, run_verify_and_preview)


async def _apply_job(install_id_str: str, user_id_str: str) -> None:
    await _run_job(install_id_str, user_id_str, run_apply)
