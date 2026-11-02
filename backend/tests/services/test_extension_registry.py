"""Unit tests for the extension registry + require_extension gate (no DB)."""

from __future__ import annotations

import base64
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from app.services.extensions.gate import require_extension
from app.services.extensions.license import (
    LICENSE_UNDECRYPTABLE_MESSAGE,
    Entitlement,
    LicenseDocument,
    seal_license_text,
)
from app.services.extensions.registry import (
    ExtensionInfo,
    ExtensionRegistry,
    extension_registry,
)

NOW = datetime(2026, 7, 8, tzinfo=timezone.utc)


def make_info(**overrides) -> ExtensionInfo:
    defaults = dict(
        key="sample-ext",
        name="Sample Extension",
        version="1.0.0",
        status="installed",
        enabled=True,
    )
    defaults.update(overrides)
    return ExtensionInfo(**defaults)


def make_license(*entitlements: Entitlement, grace_days: int = 30) -> LicenseDocument:
    return LicenseDocument(
        licensee="ACME Corp",
        customer_id="cus_1",
        issued_at=NOW - timedelta(days=1),
        grace_days=grace_days,
        entitlements=list(entitlements),
    )


class TestRegistryEntitlement:
    def test_no_license_is_unlicensed(self):
        reg = ExtensionRegistry()
        reg.load_installed([make_info()])
        assert reg.entitlement("sample-ext").state == "unlicensed"
        assert reg.entitlement("sample-ext").usable is False

    def test_license_without_matching_entitlement_is_unlicensed(self):
        reg = ExtensionRegistry()
        reg.set_license(make_license(Entitlement(extension_key="other-ext")))
        assert reg.entitlement("sample-ext").state == "unlicensed"

    def test_active_entitlement(self):
        reg = ExtensionRegistry()
        reg.set_license(
            make_license(
                Entitlement(
                    extension_key="sample-ext",
                    expires_at=NOW + timedelta(days=90),
                )
            )
        )
        status = reg.entitlement("sample-ext", now=NOW)
        assert status.state == "active"
        assert status.usable is True
        assert status.grace_until == NOW + timedelta(days=90) + timedelta(days=30)

    def test_grace_entitlement_is_usable(self):
        reg = ExtensionRegistry()
        reg.set_license(
            make_license(
                Entitlement(extension_key="sample-ext", expires_at=NOW - timedelta(days=5))
            )
        )
        status = reg.entitlement("sample-ext", now=NOW)
        assert status.state == "grace"
        assert status.usable is True

    def test_expired_entitlement_is_not_usable(self):
        reg = ExtensionRegistry()
        reg.set_license(
            make_license(
                Entitlement(extension_key="sample-ext", expires_at=NOW - timedelta(days=40))
            )
        )
        status = reg.entitlement("sample-ext", now=NOW)
        assert status.state == "expired"
        assert status.usable is False

    def test_trial_entitlement_gets_no_grace(self):
        """A trial's expiry is a hard stop — no 30 bonus days of grace.

        The same one-second-past-expiry instant that puts a paid entitlement
        into ``grace`` puts a trial straight into ``expired``.
        """
        reg = ExtensionRegistry()
        expires = NOW - timedelta(seconds=1)
        reg.set_license(
            make_license(
                Entitlement(extension_key="sample-ext", expires_at=expires, trial=True),
                Entitlement(extension_key="paid-ext", expires_at=expires),
            )
        )
        trial = reg.entitlement("sample-ext", now=NOW)
        assert trial.state == "expired"
        assert trial.usable is False
        assert trial.trial is True
        assert trial.grace_until == expires  # zero grace window
        # The license-global grace_days still applies to the paid entitlement.
        paid = reg.entitlement("paid-ext", now=NOW)
        assert paid.state == "grace"
        assert paid.usable is True

    def test_active_trial_is_usable_and_labelled(self):
        reg = ExtensionRegistry()
        reg.set_license(
            make_license(
                Entitlement(
                    extension_key="sample-ext", expires_at=NOW + timedelta(days=10), trial=True
                )
            )
        )
        status = reg.entitlement("sample-ext", now=NOW)
        assert status.state == "active"
        assert status.usable is True
        assert status.trial is True

    def test_load_and_lookup(self):
        reg = ExtensionRegistry()
        reg.load_installed([make_info(), make_info(key="second-ext")])
        assert reg.get("second-ext") is not None
        assert reg.get("missing") is None
        assert {info.key for info in reg.all()} == {"sample-ext", "second-ext"}

    def test_free_manifest_is_usable_without_license(self):
        reg = ExtensionRegistry()
        reg.load_installed([make_info(manifest={"free": True})])
        status = reg.entitlement("sample-ext", now=NOW)
        assert status.state == "free"
        assert status.usable is True

    def test_free_flag_overrides_absent_entitlement(self):
        # A free extension is usable even when a license is present but does not
        # entitle it — the free flag is checked before the license path.
        reg = ExtensionRegistry()
        reg.load_installed([make_info(manifest={"free": True})])
        reg.set_license(make_license(Entitlement(extension_key="other-ext")))
        assert reg.entitlement("sample-ext", now=NOW).usable is True

    def test_non_bool_free_flag_is_not_treated_as_free(self):
        # Defence in depth — bundle.py rejects a non-bool free at verify time,
        # but the registry must not treat a truthy non-True value as free.
        reg = ExtensionRegistry()
        reg.load_installed([make_info(manifest={"free": "yes"})])
        assert reg.entitlement("sample-ext").state == "unlicensed"


class TestGrantedCapabilities:
    """Grants only count from enabled + licensed (usable) extensions."""

    def _reg(self, *, enabled=True, status="installed", grants, licensed=True) -> ExtensionRegistry:
        reg = ExtensionRegistry()
        reg.load_installed([make_info(enabled=enabled, status=status, manifest={"grants": grants})])
        if licensed:
            reg.set_license(make_license(Entitlement(extension_key="sample-ext", expires_at=None)))
        return reg

    def test_active_extension_grants_capabilities(self):
        reg = self._reg(grants=["metamodel.field_help", "metamodel.custom_field_types"])
        assert reg.granted_capabilities(now=NOW) == {
            "metamodel.field_help",
            "metamodel.custom_field_types",
        }
        assert reg.grants_for("sample-ext", now=NOW) == [
            "metamodel.field_help",
            "metamodel.custom_field_types",
        ]

    def test_unlicensed_extension_grants_nothing(self):
        reg = self._reg(grants=["metamodel.field_help"], licensed=False)
        assert reg.granted_capabilities(now=NOW) == set()

    def test_disabled_extension_grants_nothing(self):
        reg = self._reg(grants=["metamodel.field_help"], enabled=False)
        assert reg.granted_capabilities(now=NOW) == set()

    def test_removed_extension_grants_nothing(self):
        reg = self._reg(grants=["metamodel.field_help"], status="removed")
        assert reg.granted_capabilities(now=NOW) == set()

    def test_expired_extension_grants_nothing(self):
        reg = ExtensionRegistry()
        reg.load_installed([make_info(manifest={"grants": ["metamodel.field_help"]})])
        reg.set_license(
            make_license(
                Entitlement(extension_key="sample-ext", expires_at=NOW - timedelta(days=40))
            )
        )
        assert reg.granted_capabilities(now=NOW) == set()

    def test_no_grants_declared(self):
        reg = self._reg(grants=[])
        assert reg.granted_capabilities(now=NOW) == set()


@pytest.fixture
def gate_app():
    app = FastAPI()

    @app.get("/probe", dependencies=[Depends(require_extension("sample-ext"))])
    async def probe():
        return {"ok": True}

    extension_registry.clear()
    yield app
    extension_registry.clear()


async def _get(app: FastAPI) -> int:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        return (await client.get("/probe")).status_code


class TestRequireExtensionGate:
    async def test_not_installed_is_404(self, gate_app):
        assert await _get(gate_app) == 404

    async def test_removed_is_404(self, gate_app):
        extension_registry.load_installed([make_info(status="removed")])
        assert await _get(gate_app) == 404

    async def test_disabled_is_403(self, gate_app):
        extension_registry.load_installed([make_info(enabled=False)])
        extension_registry.set_license(
            make_license(Entitlement(extension_key="sample-ext", expires_at=None))
        )
        assert await _get(gate_app) == 403

    async def test_unlicensed_is_403(self, gate_app):
        extension_registry.load_installed([make_info()])
        assert await _get(gate_app) == 403

    async def test_expired_is_403(self, gate_app):
        extension_registry.load_installed([make_info()])
        extension_registry.set_license(
            make_license(
                Entitlement(extension_key="sample-ext", expires_at=NOW - timedelta(days=400))
            )
        )
        assert await _get(gate_app) == 403

    async def test_active_passes(self, gate_app):
        extension_registry.load_installed([make_info()])
        extension_registry.set_license(
            make_license(Entitlement(extension_key="sample-ext", expires_at=None))
        )
        assert await _get(gate_app) == 200

    async def test_free_extension_passes_without_license(self, gate_app):
        extension_registry.load_installed([make_info(manifest={"free": True})])
        assert await _get(gate_app) == 200

    async def test_grace_passes(self, gate_app):
        extension_registry.load_installed([make_info()])
        extension_registry.set_license(
            make_license(
                Entitlement(
                    extension_key="sample-ext",
                    expires_at=datetime.now(timezone.utc) - timedelta(days=1),
                )
            )
        )
        assert await _get(gate_app) == 200


class TestRefreshFromDbStoredText:
    """The registry decrypts ``raw_text`` before verifying (migration 162)."""

    INSTANCE = "TEA-TEST-TEST-TEST"

    @staticmethod
    def _db(license_row) -> MagicMock:
        extensions_result = MagicMock()
        extensions_result.scalars.return_value.all.return_value = []
        license_result = MagicMock()
        license_result.scalar_one_or_none.return_value = license_row
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[extensions_result, license_result])
        return db

    @pytest.fixture
    def signed(self, monkeypatch):
        from app.services.extensions.instance_id import get_instance_id, set_instance_id
        from tests.teax_helpers import make_keypair, trust_test_key

        private, public_b64 = make_keypair()
        trust_test_key(monkeypatch, public_b64)
        previous = get_instance_id()
        set_instance_id(self.INSTANCE)
        payload = json.dumps(
            {
                "licensee": "ACME Corp",
                "customer_id": "cus_1",
                "instance_id": self.INSTANCE,
                "renewal_key": "rk_bearer",
                "entitlements": [{"extension_key": "sample-ext", "expires_at": None}],
            }
        ).encode()
        text = json.dumps(
            {
                "schema": "turboea-license/1",
                "key_id": "test",
                "payload": base64.b64encode(payload).decode(),
                "signature": base64.b64encode(private.sign(payload)).decode(),
            }
        )
        yield text
        set_instance_id(previous)

    async def test_encrypted_row_loads(self, signed):
        reg = ExtensionRegistry()
        row = SimpleNamespace(raw_text=seal_license_text(signed))
        await reg.refresh_from_db(self._db(row))
        assert reg.license_problem is None
        assert reg.license is not None
        assert reg.license.renewal_key == "rk_bearer"
        assert reg.license.raw_text == signed

    async def test_legacy_plaintext_row_still_loads(self, signed):
        reg = ExtensionRegistry()
        await reg.refresh_from_db(self._db(SimpleNamespace(raw_text=signed)))
        assert reg.license_problem is None
        assert reg.license is not None and reg.license.licensee == "ACME Corp"

    async def test_rotated_secret_key_soft_disables_with_the_specific_problem(
        self, signed, monkeypatch
    ):
        from app.config import settings

        sealed = seal_license_text(signed)
        row = SimpleNamespace(raw_text=sealed)
        monkeypatch.setattr(settings, "SECRET_KEY", settings.SECRET_KEY + "-rotated")
        reg = ExtensionRegistry()
        reg.set_license(make_license(Entitlement(extension_key="sample-ext")))
        await reg.refresh_from_db(self._db(row))
        assert reg.license is None
        assert reg.license_problem == LICENSE_UNDECRYPTABLE_MESSAGE
        assert reg.entitlement("sample-ext").state == "unlicensed"
        # Nothing was written back: the stored envelope is untouched.
        assert row.raw_text == sealed
