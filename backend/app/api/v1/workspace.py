"""Full-workspace export / import (Admin → Workspace Transfer).

``GET  /admin/workspace/export``           — stream the workspace bundle (.zip)
``POST /admin/workspace/import``           — upload a bundle, background dry-run
``GET  /admin/workspace/import/{id}``      — poll status + diff/result
``POST /admin/workspace/import/{id}/apply``— background apply
``DELETE /admin/workspace/import/{id}``    — discard

The export strips all secrets server-side. The import shows a dry-run preview
before anything is written and upserts idempotently. Both routes are gated by
dedicated ``admin.export_workspace`` / ``admin.import_workspace`` permissions.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import async_session, get_db
from app.models.user import User
from app.models.workspace_transfer import WorkspaceTransfer
from app.services.permission_service import PermissionService
from app.services.workspace_io import (
    apply_bundle,
    build_bundle,
    diff_bundle,
    parse_bundle,
)
from app.services.workspace_io.bundle import BundleFormatError
from app.services.workspace_io.schema import FORMAT_VERSION

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/workspace", tags=["Workspace Transfer"])

_BUNDLE_DIR = Path("data/workspace_transfers")


class WorkspaceTransferOut(BaseModel):
    id: str
    filename: str
    status: str
    format_version: str | None = None
    source_app_version: str | None = None
    source_url: str | None = None
    diff: dict | None = None
    result: dict | None = None
    error_message: str | None = None
    created_at: datetime | None = None
    previewed_at: datetime | None = None
    applied_at: datetime | None = None


def _to_out(t: WorkspaceTransfer) -> WorkspaceTransferOut:
    return WorkspaceTransferOut(
        id=str(t.id),
        filename=t.filename,
        status=t.status,
        format_version=t.format_version,
        source_app_version=t.source_app_version,
        source_url=t.source_url,
        diff=t.diff or None,
        result=t.result or None,
        error_message=t.error_message,
        created_at=t.created_at,
        previewed_at=t.previewed_at,
        applied_at=t.applied_at,
    )


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


@router.get("/export")
async def export_workspace(
    include_archived: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.export_workspace")
    data = await build_bundle(db, include_archived=include_archived)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M")
    filename = f"workspace_export_{ts}.zip"
    return StreamingResponse(
        iter([data]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Import — upload + background dry-run preview
# ---------------------------------------------------------------------------


@router.post("/import", response_model=WorkspaceTransferOut, status_code=202)
async def upload_workspace(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkspaceTransferOut:
    await PermissionService.require_permission(db, user, "admin.import_workspace")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty bundle file")

    _BUNDLE_DIR.mkdir(parents=True, exist_ok=True)
    transfer_id = uuid.uuid4()
    storage_path = _BUNDLE_DIR / f"{transfer_id}.bin"
    storage_path.write_bytes(raw)

    transfer = WorkspaceTransfer(
        id=transfer_id,
        filename=file.filename or "workspace.zip",
        file_size=len(raw),
        storage_path=str(storage_path),
        status="parsing",
        created_by=user.id,
    )
    db.add(transfer)
    await db.commit()
    await db.refresh(transfer)

    background_tasks.add_task(_preview_job, str(transfer.id), str(user.id))
    return _to_out(transfer)


@router.get("/import/{transfer_id}", response_model=WorkspaceTransferOut)
async def get_workspace_transfer(
    transfer_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkspaceTransferOut:
    await PermissionService.require_permission(db, user, "admin.import_workspace")
    transfer = await _load(db, transfer_id)
    return _to_out(transfer)


@router.post("/import/{transfer_id}/apply", response_model=WorkspaceTransferOut, status_code=202)
async def apply_workspace_transfer(
    transfer_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkspaceTransferOut:
    await PermissionService.require_permission(db, user, "admin.import_workspace")
    transfer = await _load(db, transfer_id)
    if transfer.status not in {"previewed", "failed", "applied"}:
        raise HTTPException(
            status_code=400, detail=f"Cannot apply transfer in status {transfer.status!r}"
        )
    transfer.status = "applying"
    await db.commit()
    await db.refresh(transfer)
    background_tasks.add_task(_apply_job, str(transfer.id), str(user.id))
    return _to_out(transfer)


@router.delete("/import/{transfer_id}", status_code=204)
async def delete_workspace_transfer(
    transfer_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    await PermissionService.require_permission(db, user, "admin.import_workspace")
    transfer = await _load(db, transfer_id)
    if transfer.storage_path:
        try:
            Path(transfer.storage_path).unlink(missing_ok=True)
        except OSError:
            logger.warning("Could not delete bundle file %s", transfer.storage_path)
    await db.delete(transfer)
    await db.commit()


async def _load(db: AsyncSession, transfer_id: uuid.UUID) -> WorkspaceTransfer:
    transfer = (
        await db.execute(select(WorkspaceTransfer).where(WorkspaceTransfer.id == transfer_id))
    ).scalar_one_or_none()
    if transfer is None:
        raise HTTPException(status_code=404, detail="Workspace transfer not found")
    return transfer


# ---------------------------------------------------------------------------
# Background jobs
# ---------------------------------------------------------------------------


async def _preview_job(transfer_id_str: str, user_id_str: str) -> None:
    async with async_session() as db:
        transfer = (
            await db.execute(
                select(WorkspaceTransfer).where(WorkspaceTransfer.id == uuid.UUID(transfer_id_str))
            )
        ).scalar_one_or_none()
        if transfer is None:
            return
        user = (
            await db.execute(select(User).where(User.id == uuid.UUID(user_id_str)))
        ).scalar_one_or_none()
        if user is None or not transfer.storage_path:
            transfer.status = "failed"
            transfer.error_message = "Preview user or uploaded bundle no longer exists"
            await db.commit()
            return
        try:
            raw = Path(transfer.storage_path).read_bytes()
            bundle = parse_bundle(raw)
            transfer.format_version = bundle.format_version
            transfer.source_app_version = bundle.manifest.get("app_version")
            transfer.source_url = bundle.manifest.get("source_url")
            if bundle.format_version != FORMAT_VERSION:
                transfer.status = "failed"
                transfer.error_message = (
                    f"Unsupported bundle format {bundle.format_version!r} "
                    f"(expected {FORMAT_VERSION!r})"
                )
                await db.commit()
                return
            result = await diff_bundle(db, bundle, user)
            transfer.diff = result.as_dict()
            transfer.status = "previewed"
            transfer.previewed_at = datetime.now(timezone.utc)
            await db.commit()
        except BundleFormatError as exc:
            await db.rollback()
            await _fail(transfer_id_str, str(exc))
        except Exception as exc:  # noqa: BLE001
            logger.exception("workspace preview job failed")
            await db.rollback()
            await _fail(transfer_id_str, str(exc)[:1000])


async def _apply_job(transfer_id_str: str, user_id_str: str) -> None:
    async with async_session() as db:
        transfer = (
            await db.execute(
                select(WorkspaceTransfer).where(WorkspaceTransfer.id == uuid.UUID(transfer_id_str))
            )
        ).scalar_one_or_none()
        if transfer is None:
            return
        user = (
            await db.execute(select(User).where(User.id == uuid.UUID(user_id_str)))
        ).scalar_one_or_none()
        if user is None or not transfer.storage_path:
            transfer.status = "failed"
            transfer.error_message = "Apply user or uploaded bundle no longer exists"
            await db.commit()
            return
        try:
            raw = Path(transfer.storage_path).read_bytes()
            bundle = parse_bundle(raw)
            result = await apply_bundle(db, bundle, user)
            transfer.result = result.as_dict()
            transfer.status = "applied" if result.total_failed == 0 else "failed"
            transfer.applied_at = datetime.now(timezone.utc)
            if result.total_failed:
                transfer.error_message = f"{result.total_failed} section error(s) — see result"
            await db.commit()
        except Exception as exc:  # noqa: BLE001
            logger.exception("workspace apply job failed")
            await db.rollback()
            await _fail(transfer_id_str, str(exc)[:1000])


async def _fail(transfer_id_str: str, message: str) -> None:
    async with async_session() as db:
        transfer = (
            await db.execute(
                select(WorkspaceTransfer).where(WorkspaceTransfer.id == uuid.UUID(transfer_id_str))
            )
        ).scalar_one_or_none()
        if transfer is not None:
            transfer.status = "failed"
            transfer.error_message = message
            await db.commit()
