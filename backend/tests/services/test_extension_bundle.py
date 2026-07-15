"""Unit tests for signed ``.teax`` bundle verification + extraction (no DB)."""

from __future__ import annotations

import json

import pytest

from app.services.extensions.bundle import BundleError, read_bundle
from app.services.extensions.installer import extract_bundle_to_dir
from tests.teax_helpers import build_manifest, build_teax, build_wheel, make_keypair, trust_test_key

CORE_VERSION = "1.69.0"

CONTENT = json.dumps({"CardTypes": [{"key": "EsgMetric", "label": "ESG Metric"}]}).encode()


@pytest.fixture
def keypair(monkeypatch):
    """Trusted keypair: the test key replaces the baked-in trust map."""
    private, public_b64 = make_keypair()
    trust_test_key(monkeypatch, public_b64)
    return private


def write_bundle(tmp_path, raw: bytes):
    path = tmp_path / "bundle.teax"
    path.write_bytes(raw)
    return path


class TestReadBundle:
    def test_valid_bundle_verifies(self, tmp_path, keypair):
        raw = build_teax(keypair, files={"content/pack.json": CONTENT})
        bundle = read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)
        assert bundle.key == "sample-ext"
        assert bundle.version == "1.0.0"
        assert bundle.capabilities == ["content"]
        assert bundle.manifest["content"] == ["content/pack.json"]

    def test_unsigned_bundle_rejected(self, tmp_path, keypair):
        raw = build_teax(keypair, files={"content/pack.json": CONTENT}, omit_signature=True)
        with pytest.raises(BundleError, match="unsigned"):
            read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)

    def test_foreign_key_rejected(self, tmp_path, monkeypatch):
        """A bundle signed by someone else's key never installs."""
        attacker_private, _ = make_keypair()
        _, trusted_public = make_keypair()
        trust_test_key(monkeypatch, trusted_public)
        raw = build_teax(attacker_private, files={"content/pack.json": CONTENT})
        with pytest.raises(BundleError, match="signature verification failed"):
            read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)

    def test_tampered_manifest_rejected(self, tmp_path, keypair):
        raw = build_teax(
            keypair, files={"content/pack.json": CONTENT}, tamper_manifest_after_signing=True
        )
        with pytest.raises(BundleError, match="signature verification failed"):
            read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)

    def test_tampered_file_rejected(self, tmp_path, keypair):
        manifest = build_manifest(files={"content/pack.json": CONTENT})
        raw = build_teax(
            keypair,
            manifest=manifest,
            files={"content/pack.json": b'{"CardTypes": []}'},  # differs from hashed bytes
        )
        with pytest.raises(BundleError, match="hash mismatch"):
            read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)

    def test_stowaway_file_rejected(self, tmp_path, keypair):
        raw = build_teax(
            keypair,
            files={"content/pack.json": CONTENT},
            extra_zip_files={"lib/backdoor.py": b"print('hi')"},
        )
        with pytest.raises(BundleError, match="not covered by the signed manifest"):
            read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)

    def test_missing_listed_file_rejected(self, tmp_path, keypair):
        manifest = build_manifest(files={"content/pack.json": CONTENT, "content/more.json": b"{}"})
        raw = build_teax(keypair, manifest=manifest, files={"content/pack.json": CONTENT})
        with pytest.raises(BundleError, match="missing files"):
            read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)

    def test_zip_slip_rejected(self, tmp_path, keypair):
        raw = build_teax(keypair, files={"../evil.json": CONTENT}, content=["../evil.json"])
        with pytest.raises(BundleError, match="unsafe path"):
            read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)

    def test_wrong_schema_rejected(self, tmp_path, keypair):
        manifest = build_manifest(files={"content/pack.json": CONTENT})
        manifest["schema"] = "turboea-extension/999"
        raw = build_teax(keypair, manifest=manifest, files={"content/pack.json": CONTENT})
        with pytest.raises(BundleError, match="schema"):
            read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)

    @pytest.mark.parametrize("bad_key", ["UPPER", "a", "spaces in key", "under_score", ""])
    def test_invalid_extension_key_rejected(self, tmp_path, keypair, bad_key):
        raw = build_teax(keypair, files={"content/pack.json": CONTENT}, key=bad_key)
        with pytest.raises(BundleError, match="key"):
            read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)

    def test_core_min_too_high_rejected(self, tmp_path, keypair):
        raw = build_teax(keypair, files={"content/pack.json": CONTENT}, core_min="99.0.0")
        with pytest.raises(BundleError, match=">= 99.0.0"):
            read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)

    def test_core_max_exclusive_rejected(self, tmp_path, keypair):
        raw = build_teax(
            keypair,
            files={"content/pack.json": CONTENT},
            core_min="1.0.0",
            core_max_exclusive="1.50.0",
        )
        with pytest.raises(BundleError, match="< 1.50.0"):
            read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)

    def test_compatible_range_accepted(self, tmp_path, keypair):
        raw = build_teax(
            keypair,
            files={"content/pack.json": CONTENT},
            core_min="1.0.0",
            core_max_exclusive="2.0.0",
        )
        assert read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION).key

    def test_unknown_capability_rejected(self, tmp_path, keypair):
        raw = build_teax(
            keypair, files={"content/pack.json": CONTENT}, capabilities=["content", "kernel"]
        )
        with pytest.raises(BundleError, match="unknown capabilities"):
            read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)

    def test_content_capability_without_files_rejected(self, tmp_path, keypair):
        raw = build_teax(keypair, capabilities=["content"], content=[])
        with pytest.raises(BundleError, match="no content files"):
            read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)

    def test_backend_capability_without_entrypoint_rejected(self, tmp_path, keypair):
        raw = build_teax(keypair, files={"content/pack.json": CONTENT}, capabilities=["backend"])
        with pytest.raises(BundleError, match="entrypoint"):
            read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)

    def test_empty_vendor_map_rejects_everything(self, tmp_path, monkeypatch):
        """A build with an empty baked trust map refuses all bundles."""
        private, _ = make_keypair()
        monkeypatch.setattr("app.core.extension_signing.DEFAULT_VENDOR_PUBLIC_KEYS", {})
        raw = build_teax(private, files={"content/pack.json": CONTENT})
        with pytest.raises(BundleError, match="no extension vendor key"):
            read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)

    def test_not_a_zip_rejected(self, tmp_path, keypair):
        with pytest.raises(BundleError, match="bad zip"):
            read_bundle(write_bundle(tmp_path, b"definitely not a zip"), core_version=CORE_VERSION)

    def test_free_flag_exposed(self, tmp_path, keypair):
        raw = build_teax(keypair, files={"content/pack.json": CONTENT}, free=True)
        bundle = read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)
        assert bundle.free is True

    def test_absent_free_flag_defaults_false(self, tmp_path, keypair):
        raw = build_teax(keypair, files={"content/pack.json": CONTENT})
        bundle = read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)
        assert bundle.free is False

    def test_non_bool_free_flag_rejected(self, tmp_path, keypair):
        raw = build_teax(keypair, files={"content/pack.json": CONTENT}, free="yes")
        with pytest.raises(BundleError, match="free"):
            read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)


class TestExtractBundle:
    def test_extracts_files_and_wheel(self, tmp_path, keypair):
        wheel = build_wheel("turbo_ext_sample", "VALUE = 42\n")
        raw = build_teax(
            keypair,
            files={
                "content/pack.json": CONTENT,
                "wheels/turbo_ext_sample-1.0.0-py3-none-any.whl": wheel,
            },
            capabilities=["content", "backend"],
            backend={
                "entrypoint": "turbo_ext_sample:extension",
                "wheels": ["wheels/turbo_ext_sample-1.0.0-py3-none-any.whl"],
            },
        )
        bundle = read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)
        target = tmp_path / "extracted"
        extract_bundle_to_dir(bundle, target)
        assert (target / "manifest.json").is_file()
        assert (target / "manifest.sig").is_file()
        assert (target / "content/pack.json").read_bytes() == CONTENT
        assert (target / "lib/turbo_ext_sample/__init__.py").read_text() == "VALUE = 42\n"

    def test_non_pure_wheel_rejected(self, tmp_path, keypair):
        wheel = build_wheel("turbo_ext_sample", "VALUE = 1\n")
        raw = build_teax(
            keypair,
            files={"wheels/turbo_ext_sample-1.0.0-cp312-manylinux_x86_64.whl": wheel},
            capabilities=["backend"],
            backend={
                "entrypoint": "turbo_ext_sample:extension",
                "wheels": ["wheels/turbo_ext_sample-1.0.0-cp312-manylinux_x86_64.whl"],
            },
        )
        bundle = read_bundle(write_bundle(tmp_path, raw), core_version=CORE_VERSION)
        with pytest.raises(BundleError, match="py3-none-any"):
            extract_bundle_to_dir(bundle, tmp_path / "extracted")
