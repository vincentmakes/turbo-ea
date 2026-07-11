"""Hardening tests for the backend extension loader + runtime (B-phase).

Covers: boot-time signature re-verification, import-crash isolation, SDK
compat gating, permission-namespace enforcement, router mounting behind
the entitlement gate, and the sequential migration runner.
"""

from __future__ import annotations

import base64
import json
import uuid
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core import permissions as perm_registry
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.loader import (
    load_extensions,
    merge_extension_permissions,
    mount_extension_routers,
)
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.sdk import SDK_VERSION, sdk_compatible
from tests.teax_helpers import build_manifest, build_wheel, make_keypair, trust_test_key


def sample_source(key: str, *, sdk_version: str = SDK_VERSION, crash: bool = False) -> str:
    if crash:
        return "raise RuntimeError('boom on import')\n"
    return f'''
from fastapi import APIRouter

from app.services.extensions.sdk import ExtensionMigration

router = APIRouter()


@router.get("/items")
async def items():
    return {{"items": ["a", "b"]}}


async def _create_items_table(conn):
    from sqlalchemy import text

    await conn.execute(
        text("CREATE TABLE IF NOT EXISTS ext_{key.replace("-", "_")}_items "
             "(id serial PRIMARY KEY, name text)")
    )


class SampleExtension:
    key = "{key}"
    sdk_version = "{sdk_version}"

    def get_router(self):
        return router

    def get_permissions(self):
        return {{
            "ext.{key}.view": "View sample items",
            "not-namespaced.view": "Should be skipped by the loader",
        }}

    def get_migrations(self):
        return [ExtensionMigration(version=1, name="create items", upgrade=_create_items_table)]

    def get_jobs(self):
        return []

    async def on_startup(self, ctx):
        pass


extension = SampleExtension()
'''


def install_ext_dir(
    root: Path,
    private,
    *,
    key: str = "sample-ext",
    source: str | None = None,
    sdk_version: str = SDK_VERSION,
    crash: bool = False,
    tamper_after_signing: bool = False,
) -> Path:
    """Write an installed-extension directory the way the installer would.

    Lays out a real wheel under ``wheels/`` (with its true sha256 in the signed
    files map); ``lib/`` is left for the loader to (re)extract from that wheel,
    exactly as the runtime does — so on-disk integrity checks are exercised.
    """
    pkg = f"turbo_ext_{uuid.uuid4().hex[:10]}"
    module_source = (
        source if source is not None else sample_source(key, sdk_version=sdk_version, crash=crash)
    )
    wheel_rel = f"wheels/{pkg}-1.0.0-py3-none-any.whl"
    wheel_bytes = build_wheel(pkg, module_source)
    manifest = build_manifest(
        key=key,
        capabilities=["backend"],
        files={wheel_rel: wheel_bytes},
        backend={"entrypoint": f"{pkg}:extension", "wheels": [wheel_rel]},
    )
    manifest_bytes = json.dumps(manifest, indent=2).encode()
    signature = base64.b64encode(private.sign(manifest_bytes)).decode()
    if tamper_after_signing:
        manifest_bytes = manifest_bytes.replace(b'"Sample Extension"', b'"Evil Extension"')

    ext_dir = root / key
    (ext_dir / "wheels").mkdir(parents=True)
    (ext_dir / "wheels" / f"{pkg}-1.0.0-py3-none-any.whl").write_bytes(wheel_bytes)
    (ext_dir / "manifest.json").write_bytes(manifest_bytes)
    (ext_dir / "manifest.sig").write_text(signature)
    return ext_dir


@pytest.fixture
def vendor(monkeypatch):
    private, public_b64 = make_keypair()
    trust_test_key(monkeypatch, public_b64)
    extension_registry.clear()
    yield private
    extension_registry.clear()


class TestLoadExtensions:
    def test_loads_valid_backend_extension(self, tmp_path, vendor):
        install_ext_dir(tmp_path, vendor)
        report = load_extensions(tmp_path)
        assert [f.error for f in report.failed] == []
        assert len(report.loaded) == 1
        ext = report.loaded[0]
        assert ext.key == "sample-ext"
        assert ext.instance is not None
        assert ext.instance.get_router() is not None

    def test_tampered_manifest_is_quarantined(self, tmp_path, vendor):
        install_ext_dir(tmp_path, vendor, tamper_after_signing=True)
        report = load_extensions(tmp_path)
        assert report.loaded == []
        assert len(report.failed) == 1
        assert "signature re-verification" in report.failed[0].error

    def test_hand_edited_manifest_is_quarantined(self, tmp_path, vendor):
        """Editing files on the volume after install must not survive a reboot."""
        ext_dir = install_ext_dir(tmp_path, vendor)
        manifest = json.loads((ext_dir / "manifest.json").read_text())
        manifest["name"] = "Edited On Disk"
        (ext_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
        report = load_extensions(tmp_path)
        assert report.loaded == []
        assert "signature re-verification" in report.failed[0].error

    def test_tampered_wheel_on_disk_is_quarantined(self, tmp_path, vendor):
        """Overwriting signed code on the volume (manifest intact) is detected."""
        ext_dir = install_ext_dir(tmp_path, vendor)
        wheel = next((ext_dir / "wheels").glob("*.whl"))
        wheel.write_bytes(b"evil replacement wheel bytes")
        report = load_extensions(tmp_path)
        assert report.loaded == []
        assert "hash mismatch" in report.failed[0].error

    def test_tampered_lib_is_reextracted_from_verified_wheel(self, tmp_path, vendor):
        """A tampered extracted lib/ is overwritten by verified wheel bytes at boot."""
        ext_dir = install_ext_dir(tmp_path, vendor)
        # First load extracts lib/ from the wheel.
        assert len(load_extensions(tmp_path).loaded) == 1
        init = next((ext_dir / "lib").glob("*/__init__.py"))
        init.write_text("raise RuntimeError('tampered lib should be overwritten')\n")
        # Second load must heal lib/ from the (still-valid) wheel and load cleanly.
        report = load_extensions(tmp_path)
        assert [f.error for f in report.failed] == []
        assert len(report.loaded) == 1

    def test_import_crash_is_isolated(self, tmp_path, vendor):
        install_ext_dir(tmp_path, vendor, key="broken-ext", crash=True)
        install_ext_dir(tmp_path, vendor, key="good-ext")
        report = load_extensions(tmp_path)
        assert [e.key for e in report.loaded] == ["good-ext"]
        assert [f.key for f in report.failed] == ["broken-ext"]
        assert "boom on import" in report.failed[0].error

    def test_sdk_major_mismatch_is_quarantined(self, tmp_path, vendor):
        install_ext_dir(tmp_path, vendor, sdk_version="2.0")
        report = load_extensions(tmp_path)
        assert report.loaded == []
        assert "SDK" in report.failed[0].error

    def test_missing_signature_is_quarantined(self, tmp_path, vendor):
        ext_dir = install_ext_dir(tmp_path, vendor)
        (ext_dir / "manifest.sig").unlink()
        report = load_extensions(tmp_path)
        assert report.loaded == []
        assert "signed manifest" in report.failed[0].error

    def test_tmp_dirs_and_missing_root_are_ignored(self, tmp_path, vendor):
        (tmp_path / ".tmp-abc").mkdir()
        assert load_extensions(tmp_path).loaded == []
        assert load_extensions(tmp_path / "does-not-exist").loaded == []

    def test_sdk_compatible_matrix(self):
        assert sdk_compatible("1.0") is True
        assert sdk_compatible("1.9") is True
        assert sdk_compatible("2.0") is False
        assert sdk_compatible("garbage") is False


class TestMergePermissions:
    def test_namespaced_keys_merge_and_foreign_keys_are_skipped(self, tmp_path, vendor):
        install_ext_dir(tmp_path, vendor)
        report = load_extensions(tmp_path)
        before = set(perm_registry.ALL_APP_PERMISSION_KEYS)
        try:
            merge_extension_permissions(report)
            assert "ext.sample-ext.view" in perm_registry.ALL_APP_PERMISSION_KEYS
            assert "not-namespaced.view" not in perm_registry.ALL_APP_PERMISSION_KEYS
            assert (
                "ext.sample-ext.view" in perm_registry.APP_PERMISSIONS["extensions"]["permissions"]
            )
        finally:
            # Undo registry mutation so other tests see the pristine set.
            perm_registry.APP_PERMISSIONS.pop("extensions", None)
            perm_registry.ALL_APP_PERMISSION_KEYS.clear()
            perm_registry.ALL_APP_PERMISSION_KEYS.update(before)


class TestMountedRouterGate:
    async def _client(self, tmp_path, vendor) -> AsyncClient:
        from fastapi import APIRouter

        install_ext_dir(tmp_path, vendor)
        report = load_extensions(tmp_path)
        api_router = APIRouter()
        mount_extension_routers(api_router, report)
        app = FastAPI()
        app.include_router(api_router, prefix="/api/v1")
        return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

    def _license(self) -> LicenseDocument:
        return LicenseDocument(
            licensee="ACME",
            customer_id="c",
            issued_at=None,
            grace_days=30,
            entitlements=[Entitlement(extension_key="sample-ext", expires_at=None)],
        )

    async def test_route_serves_when_licensed_and_enabled(self, tmp_path, vendor):
        client = await self._client(tmp_path, vendor)
        extension_registry.load_installed(
            [
                ExtensionInfo(
                    key="sample-ext",
                    name="Sample",
                    version="1.0.0",
                    status="installed",
                    enabled=True,
                )
            ]
        )
        extension_registry.set_license(self._license())
        async with client:
            res = await client.get("/api/v1/ext/sample-ext/items")
        assert res.status_code == 200
        assert res.json() == {"items": ["a", "b"]}

    async def test_route_403_when_unlicensed_and_404_when_not_installed(self, tmp_path, vendor):
        client = await self._client(tmp_path, vendor)
        async with client:
            # Registry empty → not installed → 404
            assert (await client.get("/api/v1/ext/sample-ext/items")).status_code == 404
            # Installed but no license → 403
            extension_registry.load_installed(
                [
                    ExtensionInfo(
                        key="sample-ext",
                        name="Sample",
                        version="1.0.0",
                        status="installed",
                        enabled=True,
                    )
                ]
            )
            assert (await client.get("/api/v1/ext/sample-ext/items")).status_code == 403
            # Disabled → 403 even when licensed
            extension_registry.set_license(self._license())
            extension_registry.load_installed(
                [
                    ExtensionInfo(
                        key="sample-ext",
                        name="Sample",
                        version="1.0.0",
                        status="disabled",
                        enabled=False,
                    )
                ]
            )
            assert (await client.get("/api/v1/ext/sample-ext/items")).status_code == 403


class TestMigrationRunner:
    async def test_sequential_migrations_run_once(self, tmp_path, vendor, test_engine, monkeypatch):
        """Runner applies pending steps in order, records them, and re-runs are no-ops."""
        from sqlalchemy import text

        from app.services.extensions import migrations as mig_mod

        key = f"mig-ext-{uuid.uuid4().hex[:8]}"
        table = f"ext_{key.replace('-', '_')}_items"
        install_ext_dir(tmp_path, vendor, key=key)
        report = load_extensions(tmp_path)
        assert report.loaded and report.loaded[0].instance is not None

        monkeypatch.setattr(mig_mod, "engine", test_engine)
        try:
            errors = await mig_mod.run_extension_migrations(report, should_run={key: True})
            assert errors == {}
            errors = await mig_mod.run_extension_migrations(report, should_run={key: True})
            assert errors == {}  # idempotent — version 1 already recorded

            async with test_engine.connect() as conn:
                versions = (
                    await conn.execute(
                        text(
                            "SELECT version FROM extension_schema_versions WHERE extension_key = :k"
                        ).bindparams(k=key)
                    )
                ).all()
                assert [v for (v,) in versions] == [1]
                # The extension's own table exists
                exists = (
                    await conn.execute(text("SELECT to_regclass(:t)").bindparams(t=table))
                ).scalar_one()
                assert exists is not None
        finally:
            async with test_engine.begin() as conn:
                await conn.execute(text(f"DROP TABLE IF EXISTS {table}"))
                await conn.execute(
                    text(
                        "DELETE FROM extension_schema_versions WHERE extension_key = :k"
                    ).bindparams(k=key)
                )

    async def test_skipped_when_should_run_false(self, tmp_path, vendor, test_engine, monkeypatch):
        from sqlalchemy import text

        from app.services.extensions import migrations as mig_mod

        key = f"mig-skip-{uuid.uuid4().hex[:8]}"
        install_ext_dir(tmp_path, vendor, key=key)
        report = load_extensions(tmp_path)
        monkeypatch.setattr(mig_mod, "engine", test_engine)
        errors = await mig_mod.run_extension_migrations(report, should_run={key: False})
        assert errors == {}
        async with test_engine.connect() as conn:
            count = (
                await conn.execute(
                    text(
                        "SELECT count(*) FROM extension_schema_versions WHERE extension_key = :k"
                    ).bindparams(k=key)
                )
            ).scalar_one()
        assert count == 0
