"""Integration tests for publishing a diagram as a read-only public link.

A published diagram is the only place in the product where diagram content
leaves the instance without an app session (added so diagrams can be iframed
into Confluence — discussion #905). The tests below pin the properties that
make that safe:

* publishing is gated on its own permission, not on "can edit diagrams";
* the public payload is a picture and nothing more — no card ids, no relations;
* an SSO-gated diagram refuses anonymous access and wrong-domain visitors;
* a session cookie for one resource never unlocks another;
* unpublishing revokes access immediately, cookie or no cookie.
"""

from __future__ import annotations

import uuid

import pytest

from app.api.v1.diagrams import sanitise_public_xml
from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.core.security import create_portal_token
from app.services.public_access import PUBLIC_ACCESS_COOKIE
from tests.conftest import auth_headers, create_role, create_user

# A realistic fragment: a card-shaped cell plus a relation-stamped edge.
CARD_XML = (
    '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
    '<object label="NexaCore ERP" cardId="11111111-1111-1111-1111-111111111111" '
    'cardType="Application" parentGroupCell="c9"><mxCell style="fillColor=#0f7eb5" '
    'vertex="1" parent="1"/></object>'
    '<object label="" relationId="22222222-2222-2222-2222-222222222222" '
    'relationType="app_to_itc"><mxCell edge="1" parent="1"/></object>'
    "</root></mxGraphModel>"
)


@pytest.fixture
async def publish_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "member": member, "viewer": viewer}


async def _make_diagram(client, user, *, name="Landscape", xml=CARD_XML) -> str:
    resp = await client.post(
        "/api/v1/diagrams",
        json={"name": name, "data": {"xml": xml}},
        headers=auth_headers(user),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


# ---------------------------------------------------------------------------
# The sanitiser — pure, no DB
# ---------------------------------------------------------------------------


class TestSanitiser:
    def test_strips_every_turbo_attribute(self):
        out = sanitise_public_xml(CARD_XML)
        for attr in (
            "cardId=",
            "cardType=",
            "relationId=",
            "relationType=",
            "parentGroupCell=",
        ):
            assert attr not in out, f"{attr} survived sanitisation"

    def test_keeps_the_picture_intact(self):
        """Labels, geometry and styling are the whole point of publishing."""
        out = sanitise_public_xml(CARD_XML)
        assert "NexaCore ERP" in out
        assert "fillColor=#0f7eb5" in out
        assert 'edge="1"' in out
        assert out.startswith("<mxGraphModel>")

    def test_handles_missing_xml(self):
        assert sanitise_public_xml(None) == ""
        assert sanitise_public_xml("") == ""


# ---------------------------------------------------------------------------
# Publishing is its own authority
# ---------------------------------------------------------------------------


class TestPublishPermission:
    async def test_admin_can_publish(self, client, db, publish_env):
        did = await _make_diagram(client, publish_env["admin"])
        resp = await client.post(
            f"/api/v1/diagrams/{did}/publish",
            json={"access_mode": "public"},
            headers=auth_headers(publish_env["admin"]),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["is_published"] is True
        assert body["public_slug"]

    async def test_member_who_can_edit_diagrams_cannot_publish(self, client, db, publish_env):
        """`diagrams.manage` must not imply `diagrams.publish` — editing a
        diagram and exposing it outside the instance are different powers."""
        member = publish_env["member"]
        assert MEMBER_PERMISSIONS["diagrams.manage"] is True
        did = await _make_diagram(client, member)
        resp = await client.post(
            f"/api/v1/diagrams/{did}/publish",
            json={"access_mode": "public"},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_viewer_cannot_publish(self, client, db, publish_env):
        did = await _make_diagram(client, publish_env["admin"])
        resp = await client.post(
            f"/api/v1/diagrams/{did}/publish",
            json={"access_mode": "public"},
            headers=auth_headers(publish_env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_rejects_unknown_access_mode(self, client, db, publish_env):
        did = await _make_diagram(client, publish_env["admin"])
        resp = await client.post(
            f"/api/v1/diagrams/{did}/publish",
            json={"access_mode": "everyone"},
            headers=auth_headers(publish_env["admin"]),
        )
        assert resp.status_code == 422

    async def test_slug_is_not_derived_from_the_name(self, client, db, publish_env):
        """For a public diagram the URL is the capability, so the slug must not
        be guessable from the title."""
        did = await _make_diagram(client, publish_env["admin"], name="Q3 Landscape")
        resp = await client.post(
            f"/api/v1/diagrams/{did}/publish",
            json={"access_mode": "public"},
            headers=auth_headers(publish_env["admin"]),
        )
        slug = resp.json()["public_slug"]
        assert "q3" not in slug.lower()
        assert "landscape" not in slug.lower()
        assert len(slug) >= 20

    async def test_republishing_keeps_the_same_url(self, client, db, publish_env):
        """Links already pasted into a wiki must survive an unpublish/republish."""
        admin = publish_env["admin"]
        did = await _make_diagram(client, admin)
        first = await client.post(
            f"/api/v1/diagrams/{did}/publish",
            json={"access_mode": "public"},
            headers=auth_headers(admin),
        )
        slug = first.json()["public_slug"]
        await client.delete(f"/api/v1/diagrams/{did}/publish", headers=auth_headers(admin))
        again = await client.post(
            f"/api/v1/diagrams/{did}/publish",
            json={"access_mode": "public"},
            headers=auth_headers(admin),
        )
        assert again.json()["public_slug"] == slug


# ---------------------------------------------------------------------------
# The public surface
# ---------------------------------------------------------------------------


class TestPublicAccess:
    async def _publish(self, client, admin, did, **body):
        resp = await client.post(
            f"/api/v1/diagrams/{did}/publish",
            json={"access_mode": "public", **body},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        return resp.json()["public_slug"]

    async def test_public_diagram_readable_without_a_session(self, client, db, publish_env):
        admin = publish_env["admin"]
        did = await _make_diagram(client, admin)
        slug = await self._publish(client, admin, did)

        resp = await client.get(f"/api/v1/diagrams/public/{slug}")  # no auth header
        assert resp.status_code == 200
        assert resp.json()["name"] == "Landscape"

    async def test_public_payload_leaks_nothing_but_the_picture(self, client, db, publish_env):
        admin = publish_env["admin"]
        did = await _make_diagram(client, admin)
        slug = await self._publish(client, admin, did)

        body = (await client.get(f"/api/v1/diagrams/public/{slug}")).json()
        assert set(body) == {"name", "xml"}
        assert "cardId" not in body["xml"]
        assert "relationId" not in body["xml"]
        assert "11111111-1111-1111-1111-111111111111" not in body["xml"]

    async def test_unpublished_diagram_is_404_not_403(self, client, db, publish_env):
        """An unpublished slug must be indistinguishable from a nonexistent one."""
        admin = publish_env["admin"]
        did = await _make_diagram(client, admin)
        slug = await self._publish(client, admin, did)
        await client.delete(f"/api/v1/diagrams/{did}/publish", headers=auth_headers(admin))

        assert (await client.get(f"/api/v1/diagrams/public/{slug}")).status_code == 404
        assert (await client.get(f"/api/v1/diagrams/public/{slug}/gate")).status_code == 404

    async def test_unknown_slug_is_404(self, client, db, publish_env):
        assert (await client.get("/api/v1/diagrams/public/nope")).status_code == 404

    async def test_never_published_diagram_is_not_reachable(self, client, db, publish_env):
        did = await _make_diagram(client, publish_env["admin"])
        # The id is not a slug, and there is no slug until it is published.
        assert (await client.get(f"/api/v1/diagrams/public/{did}")).status_code == 404


# ---------------------------------------------------------------------------
# SSO-gated diagrams
# ---------------------------------------------------------------------------


class TestSsoGate:
    async def _publish_sso(self, client, admin, did, domains=None):
        resp = await client.post(
            f"/api/v1/diagrams/{did}/publish",
            json={"access_mode": "sso", "allowed_email_domains": domains},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200, resp.text
        return resp.json()

    async def test_sso_diagram_refuses_anonymous_access(self, client, db, publish_env):
        admin = publish_env["admin"]
        did = await _make_diagram(client, admin)
        slug = (await self._publish_sso(client, admin, did))["public_slug"]

        resp = await client.get(f"/api/v1/diagrams/public/{slug}")
        assert resp.status_code == 401
        # Machine-readable so the embed page can show the sign-in gate.
        assert resp.json()["detail"] == "portal_locked"

    async def test_gate_reveals_only_the_mode_and_name(self, client, db, publish_env):
        admin = publish_env["admin"]
        did = await _make_diagram(client, admin)
        slug = (await self._publish_sso(client, admin, did))["public_slug"]

        body = (await client.get(f"/api/v1/diagrams/public/{slug}/gate")).json()
        assert body["access_mode"] == "sso"
        assert body["name"] == "Landscape"
        assert "xml" not in body

    async def test_a_valid_cookie_unlocks_it(self, client, db, publish_env):
        admin = publish_env["admin"]
        did = await _make_diagram(client, admin)
        slug = (await self._publish_sso(client, admin, did))["public_slug"]

        token = create_portal_token(uuid.UUID(did), slug, "someone@corp.com", resource="diagram")
        client.cookies.set(PUBLIC_ACCESS_COOKIE, token)
        try:
            resp = await client.get(f"/api/v1/diagrams/public/{slug}")
            assert resp.status_code == 200
        finally:
            client.cookies.clear()

    async def test_a_portal_cookie_does_not_unlock_a_diagram(self, client, db, publish_env):
        """The resource discriminator is what keeps the two grants apart — a
        token minted for a portal with the same id must be refused."""
        admin = publish_env["admin"]
        did = await _make_diagram(client, admin)
        slug = (await self._publish_sso(client, admin, did))["public_slug"]

        token = create_portal_token(uuid.UUID(did), slug, "someone@corp.com", resource="portal")
        client.cookies.set(PUBLIC_ACCESS_COOKIE, token)
        try:
            resp = await client.get(f"/api/v1/diagrams/public/{slug}")
            assert resp.status_code == 401
        finally:
            client.cookies.clear()

    async def test_a_cookie_for_another_diagram_is_refused(self, client, db, publish_env):
        admin = publish_env["admin"]
        did = await _make_diagram(client, admin)
        other = await _make_diagram(client, admin, name="Other")
        slug = (await self._publish_sso(client, admin, did))["public_slug"]

        token = create_portal_token(uuid.UUID(other), slug, "x@corp.com", resource="diagram")
        client.cookies.set(PUBLIC_ACCESS_COOKIE, token)
        try:
            assert (await client.get(f"/api/v1/diagrams/public/{slug}")).status_code == 401
        finally:
            client.cookies.clear()

    async def test_unpublish_revokes_a_live_session(self, client, db, publish_env):
        """A held cookie must not outlive the publication."""
        admin = publish_env["admin"]
        did = await _make_diagram(client, admin)
        slug = (await self._publish_sso(client, admin, did))["public_slug"]
        token = create_portal_token(uuid.UUID(did), slug, "someone@corp.com", resource="diagram")
        client.cookies.set(PUBLIC_ACCESS_COOKIE, token)
        try:
            assert (await client.get(f"/api/v1/diagrams/public/{slug}")).status_code == 200
            await client.delete(f"/api/v1/diagrams/{did}/publish", headers=auth_headers(admin))
            assert (await client.get(f"/api/v1/diagrams/public/{slug}")).status_code == 404
        finally:
            client.cookies.clear()

    async def test_domains_are_normalised(self, client, db, publish_env):
        admin = publish_env["admin"]
        did = await _make_diagram(client, admin)
        body = await self._publish_sso(
            client, admin, did, domains=["  Corp.COM ", "@other.com", "", "corp.com"]
        )
        assert body["allowed_email_domains"] == ["corp.com", "other.com"]

    async def test_sso_callback_rejected_on_a_public_diagram(self, client, db, publish_env):
        admin = publish_env["admin"]
        did = await _make_diagram(client, admin)
        resp = await client.post(
            f"/api/v1/diagrams/{did}/publish",
            json={"access_mode": "public"},
            headers=auth_headers(admin),
        )
        slug = resp.json()["public_slug"]
        cb = await client.post(
            f"/api/v1/diagrams/public/{slug}/sso/callback",
            json={"code": "x", "redirect_uri": "https://example.com/cb"},
        )
        assert cb.status_code == 400


# ---------------------------------------------------------------------------
# Publication state must not travel between instances
# ---------------------------------------------------------------------------


class TestWorkspaceTransferSafety:
    def test_publish_columns_are_excluded_from_transfer(self):
        """Cloning a workspace must never re-expose a public link on the target.

        A source instance with a published diagram, exported and imported
        elsewhere, would otherwise arrive already published — at a URL its new
        operator never chose to hand out — and `public_slug` being unique would
        collide the moment two instances shared a bundle.
        """
        from app.services.workspace_io.sections import ENTITY_SECTIONS

        section = next(s for s in ENTITY_SECTIONS if s.sheet == "Diagrams")
        for col in ("is_published", "public_slug", "access_mode", "allowed_email_domains"):
            assert col in section.exclude_columns, f"{col} would transfer between instances"
