"""Integration tests for native web-portal access protection (public / sso)."""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.models.user import User
from tests.conftest import auth_headers, create_card_type, create_role, create_user


async def _set_sso_config(db, *, enabled=True):
    """Seed the singleton app_settings row with an SSO config."""
    from app.models.app_settings import AppSettings

    row = (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one_or_none()
    sso = {
        "enabled": enabled,
        "provider": "microsoft",
        "client_id": "test-client-id",
        "tenant_id": "common",
    }
    if row is None:
        db.add(AppSettings(id="default", general_settings={"sso": sso}))
    else:
        row.general_settings = {**(row.general_settings or {}), "sso": sso}
    await db.flush()


@pytest.fixture
async def portals_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_card_type(db, key="Application", label="Application")
    admin = await create_user(db, email="admin@test.com", role="admin")
    return {"admin": admin}


async def _create_portal(client, admin, **overrides):
    body = {
        "name": "Catalog",
        "slug": "catalog",
        "card_type": "Application",
        "is_published": True,
        **overrides,
    }
    resp = await client.post("/api/v1/web-portals", json=body, headers=auth_headers(admin))
    return resp


def _fake_exchange(email="user@company.com", *, email_verified=True, provider="microsoft"):
    async def _exchange(db, code, redirect_uri):
        claims = {"email": email, "sub": "subject-123", "name": "Portal Visitor"}
        if email_verified is not None:
            claims["email_verified"] = email_verified
        return claims, {"enabled": True, "provider": provider}, provider

    return _exchange


class TestAccessModeAdmin:
    async def test_default_mode_is_public(self, client, db, portals_env):
        resp = await _create_portal(client, portals_env["admin"])
        assert resp.status_code == 201
        assert resp.json()["access_mode"] == "public"

    async def test_create_sso_portal_requires_sso_enabled(self, client, db, portals_env):
        resp = await _create_portal(client, portals_env["admin"], access_mode="sso")
        assert resp.status_code == 400

    async def test_create_sso_portal_when_enabled(self, client, db, portals_env):
        await _set_sso_config(db, enabled=True)
        resp = await _create_portal(
            client,
            portals_env["admin"],
            access_mode="sso",
            allowed_email_domains=["Company.com", " ", "other.com"],
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["access_mode"] == "sso"
        # Domains are normalised (lowercased, blanks dropped)
        assert data["allowed_email_domains"] == ["company.com", "other.com"]

    async def test_invalid_access_mode_rejected(self, client, db, portals_env):
        resp = await _create_portal(client, portals_env["admin"], access_mode="bogus")
        assert resp.status_code == 400

    async def test_switch_to_public_clears_domains(self, client, db, portals_env):
        await _set_sso_config(db, enabled=True)
        create = await _create_portal(
            client, portals_env["admin"], access_mode="sso", allowed_email_domains=["company.com"]
        )
        pid = create.json()["id"]
        resp = await client.patch(
            f"/api/v1/web-portals/{pid}",
            json={"access_mode": "public"},
            headers=auth_headers(portals_env["admin"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["access_mode"] == "public"
        assert data["allowed_email_domains"] is None


class TestGate:
    async def test_public_portal_gate(self, client, db, portals_env):
        await _create_portal(client, portals_env["admin"])
        resp = await client.get("/api/v1/web-portals/public/catalog/gate")
        assert resp.status_code == 200
        data = resp.json()
        assert data["access_mode"] == "public"
        assert data["name"] == "Catalog"
        assert "sso" not in data

    async def test_sso_portal_gate_exposes_provider_only(self, client, db, portals_env):
        await _set_sso_config(db, enabled=True)
        await _create_portal(client, portals_env["admin"], access_mode="sso")
        resp = await client.get("/api/v1/web-portals/public/catalog/gate")
        assert resp.status_code == 200
        data = resp.json()
        assert data["access_mode"] == "sso"
        assert data["sso"]["provider"] == "microsoft"
        assert data["sso"]["client_id"] == "test-client-id"
        # Exact match (not a substring/prefix check) — the tenant is "common".
        assert (
            data["sso"]["authorization_endpoint"]
            == "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
        )
        # No portal data / secrets leak through the gate
        assert "description" not in data
        assert "filters" not in data
        assert "allowed_email_domains" not in data
        assert "client_secret" not in data["sso"]


class TestGateEnforcement:
    async def test_sso_portal_data_locked_without_cookie(self, client, db, portals_env):
        await _set_sso_config(db, enabled=True)
        await _create_portal(client, portals_env["admin"], access_mode="sso")
        for path in ("", "/cards", "/relation-options?type_key=Application"):
            resp = await client.get(f"/api/v1/web-portals/public/catalog{path}")
            assert resp.status_code == 401, path
            assert resp.json()["detail"] == "portal_locked"

    async def test_public_portal_serves_cookieless(self, client, db, portals_env):
        await _create_portal(client, portals_env["admin"])
        assert (await client.get("/api/v1/web-portals/public/catalog")).status_code == 200
        assert (await client.get("/api/v1/web-portals/public/catalog/cards")).status_code == 200


class TestSsoCallback:
    async def test_callback_unlocks_and_creates_no_user(self, client, db, portals_env, monkeypatch):
        import app.services.sso_service as svc

        await _set_sso_config(db, enabled=True)
        await _create_portal(client, portals_env["admin"], access_mode="sso")
        monkeypatch.setattr(svc, "exchange_code_for_claims", _fake_exchange())

        before = (await db.execute(select(func.count()).select_from(User))).scalar()

        resp = await client.post(
            "/api/v1/web-portals/public/catalog/sso/callback",
            json={"code": "authz-code", "redirect_uri": "http://test/portal/sso-callback"},
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Account-less: no users row was created for the visitor.
        after = (await db.execute(select(func.count()).select_from(User))).scalar()
        assert after == before

        # The cookie set on the callback now unlocks the data endpoints.
        unlocked = await client.get("/api/v1/web-portals/public/catalog")
        assert unlocked.status_code == 200
        assert unlocked.json()["name"] == "Catalog"

    async def test_callback_domain_allowlist_denies_outsider(
        self, client, db, portals_env, monkeypatch
    ):
        import app.services.sso_service as svc

        await _set_sso_config(db, enabled=True)
        await _create_portal(
            client, portals_env["admin"], access_mode="sso", allowed_email_domains=["company.com"]
        )
        monkeypatch.setattr(
            svc, "exchange_code_for_claims", _fake_exchange(email="intruder@evil.com")
        )
        resp = await client.post(
            "/api/v1/web-portals/public/catalog/sso/callback",
            json={"code": "c", "redirect_uri": "http://test/portal/sso-callback"},
        )
        assert resp.status_code == 403

    async def test_callback_domain_allowlist_allows_member(
        self, client, db, portals_env, monkeypatch
    ):
        import app.services.sso_service as svc

        await _set_sso_config(db, enabled=True)
        await _create_portal(
            client, portals_env["admin"], access_mode="sso", allowed_email_domains=["company.com"]
        )
        monkeypatch.setattr(
            svc, "exchange_code_for_claims", _fake_exchange(email="ceo@Company.com")
        )
        resp = await client.post(
            "/api/v1/web-portals/public/catalog/sso/callback",
            json={"code": "c", "redirect_uri": "http://test/portal/sso-callback"},
        )
        assert resp.status_code == 200

    async def test_callback_rejects_unverified_email(self, client, db, portals_env, monkeypatch):
        import app.services.sso_service as svc

        await _set_sso_config(db, enabled=True)
        await _create_portal(client, portals_env["admin"], access_mode="sso")
        monkeypatch.setattr(svc, "exchange_code_for_claims", _fake_exchange(email_verified=False))
        resp = await client.post(
            "/api/v1/web-portals/public/catalog/sso/callback",
            json={"code": "c", "redirect_uri": "http://test/portal/sso-callback"},
        )
        assert resp.status_code == 403

    async def test_callback_on_public_portal_rejected(self, client, db, portals_env, monkeypatch):
        import app.services.sso_service as svc

        await _create_portal(client, portals_env["admin"])  # public
        monkeypatch.setattr(svc, "exchange_code_for_claims", _fake_exchange())
        resp = await client.post(
            "/api/v1/web-portals/public/catalog/sso/callback",
            json={"code": "c", "redirect_uri": "http://test/portal/sso-callback"},
        )
        assert resp.status_code == 400


class TestPortalToken:
    def test_portal_token_roundtrip_and_cross_family(self):
        import uuid

        from app.core.security import (
            create_access_token,
            create_portal_token,
            decode_access_token,
            decode_portal_token,
        )

        pid = uuid.uuid4()
        tok = create_portal_token(pid, "catalog", "user@company.com")
        claims = decode_portal_token(tok)
        assert claims is not None
        assert claims["typ"] == "portal"
        assert claims["psid"] == str(pid)
        assert claims["slug"] == "catalog"
        # A portal token is not a user session, and vice-versa.
        assert decode_access_token(tok) is None
        assert decode_portal_token(create_access_token(uuid.uuid4(), "member")) is None
