"""Unit tests for the ops request-signature primitives (no database needed)."""

from __future__ import annotations

import base64
import hashlib
import time

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.core.ops_auth import _verify_signature, canonical_string


def make_keypair() -> tuple[Ed25519PrivateKey, str]:
    private = Ed25519PrivateKey.generate()
    public_b64 = base64.b64encode(
        private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
    ).decode()
    return private, public_b64


def sign(private: Ed25519PrivateKey, method: str, path: str, body: bytes, ts: str, nonce: str):
    return base64.b64encode(private.sign(canonical_string(method, path, body, ts, nonce))).decode()


def test_canonical_string_binds_all_parts():
    body = b'{"a":1}'
    canonical = canonical_string("POST", "/api/v1/ops/rescue-access", body, "123", "n-1")
    assert canonical.decode().split("\n") == [
        "POST",
        "/api/v1/ops/rescue-access",
        hashlib.sha256(body).hexdigest(),
        "123",
        "n-1",
    ]


def test_signature_verifies_and_rejects_tampering():
    private, public_b64 = make_keypair()
    ts, nonce = str(int(time.time())), "nonce-1"
    signature = sign(private, "GET", "/api/v1/ops/info", b"", ts, nonce)

    assert _verify_signature(public_b64, "GET", "/api/v1/ops/info", b"", ts, nonce, signature)
    # Tampered path / body / nonce all fail
    assert not _verify_signature(public_b64, "GET", "/api/v1/ops/export", b"", ts, nonce, signature)
    assert not _verify_signature(public_b64, "GET", "/api/v1/ops/info", b"x", ts, nonce, signature)
    assert not _verify_signature(public_b64, "GET", "/api/v1/ops/info", b"", ts, "other", signature)


def test_signature_rejects_wrong_key_and_garbage():
    private, _ = make_keypair()
    _, other_public = make_keypair()
    ts = str(int(time.time()))
    signature = sign(private, "GET", "/api/v1/ops/info", b"", ts, "n")
    assert not _verify_signature(other_public, "GET", "/api/v1/ops/info", b"", ts, "n", signature)
    assert not _verify_signature(other_public, "GET", "/api/v1/ops/info", b"", ts, "n", "!!!")
