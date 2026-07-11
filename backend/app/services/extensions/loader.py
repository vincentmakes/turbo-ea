"""Boot-time loader for backend extension code.

Runs at import time in ``app.main`` — BEFORE ``app.include_router`` —
because FastAPI's route table is static once the app starts serving.
Consequences:

- no database access here (activation state is enforced per-request by
  ``require_extension`` and per-tick by the job loops),
- installing or uninstalling a code-bearing extension needs a backend
  restart (surfaced as the ``needs_restart`` status in the admin UI).

Provenance is re-checked on every boot: each installed extension's
``manifest.sig`` is verified against the vendor key again, so dropping
files onto the extensions volume bypasses nothing. Any failure —
signature, SDK mismatch, import error, protocol violation — quarantines
that one extension (recorded, surfaced in the admin UI at startup) and
never prevents core from booting.
"""

from __future__ import annotations

import importlib
import json
import logging
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends

from app.config import APP_VERSION
from app.core.extension_signing import trusted_public_keys, verify_with_trusted
from app.services.extensions.bundle import (
    MANIFEST_NAME,
    SIGNATURE_NAME,
    BundleError,
    _validate_manifest,
    verify_files_on_disk,
)
from app.services.extensions.gate import require_extension
from app.services.extensions.installer import EXTENSIONS_DIR, extract_wheels_to_lib
from app.services.extensions.sdk import SDK_VERSION, TurboExtension, sdk_compatible

logger = logging.getLogger(__name__)


@dataclass
class LoadedExtension:
    key: str
    manifest: dict[str, Any]
    directory: Path
    instance: TurboExtension | None = None  # None for content/frontend-only bundles


@dataclass
class FailedExtension:
    key: str
    error: str


@dataclass
class LoadReport:
    loaded: list[LoadedExtension] = field(default_factory=list)
    failed: list[FailedExtension] = field(default_factory=list)

    def get(self, key: str) -> LoadedExtension | None:
        for ext in self.loaded:
            if ext.key == key:
                return ext
        return None


def _verify_installed_dir(ext_dir: Path) -> dict[str, Any]:
    """Re-verify an installed extension's signature, compat, and on-disk files.

    The signature only pins ``manifest.json``; the manifest in turn pins every
    file's sha256. Re-hashing the extracted files (``verify_files_on_disk``) is
    what makes tampering with code dropped onto the extensions volume
    detectable — without it, a manifest-only re-check leaves the actual
    imported bytes unverified.
    """
    manifest_path = ext_dir / MANIFEST_NAME
    signature_path = ext_dir / SIGNATURE_NAME
    if not manifest_path.is_file() or not signature_path.is_file():
        raise BundleError("Installed extension is missing its signed manifest")
    manifest_bytes = manifest_path.read_bytes()
    signature_b64 = signature_path.read_text(encoding="ascii", errors="replace").strip()
    trusted = trusted_public_keys()
    if not trusted or not verify_with_trusted(
        manifest_bytes, signature_b64, None, trusted, artifact="bundle"
    ):
        raise BundleError("Installed extension failed signature re-verification — refusing to load")
    manifest = json.loads(manifest_bytes)
    if not isinstance(manifest, dict):
        raise BundleError("Installed extension manifest must be a JSON object")
    _validate_manifest(manifest, APP_VERSION)
    verify_files_on_disk(manifest, ext_dir)
    return manifest


def _resolve_entrypoint(ext_dir: Path, manifest: dict[str, Any]) -> TurboExtension:
    # ``lib/`` is derived by extracting the (now signature-verified) wheels, so
    # it is not itself in the signed files map. Re-extract it from the verified
    # wheels on every boot so the imported bytes always match signed code — a
    # tampered on-disk lib/ is overwritten rather than trusted.
    lib_dir = ext_dir / "lib"
    extract_wheels_to_lib(ext_dir, manifest)
    lib_str = str(lib_dir.resolve())
    if lib_dir.is_dir() and lib_str not in sys.path:
        sys.path.insert(0, lib_str)

    entrypoint = str((manifest.get("backend") or {}).get("entrypoint", ""))
    module_name, _, attr = entrypoint.partition(":")
    if not module_name or not attr:
        raise BundleError(f"Invalid backend entrypoint: {entrypoint!r}")
    module = importlib.import_module(module_name)
    instance = getattr(module, attr)

    if not isinstance(instance, TurboExtension):
        raise BundleError(f"Entrypoint {entrypoint!r} does not satisfy the TurboExtension protocol")
    if instance.key != manifest["key"]:
        raise BundleError(
            f"Extension key mismatch: manifest says {manifest['key']!r}, code says {instance.key!r}"
        )
    if not sdk_compatible(instance.sdk_version):
        raise BundleError(
            f"Extension was built for SDK {instance.sdk_version}, this core provides "
            f"SDK {SDK_VERSION} — rebuild the extension against a compatible SDK"
        )
    return instance


def load_extensions(extensions_dir: Path | None = None) -> LoadReport:
    """Scan the extensions volume and load every backend-capable extension.

    Fail-soft per extension; core always boots.
    """
    extensions_dir = extensions_dir if extensions_dir is not None else EXTENSIONS_DIR
    report = LoadReport()
    if not extensions_dir.is_dir():
        return report

    for ext_dir in sorted(p for p in extensions_dir.iterdir() if p.is_dir()):
        key = ext_dir.name
        if key.startswith(".tmp-"):
            continue
        try:
            manifest = _verify_installed_dir(ext_dir)
            loaded = LoadedExtension(key=str(manifest["key"]), manifest=manifest, directory=ext_dir)
            if "backend" in (manifest.get("capabilities") or []):
                loaded.instance = _resolve_entrypoint(ext_dir, manifest)
            report.loaded.append(loaded)
            logger.info(
                "Loaded extension %s %s (backend code: %s)",
                loaded.key,
                manifest.get("version"),
                "yes" if loaded.instance else "no",
            )
        except Exception as exc:  # noqa: BLE001 — quarantine, never block boot
            logger.exception("Failed to load extension %s", key)
            report.failed.append(FailedExtension(key=key, error=str(exc)[:1000]))
    return report


def mount_extension_routers(api_router: APIRouter, report: LoadReport) -> None:
    """Mount every loaded extension's router under ``/ext/{key}/``.

    Every route is request-gated by ``require_extension(key)`` — that is
    the soft-disable/entitlement enforcement point (routes themselves are
    static once mounted).
    """
    for ext in report.loaded:
        if ext.instance is None:
            continue
        try:
            router = ext.instance.get_router()
        except Exception as exc:  # noqa: BLE001
            logger.exception("Extension %s get_router() failed", ext.key)
            report.failed.append(FailedExtension(key=ext.key, error=str(exc)[:1000]))
            continue
        if router is None:
            continue
        api_router.include_router(
            router,
            prefix=f"/ext/{ext.key}",
            tags=[f"ext:{ext.key}"],
            dependencies=[Depends(require_extension(ext.key))],
        )
        logger.info("Mounted extension router at /ext/%s", ext.key)


def merge_extension_permissions(report: LoadReport) -> None:
    """Inject validated ``ext.{key}.*`` permission keys into the registry."""
    from app.core import permissions as perm_registry

    merged: dict[str, str] = {}
    for ext in report.loaded:
        if ext.instance is None:
            continue
        try:
            declared = ext.instance.get_permissions() or {}
        except Exception as exc:  # noqa: BLE001
            logger.exception("Extension %s get_permissions() failed", ext.key)
            report.failed.append(FailedExtension(key=ext.key, error=str(exc)[:1000]))
            continue
        prefix = f"ext.{ext.key}."
        for perm_key, description in declared.items():
            if not str(perm_key).startswith(prefix):
                logger.error(
                    "Extension %s declared permission %r outside its namespace %r — skipped",
                    ext.key,
                    perm_key,
                    prefix,
                )
                continue
            merged[str(perm_key)] = str(description)

    if not merged:
        return
    group = perm_registry.APP_PERMISSIONS.setdefault(
        "extensions", {"label": "Extensions", "permissions": {}}
    )
    group["permissions"].update(merged)
    perm_registry.ALL_APP_PERMISSION_KEYS.update(merged.keys())
    logger.info("Registered %d extension permission key(s)", len(merged))
