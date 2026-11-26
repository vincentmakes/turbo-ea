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
from tests.conftest import LONG_ROLE_KEY, create_role, create_user, stored_role

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

    async def test_an_invitation_with_a_50_character_role_is_honoured(
        self, client, db, env, monkeypatch
    ):
        """An invitation can carry any role key ``POST /roles`` accepts (#1330)."""
        from app.models.sso_invitation import SsoInvitation

        await create_role(
            db, key=LONG_ROLE_KEY, label="Regional", permissions=MEMBER_PERMISSIONS, is_system=False
        )
        db.add(SsoInvitation(email="regional@acme.com", role=LONG_ROLE_KEY))
        await db.flush()
        _exchange(monkeypatch, {"oid": "reg-oid", "email": "regional@acme.com"})

        resp = await client.post(CALLBACK, json=BODY)
        assert resp.status_code == 200, resp.text
        assert await stored_role(db, User, "regional@acme.com") == LONG_ROLE_KEY


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


ROLE_MAP_CFG = {
    "role_claim": "groups",
    "role_map": [
        {"value": "EA-Admins", "role": "admin"},
        {"value": "EA-Readers", "role": "viewer"},
        {"value": "EA-Gone", "role": "retired"},
        {"value": "EA-Old", "role": "old_role"},
    ],
}


async def _sso_user(db, email: str, role: str, subject: str) -> User:
    user = await create_user(db, email=email, role=role)
    user.auth_provider = "sso"
    user.password_hash = None
    user.sso_subject_id = subject
    await db.flush()
    return user


async def _succeeded_row(db):
    from app.models.audit_log import AuditLogEntry

    result = await db.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == "auth.sso.succeeded")
    )
    return result.scalar_one()


class TestDirectoryRoleMap:
    """The role map in ``general_settings["sso"]`` (discussion 1446): the same
    rules as reverse-proxy sign-in, plus the last-admin rule."""

    @pytest.fixture
    async def roles(self, db, env):
        await create_role(db, key="viewer", label="Viewer", permissions={})
        old = await create_role(db, key="old_role", label="Old", permissions={})
        old.is_archived = True
        await db.flush()

    def _sign_in(self, monkeypatch, claims, *, provider="oidc", sso_cfg=None):
        return _exchange(
            monkeypatch,
            claims,
            provider=provider,
            sso_cfg=ROLE_MAP_CFG if sso_cfg is None else sso_cfg,
        )

    async def test_a_mapped_group_promotes(self, client, db, roles, monkeypatch):
        await _sso_user(db, "p@acme.com", "viewer", "s-1")
        self._sign_in(monkeypatch, {"sub": "s-1", "email": "p@acme.com", "groups": ["ea-admins"]})

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert await stored_role(db, User, "p@acme.com") == "admin"

    async def test_the_first_match_in_map_order_wins(self, client, db, roles, monkeypatch):
        await _sso_user(db, "p@acme.com", "member", "s-1")
        claims = {"sub": "s-1", "email": "p@acme.com", "groups": ["EA-Readers", "EA-ADMINS"]}
        self._sign_in(monkeypatch, claims)

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert await stored_role(db, User, "p@acme.com") == "admin"

    async def test_a_role_granted_by_hand_is_demoted(self, client, db, roles, monkeypatch):
        await create_user(db, email="other-admin@acme.com", role="admin")
        await _sso_user(db, "p@acme.com", "admin", "s-1")
        self._sign_in(monkeypatch, {"sub": "s-1", "email": "p@acme.com", "groups": "EA-Readers"})

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert await stored_role(db, User, "p@acme.com") == "viewer"

    async def test_no_match_gives_the_default_role(self, client, db, roles, monkeypatch):
        await _sso_user(db, "p@acme.com", "viewer", "s-1")
        self._sign_in(monkeypatch, {"sub": "s-1", "email": "p@acme.com", "groups": ["sales"]})

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert await stored_role(db, User, "p@acme.com") == "member"

    @pytest.mark.parametrize("groups", ["absent", [], "", ["  "]])
    async def test_an_absent_or_empty_claim_leaves_the_role(
        self, client, db, roles, monkeypatch, groups
    ):
        await _sso_user(db, "p@acme.com", "viewer", "s-1")
        claims = {"sub": "s-1", "email": "p@acme.com"}
        if groups != "absent":
            claims["groups"] = groups
        self._sign_in(monkeypatch, claims)

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert await stored_role(db, User, "p@acme.com") == "viewer"

    async def test_only_the_configured_claim_is_read(self, client, db, roles, monkeypatch):
        await _sso_user(db, "p@acme.com", "viewer", "s-1")
        self._sign_in(monkeypatch, {"sub": "s-1", "email": "p@acme.com", "roles": ["EA-Admins"]})

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert await stored_role(db, User, "p@acme.com") == "viewer"

    async def test_an_undefined_target_gives_the_default_role(self, client, db, roles, monkeypatch):
        await _sso_user(db, "p@acme.com", "viewer", "s-1")
        self._sign_in(monkeypatch, {"sub": "s-1", "email": "p@acme.com", "groups": ["EA-Gone"]})

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert await stored_role(db, User, "p@acme.com") == "member"

    async def test_an_archived_target_gives_the_default_role(self, client, db, roles, monkeypatch):
        await _sso_user(db, "p@acme.com", "viewer", "s-1")
        self._sign_in(monkeypatch, {"sub": "s-1", "email": "p@acme.com", "groups": ["EA-Old"]})

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert await stored_role(db, User, "p@acme.com") == "member"

    async def test_without_a_map_the_role_is_never_touched(self, client, db, roles, monkeypatch):
        await _sso_user(db, "p@acme.com", "viewer", "s-1")
        self._sign_in(
            monkeypatch,
            {"sub": "s-1", "email": "p@acme.com", "groups": ["EA-Admins"]},
            sso_cfg={"role_claim": "groups"},
        )

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert await stored_role(db, User, "p@acme.com") == "viewer"

    async def test_without_a_claim_name_the_map_is_off(self, client, db, roles, monkeypatch):
        await _sso_user(db, "p@acme.com", "viewer", "s-1")
        self._sign_in(
            monkeypatch,
            {"sub": "s-1", "email": "p@acme.com", "groups": ["EA-Admins"]},
            sso_cfg={"role_map": ROLE_MAP_CFG["role_map"]},
        )

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert await stored_role(db, User, "p@acme.com") == "viewer"

    async def test_google_is_ignored(self, client, db, roles, monkeypatch):
        await _sso_user(db, "p@acme.com", "viewer", "s-1")
        self._sign_in(
            monkeypatch,
            {"sub": "s-1", "email": "p@acme.com", "groups": ["EA-Admins"]},
            provider="google",
        )

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert await stored_role(db, User, "p@acme.com") == "viewer"

    @pytest.mark.parametrize("tenant", [None, "organizations", "common", "consumers"])
    async def test_microsoft_with_a_multi_tenant_tenant_is_ignored(
        self, client, db, roles, monkeypatch, tenant
    ):
        await _sso_user(db, "p@acme.com", "viewer", "oid-1")
        cfg = dict(ROLE_MAP_CFG) if tenant is None else {**ROLE_MAP_CFG, "tenant_id": tenant}
        self._sign_in(
            monkeypatch,
            {"oid": "oid-1", "email": "p@acme.com", "groups": ["EA-Admins"]},
            provider="microsoft",
            sso_cfg=cfg,
        )

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert await stored_role(db, User, "p@acme.com") == "viewer"

    async def test_microsoft_with_a_specific_tenant_is_mapped(self, client, db, roles, monkeypatch):
        await _sso_user(db, "p@acme.com", "viewer", "oid-1")
        self._sign_in(
            monkeypatch,
            {"oid": "oid-1", "email": "p@acme.com", "groups": ["EA-Admins"]},
            provider="microsoft",
            sso_cfg={**ROLE_MAP_CFG, "tenant_id": "contoso.onmicrosoft.com"},
        )

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert await stored_role(db, User, "p@acme.com") == "admin"

    async def test_the_last_active_admin_is_kept_and_the_row_says_so(
        self, client, db, roles, monkeypatch
    ):
        await _sso_user(db, "p@acme.com", "admin", "s-1")
        self._sign_in(monkeypatch, {"sub": "s-1", "email": "p@acme.com", "groups": ["EA-Readers"]})

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert await stored_role(db, User, "p@acme.com") == "admin"
        row = await _succeeded_row(db)
        assert row.details == {
            "context": {
                "provider": "oidc",
                "subject": "s-1",
                "created": False,
                "last_admin_kept": True,
            }
        }

    async def test_a_second_active_admin_lets_the_demotion_through(
        self, client, db, roles, monkeypatch
    ):
        await create_user(db, email="other-admin@acme.com", role="admin")
        await _sso_user(db, "p@acme.com", "admin", "s-1")
        self._sign_in(monkeypatch, {"sub": "s-1", "email": "p@acme.com", "groups": ["EA-Readers"]})

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert await stored_role(db, User, "p@acme.com") == "viewer"
        row = await _succeeded_row(db)
        assert row.details == {
            "changes": {"role": {"old": "Admin", "new": "Viewer"}},
            "context": {"provider": "oidc", "subject": "s-1", "created": False},
        }

    async def test_the_success_row_records_the_change_by_label(
        self, client, db, roles, monkeypatch
    ):
        await _sso_user(db, "p@acme.com", "viewer", "s-1")
        self._sign_in(monkeypatch, {"sub": "s-1", "email": "p@acme.com", "groups": ["EA-Admins"]})

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        row = await _succeeded_row(db)
        assert row.details == {
            "changes": {"role": {"old": "Viewer", "new": "Admin"}},
            "context": {"provider": "oidc", "subject": "s-1", "created": False},
        }

    async def test_an_unchanged_role_records_no_change(self, client, db, roles, monkeypatch):
        await _sso_user(db, "p@acme.com", "viewer", "s-1")
        self._sign_in(monkeypatch, {"sub": "s-1", "email": "p@acme.com", "groups": ["EA-Readers"]})

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        row = await _succeeded_row(db)
        assert row.details == {"context": {"provider": "oidc", "subject": "s-1", "created": False}}

    async def test_the_session_carries_the_mapped_role(self, client, db, roles, monkeypatch):
        from app.core.security import decode_access_token

        await _sso_user(db, "p@acme.com", "viewer", "s-1")
        self._sign_in(monkeypatch, {"sub": "s-1", "email": "p@acme.com", "groups": ["EA-Admins"]})

        resp = await client.post(CALLBACK, json=BODY)
        assert resp.status_code == 200
        assert decode_access_token(resp.json()["access_token"])["role"] == "admin"

    async def test_the_map_overrides_an_invitation_when_the_claim_is_present(
        self, client, db, roles, monkeypatch
    ):
        from app.models.sso_invitation import SsoInvitation

        db.add(SsoInvitation(email="invited@acme.com", role="member"))
        await db.flush()
        self._sign_in(
            monkeypatch, {"sub": "inv", "email": "invited@acme.com", "groups": ["EA-Readers"]}
        )

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert await stored_role(db, User, "invited@acme.com") == "viewer"

    async def test_an_invitation_is_kept_when_the_claim_is_absent(
        self, client, db, roles, monkeypatch
    ):
        from app.models.sso_invitation import SsoInvitation

        db.add(SsoInvitation(email="invited@acme.com", role="viewer"))
        await db.flush()
        self._sign_in(monkeypatch, {"sub": "inv", "email": "invited@acme.com"})

        assert (await client.post(CALLBACK, json=BODY)).status_code == 200
        assert await stored_role(db, User, "invited@acme.com") == "viewer"

    async def test_a_refused_sign_in_never_changes_the_role(self, client, db, roles, monkeypatch):
        user = await _sso_user(db, "off@acme.com", "viewer", "s-off")
        user.is_active = False
        await db.flush()
        self._sign_in(
            monkeypatch, {"sub": "s-off", "email": "off@acme.com", "groups": ["EA-Admins"]}
        )

        resp = await client.post(CALLBACK, json=BODY)
        assert resp.status_code == 403
        assert resp.json() == {"detail": "Account disabled"}
        assert await stored_role(db, User, "off@acme.com") == "viewer"


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

    async def test_extra_scopes_are_added_to_the_login_scopes(self, client, db, env):
        await self._configure(
            db,
            provider="okta",
            domain="dev-1.okta.com",
            extra_scopes="groups openid offline_access",
        )
        body = (await client.get("/api/v1/auth/sso/config")).json()
        assert body["enabled"] is True
        assert body["scopes"] == "openid email profile groups offline_access"

    async def test_without_extra_scopes_the_login_scopes_are_the_base(self, client, db, env):
        await self._configure(db, provider="okta", domain="dev-1.okta.com")
        body = (await client.get("/api/v1/auth/sso/config")).json()
        assert body["scopes"] == "openid email profile"

    async def test_the_public_config_carries_nothing_of_the_role_map(self, client, db, env):
        await self._configure(
            db,
            provider="okta",
            domain="dev-1.okta.com",
            role_claim="groups",
            role_map=[{"value": "EA-Admins", "role": "admin"}],
        )
        resp = await client.get("/api/v1/auth/sso/config")
        assert "EA-Admins" not in resp.text and "groups" not in resp.text
        assert "role_claim" not in resp.json() and "role_map" not in resp.json()
