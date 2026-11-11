"""Files on a decision over the API.

``GET /adr/{id}/files`` and the download need ``adr.view``; upload and delete
need ``adr.manage`` and a draft decision; an upload also needs file uploads
switched on, a delete does not (like a card attachment's delete). A
revision shares its parent's bytes, so deleting a file on the draft revision
leaves the signed one's file downloadable.
"""

from __future__ import annotations

from urllib.parse import quote

import pytest
from sqlalchemy import event as sa_event
from sqlalchemy import func, select
from sqlalchemy.engine import Engine

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.architecture_decision_file import (
    ArchitectureDecisionFile,
    ArchitectureDecisionFileContent,
)
from app.services.attachment_validation import MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB
from tests.conftest import auth_headers, create_role, create_user

URL = "/api/v1/adr"
PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\ncontent\n"
PDF2 = b"%PDF-1.4\n%second\n"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_role(db, key="blind", label="Blind", permissions={"adr.manage": True})
    return {
        "admin": await create_user(db, email="admin@test.com", role="admin", display_name="Ann"),
        "member": await create_user(db, email="member@test.com", role="member"),
        "viewer": await create_user(db, email="viewer@test.com", role="viewer"),
        "blind": await create_user(db, email="blind@test.com", role="blind"),
    }


@pytest.fixture
def sql_capture():
    statements: list[str] = []

    def _capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    sa_event.listen(Engine, "before_cursor_execute", _capture)
    yield statements
    sa_event.remove(Engine, "before_cursor_execute", _capture)


async def _create(client, user, title="Decision") -> dict:
    resp = await client.post(URL, json={"title": title}, headers=auth_headers(user))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _upload(client, user, adr_id, name="plan.pdf", data=PDF):
    return await client.post(
        f"{URL}/{adr_id}/files",
        files={"file": (name, data, "application/octet-stream")},
        headers=auth_headers(user),
    )


async def _sign(client, admin, adr_id) -> dict:
    resp = await client.post(
        f"{URL}/{adr_id}/request-signatures",
        json={"user_ids": [str(admin.id)]},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200, resp.text
    resp = await client.post(f"{URL}/{adr_id}/sign", headers=auth_headers(admin))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _count(db, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def _disable_uploads(client, admin):
    resp = await client.patch(
        "/api/v1/settings/file-uploads-enabled",
        json={"enabled": False},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200


class TestRoundTrip:
    async def test_upload_list_download(self, client, env):
        admin = env["admin"]
        adr = await _create(client, admin)

        resp = await _upload(client, admin, adr["id"], "plan.pdf")
        assert resp.status_code == 201, resp.text
        row = resp.json()
        assert set(row) == {"id", "name", "mime_type", "size", "created_at", "created_by"}
        assert row["name"] == "plan.pdf"
        # The canonical MIME from the extension, never the browser's string.
        assert row["mime_type"] == "application/pdf"
        assert row["size"] == len(PDF)
        assert row["created_by"] == {"user_id": str(admin.id), "display_name": "Ann"}
        assert row["created_at"]

        listed = await client.get(f"{URL}/{adr['id']}/files", headers=auth_headers(env["viewer"]))
        assert listed.status_code == 200
        assert listed.json() == [row]

        detail = await client.get(f"{URL}/{adr['id']}", headers=auth_headers(env["viewer"]))
        assert detail.json()["files"] == [row]

        down = await client.get(
            f"{URL}/{adr['id']}/files/{row['id']}/download", headers=auth_headers(env["viewer"])
        )
        assert down.status_code == 200
        assert down.content == PDF
        assert down.headers["content-type"] == "application/pdf"
        assert down.headers["content-disposition"] == (
            "attachment; filename=\"plan.pdf\"; filename*=UTF-8''plan.pdf"
        )

    async def test_a_non_latin1_name_downloads(self, client, env):
        admin = env["admin"]
        adr = await _create(client, admin)
        name = "отчёт 报告.pdf"
        row = (await _upload(client, admin, adr["id"], name)).json()

        down = await client.get(
            f"{URL}/{adr['id']}/files/{row['id']}/download", headers=auth_headers(admin)
        )
        assert down.status_code == 200
        assert down.headers["content-disposition"].endswith(
            f"filename*=UTF-8''{quote(name, safe='')}"
        )

    async def test_an_unknown_or_foreign_file_is_404(self, client, env):
        admin = env["admin"]
        a = await _create(client, admin, "A")
        b = await _create(client, admin, "B")
        row = (await _upload(client, admin, a["id"])).json()

        for path in (
            f"{URL}/{b['id']}/files/{row['id']}/download",
            f"{URL}/{a['id']}/files/not-a-uuid/download",
        ):
            resp = await client.get(path, headers=auth_headers(admin))
            assert resp.status_code == 404
            assert resp.json()["detail"] == "File not found"
        resp = await client.delete(
            f"{URL}/{b['id']}/files/{row['id']}", headers=auth_headers(admin)
        )
        assert resp.status_code == 404

    async def test_the_list_never_selects_the_bytes(self, client, env, sql_capture):
        admin = env["admin"]
        adr = await _create(client, admin)
        await _upload(client, admin, adr["id"])
        sql_capture.clear()

        await client.get(f"{URL}/{adr['id']}/files", headers=auth_headers(admin))
        await client.get(f"{URL}/{adr['id']}", headers=auth_headers(admin))

        assert sql_capture, "the capture saw no query"
        assert not [s for s in sql_capture if "architecture_decision_file_contents.data" in s]


class TestRejectedInput:
    async def test_bytes_that_do_not_match_the_extension(self, client, env, db):
        adr = await _create(client, env["admin"])
        resp = await _upload(client, env["admin"], adr["id"], "plan.pdf", b"MZ\x90\x00binary")
        assert resp.status_code == 400
        assert await _count(db, ArchitectureDecisionFile) == 0

    async def test_an_unknown_extension(self, client, env):
        adr = await _create(client, env["admin"])
        resp = await _upload(client, env["admin"], adr["id"], "tool.exe", b"MZ")
        assert resp.status_code == 400

    async def test_over_the_cap(self, client, env, db):
        adr = await _create(client, env["admin"])
        oversized = PDF + b"\x00" * (MAX_ATTACHMENT_BYTES - len(PDF) + 1)
        resp = await _upload(client, env["admin"], adr["id"], "huge.pdf", oversized)
        assert resp.status_code == 400
        assert resp.json()["detail"] == f"File exceeds maximum size of {MAX_ATTACHMENT_MB} MB"
        assert await _count(db, ArchitectureDecisionFileContent) == 0

    async def test_uploads_disabled(self, client, env, db):
        admin = env["admin"]
        adr = await _create(client, admin)
        row = (await _upload(client, admin, adr["id"])).json()
        await _disable_uploads(client, admin)

        resp = await _upload(client, admin, adr["id"], "second.pdf", PDF2)
        assert resp.status_code == 403
        assert resp.json()["detail"] == "File uploads are disabled by the administrator"
        assert await _count(db, ArchitectureDecisionFile) == 1
        # Reading still works.
        down = await client.get(
            f"{URL}/{adr['id']}/files/{row['id']}/download", headers=auth_headers(admin)
        )
        assert down.status_code == 200

    async def test_a_file_can_be_removed_while_uploads_are_disabled(self, client, env, db):
        admin = env["admin"]
        adr = await _create(client, admin)
        row = (await _upload(client, admin, adr["id"])).json()
        await _disable_uploads(client, admin)

        resp = await client.delete(
            f"{URL}/{adr['id']}/files/{row['id']}", headers=auth_headers(admin)
        )
        assert resp.status_code == 204
        assert await _count(db, ArchitectureDecisionFile) == 0
        assert await _count(db, ArchitectureDecisionFileContent) == 0
        listed = await client.get(f"{URL}/{adr['id']}/files", headers=auth_headers(admin))
        assert listed.json() == []


class TestPermissions:
    async def test_upload_and_delete_need_adr_manage(self, client, env):
        adr = await _create(client, env["admin"])
        row = (await _upload(client, env["admin"], adr["id"])).json()

        assert (await _upload(client, env["viewer"], adr["id"])).status_code == 403
        resp = await client.delete(
            f"{URL}/{adr['id']}/files/{row['id']}", headers=auth_headers(env["viewer"])
        )
        assert resp.status_code == 403
        # A member holds adr.manage.
        assert (await _upload(client, env["member"], adr["id"], "m.pdf")).status_code == 201

    async def test_reading_needs_adr_view(self, client, env):
        adr = await _create(client, env["admin"])
        row = (await _upload(client, env["admin"], adr["id"])).json()
        headers = auth_headers(env["blind"])

        assert (await client.get(f"{URL}/{adr['id']}/files", headers=headers)).status_code == 403
        resp = await client.get(f"{URL}/{adr['id']}/files/{row['id']}/download", headers=headers)
        assert resp.status_code == 403

    async def test_a_decision_in_review_is_locked(self, client, env):
        admin = env["admin"]
        adr = await _create(client, admin)
        row = (await _upload(client, admin, adr["id"])).json()
        resp = await client.post(
            f"{URL}/{adr['id']}/request-signatures",
            json={"user_ids": [str(admin.id)]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        resp = await _upload(client, admin, adr["id"], "late.pdf", PDF2)
        assert resp.status_code == 403
        assert resp.json()["detail"] == (
            "Cannot edit a decision in review. Recall the signatures to edit it."
        )
        resp = await client.delete(
            f"{URL}/{adr['id']}/files/{row['id']}", headers=auth_headers(admin)
        )
        assert resp.status_code == 403

    async def test_a_signed_decision_is_locked(self, client, env):
        admin = env["admin"]
        adr = await _create(client, admin)
        row = (await _upload(client, admin, adr["id"])).json()
        await _sign(client, admin, adr["id"])

        resp = await _upload(client, admin, adr["id"], "late.pdf", PDF2)
        assert resp.status_code == 403
        assert resp.json()["detail"] == (
            "Cannot edit a signed decision. Create a new revision instead."
        )
        resp = await client.delete(
            f"{URL}/{adr['id']}/files/{row['id']}", headers=auth_headers(admin)
        )
        assert resp.status_code == 403

    async def test_unknown_decision_is_404(self, client, env):
        missing = "00000000-0000-0000-0000-000000000001"
        resp = await client.get(f"{URL}/{missing}/files", headers=auth_headers(env["admin"]))
        assert resp.status_code == 404
        assert (await _upload(client, env["admin"], missing)).status_code == 404


class TestRevisionsShareBytes:
    async def test_revision_shares_and_survives_a_delete_on_the_draft(self, client, env, db):
        admin = env["admin"]
        adr = await _create(client, admin)
        row = (await _upload(client, admin, adr["id"])).json()
        await _sign(client, admin, adr["id"])

        resp = await client.post(f"{URL}/{adr['id']}/revise", headers=auth_headers(admin))
        assert resp.status_code == 200, resp.text
        revision = resp.json()
        assert len(revision["files"]) == 1
        copy = revision["files"][0]
        assert copy["id"] != row["id"]
        assert copy["name"] == row["name"]
        assert copy["size"] == row["size"]
        assert await _count(db, ArchitectureDecisionFileContent) == 1
        assert await _count(db, ArchitectureDecisionFile) == 2

        resp = await client.delete(
            f"{URL}/{revision['id']}/files/{copy['id']}", headers=auth_headers(admin)
        )
        assert resp.status_code == 204
        assert await _count(db, ArchitectureDecisionFileContent) == 1
        assert await _count(db, ArchitectureDecisionFile) == 1
        down = await client.get(
            f"{URL}/{adr['id']}/files/{row['id']}/download", headers=auth_headers(admin)
        )
        assert down.status_code == 200
        assert down.content == PDF

    async def test_deleting_the_last_pointer_removes_the_content(self, client, env, db):
        admin = env["admin"]
        adr = await _create(client, admin)
        row = (await _upload(client, admin, adr["id"])).json()

        resp = await client.delete(
            f"{URL}/{adr['id']}/files/{row['id']}", headers=auth_headers(admin)
        )
        assert resp.status_code == 204
        assert await _count(db, ArchitectureDecisionFileContent) == 0
        listed = await client.get(f"{URL}/{adr['id']}/files", headers=auth_headers(admin))
        assert listed.json() == []

    async def test_deleting_a_draft_cleans_its_own_bytes_and_keeps_shared_ones(
        self, client, env, db
    ):
        admin = env["admin"]
        adr = await _create(client, admin)
        await _upload(client, admin, adr["id"], "shared.pdf")
        await _sign(client, admin, adr["id"])
        revision = (
            await client.post(f"{URL}/{adr['id']}/revise", headers=auth_headers(admin))
        ).json()
        await _upload(client, admin, revision["id"], "own.pdf", PDF2)
        assert await _count(db, ArchitectureDecisionFileContent) == 2

        resp = await client.delete(f"{URL}/{revision['id']}", headers=auth_headers(admin))
        assert resp.status_code == 204

        assert await _count(db, ArchitectureDecisionFile) == 1
        sizes = list((await db.execute(select(ArchitectureDecisionFileContent.size))).scalars())
        assert sizes == [len(PDF)]
