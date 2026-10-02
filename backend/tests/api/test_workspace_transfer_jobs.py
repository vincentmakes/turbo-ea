"""The workspace-transfer routes end to end, background jobs included.

``POST /admin/workspace/import`` schedules ``_preview_job`` and
``POST …/apply`` schedules ``_apply_job``; under httpx's ``ASGITransport``
a ``BackgroundTasks`` task runs before the response is returned, so the
transfer's state is final by the time the test reads it back. The jobs
open their own session, which ``patched_async_session`` points at the
test's. ``test_workspace_transfer_upload.py`` covers the upload spooling
itself; this file covers what happens after the bytes land.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from sqlalchemy import select

import app.api.v1.workspace as workspace_api
from app.core.permissions import VIEWER_PERMISSIONS
from app.models.workspace_transfer import WorkspaceTransfer
from app.services.workspace_io import build_bundle
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)

IMPORT = "/api/v1/admin/workspace/import"


@pytest.fixture
async def env(db, tmp_path, monkeypatch, patched_async_session):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    await create_card_type(db, key="Application", label="Application", built_in=True)
    await create_card(db, card_type="Application", name="Salesforce", user_id=admin.id)
    monkeypatch.setattr(workspace_api, "_BUNDLE_DIR", tmp_path)
    # The jobs roll the session back on failure, which would discard
    # anything still only flushed — make the fixture rows durable first.
    await db.commit()
    bundle = await build_bundle(db)
    return {"admin": admin, "viewer": viewer, "bundle": bundle, "dir": tmp_path}


async def _upload(client, user, data: bytes, name="workspace.zip"):
    return await client.post(
        IMPORT, files={"file": (name, data, "application/zip")}, headers=auth_headers(user)
    )


async def _row(db, transfer_id) -> WorkspaceTransfer:
    """Re-read the transfer, overwriting whatever the identity map holds —
    the job updated the row through the same session object."""
    return (
        await db.execute(
            select(WorkspaceTransfer)
            .where(WorkspaceTransfer.id == uuid.UUID(transfer_id))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


class TestPreviewJob:
    async def test_upload_runs_the_preview_and_stores_the_diff(self, client, db, env):
        resp = await _upload(client, env["admin"], env["bundle"])
        assert resp.status_code == 202
        body = resp.json()
        assert body["status"] == "parsing"  # what the request itself returned

        shown = await client.get(f"{IMPORT}/{body['id']}", headers=auth_headers(env["admin"]))
        assert shown.status_code == 200
        out = shown.json()
        assert out["status"] == "previewed"
        assert out["format_version"] == workspace_api.FORMAT_VERSION
        assert out["source_app_version"]
        assert out["diff"]["sections"]
        assert out["previewed_at"] and out["error_message"] is None

    async def test_unsupported_format_version_fails_the_transfer(
        self, client, db, env, monkeypatch
    ):
        monkeypatch.setattr(workspace_api, "FORMAT_VERSION", "999")
        resp = await _upload(client, env["admin"], env["bundle"])
        row = await _row(db, resp.json()["id"])
        assert row.status == "failed"
        assert "Unsupported bundle format" in row.error_message
        assert "'999'" in row.error_message

    async def test_a_file_that_is_not_a_bundle_fails_with_the_format_error(self, client, db, env):
        resp = await _upload(client, env["admin"], b"definitely not a zip archive")
        row = await _row(db, resp.json()["id"])
        assert row.status == "failed"
        assert "not a valid .zip" in row.error_message

    async def test_a_crash_while_diffing_rolls_back_and_fails(self, client, db, env, monkeypatch):
        async def boom(db_, bundle, user):
            raise RuntimeError("diff exploded")

        monkeypatch.setattr(workspace_api, "diff_bundle", boom)
        resp = await _upload(client, env["admin"], env["bundle"])
        row = await _row(db, resp.json()["id"])
        assert row.status == "failed"
        assert row.error_message == "diff exploded"
        assert not row.diff

    async def test_an_unknown_transfer_is_ignored(self, env):
        await workspace_api._preview_job(str(uuid.uuid4()), str(env["admin"].id))

    async def test_a_vanished_user_fails_the_transfer(self, client, db, env, monkeypatch):
        preview_job = workspace_api._preview_job
        monkeypatch.setattr(workspace_api, "_preview_job", _noop)
        resp = await _upload(client, env["admin"], env["bundle"])
        transfer_id = resp.json()["id"]

        await preview_job(transfer_id, str(uuid.uuid4()))

        row = await _row(db, transfer_id)
        assert row.status == "failed"
        assert row.error_message == "Preview user or uploaded bundle no longer exists"


class TestApplyJob:
    async def _previewed(self, client, env) -> str:
        resp = await _upload(client, env["admin"], env["bundle"])
        return resp.json()["id"]

    async def test_apply_runs_the_import_and_records_the_result(self, client, db, env):
        transfer_id = await self._previewed(client, env)

        resp = await client.post(
            f"{IMPORT}/{transfer_id}/apply", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 202
        assert resp.json()["status"] == "applying"

        row = await _row(db, transfer_id)
        assert row.status == "applied"
        assert row.applied_at is not None and row.error_message is None
        assert row.result["sections"] and row.result["dry_run"] is False
        # Re-importing the instance's own export is a no-op: nothing failed.
        assert row.result["totals"]["failed"] == 0

    async def test_apply_is_refused_while_the_preview_is_running(
        self, client, db, env, monkeypatch
    ):
        monkeypatch.setattr(workspace_api, "_preview_job", _noop)
        transfer_id = (await _upload(client, env["admin"], env["bundle"])).json()["id"]

        resp = await client.post(
            f"{IMPORT}/{transfer_id}/apply", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 400
        assert "'parsing'" in resp.json()["detail"]

    async def test_a_section_failure_marks_the_transfer_failed(self, client, db, env, monkeypatch):
        transfer_id = await self._previewed(client, env)

        async def boom(db_, bundle, user):
            raise RuntimeError("apply exploded")

        monkeypatch.setattr(workspace_api, "apply_bundle", boom)
        await client.post(f"{IMPORT}/{transfer_id}/apply", headers=auth_headers(env["admin"]))

        row = await _row(db, transfer_id)
        assert row.status == "failed" and row.error_message == "apply exploded"

    async def test_a_missing_bundle_file_fails_the_apply(self, client, db, env):
        transfer_id = await self._previewed(client, env)
        row = await _row(db, transfer_id)
        Path(row.storage_path).unlink()

        await client.post(f"{IMPORT}/{transfer_id}/apply", headers=auth_headers(env["admin"]))

        row = await _row(db, transfer_id)
        assert row.status == "failed" and row.error_message

    async def test_a_vanished_user_fails_the_apply(self, client, db, env):
        transfer_id = await self._previewed(client, env)

        await workspace_api._apply_job(transfer_id, str(uuid.uuid4()))

        row = await _row(db, transfer_id)
        assert row.status == "failed"
        assert row.error_message == "Apply user or uploaded bundle no longer exists"

    async def test_fail_on_an_unknown_transfer_is_a_no_op(self, env):
        await workspace_api._fail(str(uuid.uuid4()), "nothing to mark")


class TestRoutes:
    async def test_export_streams_a_zip_attachment(self, client, db, env):
        resp = await client.get(
            "/api/v1/admin/workspace/export?include_archived=true",
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/zip"
        assert resp.headers["content-disposition"].startswith(
            'attachment; filename="workspace_export_'
        )
        assert resp.content[:2] == b"PK"

    async def test_get_unknown_transfer_is_404(self, client, db, env):
        resp = await client.get(f"{IMPORT}/{uuid.uuid4()}", headers=auth_headers(env["admin"]))
        assert resp.status_code == 404

    async def test_delete_removes_the_row_and_the_file(self, client, db, env):
        transfer_id = (await _upload(client, env["admin"], env["bundle"])).json()["id"]
        path = Path((await _row(db, transfer_id)).storage_path)
        assert path.exists()

        resp = await client.delete(f"{IMPORT}/{transfer_id}", headers=auth_headers(env["admin"]))
        assert resp.status_code == 204
        assert not path.exists()
        assert (
            await db.execute(
                select(WorkspaceTransfer.id).where(WorkspaceTransfer.id == uuid.UUID(transfer_id))
            )
        ).scalar_one_or_none() is None

    async def test_delete_tolerates_a_file_already_gone(self, client, db, env):
        transfer_id = (await _upload(client, env["admin"], env["bundle"])).json()["id"]
        Path((await _row(db, transfer_id)).storage_path).unlink()
        resp = await client.delete(f"{IMPORT}/{transfer_id}", headers=auth_headers(env["admin"]))
        assert resp.status_code == 204

    async def test_viewer_is_refused_everywhere(self, client, db, env):
        transfer_id = (await _upload(client, env["admin"], env["bundle"])).json()["id"]
        h = auth_headers(env["viewer"])
        assert (await client.get("/api/v1/admin/workspace/export", headers=h)).status_code == 403
        assert (await _upload(client, env["viewer"], env["bundle"])).status_code == 403
        assert (await client.get(f"{IMPORT}/{transfer_id}", headers=h)).status_code == 403
        assert (await client.post(f"{IMPORT}/{transfer_id}/apply", headers=h)).status_code == 403
        assert (await client.delete(f"{IMPORT}/{transfer_id}", headers=h)).status_code == 403


async def _noop(*args, **kwargs):
    return None
