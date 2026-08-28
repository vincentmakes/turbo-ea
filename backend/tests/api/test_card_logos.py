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
