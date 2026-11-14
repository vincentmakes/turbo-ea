"""Pictures in decision and SoAW text over the API.

``POST /document-images/{kind}`` needs ``<kind>.manage`` and file uploads
switched on, and takes PNG / JPEG / GIF / WebP up to 5 MB, decided by the
bytes; ``GET /document-images/{kind}/{id}`` needs ``<kind>.view`` (checked
before any lookup) and serves the picture inline, never as a download.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.app_settings import AppSettings
from app.models.document_image import DocumentImage
from app.services.attachment_validation import MAX_DOCUMENT_IMAGE_BYTES
from tests.conftest import auth_headers, create_role, create_user

URL = "/api/v1/document-images"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + b"\x01" * 40
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x02" * 40
GIF = b"GIF89a" + b"\x03" * 40
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x04" * 40
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
EXE = b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 40


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="adr_editor",
        label="ADR editor",
        permissions={"adr.view": True, "adr.manage": True},
    )
    await create_role(db, key="adr_reader", label="ADR reader", permissions={"adr.view": True})
    await create_role(
        db,
        key="soaw_editor",
        label="SoAW editor",
        permissions={"soaw.view": True, "soaw.manage": True},
    )
    await create_role(db, key="nobody", label="Nobody", permissions={"inventory.view": True})
    return {
        "admin": await create_user(db, email="admin@test.com", role="admin"),
        "adr_editor": await create_user(db, email="ae@test.com", role="adr_editor"),
        "adr_reader": await create_user(db, email="ar@test.com", role="adr_reader"),
        "soaw_editor": await create_user(db, email="se@test.com", role="soaw_editor"),
        "nobody": await create_user(db, email="no@test.com", role="nobody"),
    }


async def _upload(client, user, kind="adr", data=PNG, name="image.png"):
    return await client.post(
        f"{URL}/{kind}",
        files={"file": (name, data, "image/png")},
        headers=auth_headers(user),
    )


async def _uploaded(client, user, kind="adr", data=PNG) -> dict:
    resp = await _upload(client, user, kind, data)
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestUpload:
    @pytest.mark.parametrize(
        ("kind", "who", "data", "mime"),
        [
            ("adr", "adr_editor", PNG, "image/png"),
            ("adr", "adr_editor", JPEG, "image/jpeg"),
            ("soaw", "soaw_editor", GIF, "image/gif"),
            ("soaw", "soaw_editor", WEBP, "image/webp"),
        ],
    )
    async def test_an_editor_uploads_and_reads_back(self, client, db, env, kind, who, data, mime):
        body = await _uploaded(client, env[who], kind, data)
        image_id = body["id"]
        assert body == {
            "id": image_id,
            "src": f"/api/v1/document-images/{kind}/{image_id}",
            "mime_type": mime,
            "size": len(data),
        }
        row = await db.get(DocumentImage, uuid.UUID(image_id))
        assert (row.kind, row.mime_type, row.created_by, row.used_at) == (
            kind,
            mime,
            env[who].id,
            None,
        )
        resp = await client.get(body["src"], headers=auth_headers(env[who]))
        assert resp.status_code == 200
        assert resp.content == data
        assert resp.headers["content-type"] == mime

    async def test_the_name_and_declared_type_decide_nothing(self, client, env):
        resp = await client.post(
            f"{URL}/adr",
            files={"file": ("blob", JPEG, "application/pdf")},
            headers=auth_headers(env["adr_editor"]),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["mime_type"] == "image/jpeg"

    @pytest.mark.parametrize(
        ("kind", "who"),
        [
            ("adr", "adr_reader"),
            ("adr", "soaw_editor"),
            ("soaw", "adr_editor"),
            ("adr", "nobody"),
        ],
    )
    async def test_upload_needs_the_kinds_manage(self, client, db, env, kind, who):
        resp = await _upload(client, env[who], kind)
        assert resp.status_code == 403
        assert (await db.execute(select(DocumentImage))).scalars().all() == []

    async def test_upload_refused_while_uploads_are_off(self, client, db, env):
        row = await db.get(AppSettings, "default")
        if row is None:
            db.add(AppSettings(id="default", general_settings={"fileUploadsEnabled": False}))
        else:
            row.general_settings = {**(row.general_settings or {}), "fileUploadsEnabled": False}
        await db.flush()
        resp = await _upload(client, env["adr_editor"])
        assert resp.status_code == 403
        assert resp.json()["detail"] == "File uploads are disabled by the administrator"
        assert (await db.execute(select(DocumentImage))).scalars().all() == []

    @pytest.mark.parametrize(
        ("data", "name", "detail"),
        [
            (SVG, "logo.svg", "Only PNG, JPEG, GIF and WebP pictures can be inserted"),
            (EXE, "photo.png", "Only PNG, JPEG, GIF and WebP pictures can be inserted"),
            (b"", "empty.png", "File is empty"),
            (
                PNG + b"\x00" * (MAX_DOCUMENT_IMAGE_BYTES - len(PNG) + 1),
                "big.png",
                "Picture exceeds maximum size of 5 MB",
            ),
        ],
        ids=["svg", "renamed-exe", "empty", "oversized"],
    )
    async def test_refused_content(self, client, db, env, data, name, detail):
        resp = await _upload(client, env["adr_editor"], data=data, name=name)
        assert resp.status_code == 400
        assert resp.json()["detail"] == detail
        assert (await db.execute(select(DocumentImage))).scalars().all() == []

    async def test_exactly_the_cap_is_accepted(self, client, env):
        data = PNG + b"\x00" * (MAX_DOCUMENT_IMAGE_BYTES - len(PNG))
        body = await _uploaded(client, env["adr_editor"], data=data)
        assert body["size"] == MAX_DOCUMENT_IMAGE_BYTES

    async def test_an_unknown_kind_is_not_a_route(self, client, env):
        resp = await _upload(client, env["admin"], "pdf")
        assert resp.status_code == 422


class TestFetch:
    async def test_headers(self, client, env):
        body = await _uploaded(client, env["adr_editor"])
        resp = await client.get(body["src"], headers=auth_headers(env["adr_reader"]))
        assert resp.status_code == 200
        assert resp.headers["x-content-type-options"] == "nosniff"
        assert resp.headers["cache-control"] == "private, max-age=86400"
        assert "content-disposition" not in resp.headers

    async def test_view_is_checked_before_any_lookup(self, client, env):
        body = await _uploaded(client, env["adr_editor"])
        nobody = auth_headers(env["nobody"])
        # The same 403 for a real picture and an unknown one: nothing is confirmed.
        assert (await client.get(body["src"], headers=nobody)).status_code == 403
        missing = await client.get(f"{URL}/adr/{uuid.uuid4()}", headers=nobody)
        assert missing.status_code == 403
        # A SoAW editor may not read decision pictures.
        resp = await client.get(body["src"], headers=auth_headers(env["soaw_editor"]))
        assert resp.status_code == 403

    async def test_wrong_kind_unknown_or_malformed_id_is_404(self, client, env):
        body = await _uploaded(client, env["adr_editor"])
        admin = auth_headers(env["admin"])
        for path in (
            f"{URL}/soaw/{body['id']}",
            f"{URL}/adr/{uuid.uuid4()}",
            f"{URL}/adr/not-a-uuid",
        ):
            resp = await client.get(path, headers=admin)
            assert resp.status_code == 404, path
            assert resp.json()["detail"] == "Picture not found"
        assert (await client.get(f"{URL}/pdf/{body['id']}", headers=admin)).status_code == 422

    async def test_anonymous_is_refused(self, client, env):
        body = await _uploaded(client, env["adr_editor"])
        assert (await client.get(body["src"])).status_code == 401
