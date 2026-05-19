"""LeanIX migration HTTP endpoints.

The admin's view onto the importer: upload a workspace snapshot, see
what would change, apply it, and inspect the result. Mirrors the
ServiceNow REST shape (``app/api/v1/servicenow.py``) — same staging /
preview / apply rhythm, gated by the new ``admin.migrate`` permission.

Phase 1 surface (cards only):

- ``POST /migration/leanix/upload`` — multipart upload, returns the
  migration id, fires a background task to parse the snapshot and
  stage cards.
- ``GET /migration/leanix`` — list past migrations.
- ``GET /migration/leanix/{id}`` — status + stats.
- ``GET /migration/leanix/{id}/preview`` — paginated staged records.
- ``POST /migration/leanix/{id}/apply`` — kick off the apply pipeline
  in the background. 202 with the migration object.
- ``DELETE /migration/leanix/{id}`` — purge a migration that has not
  yet been applied.

The HTTP layer is intentionally thin — every meaningful operation
lives in :mod:`leanix_snapshot_parser`,
:mod:`leanix_migration_service`, and :mod:`leanix_migration_apply` so
the same logic can be exercised from unit tests without spinning up a
FastAPI app.
"""

from __future__ import annotations

import csv
import hashlib
import io
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import async_session, get_db
from app.models.leanix import LeanixMigration, LeanixStagedRecord
from app.models.user import User
from app.services.leanix_migration_apply import apply_migration
from app.services.leanix_migration_service import (
    stage_cards,
    stage_comments,
    stage_documents,
    stage_metamodel,
    stage_relations,
    stage_tags,
    stage_users_and_subscriptions,
)
from app.services.leanix_snapshot_parser import parse_snapshot_path
from app.services.permission_service import PermissionService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/migration/leanix", tags=["Migration"])

# Snapshot binaries live on disk rather than in Postgres so that the
# table stays small and ``DELETE`` is cheap.
_SNAPSHOT_DIR = Path("data/leanix_snapshots")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class MigrationOut(BaseModel):
    id: str
    name: str
    status: str
    file_hash: str
    file_size: int | None
    snapshot_version: str | None
    stats: dict | None
    metamodel_diff: dict | None
    error_message: str | None
    parsed_at: str | None
    applied_at: str | None
    created_at: str | None
    updated_at: str | None


class StagedRecordOut(BaseModel):
    id: str
    entity_kind: str
    leanix_id: str
    card_type_key: str | None
    action: str
    status: str
    diff: dict | None
    error_message: str | None
    target_id: str | None


class PreviewPage(BaseModel):
    items: list[StagedRecordOut]
    total: int
    offset: int
    limit: int


def _migration_to_out(m: LeanixMigration) -> MigrationOut:
    return MigrationOut(
        id=str(m.id),
        name=m.name,
        status=m.status,
        file_hash=m.file_hash,
        file_size=m.file_size,
        snapshot_version=m.snapshot_version,
        stats=m.stats,
        metamodel_diff=m.metamodel_diff,
        error_message=m.error_message,
        parsed_at=m.parsed_at.isoformat() if m.parsed_at else None,
        applied_at=m.applied_at.isoformat() if m.applied_at else None,
        created_at=m.created_at.isoformat() if m.created_at else None,
        updated_at=m.updated_at.isoformat() if m.updated_at else None,
    )


def _staged_to_out(r: LeanixStagedRecord) -> StagedRecordOut:
    return StagedRecordOut(
        id=str(r.id),
        entity_kind=r.entity_kind,
        leanix_id=r.leanix_id,
        card_type_key=r.card_type_key,
        action=r.action,
        status=r.status,
        diff=r.diff,
        error_message=r.error_message,
        target_id=str(r.target_id) if r.target_id else None,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/upload", response_model=MigrationOut, status_code=201)
async def upload_snapshot(
    background_tasks: BackgroundTasks,
    name: str = Form(...),
    file: UploadFile = File(...),
    include_archived: bool = Form(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MigrationOut:
    await PermissionService.require_permission(db, user, "admin.migrate")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty snapshot file")
    file_hash = hashlib.sha256(raw).hexdigest()

    # Reject duplicate uploads — the file hash is the natural idempotency key.
    existing = (
        await db.execute(select(LeanixMigration).where(LeanixMigration.file_hash == file_hash))
    ).scalar_one_or_none()
    if existing is not None:
        return _migration_to_out(existing)

    _SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    migration_id = uuid.uuid4()
    storage_path = _SNAPSHOT_DIR / f"{migration_id}.bin"
    storage_path.write_bytes(raw)

    migration = LeanixMigration(
        id=migration_id,
        name=name,
        file_hash=file_hash,
        file_size=len(raw),
        storage_path=str(storage_path),
        status="uploaded",
        stats={"options": {"include_archived": bool(include_archived)}},
        metamodel_diff={},
        created_by=user.id,
    )
    db.add(migration)
    await db.commit()
    await db.refresh(migration)

    background_tasks.add_task(_parse_and_stage_job, str(migration.id))

    return _migration_to_out(migration)


@router.get("", response_model=list[MigrationOut])
async def list_migrations(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[MigrationOut]:
    await PermissionService.require_permission(db, user, "admin.migrate")
    rows = (
        (
            await db.execute(
                select(LeanixMigration).order_by(LeanixMigration.created_at.desc()).limit(100)
            )
        )
        .scalars()
        .all()
    )
    return [_migration_to_out(r) for r in rows]


@router.get("/{migration_id}", response_model=MigrationOut)
async def get_migration(
    migration_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MigrationOut:
    await PermissionService.require_permission(db, user, "admin.migrate")
    m = await _load_migration(db, migration_id)
    return _migration_to_out(m)


@router.get("/{migration_id}/preview", response_model=PreviewPage)
async def preview_migration(
    migration_id: uuid.UUID,
    entity_kind: str = Query("card", description="card / relation / tag / ..."),
    card_type_key: str | None = Query(None),
    action: str | None = Query(None, description="filter by action: create/update/skip/conflict"),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PreviewPage:
    await PermissionService.require_permission(db, user, "admin.migrate")
    await _load_migration(db, migration_id)
    base = select(LeanixStagedRecord).where(
        LeanixStagedRecord.migration_id == migration_id,
        LeanixStagedRecord.entity_kind == entity_kind,
    )
    if card_type_key is not None:
        base = base.where(LeanixStagedRecord.card_type_key == card_type_key)
    if action is not None:
        base = base.where(LeanixStagedRecord.action == action)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (
        (
            await db.execute(
                base.order_by(LeanixStagedRecord.created_at.asc()).offset(offset).limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return PreviewPage(
        items=[_staged_to_out(r) for r in rows],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.post("/{migration_id}/apply", response_model=MigrationOut, status_code=202)
async def apply_migration_endpoint(
    migration_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MigrationOut:
    await PermissionService.require_permission(db, user, "admin.migrate")
    m = await _load_migration(db, migration_id)
    if m.status not in {"parsed", "previewed"}:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot apply migration in status {m.status!r}",
        )
    m.status = "applying"
    await db.commit()
    # Without an explicit refresh the commit expires every attribute on
    # ``m`` and the trailing ``_migration_to_out(m)`` triggers a sync
    # lazy-load on each one — fatal in an async session
    # (``MissingGreenlet``).
    await db.refresh(m)

    background_tasks.add_task(_apply_job, str(m.id), str(user.id))
    return _migration_to_out(m)


@router.get("/{migration_id}/errors.csv")
async def download_error_report(
    migration_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    """CSV report of every staged row in `error` status for this migration."""
    await PermissionService.require_permission(db, user, "admin.migrate")
    await _load_migration(db, migration_id)
    rows = (
        (
            await db.execute(
                select(LeanixStagedRecord)
                .where(
                    LeanixStagedRecord.migration_id == migration_id,
                    LeanixStagedRecord.status == "error",
                )
                .order_by(
                    LeanixStagedRecord.entity_kind.asc(),
                    LeanixStagedRecord.created_at.asc(),
                )
            )
        )
        .scalars()
        .all()
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["entity_kind", "leanix_id", "card_type_key", "action", "error_message"])
    for r in rows:
        writer.writerow(
            [
                r.entity_kind,
                r.leanix_id,
                r.card_type_key or "",
                r.action,
                (r.error_message or "").replace("\n", " "),
            ]
        )
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="migration-{migration_id}-errors.csv"'
        },
    )


@router.delete("/{migration_id}", status_code=204)
async def delete_migration(
    migration_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    await PermissionService.require_permission(db, user, "admin.migrate")
    m = await _load_migration(db, migration_id)
    if m.status not in {"uploaded", "parsed", "previewed", "failed", "aborted", "applied"}:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete migration in status {m.status!r}",
        )
    if m.storage_path:
        try:
            Path(m.storage_path).unlink(missing_ok=True)
        except OSError:
            logger.exception("Failed to remove snapshot file %s", m.storage_path)
    await db.delete(m)
    await db.commit()


# ---------------------------------------------------------------------------
# Background-task entry points
# ---------------------------------------------------------------------------


async def _parse_and_stage_job(migration_id_str: str) -> None:
    """Parse the snapshot on disk and stage every card from it."""
    async with async_session() as db:
        try:
            m = (
                await db.execute(
                    select(LeanixMigration).where(LeanixMigration.id == uuid.UUID(migration_id_str))
                )
            ).scalar_one_or_none()
            if m is None or m.storage_path is None:
                logger.warning("LeanIX parse job: migration %s missing", migration_id_str)
                return

            snapshot = parse_snapshot_path(m.storage_path)
            m.snapshot_version = snapshot.version
            include_archived = bool(
                ((m.stats or {}).get("options") or {}).get("include_archived", False)
            )
            metamodel_stats = await stage_metamodel(db, m, snapshot)
            card_stats = await stage_cards(db, m, snapshot, include_archived=include_archived)
            relation_stats = await stage_relations(db, m, snapshot)
            tag_stats = await stage_tags(db, m, snapshot)
            user_stats, sub_stats = await stage_users_and_subscriptions(db, m, snapshot)
            document_stats = await stage_documents(db, m, snapshot)
            comment_stats = await stage_comments(db, m, snapshot)
            stats = {
                "metamodel": metamodel_stats,
                "cards": card_stats,
                "relations": relation_stats,
                "tags": tag_stats,
                "users": user_stats,
                "subscriptions": sub_stats,
                "documents": document_stats,
                "comments": comment_stats,
                "parse_errors": len(snapshot.parse_errors),
                "fact_sheets": len(snapshot.fact_sheets),
                "relation_count": len(snapshot.relations),
                "tag_count": len(snapshot.tags),
                "subscription_count": len(snapshot.subscriptions),
                "document_count": len(snapshot.documents),
                "comment_count": len(snapshot.comments),
                # Keep the flat counter for the legacy Phase-1 UI dashboard.
                **card_stats,
            }
            m.stats = {**(m.stats or {}), **stats}
            m.status = "parsed"
            m.parsed_at = datetime.now(timezone.utc)
            await db.commit()
        except Exception as exc:  # noqa: BLE001 — surface to UI, don't crash worker
            logger.exception("LeanIX parse job failed")
            await db.rollback()
            try:
                async with async_session() as db2:
                    m2 = (
                        await db2.execute(
                            select(LeanixMigration).where(
                                LeanixMigration.id == uuid.UUID(migration_id_str)
                            )
                        )
                    ).scalar_one_or_none()
                    if m2 is not None:
                        m2.status = "failed"
                        m2.error_message = str(exc)[:1000]
                        await db2.commit()
            except Exception:
                logger.exception("Could not record parse failure")


async def _apply_job(migration_id_str: str, user_id_str: str) -> None:
    """Apply the staged records in dependency order."""
    async with async_session() as db:
        try:
            m = (
                await db.execute(
                    select(LeanixMigration).where(LeanixMigration.id == uuid.UUID(migration_id_str))
                )
            ).scalar_one_or_none()
            if m is None:
                return
            user = (
                await db.execute(select(User).where(User.id == uuid.UUID(user_id_str)))
            ).scalar_one_or_none()
            if user is None:
                m.status = "failed"
                m.error_message = "Apply user no longer exists"
                await db.commit()
                return

            counts = await apply_migration(db, m, user)
            m.stats = {**(m.stats or {}), "apply": counts}
            m.status = "applied" if counts["errors"] == 0 else "failed"
            m.applied_at = datetime.now(timezone.utc)
            if counts["errors"]:
                m.error_message = f"{counts['errors']} entity error(s) — see staged records"
            await db.commit()
        except Exception as exc:  # noqa: BLE001
            logger.exception("LeanIX apply job failed")
            await db.rollback()
            try:
                async with async_session() as db2:
                    m2 = (
                        await db2.execute(
                            select(LeanixMigration).where(
                                LeanixMigration.id == uuid.UUID(migration_id_str)
                            )
                        )
                    ).scalar_one_or_none()
                    if m2 is not None:
                        m2.status = "failed"
                        m2.error_message = str(exc)[:1000]
                        await db2.commit()
            except Exception:
                logger.exception("Could not record apply failure")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _load_migration(db: AsyncSession, migration_id: uuid.UUID) -> LeanixMigration:
    m = (
        await db.execute(select(LeanixMigration).where(LeanixMigration.id == migration_id))
    ).scalar_one_or_none()
    if m is None:
        raise HTTPException(status_code=404, detail="Migration not found")
    return m
