"""Unit tests for Extension Store signature primitives (no DB)."""

from __future__ import annotations

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.config import settings
from app.core import extension_signing
from app.core.extension_signing import (
    trusted_public_keys,
    vendor_public_key,
    verify_bytes,
    verify_with_trusted,
)


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
    """Trust is the baked-in ``DEFAULT_VENDOR_PUBLIC_KEYS`` map."""

    def test_trust_is_the_baked_map(self, monkeypatch):
        _, baked = make_keypair()
        monkeypatch.setattr(extension_signing, "DEFAULT_VENDOR_PUBLIC_KEYS", {"vendor-1": baked})
        assert trusted_public_keys() == {"vendor-1": baked}
        assert vendor_public_key() == baked

    def test_environment_does_not_change_trust(self, monkeypatch):
        _, baked = make_keypair()
        monkeypatch.setattr(extension_signing, "DEFAULT_VENDOR_PUBLIC_KEYS", {"vendor-1": baked})
        for env in ("development", "production", "staging"):
            monkeypatch.setattr(settings, "ENVIRONMENT", env)
            assert trusted_public_keys() == {"vendor-1": baked}

    def test_empty_baked_map_trusts_nothing(self, monkeypatch):
        monkeypatch.setattr(extension_signing, "DEFAULT_VENDOR_PUBLIC_KEYS", {})
        assert trusted_public_keys() == {}
        assert vendor_public_key() == ""


class TestVerifyWithTrusted:
    def test_selects_key_by_key_id(self):
        vendor_priv, vendor_pub = make_keypair()
        store_priv, store_pub = make_keypair()
        trusted = {"vendor-1": vendor_pub, "store-1": store_pub}
        payload = b"license payload"
        assert verify_with_trusted(payload, sign(store_priv, payload), "store-1", trusted)
        assert verify_with_trusted(payload, sign(vendor_priv, payload), "vendor-1", trusted)

    def test_try_all_fallback_for_unknown_or_missing_key_id(self):
        store_priv, store_pub = make_keypair()
        _, vendor_pub = make_keypair()
        trusted = {"vendor-1": vendor_pub, "store-1": store_pub}
        payload = b"payload"
        signature = sign(store_priv, payload)
        # No key_id (legacy envelope) and a wrong key_id both still verify.
        assert verify_with_trusted(payload, signature, None, trusted)
        assert verify_with_trusted(payload, signature, "rotated-away", trusted)

    def test_untrusted_signer_rejected(self):
        attacker_priv, _ = make_keypair()
        _, vendor_pub = make_keypair()
        payload = b"payload"
        assert not verify_with_trusted(
            payload, sign(attacker_priv, payload), "vendor-1", {"vendor-1": vendor_pub}
        )

    def test_empty_trusted_set_fails_closed(self):
        priv, _ = make_keypair()
        assert not verify_with_trusted(b"p", sign(priv, b"p"), "vendor-1", {})


class TestArtifactRoleSeparation:
    """The license-signing key (store-1) must never validate a bundle."""

    def test_store_key_cannot_sign_bundles(self):
        store_priv, store_pub = make_keypair()
        vendor_priv, vendor_pub = make_keypair()
        trusted = {"vendor-1": vendor_pub, "store-1": store_pub}
        payload = b"malicious bundle manifest"
        sig = sign(store_priv, payload)
        # As a license, the store key is accepted...
        assert verify_with_trusted(payload, sig, "store-1", trusted, artifact="license")
        # ...but a bundle signed with it is refused even though the key is trusted.
        assert not verify_with_trusted(payload, sig, "store-1", trusted, artifact="bundle")
        # try-all fallback (no key_id) must not sneak the store key past either.
        assert not verify_with_trusted(payload, sig, None, trusted, artifact="bundle")
        # The vendor key still signs bundles.
        vsig = sign(vendor_priv, payload)
        assert verify_with_trusted(payload, vsig, "vendor-1", trusted, artifact="bundle")

    def test_unknown_key_id_is_permissive(self):
        """Custom / dev key sets (no role entry) may sign any artifact."""
        priv, pub = make_keypair()
        payload = b"payload"
        sig = sign(priv, payload)
        assert verify_with_trusted(payload, sig, "test", {"test": pub}, artifact="bundle")
        assert verify_with_trusted(payload, sig, "test", {"test": pub}, artifact="license")
