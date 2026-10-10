"""Unit tests for app.core.security — JWT tokens and password hashing.

These tests do NOT require a database; they exercise pure functions only.
"""

from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.config import settings
from app.core.security import (
    ALGORITHM,
    PORTAL_AUD,
    PORTAL_ISS,
    create_access_token,
    create_portal_token,
    decode_access_token,
    decode_portal_token,
    hash_password,
    portal_token_matches,
    verify_password,
)

# ---------------------------------------------------------------------------
# JWT — create_access_token
# ---------------------------------------------------------------------------


@pytest.fixture
def host_clock_ahead_of_utc():
    """A host whose local time is UTC+9, so a naive ``now()`` would be nine hours off."""
    previous = os.environ.get("TZ")
    os.environ["TZ"] = "JST-9"
    time.tzset()
    yield
    if previous is None:
        del os.environ["TZ"]
    else:
        os.environ["TZ"] = previous
    time.tzset()


def _issued_at(token: str) -> int:
    return jwt.decode(token, options={"verify_signature": False})["iat"]


class TestTokensAreStampedInUtc:
    def test_a_session_token(self, host_clock_ahead_of_utc):
        before = int(time.time())
        iat = _issued_at(create_access_token(uuid.uuid4()))
        assert before <= iat <= time.time()

    def test_a_portal_token(self, host_clock_ahead_of_utc):
        before = int(time.time())
        iat = _issued_at(create_portal_token(uuid.uuid4(), "slug"))
        assert before <= iat <= time.time()


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

    def test_lifetime_is_the_configured_minutes(self):
        payload = decode_access_token(create_access_token(uuid.uuid4()))
        assert payload["exp"] - payload["iat"] == settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60

    def test_impersonated_role_is_carried_only_when_set(self):
        plain = decode_access_token(create_access_token(uuid.uuid4(), "admin"))
        assert "impersonated_role" not in plain
        acting = decode_access_token(
            create_access_token(uuid.uuid4(), "admin", impersonated_role="viewer")
        )
        assert acting["impersonated_role"] == "viewer"
        assert acting["role"] == "admin"


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


# ---------------------------------------------------------------------------
# Portal / published-resource session tokens
# ---------------------------------------------------------------------------


class TestPortalTokens:
    def test_claims(self):
        rid = uuid.uuid4()
        claims = decode_portal_token(
            create_portal_token(rid, "my-slug", "a@example.com", resource="diagram")
        )
        assert claims["typ"] == "portal"
        assert claims["res"] == "diagram"
        assert claims["psid"] == str(rid)
        assert claims["slug"] == "my-slug"
        assert claims["email"] == "a@example.com"
        assert claims["iss"] == PORTAL_ISS == "turbo-ea-portal"
        assert claims["aud"] == PORTAL_AUD == "turbo-ea-portal"
        assert claims["exp"] - claims["iat"] == settings.PORTAL_TOKEN_EXPIRE_MINUTES * 60

    def test_defaults_are_a_portal_without_an_email(self):
        claims = decode_portal_token(create_portal_token(uuid.uuid4(), "s"))
        assert claims["res"] == "portal"
        assert claims["email"] is None

    def test_signed_with_the_app_key_and_algorithm(self):
        token = create_portal_token(uuid.uuid4(), "s")
        assert jwt.get_unverified_header(token)["alg"] == ALGORITHM == "HS256"
        jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[ALGORITHM],
            audience=PORTAL_AUD,
            issuer=PORTAL_ISS,
        )

    def test_a_portal_token_is_not_a_user_session(self):
        assert decode_access_token(create_portal_token(uuid.uuid4(), "s")) is None

    def test_a_user_session_is_not_a_portal_token(self):
        assert decode_portal_token(create_access_token(uuid.uuid4(), "admin")) is None

    def _forged(self, **overrides) -> str:
        now = datetime.now(timezone.utc)
        payload = {
            "typ": "portal",
            "res": "portal",
            "psid": str(uuid.uuid4()),
            "iat": now,
            "exp": now + timedelta(minutes=5),
            "iss": PORTAL_ISS,
            "aud": PORTAL_AUD,
        }
        key = overrides.pop("key", settings.SECRET_KEY)
        payload.update(overrides)
        return jwt.encode(payload, key, algorithm=ALGORITHM)

    def test_well_formed_forgery_decodes(self):
        # The control for the refusals below: only the overridden claim differs.
        assert decode_portal_token(self._forged()) is not None

    def test_expired_token_is_refused(self):
        past = datetime.now(timezone.utc) - timedelta(minutes=1)
        assert decode_portal_token(self._forged(exp=past)) is None

    def test_wrong_key_is_refused(self):
        assert decode_portal_token(self._forged(key="not-the-key-" * 4)) is None

    def test_wrong_issuer_is_refused(self):
        assert decode_portal_token(self._forged(iss="turbo-ea")) is None

    def test_wrong_audience_is_refused(self):
        assert decode_portal_token(self._forged(aud="turbo-ea")) is None

    def test_garbage_is_refused(self):
        assert decode_portal_token("not.a.jwt") is None


class TestPortalTokenMatches:
    def test_matches_its_own_resource(self):
        rid = uuid.uuid4()
        claims = decode_portal_token(create_portal_token(rid, "s", resource="diagram"))
        assert portal_token_matches(claims, "diagram", rid) is True

    def test_another_kind_with_the_same_id_does_not_match(self):
        rid = uuid.uuid4()
        claims = decode_portal_token(create_portal_token(rid, "s", resource="diagram"))
        assert portal_token_matches(claims, "portal", rid) is False

    def test_another_id_does_not_match(self):
        claims = decode_portal_token(create_portal_token(uuid.uuid4(), "s"))
        assert portal_token_matches(claims, "portal", uuid.uuid4()) is False

    def test_legacy_token_without_res_counts_as_a_portal(self):
        rid = uuid.uuid4()
        legacy = {"typ": "portal", "psid": str(rid)}
        assert portal_token_matches(legacy, "portal", rid) is True
        assert portal_token_matches(legacy, "diagram", rid) is False
        assert portal_token_matches({**legacy, "res": None}, "portal", rid) is True

    def test_wrong_type_does_not_match(self):
        rid = uuid.uuid4()
        assert portal_token_matches({"typ": "user", "psid": str(rid)}, "portal", rid) is False
        assert portal_token_matches({"psid": str(rid)}, "portal", rid) is False

    def test_no_claims_do_not_match(self):
        assert portal_token_matches(None, "portal", uuid.uuid4()) is False
        assert portal_token_matches({}, "portal", uuid.uuid4()) is False
