"""Unit tests for Extension Store signature primitives (no DB)."""

from __future__ import annotations

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.config import settings
from app.core import extension_signing
from app.core.extension_signing import vendor_public_key, verify_bytes


def make_keypair() -> tuple[Ed25519PrivateKey, str]:
    private = Ed25519PrivateKey.generate()
    public_b64 = base64.b64encode(
        private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
    ).decode()
    return private, public_b64


def sign(private: Ed25519PrivateKey, payload: bytes) -> str:
    return base64.b64encode(private.sign(payload)).decode()


class TestVerifyBytes:
    def test_valid_signature_verifies(self):
        private, public_b64 = make_keypair()
        payload = b'{"key": "sample-ext", "version": "1.0.0"}'
        assert verify_bytes(payload, sign(private, payload), public_b64) is True

    def test_tampered_payload_rejected(self):
        private, public_b64 = make_keypair()
        payload = b'{"key": "sample-ext"}'
        signature = sign(private, payload)
        assert verify_bytes(b'{"key": "evil-ext"}', signature, public_b64) is False

    def test_wrong_key_rejected(self):
        private, _ = make_keypair()
        _, other_public_b64 = make_keypair()
        payload = b"payload"
        assert verify_bytes(payload, sign(private, payload), other_public_b64) is False

    def test_garbage_inputs_fail_closed(self):
        _, public_b64 = make_keypair()
        assert verify_bytes(b"payload", "not-base64!!!", public_b64) is False
        assert verify_bytes(b"payload", "", public_b64) is False
        assert verify_bytes(b"payload", base64.b64encode(b"short").decode(), public_b64) is False
        assert verify_bytes(b"payload", "AAAA", "definitely-not-a-key") is False

    def test_empty_public_key_fails_closed(self):
        private, _ = make_keypair()
        payload = b"payload"
        assert verify_bytes(payload, sign(private, payload), "") is False


class TestVendorPublicKey:
    def test_development_honors_env_override(self, monkeypatch):
        _, public_b64 = make_keypair()
        monkeypatch.setattr(settings, "ENVIRONMENT", "development")
        monkeypatch.setattr(settings, "EXTENSION_VENDOR_PUBLIC_KEY", public_b64)
        assert vendor_public_key() == public_b64

    def test_production_ignores_env_override(self, monkeypatch):
        """Provenance hard requirement: a production image cannot be
        repointed at a foreign signing key via configuration."""
        _, public_b64 = make_keypair()
        monkeypatch.setattr(settings, "ENVIRONMENT", "production")
        monkeypatch.setattr(settings, "EXTENSION_VENDOR_PUBLIC_KEY", public_b64)
        assert vendor_public_key() == extension_signing.DEFAULT_VENDOR_PUBLIC_KEY

    def test_baked_constant_wins_in_production(self, monkeypatch):
        _, baked = make_keypair()
        _, override = make_keypair()
        monkeypatch.setattr(extension_signing, "DEFAULT_VENDOR_PUBLIC_KEY", baked)
        monkeypatch.setattr(settings, "ENVIRONMENT", "production")
        monkeypatch.setattr(settings, "EXTENSION_VENDOR_PUBLIC_KEY", override)
        assert vendor_public_key() == baked

    def test_development_without_override_uses_baked_constant(self, monkeypatch):
        _, baked = make_keypair()
        monkeypatch.setattr(extension_signing, "DEFAULT_VENDOR_PUBLIC_KEY", baked)
        monkeypatch.setattr(settings, "ENVIRONMENT", "development")
        monkeypatch.setattr(settings, "EXTENSION_VENDOR_PUBLIC_KEY", "")
        assert vendor_public_key() == baked
