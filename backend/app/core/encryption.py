"""Symmetric encryption for secrets stored in the database (SSO client_secret, SMTP password)."""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings

_PREFIX = "enc:"


def _derive_key() -> bytes:
    """Derive a 32-byte Fernet key from SECRET_KEY using SHA-256."""
    raw = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return base64.urlsafe_b64encode(raw)


def encrypt_value(plaintext: str) -> str:
    """Encrypt a plaintext string. Returns a prefixed ciphertext."""
    if not plaintext:
        return plaintext
    f = Fernet(_derive_key())
    token = f.encrypt(plaintext.encode())
    return _PREFIX + token.decode()


def decrypt_value(stored: str) -> str:
    """Decrypt a stored value. Returns plaintext.

    If the value was stored before encryption was enabled (no prefix),
    returns it as-is for backward compatibility.
    """
    if not stored:
        return stored
    if not stored.startswith(_PREFIX):
        # Legacy plaintext value — return as-is
        return stored
    f = Fernet(_derive_key())
    try:
        return f.decrypt(stored[len(_PREFIX) :].encode()).decode()
    except InvalidToken:
        # Key changed or data corrupted — return empty to force re-entry
        return ""


def is_encrypted(value: str) -> bool:
    """Check if a value is already encrypted."""
    return bool(value) and value.startswith(_PREFIX)
