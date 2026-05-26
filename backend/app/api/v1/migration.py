"""Platform-migration HTTP endpoints.

The admin's view onto the importer: pick a source, upload a snapshot,
see what would change, apply it, and inspect the result. Mirrors the
ServiceNow REST shape (``app/api/v1/servicenow.py``) — same staging /
preview / apply rhythm, gated by the ``admin.migrate`` permission.

The HTTP layer is intentionally thin — every meaningful operation
lives in :mod:`app.services.migration.staging`,
:mod:`app.services.migration.apply`, and the per-source adapter under
``app.services.migration.sources``. The route dispatches by reading
``migration.source_type`` and resolving the matching adapter via
:func:`~app.services.migration.registry.get_source`.

Endpoints:

- ``GET /migration/sources`` — list every registered source adapter so
  the upload picker knows what's available.
- ``POST /migration/upload`` — multipart upload with ``source_key``.
  Returns the migration id and fires a background task to parse +
  stage.
- ``GET /migration`` — list past migrations (optionally filtered by
  ``source_type``).
- ``GET /migration/{id}`` — status + stats.
- ``GET /migration/{id}/preview`` — paginated staged records.
- ``POST /migration/{id}/apply`` — kick off the apply pipeline in the
  background. 202 with the migration object.
- ``GET /migration/{id}/errors.csv`` — CSV report of staged rows in
  error status.
- ``DELETE /migration/{id}`` — purge a migration (any non-applying
  status).
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
from sqlalchemy.orm.attributes import flag_modified as flag_jsonb_modified

from app.api.deps import get_current_user
from app.database import async_session, get_db
from app.models.card_type import CardType
from app.models.migration import Migration, StagedRecord
from app.models.user import User
from app.services.migration.apply import apply_migration
from app.services.migration.registry import SOURCES, get_source
from app.services.migration.staging import (
    stage_cards,
    stage_comments,
    stage_documents,
    stage_metamodel,
    stage_relations,
    stage_tags,
    stage_users_and_subscriptions,
)
from app.services.permission_service import PermissionService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/migration", tags=["Migration"])

# Snapshot binaries live on disk rather than in Postgres so that the
# table stays small and ``DELETE`` is cheap. Pre-refactor migrations
# stored under ``data/leanix_snapshots/`` still resolve because their
# absolute paths live on the row.
_SNAPSHOT_DIR = Path("data/migration_snapshots")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class SourceOut(BaseModel):
    key: str
    label: str
    accepted_extensions: list[str]


class MigrationOut(BaseModel):
    id: str
    name: str
    source_type: str
    status: str
    file_hash: str
    file_size: int | None
    snapshot_version: str | None
    stats: dict | None
    metamodel_diff: dict | None
    field_mappings: dict | None
    error_message: str | None
    parsed_at: str | None
    applied_at: str | None
    created_at: str | None
    updated_at: str | None


class StagedRecordOut(BaseModel):
    id: str
    entity_kind: str
    source_id: str
    source_type: str
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


def _migration_to_out(m: Migration) -> MigrationOut:
    return MigrationOut(
        id=str(m.id),
        name=m.name,
        source_type=m.source_type,
        status=m.status,
        file_hash=m.file_hash,
        file_size=m.file_size,
        snapshot_version=m.snapshot_version,
        stats=m.stats,
        metamodel_diff=m.metamodel_diff,
        field_mappings=m.field_mappings or {},
        error_message=m.error_message,
        parsed_at=m.parsed_at.isoformat() if m.parsed_at else None,
        applied_at=m.applied_at.isoformat() if m.applied_at else None,
        created_at=m.created_at.isoformat() if m.created_at else None,
        updated_at=m.updated_at.isoformat() if m.updated_at else None,
    )


def _staged_to_out(r: StagedRecord) -> StagedRecordOut:
    return StagedRecordOut(
        id=str(r.id),
        entity_kind=r.entity_kind,
        source_id=r.source_id,
        source_type=r.source_type,
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


@router.get("/sources", response_model=list[SourceOut])
async def list_sources(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[SourceOut]:
    """Return every registered source adapter so the picker can render them."""
    await PermissionService.require_permission(db, user, "admin.migrate")
    return [
        SourceOut(
            key=src.key,
            label=src.label,
            accepted_extensions=list(src.accepted_extensions),
        )
        for src in SOURCES.values()
    ]


@router.post("/upload", response_model=MigrationOut, status_code=201)
async def upload_snapshot(
    background_tasks: BackgroundTasks,
    source_key: str = Form(..., description="Registered source adapter key (e.g. 'leanix')"),
    name: str = Form(...),
    file: UploadFile = File(...),
    include_archived: bool = Form(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MigrationOut:
    await PermissionService.require_permission(db, user, "admin.migrate")

    try:
        source = get_source(source_key)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty snapshot file")
    if not source.validate_payload(raw[:16]):
        exts = ", ".join(source.accepted_extensions) or "the expected format"
        raise HTTPException(
            status_code=400,
            detail=f"File does not match {source.label} ({exts}).",
        )
    file_hash = hashlib.sha256(raw).hexdigest()

    # Reject duplicate uploads — the (file_hash, source_type) pair is
    # the natural idempotency key.
    existing = (
        await db.execute(
            select(Migration).where(
                Migration.file_hash == file_hash,
                Migration.source_type == source.key,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return _migration_to_out(existing)

    _SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    migration_id = uuid.uuid4()
    storage_path = _SNAPSHOT_DIR / f"{migration_id}.bin"
    storage_path.write_bytes(raw)

    migration = Migration(
        id=migration_id,
        name=name,
        source_type=source.key,
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
    source_type: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[MigrationOut]:
    await PermissionService.require_permission(db, user, "admin.migrate")
    stmt = select(Migration).order_by(Migration.created_at.desc()).limit(100)
    if source_type:
        stmt = stmt.where(Migration.source_type == source_type)
    rows = (await db.execute(stmt)).scalars().all()
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
    base = select(StagedRecord).where(
        StagedRecord.migration_id == migration_id,
        StagedRecord.entity_kind == entity_kind,
    )
    if card_type_key is not None:
        base = base.where(StagedRecord.card_type_key == card_type_key)
    if action is not None:
        base = base.where(StagedRecord.action == action)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (
        (await db.execute(base.order_by(StagedRecord.created_at.asc()).offset(offset).limit(limit)))
        .scalars()
        .all()
    )
    return PreviewPage(
        items=[_staged_to_out(r) for r in rows],
        total=total,
        offset=offset,
        limit=limit,
    )


class TargetFieldOption(BaseModel):
    """One Turbo EA field that an admin can map a source field onto."""

    key: str
    label: str
    type: str
    section: str | None = None


class SourceFieldRow(BaseModel):
    """One source-platform custom field discovered in the snapshot."""

    source_field_key: str
    label: str | None
    native_data_type: str | None
    tea_type: str | None  # the parser's inferred type
    target_tea_type: str  # resolved TEA card-type key (e.g. ``Application``)
    mapped_to: str | None  # admin's current mapping (``None`` / ``""`` = unmapped)


class FieldMappingTypeBlock(BaseModel):
    native_type: str
    target_tea_type: str
    target_type_label: str
    source_fields: list[SourceFieldRow]
    available_targets: list[TargetFieldOption]


class FieldMappingOptions(BaseModel):
    """Payload for the field-mapping admin UI.

    One block per ``(native_type, target_tea_type)`` pair surfacing the
    source fields the parser discovered alongside the list of TEA
    target fields the admin can map them onto.
    """

    blocks: list[FieldMappingTypeBlock]


class FieldMappingUpdate(BaseModel):
    field_mappings: dict[str, dict[str, str]]


# Standard Turbo EA lifecycle phases — mirrors ``frontend/src/features/
# cards/sections/cardDetailUtils.tsx`` ``PHASES``. Exposed as
# additional mapping targets keyed ``__lifecycle__:<phase>`` so admins
# can route a LeanIX custom date field (e.g.
# ``lxVendorLifecycle:endOfLife``) onto the standard ``endOfLife``
# slot in ``card.lifecycle`` instead of landing it as a generic
# custom date attribute. The apply pipeline detects the prefix and
# coerces the value to ``YYYY-MM-DD`` before persisting.
_LIFECYCLE_PHASES: tuple[tuple[str, str], ...] = (
    ("plan", "Plan"),
    ("phaseIn", "Phase In"),
    ("active", "Active"),
    ("phaseOut", "Phase Out"),
    ("endOfLife", "End of Life"),
)
LIFECYCLE_TARGET_PREFIX = "__lifecycle__:"


def _lifecycle_targets() -> list[TargetFieldOption]:
    return [
        TargetFieldOption(
            key=f"{LIFECYCLE_TARGET_PREFIX}{phase}",
            label=label,
            type="date",
            section="Lifecycle",
        )
        for phase, label in _LIFECYCLE_PHASES
    ]


def _collect_fields_schema_targets(card_type: CardType) -> list[TargetFieldOption]:
    """Flatten ``fields_schema`` into a list of selectable target fields.

    Skips the synthetic ``Imported from {source}`` sections so admins
    don't map a fresh import onto a previous import's bucket. Also
    skips the ``__description`` sentinel section which feeds into the
    Description block on the card detail.
    """
    out: list[TargetFieldOption] = []
    for section in card_type.fields_schema or []:
        if not isinstance(section, dict):
            continue
        section_name = section.get("section")
        if not isinstance(section_name, str):
            continue
        if section_name.startswith("Imported from "):
            continue
        if section_name == "__description":
            continue
        for f in section.get("fields") or []:
            if not isinstance(f, dict):
                continue
            key = f.get("key")
            if not isinstance(key, str) or not key:
                continue
            out.append(
                TargetFieldOption(
                    key=key,
                    label=f.get("label") or key,
                    type=f.get("type") or "text",
                    section=section_name,
                )
            )
    return out


@router.get("/{migration_id}/field-mappings", response_model=FieldMappingOptions)
async def get_field_mappings(
    migration_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FieldMappingOptions:
    """Return source fields per type alongside the candidate TEA targets.

    Drives the **Map fields** section of the migration detail dialog.
    Available once the migration is in ``parsed`` / ``previewed`` /
    ``applied`` / ``failed`` state — earlier states have no parsed
    fields yet.
    """
    await PermissionService.require_permission(db, user, "admin.migrate")
    m = await _load_migration(db, migration_id)

    # Pull every staged metamodel_field row — those are the parser's
    # discovered custom fields, already partitioned by target TEA type.
    rows = (
        (
            await db.execute(
                select(StagedRecord).where(
                    StagedRecord.migration_id == migration_id,
                    StagedRecord.entity_kind == "metamodel_field",
                )
            )
        )
        .scalars()
        .all()
    )

    # Group source fields by their resolved target TEA card-type key so
    # the UI can render one mapping table per type.
    blocks: dict[str, list[SourceFieldRow]] = {}
    # ``native_type`` is the first segment of ``source_id`` (e.g.
    # ``Application:criticality`` → ``Application``).
    native_type_by_target: dict[str, str] = {}
    for r in rows:
        payload = r.source_data or {}
        target_type = payload.get("target_type") or r.card_type_key
        if not target_type:
            continue
        native_type, _, _ = (r.source_id or "").partition(":")
        if not native_type:
            continue
        # Build the row.
        current_mapping = ((m.field_mappings or {}).get(native_type) or {}).get(
            payload.get("field_key") or "", None
        )
        blocks.setdefault(target_type, []).append(
            SourceFieldRow(
                source_field_key=payload.get("field_key") or "",
                label=payload.get("label"),
                native_data_type=payload.get("native_data_type"),
                tea_type=payload.get("tea_type"),
                target_tea_type=target_type,
                mapped_to=current_mapping,
            )
        )
        # First-seen wins — every staged field for a given target_type
        # shares the same native_type in practice.
        native_type_by_target.setdefault(target_type, native_type)

    # Resolve the available TEA targets per type.
    out: list[FieldMappingTypeBlock] = []
    for target_type, field_rows in sorted(blocks.items()):
        ct = (
            await db.execute(select(CardType).where(CardType.key == target_type))
        ).scalar_one_or_none()
        if ct is None:
            # Custom (yet-to-be-created) target type — no built-in
            # ``fields_schema`` targets, but the lifecycle slots are
            # available on every card regardless of type, so still
            # offer those.
            available: list[TargetFieldOption] = []
            target_label = target_type
        else:
            available = _collect_fields_schema_targets(ct)
            target_label = ct.label or target_type
        # Lifecycle phases are universal — append once per block so the
        # admin can route a custom date column (e.g.
        # ``lxVendorLifecycle:endOfLife``) onto a standard phase. Sort
        # the schema fields alphabetically by label, then the lifecycle
        # slots in canonical order at the end so they're easy to find.
        available_sorted = sorted(available, key=lambda o: o.label.lower())
        available_sorted.extend(_lifecycle_targets())

        out.append(
            FieldMappingTypeBlock(
                native_type=native_type_by_target[target_type],
                target_tea_type=target_type,
                target_type_label=target_label,
                source_fields=sorted(field_rows, key=lambda r: r.source_field_key.lower()),
                available_targets=available_sorted,
            )
        )

    return FieldMappingOptions(blocks=out)


@router.put("/{migration_id}/field-mappings", response_model=MigrationOut)
async def update_field_mappings(
    migration_id: uuid.UUID,
    body: FieldMappingUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MigrationOut:
    """Persist the admin's mapping choices.

    The payload is a nested dict
    ``{<source_native_type>: {<source_field_key>: <tea_field_key>}}``.
    Empty string values clear a mapping; the literal ``"__skip__"``
    means "do not import this field at all".
    """
    await PermissionService.require_permission(db, user, "admin.migrate")
    m = await _load_migration(db, migration_id)
    if m.status not in {"parsed", "previewed"}:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Field mappings can only be edited while the migration is in "
                f"'parsed' or 'previewed' state (current: {m.status!r})"
            ),
        )

    # Clean the payload: drop empty mappings + empty type buckets so the
    # stored JSON stays minimal.
    cleaned: dict[str, dict[str, str]] = {}
    for native_type, mapping in (body.field_mappings or {}).items():
        if not isinstance(mapping, dict):
            continue
        kept = {k: v for k, v in mapping.items() if isinstance(v, str) and v}
        if kept:
            cleaned[native_type] = kept

    m.field_mappings = cleaned
    flag_jsonb_modified(m, "field_mappings")
    # The mapping affects what the user expects to see on /apply — bump
    # the migration into ``previewed`` so the UI's "ready to apply"
    # affordance keeps working.
    if m.status == "parsed":
        m.status = "previewed"
    await db.commit()
    await db.refresh(m)
    return _migration_to_out(m)


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
                select(StagedRecord)
                .where(
                    StagedRecord.migration_id == migration_id,
                    StagedRecord.status == "error",
                )
                .order_by(
                    StagedRecord.entity_kind.asc(),
                    StagedRecord.created_at.asc(),
                )
            )
        )
        .scalars()
        .all()
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["entity_kind", "source_id", "card_type_key", "action", "error_message"])
    for r in rows:
        writer.writerow(
            [
                r.entity_kind,
                r.source_id,
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
    """Parse the snapshot on disk and stage every entity from it."""
    async with async_session() as db:
        try:
            m = (
                await db.execute(
                    select(Migration).where(Migration.id == uuid.UUID(migration_id_str))
                )
            ).scalar_one_or_none()
            if m is None or m.storage_path is None:
                logger.warning("migration parse job: migration %s missing", migration_id_str)
                return

            source = get_source(m.source_type)
            snapshot = source.parse(m.storage_path)
            m.snapshot_version = snapshot.version
            include_archived = bool(
                ((m.stats or {}).get("options") or {}).get("include_archived", False)
            )
            metamodel_stats = await stage_metamodel(db, m, source, snapshot)
            card_stats = await stage_cards(
                db, m, source, snapshot, include_archived=include_archived
            )
            relation_stats = await stage_relations(db, m, source, snapshot)
            tag_stats = await stage_tags(db, m, source, snapshot)
            user_stats, sub_stats = await stage_users_and_subscriptions(db, m, source, snapshot)
            document_stats = await stage_documents(db, m, source, snapshot)
            comment_stats = await stage_comments(db, m, source, snapshot)
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
                "entities": len(snapshot.entities),
                # Legacy alias retained so any UI / scripts that read
                # ``stats.fact_sheets`` keep working after the rename.
                "fact_sheets": len(snapshot.entities),
                "relation_count": len(snapshot.relations),
                "tag_count": len(snapshot.tags),
                "subscription_count": len(snapshot.subscriptions),
                "document_count": len(snapshot.documents),
                "comment_count": len(snapshot.comments),
                # Keep the flat counter for the legacy UI dashboard.
                **card_stats,
            }
            m.stats = {**(m.stats or {}), **stats}
            m.status = "parsed"
            m.parsed_at = datetime.now(timezone.utc)
            await db.commit()
        except Exception as exc:  # noqa: BLE001 — surface to UI, don't crash worker
            logger.exception("migration parse job failed")
            await db.rollback()
            try:
                async with async_session() as db2:
                    m2 = (
                        await db2.execute(
                            select(Migration).where(Migration.id == uuid.UUID(migration_id_str))
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
                    select(Migration).where(Migration.id == uuid.UUID(migration_id_str))
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
            logger.exception("migration apply job failed")
            await db.rollback()
            try:
                async with async_session() as db2:
                    m2 = (
                        await db2.execute(
                            select(Migration).where(Migration.id == uuid.UUID(migration_id_str))
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


async def _load_migration(db: AsyncSession, migration_id: uuid.UUID) -> Migration:
    m = (
        await db.execute(select(Migration).where(Migration.id == migration_id))
    ).scalar_one_or_none()
    if m is None:
        raise HTTPException(status_code=404, detail="Migration not found")
    return m
