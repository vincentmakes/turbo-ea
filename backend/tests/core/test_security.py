"""Unit tests for app.core.security — JWT tokens and password hashing.

These tests do NOT require a database; they exercise pure functions only.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import jwt

from app.config import settings
from app.core.security import (
    ALGORITHM,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)

# ---------------------------------------------------------------------------
# JWT — create_access_token
# ---------------------------------------------------------------------------


class TestCreateAccessToken:
    def test_returns_string(self):
        token = create_access_token(uuid.uuid4(), "admin")
        assert isinstance(token, str)

    def test_contains_required_claims(self):
        user_id = uuid.uuid4()
        token = create_access_token(user_id, "member")
        payload = jwt.decode(token, options={"verify_signature": False})
        assert payload["sub"] == str(user_id)
        assert payload["role"] == "member"
        assert payload["iss"] == "turbo-ea"
        assert payload["aud"] == "turbo-ea"
        assert "iat" in payload
        assert "exp" in payload

    def test_default_role_is_member(self):
        token = create_access_token(uuid.uuid4())
        payload = jwt.decode(token, options={"verify_signature": False})
        assert payload["role"] == "member"

    def test_expiration_is_in_future(self):
        token = create_access_token(uuid.uuid4())
        payload = jwt.decode(token, options={"verify_signature": False})
        exp = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
        assert exp > datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# JWT — decode_access_token
# ---------------------------------------------------------------------------


class TestDecodeAccessToken:
    def test_valid_token(self):
        user_id = uuid.uuid4()
        token = create_access_token(user_id, "admin")
        payload = decode_access_token(token)
        assert payload is not None
        assert payload["sub"] == str(user_id)
        assert payload["role"] == "admin"

    def test_expired_token_returns_none(self):
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        payload = {
            "sub": str(uuid.uuid4()),
            "role": "admin",
            "iat": past,
            "exp": past + timedelta(seconds=1),
            "iss": "turbo-ea",
            "aud": "turbo-ea",
        }
        token = jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)
        assert decode_access_token(token) is None

    def test_wrong_signature_returns_none(self):
        now = datetime.now(timezone.utc)
        payload = {
            "sub": str(uuid.uuid4()),
            "role": "admin",
            "iat": now,
            "exp": now + timedelta(hours=1),
            "iss": "turbo-ea",
            "aud": "turbo-ea",
        }
        token = jwt.encode(payload, "wrong-secret-key", algorithm=ALGORITHM)
        assert decode_access_token(token) is None

    def test_wrong_audience_returns_none(self):
        now = datetime.now(timezone.utc)
        payload = {
            "sub": str(uuid.uuid4()),
            "role": "admin",
            "iat": now,
            "exp": now + timedelta(hours=1),
            "iss": "turbo-ea",
            "aud": "wrong-audience",
        }
        token = jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)
        assert decode_access_token(token) is None

    def test_wrong_issuer_returns_none(self):
        now = datetime.now(timezone.utc)
        payload = {
            "sub": str(uuid.uuid4()),
            "role": "admin",
            "iat": now,
            "exp": now + timedelta(hours=1),
            "iss": "wrong-issuer",
            "aud": "turbo-ea",
        }
        token = jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)
        assert decode_access_token(token) is None

    def test_garbage_token_returns_none(self):
        assert decode_access_token("not.a.real.token") is None

    def test_empty_string_returns_none(self):
        assert decode_access_token("") is None


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------


class TestPasswordHashing:
    def test_hash_returns_bcrypt_string(self):
        hashed = hash_password("mypassword")
        assert hashed.startswith("$2b$") or hashed.startswith("$2a$")

    def test_hash_is_not_plaintext(self):
        hashed = hash_password("mypassword")
        assert hashed != "mypassword"

    def test_different_calls_produce_different_hashes(self):
        h1 = hash_password("mypassword")
        h2 = hash_password("mypassword")
        assert h1 != h2  # bcrypt uses random salt

    def test_verify_correct_password(self):
        hashed = hash_password("mypassword")
        assert verify_password("mypassword", hashed) is True

    def test_verify_wrong_password(self):
        hashed = hash_password("mypassword")
        assert verify_password("wrongpassword", hashed) is False
