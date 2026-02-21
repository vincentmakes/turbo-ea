"""Unit tests for app.core.encryption — Fernet symmetric encryption.

These tests do NOT require a database; they exercise pure functions only.
"""

from __future__ import annotations

from app.core.encryption import decrypt_value, encrypt_value, is_encrypted

# ---------------------------------------------------------------------------
# Encrypt / decrypt round-trip
# ---------------------------------------------------------------------------


class TestEncryptDecrypt:
    def test_roundtrip(self):
        secret = "my-super-secret-password"
        encrypted = encrypt_value(secret)
        assert encrypted != secret
        assert decrypt_value(encrypted) == secret

    def test_encrypted_value_has_prefix(self):
        encrypted = encrypt_value("test")
        assert encrypted.startswith("enc:")

    def test_empty_string_returns_empty(self):
        assert encrypt_value("") == ""

    def test_none_returns_none(self):
        # encrypt_value returns the input unchanged for falsy values
        assert encrypt_value(None) is None  # type: ignore[arg-type]

    def test_decrypt_empty_string_returns_empty(self):
        assert decrypt_value("") == ""

    def test_decrypt_none_returns_none(self):
        assert decrypt_value(None) is None  # type: ignore[arg-type]

    def test_different_inputs_produce_different_outputs(self):
        e1 = encrypt_value("password1")
        e2 = encrypt_value("password2")
        assert e1 != e2

    def test_unicode_roundtrip(self):
        secret = "pässwörd-with-ünïcödé"
        encrypted = encrypt_value(secret)
        assert decrypt_value(encrypted) == secret


# ---------------------------------------------------------------------------
# Legacy / error handling
# ---------------------------------------------------------------------------


class TestDecryptLegacy:
    def test_legacy_plaintext_returned_as_is(self):
        """Values stored before encryption was enabled have no enc: prefix."""
        assert decrypt_value("old-plaintext-secret") == "old-plaintext-secret"

    def test_corrupted_encrypted_value_returns_empty(self):
        """If the Fernet token is invalid, return empty string."""
        assert decrypt_value("enc:this-is-not-valid-fernet") == ""


# ---------------------------------------------------------------------------
# is_encrypted
# ---------------------------------------------------------------------------


class TestIsEncrypted:
    def test_encrypted_value(self):
        encrypted = encrypt_value("test")
        assert is_encrypted(encrypted) is True

    def test_plain_value(self):
        assert is_encrypted("just-a-string") is False

    def test_empty_string(self):
        assert is_encrypted("") is False

    def test_none(self):
        assert is_encrypted(None) is False  # type: ignore[arg-type]
