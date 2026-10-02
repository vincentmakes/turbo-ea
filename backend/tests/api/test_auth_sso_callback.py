"""``POST /auth/sso/callback`` — what the login route does with verified
claims. The exchange itself (``sso_service.exchange_code_for_claims``) is
replaced, the way ``test_web_portals_access.py`` does for portals, so
these tests pin provisioning, the provider-specific subject claim, the
Google hosted-domain check and the claim validations.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

import app.services.sso_service as sso
from app.core.permissions import MEMBER_PERMISSIONS
from app.models.user import User
from tests.conftest import create_role, create_user

CALLBACK = "/api/v1/auth/sso/callback"
BODY = {"code": "authz-code", "redirect_uri": "http://test/auth/callback"}


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    return {}


def _exchange(monkeypatch, claims: dict, *, provider="microsoft", sso_cfg: dict | None = None):
    cfg = {"enabled": True, "provider": provider, **(sso_cfg or {})}

    async def fake(db, code, redirect_uri):
        fake.calls.append((code, redirect_uri))
        return claims, cfg, provider

    fake.calls = []
    monkeypatch.setattr(sso, "exchange_code_for_claims", fake)
    return fake


async def _user(db, email) -> User | None:
    return (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()


class TestProvisioning:
    async def test_a_new_identity_becomes_a_member_with_a_session(
        self, client, db, env, monkeypatch
    ):
        fake = _exchange(
            monkeypatch,
            {"sub": "sub-1", "email": "New.Person@Acme.com", "name": "New Person"},
            provider="google",
        )

        resp = await client.post(CALLBACK, json=BODY)
        assert resp.status_code == 200, resp.text
        assert resp.json()["access_token"] and resp.json()["token_type"] == "bearer"
        assert "access_token=" in resp.headers.get("set-cookie", "")
        assert fake.calls == [("authz-code", "http://test/auth/callback")]

        user = await _user(db, "new.person@acme.com")  # lowercased and stripped
        assert user is not None
        assert user.role == "member" and user.is_active
        assert user.auth_provider == "sso" and user.sso_subject_id == "sub-1"
        assert user.display_name == "New Person"

    async def test_microsoft_uses_the_object_id_as_subject(self, client, db, env, monkeypatch):
        _exchange(monkeypatch, {"oid": "ms-oid", "sub": "pairwise-sub", "email": "a@acme.com"})
        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert (await _user(db, "a@acme.com")).sso_subject_id == "ms-oid"

    async def test_microsoft_falls_back_to_sub_without_oid(self, client, db, env, monkeypatch):
        _exchange(monkeypatch, {"sub": "pairwise-sub", "email": "b@acme.com"})
        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert (await _user(db, "b@acme.com")).sso_subject_id == "pairwise-sub"

    async def test_preferred_username_stands_in_for_a_missing_email(
        self, client, db, env, monkeypatch
    ):
        _exchange(monkeypatch, {"oid": "x", "preferred_username": "c@acme.com"})
        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert await _user(db, "c@acme.com") is not None

    async def test_a_known_subject_signs_in_without_touching_the_email(
        self, client, db, env, monkeypatch
    ):
        existing = await create_user(db, email="d@acme.com", role="admin", display_name="D")
        existing.auth_provider = "sso"
        existing.sso_subject_id = "d-oid"
        await db.flush()
        _exchange(monkeypatch, {"oid": "d-oid", "email": "renamed@acme.com", "name": "Other"})

        resp = await client.post(CALLBACK, json=BODY)
        assert resp.status_code == 200
        assert await _user(db, "renamed@acme.com") is None
        assert existing.role == "admin" and existing.display_name == "D"

    async def test_a_federated_account_is_linked_by_email(self, client, db, env, monkeypatch):
        existing = await create_user(db, email="d@acme.com", role="admin", display_name="")
        existing.auth_provider = "sso"
        await db.flush()
        _exchange(monkeypatch, {"oid": "d-oid", "email": "D@ACME.COM", "name": "Dee"})

        resp = await client.post(CALLBACK, json=BODY)
        assert resp.status_code == 200
        users = (await db.execute(select(User).where(User.email == "d@acme.com"))).scalars().all()
        assert [u.id for u in users] == [existing.id]
        await db.refresh(existing)
        assert existing.sso_subject_id == "d-oid" and existing.display_name == "Dee"
        assert existing.role == "admin"

    async def test_a_local_account_is_never_merged(self, client, db, env, monkeypatch):
        await create_user(db, email="local@acme.com", role="admin")
        _exchange(monkeypatch, {"oid": "l-oid", "email": "local@acme.com"})

        resp = await client.post(CALLBACK, json=BODY)
        assert resp.status_code == 409
        assert "local account" in resp.json()["detail"]
        assert (await _user(db, "local@acme.com")).sso_subject_id is None

    async def test_a_pending_invitation_sets_the_role_and_is_consumed(
        self, client, db, env, monkeypatch
    ):
        from app.models.sso_invitation import SsoInvitation

        db.add(SsoInvitation(email="invited@acme.com", role="admin"))
        await db.flush()
        _exchange(monkeypatch, {"oid": "inv-oid", "email": "Invited@acme.com"})

        resp = await client.post(CALLBACK, json=BODY)
        assert resp.status_code == 200
        assert (await _user(db, "invited@acme.com")).role == "admin"
        assert (
            await db.execute(select(SsoInvitation).where(SsoInvitation.email == "invited@acme.com"))
        ).scalar_one_or_none() is None


class TestClaimValidation:
    async def test_google_hosted_domain_mismatch_is_403(self, client, db, env, monkeypatch):
        _exchange(
            monkeypatch,
            {"sub": "s", "email": "x@other.com", "hd": "other.com"},
            provider="google",
            sso_cfg={"domain": "acme.com"},
        )
        resp = await client.post(CALLBACK, json=BODY)
        assert resp.status_code == 403
        assert "restricted to acme.com" in resp.json()["detail"]
        assert await _user(db, "x@other.com") is None

    async def test_google_hosted_domain_match_passes(self, client, db, env, monkeypatch):
        _exchange(
            monkeypatch,
            {"sub": "s", "email": "x@acme.com", "hd": "acme.com"},
            provider="google",
            sso_cfg={"domain": "acme.com"},
        )
        assert (await client.post(CALLBACK, json=BODY)).status_code == 200

    async def test_missing_email_is_401(self, client, db, env, monkeypatch):
        _exchange(monkeypatch, {"oid": "x", "name": "No Mail"})
        resp = await client.post(CALLBACK, json=BODY)
        assert resp.status_code == 401 and "No email claim" in resp.json()["detail"]

    async def test_missing_subject_is_401(self, client, db, env, monkeypatch):
        _exchange(monkeypatch, {"email": "e@acme.com"})
        resp = await client.post(CALLBACK, json=BODY)
        assert resp.status_code == 401 and "No subject identifier" in resp.json()["detail"]

    async def test_exchange_errors_propagate_as_their_status(self, client, db, env, monkeypatch):
        from fastapi import HTTPException

        async def refuse(db, code, redirect_uri):
            raise HTTPException(502, "Cannot reach identity provider for token exchange.")

        monkeypatch.setattr(sso, "exchange_code_for_claims", refuse)
        resp = await client.post(CALLBACK, json=BODY)
        assert resp.status_code == 502

    async def test_a_disabled_account_cannot_sign_in(self, client, db, env, monkeypatch):
        user = await create_user(db, email="off@acme.com", role="member")
        user.is_active = False
        user.auth_provider = "sso"
        user.sso_subject_id = "off"
        await db.flush()
        _exchange(monkeypatch, {"oid": "off", "email": "off@acme.com"})
        resp = await client.post(CALLBACK, json=BODY)
        assert resp.status_code == 403


class TestSsoConfigEndpoint:
    """``GET /auth/sso/config`` — the public half: a misconfigured or
    unreachable provider reads as SSO off rather than as an error."""

    async def _configure(self, db, **sso):
        from tests.seams import ai_settings

        await ai_settings(db, general={"sso": {"enabled": True, "client_id": "c", **sso}})

    async def test_misconfigured_provider_reads_as_disabled(self, client, db, env):
        await self._configure(db, provider="okta", domain="")
        resp = await client.get("/api/v1/auth/sso/config")
        assert resp.status_code == 200
        assert resp.json()["enabled"] is False

    async def test_oidc_discovery_failure_reads_as_disabled(self, client, db, env, monkeypatch):
        import app.api.v1.auth as auth_api

        async def boom(issuer_url):
            raise RuntimeError("unreachable")

        monkeypatch.setattr(auth_api, "_discover_oidc", boom)
        await self._configure(db, provider="oidc", issuer_url="https://idp.test")
        resp = await client.get("/api/v1/auth/sso/config")
        assert resp.json()["enabled"] is False

    async def test_oidc_discovery_supplies_the_authorization_endpoint(
        self, client, db, env, monkeypatch
    ):
        import app.api.v1.auth as auth_api

        async def discover(issuer_url):
            assert issuer_url == "https://idp.test"
            return {"authorization_endpoint": "https://idp.test/auth"}

        monkeypatch.setattr(auth_api, "_discover_oidc", discover)
        await self._configure(db, provider="oidc", issuer_url="https://idp.test")
        body = (await client.get("/api/v1/auth/sso/config")).json()
        assert body["enabled"] is True and body["provider"] == "oidc"
        assert body["authorization_endpoint"] == "https://idp.test/auth"
        assert body["provider_name"] == "SSO" and body["client_id"] == "c"

    async def test_google_domain_is_advertised_as_an_extra_param(self, client, db, env):
        await self._configure(db, provider="google", domain="acme.com")
        body = (await client.get("/api/v1/auth/sso/config")).json()
        assert body["extra_auth_params"] == {"hd": "acme.com"}
