"""Integration tests for the per-card custom logo endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.card_logo import CardLogo
from app.models.event import Event
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)

# Smallest byte sequences that carry each format's real signature. The upload
# path sniffs the leading bytes, so tests cannot use arbitrary filler.
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 32
GIF_BYTES = b"GIF89a" + b"\x00" * 32
WEBP_BYTES = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 32


@pytest.fixture
async def logo_env(db):
    """A logo-enabled type, a logo-disabled type, and users on both sides."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    await create_card_type(db, key="Application", label="Application", allow_card_logo=True)
    await create_card_type(db, key="Objective", label="Objective", allow_card_logo=False)
    card = await create_card(db, card_type="Application", name="Kafka", user_id=admin.id)
    plain = await create_card(db, card_type="Objective", name="Grow", user_id=admin.id)
    return {"admin": admin, "viewer": viewer, "card": card, "plain": plain}


def _upload(client, card_id, user, content=PNG_BYTES, mime="image/png", filename="logo.png"):
    return client.post(
        f"/api/v1/cards/{card_id}/logo",
        files={"file": (filename, content, mime)},
        headers=auth_headers(user),
    )


# -------------------------------------------------------------------
# POST /cards/{card_id}/logo
# -------------------------------------------------------------------


class TestUploadCardLogo:
    async def test_uploads_png(self, client, db, logo_env):
        resp = await _upload(client, logo_env["card"].id, logo_env["admin"])
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        assert resp.json()["logo_updated_at"]

        row = (
            await db.execute(select(CardLogo).where(CardLogo.card_id == logo_env["card"].id))
        ).scalar_one()
        assert row.mime_type == "image/png"
        assert row.size == len(PNG_BYTES)

    @pytest.mark.parametrize(
        "content,mime",
        [
            (JPEG_BYTES, "image/jpeg"),
            (GIF_BYTES, "image/gif"),
            (WEBP_BYTES, "image/webp"),
        ],
    )
    async def test_accepts_every_allowed_format(self, client, db, logo_env, content, mime):
        resp = await _upload(client, logo_env["card"].id, logo_env["admin"], content, mime)
        assert resp.status_code == 200

    async def test_accepts_image_jpg_alias(self, client, db, logo_env):
        """Browsers send image/jpg often enough that refusing it reads as a bug."""
        resp = await _upload(
            client, logo_env["card"].id, logo_env["admin"], JPEG_BYTES, "image/jpg"
        )
        assert resp.status_code == 200
        row = (
            await db.execute(select(CardLogo).where(CardLogo.card_id == logo_env["card"].id))
        ).scalar_one()
        assert row.mime_type == "image/jpeg"

    async def test_replace_overwrites_in_place(self, client, db, logo_env):
        card = logo_env["card"]
        await _upload(client, card.id, logo_env["admin"])
        await _upload(client, card.id, logo_env["admin"], JPEG_BYTES, "image/jpeg")

        rows = (
            (await db.execute(select(CardLogo).where(CardLogo.card_id == card.id))).scalars().all()
        )
        assert len(rows) == 1, "replacing a logo must not accumulate rows"
        assert rows[0].mime_type == "image/jpeg"

    async def test_rejects_disallowed_mime(self, client, db, logo_env):
        resp = await _upload(
            client, logo_env["card"].id, logo_env["admin"], b"whatever", "text/plain"
        )
        assert resp.status_code == 400

    async def test_rejects_svg(self, client, db, logo_env):
        """SVG is scriptable and this codebase has no sanitiser for it."""
        resp = await _upload(
            client,
            logo_env["card"].id,
            logo_env["admin"],
            b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
            "image/svg+xml",
        )
        assert resp.status_code == 400

    async def test_rejects_content_that_belies_declared_type(self, client, db, logo_env):
        """A declared content type is attacker-controlled; the bytes decide."""
        resp = await _upload(
            client,
            logo_env["card"].id,
            logo_env["admin"],
            b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
            "image/png",
        )
        assert resp.status_code == 400
        assert "does not match" in resp.json()["detail"]

    async def test_rejects_oversize_image(self, client, db, logo_env):
        oversized = PNG_BYTES + b"\x00" * (1 * 1024 * 1024)
        resp = await _upload(client, logo_env["card"].id, logo_env["admin"], oversized)
        assert resp.status_code == 400

    async def test_rejects_empty_image(self, client, db, logo_env):
        resp = await _upload(client, logo_env["card"].id, logo_env["admin"], b"")
        assert resp.status_code == 400

    async def test_rejects_type_with_logos_disabled(self, client, db, logo_env):
        resp = await _upload(client, logo_env["plain"].id, logo_env["admin"])
        assert resp.status_code == 400
        assert "not enabled" in resp.json()["detail"]

    async def test_viewer_cannot_upload(self, client, db, logo_env):
        resp = await _upload(client, logo_env["card"].id, logo_env["viewer"])
        assert resp.status_code == 403

    async def test_anonymous_cannot_upload(self, client, db, logo_env):
        resp = await client.post(
            f"/api/v1/cards/{logo_env['card'].id}/logo",
            files={"file": ("logo.png", PNG_BYTES, "image/png")},
        )
        assert resp.status_code in (401, 403)

    async def test_unknown_card_is_404(self, client, db, logo_env):
        resp = await _upload(client, "00000000-0000-0000-0000-000000000000", logo_env["admin"])
        assert resp.status_code == 404

    async def test_respects_file_uploads_disabled(self, client, db, logo_env):
        from app.models.app_settings import AppSettings

        settings = AppSettings(id="default", general_settings={"fileUploadsEnabled": False})
        db.add(settings)
        await db.flush()

        resp = await _upload(client, logo_env["card"].id, logo_env["admin"])
        assert resp.status_code == 403


# -------------------------------------------------------------------
# GET /cards/{card_id}/logo  (public)
# -------------------------------------------------------------------


class TestServeCardLogo:
    async def test_serves_bytes_without_authentication(self, client, db, logo_env):
        """Portals are viewed with no account, and <img> cannot send the token."""
        await _upload(client, logo_env["card"].id, logo_env["admin"])

        resp = await client.get(f"/api/v1/cards/{logo_env['card'].id}/logo")
        assert resp.status_code == 200
        assert resp.content == PNG_BYTES
        assert resp.headers["content-type"] == "image/png"
        assert resp.headers["cache-control"] == "public, max-age=300"
        assert resp.headers["x-content-type-options"] == "nosniff"

    async def test_404_when_card_has_no_logo(self, client, db, logo_env):
        resp = await client.get(f"/api/v1/cards/{logo_env['card'].id}/logo")
        assert resp.status_code == 404

    async def test_404_for_unknown_card(self, client, db, logo_env):
        resp = await client.get("/api/v1/cards/00000000-0000-0000-0000-000000000000/logo")
        assert resp.status_code == 404

    async def test_404_for_malformed_id_rather_than_500(self, client, db, logo_env):
        resp = await client.get("/api/v1/cards/not-a-uuid/logo")
        assert resp.status_code == 404

    async def test_still_served_when_type_toggle_is_off(self, client, db, logo_env):
        """Flipping the type switch off must not 404 images already on screen."""
        from app.models.card_type import CardType

        card = logo_env["card"]
        await _upload(client, card.id, logo_env["admin"])

        ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
        ct.allow_card_logo = False
        await db.flush()

        resp = await client.get(f"/api/v1/cards/{card.id}/logo")
        assert resp.status_code == 200


# -------------------------------------------------------------------
# DELETE /cards/{card_id}/logo
# -------------------------------------------------------------------


class TestDeleteCardLogo:
    async def test_deletes_logo(self, client, db, logo_env):
        card = logo_env["card"]
        await _upload(client, card.id, logo_env["admin"])

        resp = await client.delete(
            f"/api/v1/cards/{card.id}/logo", headers=auth_headers(logo_env["admin"])
        )
        assert resp.status_code == 204
        assert (await client.get(f"/api/v1/cards/{card.id}/logo")).status_code == 404

    async def test_404_when_no_logo(self, client, db, logo_env):
        resp = await client.delete(
            f"/api/v1/cards/{logo_env['card'].id}/logo",
            headers=auth_headers(logo_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_viewer_cannot_delete(self, client, db, logo_env):
        await _upload(client, logo_env["card"].id, logo_env["admin"])
        resp = await client.delete(
            f"/api/v1/cards/{logo_env['card'].id}/logo",
            headers=auth_headers(logo_env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_allowed_after_type_toggle_is_switched_off(self, client, db, logo_env):
        """Turning the feature off must never strand an image as undeletable."""
        from app.models.card_type import CardType

        card = logo_env["card"]
        await _upload(client, card.id, logo_env["admin"])
        ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
        ct.allow_card_logo = False
        await db.flush()

        resp = await client.delete(
            f"/api/v1/cards/{card.id}/logo", headers=auth_headers(logo_env["admin"])
        )
        assert resp.status_code == 204


# -------------------------------------------------------------------
# History + the updated_at invariant
# -------------------------------------------------------------------


class TestCardLogoEvents:
    async def test_upload_and_delete_persist_events(self, client, db, logo_env):
        card = logo_env["card"]
        await _upload(client, card.id, logo_env["admin"])
        await client.delete(
            f"/api/v1/cards/{card.id}/logo", headers=auth_headers(logo_env["admin"])
        )

        types = (
            (
                await db.execute(
                    select(Event.event_type).where(
                        Event.card_id == card.id,
                        Event.event_type.in_(["card_logo.updated", "card_logo.deleted"]),
                    )
                )
            )
            .scalars()
            .all()
        )
        assert "card_logo.updated" in types
        assert "card_logo.deleted" in types

    async def test_upload_does_not_move_card_updated_at(
        self, client, db, logo_env, card_update_sql
    ):
        """The Modified column must keep meaning "content last changed".

        A logo lives in its own table precisely so this write cannot re-date
        the card. Asserting on the emitted SQL, not on timestamps: now() is
        transaction-constant, so a before/after comparison passes vacuously.
        """
        card_update_sql.clear()
        resp = await _upload(client, logo_env["card"].id, logo_env["admin"])
        assert resp.status_code == 200

        assert not card_update_sql.bumped(), (
            f"uploading a logo re-dated the card: {card_update_sql.statements}"
        )
        # Prove the assertion above is not vacuous — the logo really was stored.
        assert (
            await db.execute(select(CardLogo).where(CardLogo.card_id == logo_env["card"].id))
        ).scalar_one_or_none() is not None


# -------------------------------------------------------------------
# logo_updated_at on the card payloads
# -------------------------------------------------------------------


class TestLogoUpdatedAtInPayloads:
    async def test_absent_before_upload(self, client, db, logo_env):
        resp = await client.get(
            f"/api/v1/cards/{logo_env['card'].id}", headers=auth_headers(logo_env["admin"])
        )
        assert resp.status_code == 200
        assert resp.json()["logo_updated_at"] is None

    async def test_present_on_card_detail(self, client, db, logo_env):
        await _upload(client, logo_env["card"].id, logo_env["admin"])
        resp = await client.get(
            f"/api/v1/cards/{logo_env['card'].id}", headers=auth_headers(logo_env["admin"])
        )
        assert resp.json()["logo_updated_at"] is not None

    async def test_present_in_card_list(self, client, db, logo_env):
        await _upload(client, logo_env["card"].id, logo_env["admin"])
        resp = await client.get(
            "/api/v1/cards?type=Application", headers=auth_headers(logo_env["admin"])
        )
        assert resp.status_code == 200
        item = next(i for i in resp.json()["items"] if i["id"] == str(logo_env["card"].id))
        assert item["logo_updated_at"] is not None

    async def test_omitted_when_type_toggle_is_off(self, client, db, logo_env):
        """Switching the type off must make every surface render as before,
        without the client needing a rule of its own."""
        from app.models.card_type import CardType

        card = logo_env["card"]
        await _upload(client, card.id, logo_env["admin"])
        ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
        ct.allow_card_logo = False
        await db.flush()

        detail = await client.get(
            f"/api/v1/cards/{card.id}", headers=auth_headers(logo_env["admin"])
        )
        assert detail.json()["logo_updated_at"] is None

        listing = await client.get(
            "/api/v1/cards?type=Application", headers=auth_headers(logo_env["admin"])
        )
        item = next(i for i in listing.json()["items"] if i["id"] == str(card.id))
        assert item["logo_updated_at"] is None


# -------------------------------------------------------------------
# Metamodel toggle
# -------------------------------------------------------------------


class TestAllowCardLogoToggle:
    async def test_type_payload_exposes_the_flag(self, client, db, logo_env):
        resp = await client.get("/api/v1/metamodel/types", headers=auth_headers(logo_env["admin"]))
        by_key = {t["key"]: t for t in resp.json()}
        assert by_key["Application"]["allow_card_logo"] is True
        assert by_key["Objective"]["allow_card_logo"] is False

    async def test_admin_can_flip_the_flag(self, client, db, logo_env):
        resp = await client.patch(
            "/api/v1/metamodel/types/Objective",
            json={"allow_card_logo": True},
            headers=auth_headers(logo_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["allow_card_logo"] is True

        # And the upload it unblocks now succeeds.
        assert (await _upload(client, logo_env["plain"].id, logo_env["admin"])).status_code == 200


# -------------------------------------------------------------------
# Brand icons (bundled pack)
# -------------------------------------------------------------------


async def _post_slug(client, card_id, user, slug):
    return await client.post(
        f"/api/v1/cards/{card_id}/logo",
        data={"icon_slug": slug},
        headers=auth_headers(user),
    )


class TestUploadByIconSlug:
    async def test_resolves_a_known_slug(self, client, db, logo_env):
        resp = await _post_slug(client, logo_env["card"].id, logo_env["admin"], "apachekafka")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["source"] == "icon"
        assert body["icon_slug"] == "apachekafka"
        assert body["mime"] == "image/png"
        assert body["bytes"] > 0

        row = (
            await db.execute(select(CardLogo).where(CardLogo.card_id == logo_env["card"].id))
        ).scalar_one()
        assert row.mime_type == "image/png"

    async def test_accepts_the_pack_prefixed_form(self, client, db, logo_env):
        resp = await _post_slug(
            client, logo_env["card"].id, logo_env["admin"], "simpleicons:apachekafka"
        )
        assert resp.status_code == 200
        assert resp.json()["icon_slug"] == "apachekafka"

    async def test_unknown_slug_points_at_the_discovery_endpoint(self, client, db, logo_env):
        resp = await _post_slug(client, logo_env["card"].id, logo_env["admin"], "not-a-real-brand")
        assert resp.status_code == 400
        assert "brand-icons" in resp.json()["detail"]

    @pytest.mark.parametrize(
        "slug", ["../../../etc/passwd", "..%2f..%2fetc", "sap/../../secret", "SAP/../sap"]
    )
    async def test_a_traversal_slug_is_refused(self, client, db, logo_env, slug):
        """The slug becomes a filename, so it is checked against the parsed
        index before the filesystem is touched at all."""
        resp = await _post_slug(client, logo_env["card"].id, logo_env["admin"], slug)
        assert resp.status_code == 400

    async def test_neither_file_nor_slug_is_rejected(self, client, db, logo_env):
        resp = await client.post(
            f"/api/v1/cards/{logo_env['card'].id}/logo",
            data={"unused": "x"},
            headers=auth_headers(logo_env["admin"]),
        )
        assert resp.status_code == 400
        assert "either" in resp.json()["detail"]

    async def test_both_file_and_slug_is_rejected(self, client, db, logo_env):
        resp = await client.post(
            f"/api/v1/cards/{logo_env['card'].id}/logo",
            files={"file": ("logo.png", PNG_BYTES, "image/png")},
            data={"icon_slug": "apachekafka"},
            headers=auth_headers(logo_env["admin"]),
        )
        assert resp.status_code == 400

    async def test_icon_path_honours_the_per_type_switch(self, client, db, logo_env):
        resp = await _post_slug(client, logo_env["plain"].id, logo_env["admin"], "apachekafka")
        assert resp.status_code == 400
        assert "not enabled" in resp.json()["detail"]

    async def test_icon_path_honours_file_uploads_disabled(self, client, db, logo_env):
        """One operator switch means one thing: no images on this instance."""
        from app.models.app_settings import AppSettings

        db.add(AppSettings(id="default", general_settings={"fileUploadsEnabled": False}))
        await db.flush()

        resp = await _post_slug(client, logo_env["card"].id, logo_env["admin"], "apachekafka")
        assert resp.status_code == 403

    async def test_viewer_cannot_set_an_icon(self, client, db, logo_env):
        resp = await _post_slug(client, logo_env["card"].id, logo_env["viewer"], "apachekafka")
        assert resp.status_code == 403

    async def test_icon_upload_records_the_slug_in_history(self, client, db, logo_env):
        await _post_slug(client, logo_env["card"].id, logo_env["admin"], "apachekafka")
        event = (
            await db.execute(
                select(Event).where(
                    Event.card_id == logo_env["card"].id,
                    Event.event_type == "card_logo.updated",
                )
            )
        ).scalar_one()
        assert event.data["icon_slug"] == "apachekafka"


class TestUploadResponseDigest:
    async def test_response_carries_a_sha256_of_the_stored_bytes(self, client, db, logo_env):
        import hashlib

        resp = await _upload(client, logo_env["card"].id, logo_env["admin"])
        body = resp.json()
        assert body["sha256"] == hashlib.sha256(PNG_BYTES).hexdigest()
        assert body["bytes"] == len(PNG_BYTES)
        assert body["source"] == "upload"


class TestBrandIconDiscovery:
    async def test_search_ranks_an_exact_slug_first(self, client, db, logo_env):
        resp = await client.get(
            "/api/v1/card-logos/brand-icons?search=sap", headers=auth_headers(logo_env["admin"])
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] > 1000
        assert body["items"][0]["slug"] == "sap"

    async def test_limit_is_capped(self, client, db, logo_env):
        resp = await client.get(
            "/api/v1/card-logos/brand-icons?limit=500", headers=auth_headers(logo_env["admin"])
        )
        assert resp.status_code == 422

    async def test_requires_authentication(self, client, db, logo_env):
        resp = await client.get("/api/v1/card-logos/brand-icons")
        assert resp.status_code in (401, 403)


# -------------------------------------------------------------------
# GET /reports/dependencies — logos on the Layered Dependency View
# -------------------------------------------------------------------


class TestDependencyReportLogos:
    """The dependency graph carries the same logo fact every other surface does.

    It is the one consumer that builds its nodes by hand rather than through
    ``_card_to_response``, so it is also the one that can silently drift.
    """

    async def test_node_carries_logo_updated_at_for_a_card_with_a_logo(self, client, db, logo_env):
        resp = await _upload(client, logo_env["card"].id, logo_env["admin"])
        assert resp.status_code == 200

        resp = await client.get(
            "/api/v1/reports/dependencies",
            headers=auth_headers(logo_env["admin"]),
        )
        assert resp.status_code == 200
        nodes = {n["id"]: n for n in resp.json()["nodes"]}
        assert nodes[str(logo_env["card"].id)]["logo_updated_at"] is not None

    async def test_a_card_without_a_logo_reports_none(self, client, db, logo_env):
        resp = await client.get(
            "/api/v1/reports/dependencies",
            headers=auth_headers(logo_env["admin"]),
        )
        nodes = {n["id"]: n for n in resp.json()["nodes"]}
        # Present as a key, so the view reads one shape for every node.
        assert nodes[str(logo_env["card"].id)]["logo_updated_at"] is None

    async def test_a_type_with_logos_switched_off_is_withheld(self, client, db, logo_env):
        """The per-type switch is applied server-side, once.

        Uploading to the disabled type is refused, so this asserts the shape the
        view relies on: a card of such a type never carries a logo timestamp,
        and therefore renders exactly as it did before logos existed.
        """
        refused = await _upload(client, logo_env["plain"].id, logo_env["admin"])
        assert refused.status_code == 400

        resp = await client.get(
            "/api/v1/reports/dependencies",
            headers=auth_headers(logo_env["admin"]),
        )
        nodes = {n["id"]: n for n in resp.json()["nodes"]}
        assert nodes[str(logo_env["plain"].id)]["logo_updated_at"] is None


# -------------------------------------------------------------------
# GET /card-logos/brand-icons/{slug}.png
# -------------------------------------------------------------------


class TestBrandIconImage:
    """The picker renders these through <img>, so the route is public.

    Same split as `/settings/logo` (public image) versus `/settings/logo-info`
    (gated metadata): the bytes are CC0 artwork shipped in the image and carry
    no instance data, while enumerating the pack stays behind a permission.
    """

    async def test_serves_a_known_icon_without_authentication(self, client, db, logo_env):
        resp = await client.get("/api/v1/card-logos/brand-icons/apachekafka.png")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert resp.content.startswith(b"\x89PNG\r\n\x1a\n")
        assert "max-age" in resp.headers.get("cache-control", "")
        assert resp.headers.get("x-content-type-options") == "nosniff"

    async def test_accepts_the_prefixed_form(self, client, db, logo_env):
        resp = await client.get("/api/v1/card-logos/brand-icons/simpleicons:sap.png")
        assert resp.status_code == 200

    @pytest.mark.parametrize(
        "slug",
        ["not-a-real-brand", "..", "../../etc/passwd"],
    )
    async def test_unknown_or_malformed_slugs_are_404(self, client, db, logo_env, slug):
        resp = await client.get(f"/api/v1/card-logos/brand-icons/{slug}.png")
        assert resp.status_code == 404

    async def test_listing_the_pack_still_requires_permission(self, client, db, logo_env):
        # The asymmetry is deliberate: rendering one icon is not enumerating
        # the pack.
        resp = await client.get("/api/v1/card-logos/brand-icons")
        assert resp.status_code == 401

    async def test_serves_a_pack_qualified_ref_url_encoded(self, client, db, logo_env):
        """What the picker actually requests: the colon percent-encoded.

        The picker addresses one specific mark — the colour SAP, not the
        silhouette — so it sends the pack-qualified ref rather than a bare
        slug, and that colon arrives as %3A.
        """
        resp = await client.get("/api/v1/card-logos/brand-icons/logos%3Asap.png")
        assert resp.status_code == 200
        assert resp.content.startswith(b"\x89PNG\r\n\x1a\n")

        mono = await client.get("/api/v1/card-logos/brand-icons/simpleicons%3Asap.png")
        assert mono.status_code == 200
        # Two different packs, two different pictures.
        assert mono.content != resp.content


class TestResolveBrandIcons:
    """Bulk existence check, so a dry run can warn before it commits."""

    async def test_separates_known_from_unknown_and_canonicalises(self, client, db, logo_env):
        resp = await client.get(
            "/api/v1/card-logos/brand-icons/resolve",
            params={"refs": "sap,simpleicons:sap,acme-corp,not-a-brand"},
            headers=auth_headers(logo_env["admin"]),
        )
        assert resp.status_code == 200
        body = resp.json()
        # A bare slug comes back canonicalised, so the caller can store the
        # exact pack it resolved to rather than re-resolving later.
        assert body["known"]["sap"].startswith("logos:")
        assert body["known"]["simpleicons:sap"] == "simpleicons:sap"
        assert sorted(body["unknown"]) == ["acme-corp", "not-a-brand"]

    async def test_requires_permission(self, client, db, logo_env):
        resp = await client.get("/api/v1/card-logos/brand-icons/resolve", params={"refs": "sap"})
        assert resp.status_code == 401

    async def test_an_empty_request_is_not_an_error(self, client, db, logo_env):
        # A batch that uses no icon_slug at all still calls this; answering
        # with an error would turn "nothing to check" into a failure.
        resp = await client.get(
            "/api/v1/card-logos/brand-icons/resolve",
            headers=auth_headers(logo_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == {"known": {}, "unknown": []}
