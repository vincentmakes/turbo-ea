"""Integration tests for the file-attachment endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import pytest

from app.core.permissions import VIEWER_PERMISSIONS
from app.services.attachment_validation import MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)

# Uploads are validated against their extension, so a payload has to really be
# what its name says. These are the shortest heads that are.
PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\ncontent\n"
PDF2 = b"%PDF-1.4\n%second\n"
TXT = b"plain text content"
OLE2 = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 8
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01"
ZIP = b"PK\x03\x04\x14\x00\x06\x00zipped"


@pytest.fixture
async def file_env(db):
    """Prerequisite data shared by all file-attachment tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="Test Card", user_id=admin.id)
    return {"admin": admin, "viewer": viewer, "card": card}


# -------------------------------------------------------------------
# POST /cards/{card_id}/file-attachments  (upload)
# -------------------------------------------------------------------


class TestUploadFile:
    async def test_admin_can_upload_pdf(self, client, db, file_env):
        admin = file_env["admin"]
        card = file_env["card"]

        resp = await client.post(
            f"/api/v1/cards/{card.id}/file-attachments",
            files={"file": ("test.pdf", PDF, "application/pdf")},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "test.pdf"
        assert data["mime_type"] == "application/pdf"
        assert data["size"] == len(PDF)
        assert "id" in data

    async def test_rejects_disallowed_extension(self, client, db, file_env):
        admin = file_env["admin"]
        card = file_env["card"]

        resp = await client.post(
            f"/api/v1/cards/{card.id}/file-attachments",
            files={"file": ("malware.exe", b"MZ\x90\x00bad", "application/x-msdownload")},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_rejects_a_renamed_executable(self, client, db, file_env):
        """The name says PDF, the bytes say PE binary.

        The declared content type is attacker-controlled, so this is the check
        that actually decides — and the refusal says why, so a user who simply
        mistyped an extension can fix it.
        """
        resp = await client.post(
            f"/api/v1/cards/{file_env['card'].id}/file-attachments",
            files={"file": ("invoice.pdf", b"MZ\x90\x00\x03\x00", "application/pdf")},
            headers=auth_headers(file_env["admin"]),
        )
        assert resp.status_code == 400
        assert "does not match" in resp.json()["detail"]

    async def test_accepts_an_outlook_message_sent_as_octet_stream(self, client, db, file_env):
        """Browsers send application/octet-stream (or nothing) for .msg.

        Under the old MIME allow-list that was an outright refusal, which is
        why Outlook messages could not be attached at all.
        """
        resp = await client.post(
            f"/api/v1/cards/{file_env['card'].id}/file-attachments",
            files={"file": ("thread.msg", OLE2, "application/octet-stream")},
            headers=auth_headers(file_env["admin"]),
        )
        assert resp.status_code == 201
        assert resp.json()["mime_type"] == "application/vnd.ms-outlook"

    async def test_accepts_a_zip_archive(self, client, db, file_env):
        resp = await client.post(
            f"/api/v1/cards/{file_env['card'].id}/file-attachments",
            files={"file": ("evidence.zip", ZIP, "application/x-zip-compressed")},
            headers=auth_headers(file_env["admin"]),
        )
        assert resp.status_code == 201
        # Stored as the canonical type, not the browser's Windows-flavoured one.
        assert resp.json()["mime_type"] == "application/zip"

    async def test_stores_the_canonical_mime_not_the_browser_string(self, client, db, file_env):
        """image/jpg is not a real media type; browsers send it anyway.

        The Resources grid filters on the stored value, so normalising here is
        what keeps one format from splitting into two filter rows.
        """
        resp = await client.post(
            f"/api/v1/cards/{file_env['card'].id}/file-attachments",
            files={"file": ("photo.jpg", JPEG, "image/jpg")},
            headers=auth_headers(file_env["admin"]),
        )
        assert resp.status_code == 201
        assert resp.json()["mime_type"] == "image/jpeg"

    async def test_rejects_a_file_over_the_size_cap(self, client, db, file_env):
        """One byte past the cap, and the message names the limit.

        The edge nginx allows a megabyte more than this precisely so that the
        user sees this 400 rather than its bare 413.
        """
        oversized = PDF + b"\x00" * (MAX_ATTACHMENT_BYTES - len(PDF) + 1)
        resp = await client.post(
            f"/api/v1/cards/{file_env['card'].id}/file-attachments",
            files={"file": ("huge.pdf", oversized, "application/pdf")},
            headers=auth_headers(file_env["admin"]),
        )
        assert resp.status_code == 400
        assert f"{MAX_ATTACHMENT_MB} MB" in resp.json()["detail"]

    async def test_accepts_a_file_at_exactly_the_size_cap(self, client, db, file_env):
        at_limit = PDF + b"\x00" * (MAX_ATTACHMENT_BYTES - len(PDF))
        resp = await client.post(
            f"/api/v1/cards/{file_env['card'].id}/file-attachments",
            files={"file": ("big.pdf", at_limit, "application/pdf")},
            headers=auth_headers(file_env["admin"]),
        )
        assert resp.status_code == 201
        assert resp.json()["size"] == MAX_ATTACHMENT_BYTES

    async def test_rejects_an_empty_file(self, client, db, file_env):
        resp = await client.post(
            f"/api/v1/cards/{file_env['card'].id}/file-attachments",
            files={"file": ("empty.pdf", b"", "application/pdf")},
            headers=auth_headers(file_env["admin"]),
        )
        assert resp.status_code == 400

    async def test_viewer_cannot_upload(self, client, db, file_env):
        viewer = file_env["viewer"]
        card = file_env["card"]

        resp = await client.post(
            f"/api/v1/cards/{card.id}/file-attachments",
            files={"file": ("test.pdf", PDF, "application/pdf")},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_upload_blocked_when_disabled_by_admin(self, client, db, file_env):
        """When the admin toggle is off, POST /file-attachments returns 403."""
        admin = file_env["admin"]
        card = file_env["card"]

        # First upload succeeds (feature defaults to enabled).
        ok_resp = await client.post(
            f"/api/v1/cards/{card.id}/file-attachments",
            files={"file": ("before.pdf", PDF, "application/pdf")},
            headers=auth_headers(admin),
        )
        assert ok_resp.status_code == 201
        existing_id = ok_resp.json()["id"]

        # Admin disables the feature.
        toggle_resp = await client.patch(
            "/api/v1/settings/file-uploads-enabled",
            json={"enabled": False},
            headers=auth_headers(admin),
        )
        assert toggle_resp.status_code == 200

        # Subsequent uploads are rejected.
        blocked_resp = await client.post(
            f"/api/v1/cards/{card.id}/file-attachments",
            files={"file": ("after.pdf", PDF2, "application/pdf")},
            headers=auth_headers(admin),
        )
        assert blocked_resp.status_code == 403
        assert "disabled" in blocked_resp.json()["detail"].lower()

        # Listing existing attachments still works (admins must be able to
        # audit and clean up after disabling).
        list_resp = await client.get(
            f"/api/v1/cards/{card.id}/file-attachments",
            headers=auth_headers(admin),
        )
        assert list_resp.status_code == 200
        assert any(f["id"] == existing_id for f in list_resp.json())

        # Downloading existing attachments still works.
        dl_resp = await client.get(
            f"/api/v1/file-attachments/{existing_id}/download",
            headers=auth_headers(admin),
        )
        assert dl_resp.status_code == 200

        # Deleting existing attachments still works.
        del_resp = await client.delete(
            f"/api/v1/file-attachments/{existing_id}",
            headers=auth_headers(admin),
        )
        assert del_resp.status_code == 204


# -------------------------------------------------------------------
# GET /cards/{card_id}/file-attachments  (list)
# -------------------------------------------------------------------


class TestListFiles:
    async def test_list_returns_uploaded_files(self, client, db, file_env):
        admin = file_env["admin"]
        card = file_env["card"]

        # Upload two files
        await client.post(
            f"/api/v1/cards/{card.id}/file-attachments",
            files={"file": ("a.pdf", PDF, "application/pdf")},
            headers=auth_headers(admin),
        )
        await client.post(
            f"/api/v1/cards/{card.id}/file-attachments",
            files={"file": ("b.txt", TXT, "text/plain")},
            headers=auth_headers(admin),
        )

        resp = await client.get(
            f"/api/v1/cards/{card.id}/file-attachments",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        names = [f["name"] for f in resp.json()]
        assert "a.pdf" in names
        assert "b.txt" in names

    async def test_viewer_can_list(self, client, db, file_env):
        viewer = file_env["viewer"]
        card = file_env["card"]

        resp = await client.get(
            f"/api/v1/cards/{card.id}/file-attachments",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200


# -------------------------------------------------------------------
# GET /file-attachments/{id}/download
# -------------------------------------------------------------------


class TestDownloadFile:
    async def test_admin_can_download(self, client, db, file_env):
        admin = file_env["admin"]
        card = file_env["card"]

        upload_resp = await client.post(
            f"/api/v1/cards/{card.id}/file-attachments",
            files={"file": ("doc.pdf", PDF, "application/pdf")},
            headers=auth_headers(admin),
        )
        attachment_id = upload_resp.json()["id"]

        resp = await client.get(
            f"/api/v1/file-attachments/{attachment_id}/download",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.content == PDF
        assert resp.headers["content-type"] == "application/pdf"
        assert "doc.pdf" in resp.headers.get("content-disposition", "")

    async def test_viewer_can_download(self, client, db, file_env):
        admin = file_env["admin"]
        viewer = file_env["viewer"]
        card = file_env["card"]

        upload_resp = await client.post(
            f"/api/v1/cards/{card.id}/file-attachments",
            files={"file": ("report.txt", TXT, "text/plain")},
            headers=auth_headers(admin),
        )
        attachment_id = upload_resp.json()["id"]

        resp = await client.get(
            f"/api/v1/file-attachments/{attachment_id}/download",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 200

    async def test_download_serves_the_canonical_mime(self, client, db, file_env):
        """What is stored is what is served — and always as an attachment."""
        up = await client.post(
            f"/api/v1/cards/{file_env['card'].id}/file-attachments",
            files={"file": ("export.csv", b"name,owner\nSAP,IT\n", "application/octet-stream")},
            headers=auth_headers(file_env["admin"]),
        )
        assert up.status_code == 201
        resp = await client.get(
            f"/api/v1/file-attachments/{up.json()['id']}/download",
            headers=auth_headers(file_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/csv")
        assert resp.headers["content-disposition"].startswith("attachment;")

    async def test_download_with_non_latin1_filename(self, client, db, file_env):
        # Regression: filenames containing characters outside Latin-1 (Cyrillic,
        # CJK, emoji) must not crash the response serializer with HTTP 500.
        admin = file_env["admin"]
        card = file_env["card"]
        unicode_name = "отчёт 报告 🚀.pdf"

        upload_resp = await client.post(
            f"/api/v1/cards/{card.id}/file-attachments",
            files={"file": (unicode_name, PDF, "application/pdf")},
            headers=auth_headers(admin),
        )
        assert upload_resp.status_code == 201
        attachment_id = upload_resp.json()["id"]

        resp = await client.get(
            f"/api/v1/file-attachments/{attachment_id}/download",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.content == PDF

        from urllib.parse import quote

        disposition = resp.headers.get("content-disposition", "")
        assert 'filename="' in disposition
        assert f"filename*=UTF-8''{quote(unicode_name, safe='')}" in disposition


# -------------------------------------------------------------------
# DELETE /file-attachments/{id}
# -------------------------------------------------------------------


class TestDeleteFile:
    async def test_admin_can_delete(self, client, db, file_env):
        admin = file_env["admin"]
        card = file_env["card"]

        upload_resp = await client.post(
            f"/api/v1/cards/{card.id}/file-attachments",
            files={"file": ("delete_me.pdf", PDF, "application/pdf")},
            headers=auth_headers(admin),
        )
        attachment_id = upload_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/file-attachments/{attachment_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        # Verify it's gone
        get_resp = await client.get(
            f"/api/v1/file-attachments/{attachment_id}/download",
            headers=auth_headers(admin),
        )
        assert get_resp.status_code == 404

    async def test_viewer_cannot_delete(self, client, db, file_env):
        admin = file_env["admin"]
        viewer = file_env["viewer"]
        card = file_env["card"]

        upload_resp = await client.post(
            f"/api/v1/cards/{card.id}/file-attachments",
            files={"file": ("protected.pdf", PDF, "application/pdf")},
            headers=auth_headers(admin),
        )
        attachment_id = upload_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/file-attachments/{attachment_id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403
