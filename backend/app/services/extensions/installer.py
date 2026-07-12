"""Extension installation on the persistent extensions volume.

Layout on disk (``data/extensions/`` — persisted via the ``backend_data``
docker volume)::

    data/extensions/
      <key>/
        manifest.json   # kept verbatim so the loader can re-verify at boot
        manifest.sig
        lib/            # extracted backend wheel contents (added to sys.path)
        frontend/       # ESM bundle(s) served by /ext-assets
        content/        # data payloads
        docs/

Wheels are installed by **zip extraction, not pip** — the backend
container is non-root with all capabilities dropped and may be
air-gapped, so pulling dependencies at install time is off the table.
Only pure-Python ``py3-none-any`` wheels are accepted; an extension
bundles any extra pure-Python dependency wheels alongside its own.

Installation is atomic: everything is extracted into a ``.tmp-*``
sibling first and swapped into place with ``os.replace`` so a crash
mid-install can never leave a half-written extension directory.
"""

from __future__ import annotations

import logging
import os
import shutil
import uuid
import zipfile
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extension import Extension
from app.services.extensions.bundle import (
    KEY_PATTERN,
    MANIFEST_NAME,
    SIGNATURE_NAME,
    BundleError,
    VerifiedBundle,
    _safe_member_name,
)

logger = logging.getLogger(__name__)

EXTENSIONS_DIR = Path("data/extensions")

# Capabilities whose code the running backend process loads at startup and
# therefore cannot pick up without a restart (surfaced as the restart banner
# in the admin UI). Only ``backend`` qualifies: routers mount at import time,
# wheels go onto sys.path, permissions/migrations/jobs wire during startup.
# ``frontend`` is deliberately NOT here — UI bundles are served straight from
# disk per request (``GET /ext-assets/...``) and ``/extensions/ui-manifest``
# refreshes the registry from the DB on every call, so a UI-only install is
# live immediately (users pick it up on their next page load). The bundle was
# signature-verified by this installer moments ago, so serving it without a
# boot-time re-verification is safe; the boot re-check still guards against
# volume tampering while the process was down.
RUNTIME_CAPABILITIES = frozenset({"backend"})


def _extract_wheel(wheel_path: Path, lib_dir: Path) -> None:
    """Extract a pure-Python wheel's packages into ``lib_dir``."""
    name = wheel_path.name
    if not name.endswith("py3-none-any.whl"):
        raise BundleError(
            f"Extension wheel {name} is not py3-none-any — only pure-Python wheels are supported"
        )
    with zipfile.ZipFile(wheel_path) as zf:
        for member in zf.namelist():
            if member.endswith("/"):
                continue
            if not _safe_member_name(member):
                raise BundleError(f"Wheel {name} contains an unsafe path: {member}")
            target = lib_dir / member
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(zf.read(member))


def extract_wheels_to_lib(ext_dir: Path, manifest: dict) -> None:
    """(Re)build ``ext_dir/lib`` from the manifest's wheels, verified bytes only.

    Idempotent: the existing ``lib/`` is discarded first so a tampered or stale
    lib can never survive. Called at install time and again at every boot (from
    the loader) so the imported code is always derived from signature-verified
    wheels rather than whatever happens to be on the volume.
    """
    wheels = (manifest.get("backend") or {}).get("wheels", [])
    if not wheels:
        return
    lib_dir = ext_dir / "lib"
    if lib_dir.exists():
        shutil.rmtree(lib_dir)
    for rel in wheels:
        wheel_path = ext_dir / str(rel)
        if not wheel_path.is_file():
            raise BundleError(f"Bundle manifest lists a missing wheel: {rel}")
        _extract_wheel(wheel_path, lib_dir)


def extract_bundle_to_dir(bundle: VerifiedBundle, target_dir: Path) -> None:
    """Extract a verified bundle's members (and wheels) into ``target_dir``."""
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(bundle.path) as zf:
        for member in zf.namelist():
            if member.endswith("/"):
                continue
            if member not in (MANIFEST_NAME, SIGNATURE_NAME) and not _safe_member_name(member):
                raise BundleError(f"Bundle contains an unsafe path: {member}")
            target = target_dir / member
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(zf.read(member))

    extract_wheels_to_lib(target_dir, bundle.manifest)


async def install_bundle(
    db: AsyncSession,
    bundle: VerifiedBundle,
    user_id: uuid.UUID | None,
    *,
    extensions_dir: Path | None = None,
) -> Extension:
    """Extract a verified bundle onto the volume and upsert its registry row.

    The caller owns the transaction (flush only) and is responsible for
    refreshing the in-memory registry afterwards.
    """
    key = bundle.key
    extensions_dir = extensions_dir if extensions_dir is not None else EXTENSIONS_DIR
    extensions_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir = extensions_dir / f".tmp-{uuid.uuid4().hex}"
    try:
        extract_bundle_to_dir(bundle, tmp_dir)
        final_dir = extensions_dir / key
        if final_dir.exists():
            shutil.rmtree(final_dir)
        tmp_dir.replace(final_dir)
    except Exception:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise

    has_runtime_code = bool(set(bundle.capabilities) & RUNTIME_CAPABILITIES)
    status = "needs_restart" if has_runtime_code else "installed"

    existing = (
        await db.execute(select(Extension).where(Extension.key == key))
    ).scalar_one_or_none()
    if existing is None:
        existing = Extension(
            key=key,
            name=str(bundle.manifest.get("name") or key),
            version=bundle.version,
            manifest=bundle.manifest,
            capabilities=bundle.capabilities,
            status=status,
            enabled=True,
            installed_by=user_id,
        )
        db.add(existing)
    else:
        existing.name = str(bundle.manifest.get("name") or key)
        existing.version = bundle.version
        existing.manifest = bundle.manifest
        existing.capabilities = bundle.capabilities
        existing.status = status
        existing.last_error = None
        existing.installed_by = user_id
        # A re-install of a previously removed extension comes back enabled.
        if existing.status != "disabled":
            existing.enabled = True
    await db.flush()
    logger.info("Installed extension %s %s (status=%s)", key, bundle.version, status)
    return existing


async def uninstall(
    db: AsyncSession, key: str, *, extensions_dir: Path | None = None
) -> Extension | None:
    """Remove an extension's files and mark its row ``removed``.

    Extension data (``ext_{key}_*`` tables, content-pack cards) is
    deliberately left untouched — uninstalling must never destroy customer
    data. Content-pack **card/relation types are soft-hidden** though, so
    the metamodel visibly reflects the uninstall; reinstalling unhides
    them and everything reappears. If the extension had loaded runtime
    code the process keeps serving it until the next restart; the API
    layer surfaces that.
    """
    from app.services.extensions.content_pack import set_content_visibility
    from app.services.extensions.field_contributions import remove_field_contributions

    extensions_dir = extensions_dir if extensions_dir is not None else EXTENSIONS_DIR
    row = (await db.execute(select(Extension).where(Extension.key == key))).scalar_one_or_none()
    if row is None:
        return None
    # Hide the pack's metamodel entries BEFORE removing the files that
    # declare them, and strip contributed field sections from card types
    # (attribute values stay in cards.attributes — reinstalling restores them).
    hidden = await set_content_visibility(db, extensions_dir / key, row.manifest or {}, True)
    hidden += await remove_field_contributions(db, key)
    # The DB row lookup above already guarantees a legitimate key, but never
    # hand a deletion sink a path that could have escaped the extensions root.
    # Realpath + os.sep-terminated prefix guard is the canonical containment
    # barrier for the rmtree below.
    root = os.path.realpath(str(extensions_dir))
    ext_dir = os.path.realpath(os.path.join(root, key))
    if KEY_PATTERN.match(key) and ext_dir.startswith(root + os.sep):
        shutil.rmtree(ext_dir, ignore_errors=True)
    else:
        logger.error("Refusing to remove suspicious extension directory for key %r", key)
    row.status = "removed"
    row.enabled = False
    await db.flush()
    logger.info(
        "Uninstalled extension %s (files removed, %d metamodel entries hidden, data retained)",
        key,
        hidden,
    )
    return row
