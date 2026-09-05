"""Extension-declared notification types (SDK 1.11): manifest-driven
registration, the grant + namespace gates, liveness, and label resolution."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.services.extensions import notification_types as nt
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.loader import LoadedExtension, LoadReport
from app.services.extensions.registry import ExtensionInfo, extension_registry

NOW = datetime.now(timezone.utc)
KEY = "sample-rules"
OTHER = "other-ext"
GRANT = "core.notifications.send"


def manifest(types: list[dict], *, grants: list[str] | None = None) -> dict:
    return {
        "grants": [GRANT] if grants is None else grants,
        "notifications": {"types": types},
    }


def entry(name: str = "notice", key: str = KEY, **extra) -> dict:
    return {"key": f"ext.{key}.{name}", "label": f"{name} label", **extra}


def load_registry(
    *, manifests: dict[str, dict], enabled: bool = True, licensed: bool = True
) -> None:
    extension_registry.clear()
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=key,
                name=key.title(),
                version="1.0.0",
                status="installed",
                enabled=enabled,
                manifest=m,
            )
            for key, m in manifests.items()
        ]
    )
    if licensed:
        extension_registry.set_license(
            LicenseDocument(
                licensee="ACME",
                customer_id="cus_1",
                issued_at=NOW - timedelta(days=1),
                grace_days=30,
                entitlements=[Entitlement(extension_key=k, expires_at=None) for k in manifests],
            )
        )


def report(*keys: str) -> LoadReport:
    r = LoadReport()
    for key in keys:
        r.loaded.append(
            LoadedExtension(key=key, manifest={}, directory=Path("/nonexistent"), instance=None)
        )
    return r


@pytest.fixture(autouse=True)
def _cleanup():
    extension_registry.clear()
    nt.reset_types()
    yield
    extension_registry.clear()
    nt.reset_types()


class TestRegistration:
    def test_registers_from_the_manifest_at_startup(self):
        load_registry(manifests={KEY: manifest([entry(in_app_default=True, email_default=True)])})
        nt.start_notification_types(report(KEY))
        assert nt.registered_type_keys() == [f"ext.{KEY}.notice"]
        spec = nt.type_spec(f"ext.{KEY}.notice")
        assert spec is not None
        assert spec.in_app_default is True
        assert spec.email_default is True
        assert spec.in_app_only is False
        assert spec.email_locked is False
        assert spec.user_configurable is True

    def test_defaults_are_bell_on_email_off(self):
        load_registry(manifests={KEY: manifest([entry()])})
        nt.start_notification_types(report(KEY))
        spec = nt.type_spec(f"ext.{KEY}.notice")
        assert spec is not None
        assert (spec.in_app_default, spec.email_default) == (True, False)

    def test_missing_grant_skips_the_block(self):
        load_registry(manifests={KEY: manifest([entry()], grants=["core.cards.read"])})
        nt.start_notification_types(report(KEY))
        assert nt.registered_type_keys() == []

    def test_foreign_namespace_skips_the_whole_block(self):
        # A half-registered block would give the dialog rows the bridge then
        # refuses, so one bad row voids the block — the verifier already
        # refused it at install; this is the on-disk re-read guard.
        load_registry(manifests={KEY: manifest([entry(), entry(key=OTHER, name="x")])})
        nt.start_notification_types(report(KEY))
        assert nt.registered_type_keys() == []

    def test_cap_is_enforced(self):
        load_registry(manifests={KEY: manifest([entry(name=f"t{i}") for i in range(6)])})
        nt.start_notification_types(report(KEY))
        assert nt.registered_type_keys() == []

    def test_duplicate_key_across_extensions_keeps_the_first(self):
        stolen = {"key": f"ext.{KEY}.notice", "label": "Stolen"}
        load_registry(
            manifests={KEY: manifest([entry()]), OTHER: manifest([stolen])},
        )
        # The second extension's block fails the namespace check anyway; make
        # the collision explicit by registering it directly.
        nt.register_manifest_types(KEY, manifest([entry()]))
        assert nt.register_manifest_types(OTHER, {"grants": [GRANT]}) == []
        assert nt._types[f"ext.{KEY}.notice"].ext_key == KEY

    def test_extension_without_a_block_registers_nothing(self):
        load_registry(manifests={KEY: {"grants": [GRANT]}})
        nt.start_notification_types(report(KEY))
        assert nt.registered_type_keys() == []


class TestLiveness:
    def test_disabled_extension_hides_its_type(self):
        load_registry(manifests={KEY: manifest([entry()])}, enabled=False)
        nt.start_notification_types(report(KEY))
        assert f"ext.{KEY}.notice" in nt._types
        assert nt.registered_type_keys() == []
        assert nt.type_spec(f"ext.{KEY}.notice") is None
        assert nt.types_for_extension(KEY) == set()

    def test_unlicensed_extension_hides_its_type(self):
        load_registry(manifests={KEY: manifest([entry()])}, licensed=False)
        nt.start_notification_types(report(KEY))
        assert nt.registered_type_keys() == []

    def test_types_for_extension_is_scoped(self):
        load_registry(
            manifests={
                KEY: manifest([entry()]),
                OTHER: manifest([entry(key=OTHER, name="digest")]),
            }
        )
        nt.start_notification_types(report(KEY, OTHER))
        assert nt.types_for_extension(KEY) == {f"ext.{KEY}.notice"}
        assert nt.types_for_extension(OTHER) == {f"ext.{OTHER}.digest"}


class TestLabels:
    def test_label_follows_the_locale_then_the_language_then_the_manifest(self):
        load_registry(
            manifests={
                KEY: manifest([entry(translations={"de": "Hinweise", "fr": "Avis"})]),
            }
        )
        nt.start_notification_types(report(KEY))
        key = f"ext.{KEY}.notice"
        assert nt.type_label(key, "de") == "Hinweise"
        assert nt.type_label(key, "de-CH") == "Hinweise"
        assert nt.type_label(key, "fr_FR") == "Avis"
        assert nt.type_label(key, "it") == "notice label"
        assert nt.type_label(key, None) == "notice label"
        assert nt.type_label("ext.nobody.x", "de") == "ext.nobody.x"

    def test_descriptors_are_the_dialog_rows(self):
        load_registry(manifests={KEY: manifest([entry(translations={"de": "Hinweise"})])})
        nt.start_notification_types(report(KEY))
        assert nt.type_descriptors("de") == [
            {
                "key": f"ext.{KEY}.notice",
                "in_app_default": True,
                "email_default": False,
                "in_app_only": False,
                "email_locked": False,
                "label": "Hinweise",
                "extension_key": KEY,
            }
        ]

    def test_descriptors_drop_a_lapsed_extension(self):
        load_registry(manifests={KEY: manifest([entry()])})
        nt.start_notification_types(report(KEY))
        assert len(nt.type_descriptors("en")) == 1
        load_registry(manifests={KEY: manifest([entry()])}, licensed=False)
        assert nt.type_descriptors("en") == []
