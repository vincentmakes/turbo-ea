"""The workspace-import upload writes the bundle to disk without buffering it.

A bundle can be 2 GB. ``await file.read()`` would put all of it on the heap —
twice, counting the copy handed to ``write_bytes`` — on a backend that runs as
a single process. These tests pin the streaming behaviour and the cap.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.api.v1 import workspace as workspace_api
from app.models.workspace_transfer import WorkspaceTransfer
from tests.conftest import auth_headers, create_role, create_user


async def _noop_job(*args, **kwargs):
    """The preview job opens its own session, outside the test's savepoint."""
    return None


@pytest.fixture
async def transfer_env(db, tmp_path, monkeypatch):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    monkeypatch.setattr(workspace_api, "_BUNDLE_DIR", tmp_path)
    monkeypatch.setattr(workspace_api, "_preview_job", _noop_job)
    return {"admin": admin, "dir": tmp_path}


class TestUploadSpooling:
    async def test_the_uploaded_bundle_lands_on_disk_byte_for_byte(self, client, db, transfer_env):
        """1.5 MiB is past Starlette's in-memory spool threshold.

        So ``file.file`` is a real temporary file here and the handler's copy
        is the disk-to-disk path a large bundle actually takes.
        """
        payload = b"PK\x03\x04" + bytes(range(256)) * 6144  # ~1.5 MiB
        resp = await client.post(
            "/api/v1/admin/workspace/import",
            files={"file": ("workspace.zip", payload, "application/zip")},
            headers=auth_headers(transfer_env["admin"]),
        )
        assert resp.status_code == 202
        body = resp.json()
        assert body["status"] == "parsing"

        stored = transfer_env["dir"] / f"{body['id']}.bin"
        assert stored.read_bytes() == payload

        row = (
            await db.execute(select(WorkspaceTransfer).where(WorkspaceTransfer.id == body["id"]))
        ).scalar_one()
        assert row.file_size == len(payload)

    async def test_a_bundle_over_the_cap_is_refused_and_leaves_nothing_behind(
        self, client, db, transfer_env, monkeypatch
    ):
        """The copy stops at the limit rather than filling the disk first."""
        monkeypatch.setattr(workspace_api, "MAX_BUNDLE_BYTES", 1024)
        resp = await client.post(
            "/api/v1/admin/workspace/import",
            files={"file": ("workspace.zip", b"x" * 4096, "application/zip")},
            headers=auth_headers(transfer_env["admin"]),
        )
        assert resp.status_code == 413

        assert list(transfer_env["dir"].glob("*.bin")) == []
        rows = (await db.execute(select(WorkspaceTransfer))).scalars().all()
        assert rows == []

    async def test_an_empty_upload_is_refused(self, client, db, transfer_env):
        resp = await client.post(
            "/api/v1/admin/workspace/import",
            files={"file": ("workspace.zip", b"", "application/zip")},
            headers=auth_headers(transfer_env["admin"]),
        )
        assert resp.status_code == 400
        assert list(transfer_env["dir"].glob("*.bin")) == []

    async def test_a_user_without_the_permission_cannot_upload(
        self, client, db, tmp_path, monkeypatch
    ):
        from app.core.permissions import VIEWER_PERMISSIONS

        await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
        viewer = await create_user(db, email="viewer@test.com", role="viewer")
        monkeypatch.setattr(workspace_api, "_BUNDLE_DIR", tmp_path)

        resp = await client.post(
            "/api/v1/admin/workspace/import",
            files={"file": ("workspace.zip", b"PK\x03\x04data", "application/zip")},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403
        # Nothing is written before the permission check.
        assert list(tmp_path.glob("*.bin")) == []


class TestSpoolHelper:
    """The copy itself, without the HTTP layer."""

    def test_it_copies_in_chunks_and_reports_the_size(self, tmp_path):
        import io

        src = io.BytesIO(b"a" * 9000)
        dest = tmp_path / "out.bin"
        written = workspace_api._spool_upload_to_disk(src, dest, limit=1_000_000)
        assert written == 9000
        assert dest.read_bytes() == b"a" * 9000

    def test_it_removes_the_partial_file_when_the_limit_is_hit(self, tmp_path):
        import io

        src = io.BytesIO(b"a" * 9000)
        dest = tmp_path / "out.bin"
        with pytest.raises(workspace_api._BundleTooLargeError):
            workspace_api._spool_upload_to_disk(src, dest, limit=100)
        assert not dest.exists()
