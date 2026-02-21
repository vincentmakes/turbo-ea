"""ServiceNow integration endpoints — connections, mappings, sync operations."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.servicenow import (
    SnowConnection,
    SnowFieldMapping,
    SnowMapping,
    SnowStagedRecord,
    SnowSyncRun,
)
from app.models.user import User
from app.services.permission_service import PermissionService
from app.services.servicenow_service import (
    ServiceNowClient,
    SyncEngine,
    decrypt_credentials,
    encrypt_credentials,
)

router = APIRouter(prefix="/servicenow", tags=["ServiceNow"])

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ConnectionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    instance_url: str = Field(..., min_length=1, max_length=500)
    auth_type: str = Field("basic", pattern=r"^(basic|oauth2)$")
    username: str = ""
    password: str = ""
    client_id: str = ""
    client_secret: str = ""


class ConnectionUpdate(BaseModel):
    name: str | None = None
    instance_url: str | None = None
    auth_type: str | None = None
    username: str | None = None
    password: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    is_active: bool | None = None


class ConnectionOut(BaseModel):
    id: str
    name: str
    instance_url: str
    auth_type: str
    is_active: bool
    last_tested_at: str | None = None
    test_status: str | None = None
    mapping_count: int = 0
    created_at: str | None = None
    updated_at: str | None = None


class FieldMappingIn(BaseModel):
    turbo_field: str
    snow_field: str
    direction: str = Field("snow_leads", pattern=r"^(snow_leads|turbo_leads)$")
    transform_type: str | None = None
    transform_config: dict | None = None
    is_identity: bool = False


class MappingCreate(BaseModel):
    connection_id: str
    card_type_key: str
    snow_table: str
    sync_direction: str = Field(
        "snow_to_turbo", pattern=r"^(snow_to_turbo|turbo_to_snow|bidirectional)$"
    )
    sync_mode: str = Field("conservative", pattern=r"^(additive|conservative|strict)$")
    max_deletion_ratio: float = Field(0.5, ge=0.0, le=1.0)
    filter_query: str | None = None
    skip_staging: bool = False
    field_mappings: list[FieldMappingIn] = []


class MappingUpdate(BaseModel):
    card_type_key: str | None = None
    snow_table: str | None = None
    sync_direction: str | None = None
    sync_mode: str | None = None
    max_deletion_ratio: float | None = None
    filter_query: str | None = None
    skip_staging: bool | None = None
    is_active: bool | None = None
    field_mappings: list[FieldMappingIn] | None = None


class FieldMappingOut(BaseModel):
    id: str
    turbo_field: str
    snow_field: str
    direction: str
    transform_type: str | None = None
    transform_config: dict | None = None
    is_identity: bool


class MappingOut(BaseModel):
    id: str
    connection_id: str
    card_type_key: str
    snow_table: str
    sync_direction: str
    sync_mode: str
    max_deletion_ratio: float
    filter_query: str | None = None
    skip_staging: bool = False
    is_active: bool
    field_mappings: list[FieldMappingOut] = []
    created_at: str | None = None
    updated_at: str | None = None


class SyncRunOut(BaseModel):
    id: str
    connection_id: str
    mapping_id: str | None = None
    status: str
    direction: str
    started_at: str | None = None
    completed_at: str | None = None
    stats: dict | None = None
    error_message: str | None = None
    created_by: str | None = None


class StagedRecordOut(BaseModel):
    id: str
    snow_sys_id: str
    snow_data: dict | None = None
    card_id: str | None = None
    action: str
    diff: dict | None = None
    status: str
    error_message: str | None = None
    created_at: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _validate_instance_url(url: str) -> None:
    """Validate ServiceNow instance URL format."""
    if not url.startswith("https://"):
        raise HTTPException(400, "Instance URL must use HTTPS")
    # Allow *.service-now.com, *.servicenowservices.com, or custom domains
    pattern = re.compile(r"^https://[\w.-]+(:\d+)?(/.*)?$")
    if not pattern.match(url):
        raise HTTPException(400, "Invalid instance URL format")


def _conn_to_out(conn: SnowConnection, mapping_count: int = 0) -> ConnectionOut:
    return ConnectionOut(
        id=str(conn.id),
        name=conn.name,
        instance_url=conn.instance_url,
        auth_type=conn.auth_type,
        is_active=conn.is_active,
        last_tested_at=conn.last_tested_at.isoformat() if conn.last_tested_at else None,
        test_status=conn.test_status,
        mapping_count=mapping_count,
        created_at=conn.created_at.isoformat() if conn.created_at else None,
        updated_at=conn.updated_at.isoformat() if conn.updated_at else None,
    )


def _mapping_to_out(mapping: SnowMapping) -> MappingOut:
    return MappingOut(
        id=str(mapping.id),
        connection_id=str(mapping.connection_id),
        card_type_key=mapping.card_type_key,
        snow_table=mapping.snow_table,
        sync_direction=mapping.sync_direction,
        sync_mode=mapping.sync_mode,
        max_deletion_ratio=mapping.max_deletion_ratio,
        filter_query=mapping.filter_query,
        skip_staging=mapping.skip_staging,
        is_active=mapping.is_active,
        field_mappings=[
            FieldMappingOut(
                id=str(fm.id),
                turbo_field=fm.turbo_field,
                snow_field=fm.snow_field,
                direction=fm.direction,
                transform_type=fm.transform_type,
                transform_config=fm.transform_config,
                is_identity=fm.is_identity,
            )
            for fm in mapping.field_mappings
        ],
        created_at=mapping.created_at.isoformat() if mapping.created_at else None,
        updated_at=mapping.updated_at.isoformat() if mapping.updated_at else None,
    )


def _build_client(conn: SnowConnection) -> ServiceNowClient:
    """Build a ServiceNowClient from a connection model."""
    creds = decrypt_credentials(conn.credentials or {})
    return ServiceNowClient(conn.instance_url, creds, conn.auth_type)


# ---------------------------------------------------------------------------
# Connection endpoints
# ---------------------------------------------------------------------------


@router.get("/connections", response_model=list[ConnectionOut])
async def list_connections(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "servicenow.manage")
    result = await db.execute(select(SnowConnection).order_by(SnowConnection.created_at.desc()))
    conns = result.scalars().all()
    out = []
    for conn in conns:
        mc_result = await db.execute(
            select(func.count(SnowMapping.id)).where(SnowMapping.connection_id == conn.id)
        )
        mc = mc_result.scalar() or 0
        out.append(_conn_to_out(conn, mc))
    return out


@router.post("/connections", response_model=ConnectionOut)
async def create_connection(
    body: ConnectionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "servicenow.manage")
    _validate_instance_url(body.instance_url)

    creds: dict
    if body.auth_type == "basic":
        creds = {"username": body.username, "password": body.password}
    else:
        creds = {"client_id": body.client_id, "client_secret": body.client_secret}

    conn = SnowConnection(
        name=body.name,
        instance_url=body.instance_url.rstrip("/"),
        auth_type=body.auth_type,
        credentials=encrypt_credentials(creds),
    )
    db.add(conn)
    await db.commit()
    await db.refresh(conn)
    return _conn_to_out(conn)


@router.get("/connections/{conn_id}", response_model=ConnectionOut)
async def get_connection(
    conn_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "servicenow.manage")
    result = await db.execute(select(SnowConnection).where(SnowConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")
    mc_result = await db.execute(
        select(func.count(SnowMapping.id)).where(SnowMapping.connection_id == conn.id)
    )
    return _conn_to_out(conn, mc_result.scalar() or 0)


@router.patch("/connections/{conn_id}", response_model=ConnectionOut)
async def update_connection(
    conn_id: uuid.UUID,
    body: ConnectionUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "servicenow.manage")
    result = await db.execute(select(SnowConnection).where(SnowConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")

    if body.name is not None:
        conn.name = body.name
    if body.instance_url is not None:
        _validate_instance_url(body.instance_url)
        conn.instance_url = body.instance_url.rstrip("/")
    if body.auth_type is not None:
        conn.auth_type = body.auth_type
    if body.is_active is not None:
        conn.is_active = body.is_active

    # Update credentials if provided (don't overwrite with masked values)
    existing_creds = decrypt_credentials(conn.credentials or {})
    if body.auth_type == "basic" or (body.auth_type is None and conn.auth_type == "basic"):
        if body.username is not None and body.username:
            existing_creds["username"] = body.username
        if body.password is not None and body.password and body.password != "--------":
            existing_creds["password"] = body.password
    else:
        if body.client_id is not None and body.client_id:
            existing_creds["client_id"] = body.client_id
        if body.client_secret and body.client_secret != "--------":
            existing_creds["client_secret"] = body.client_secret
    conn.credentials = encrypt_credentials(existing_creds)

    await db.commit()
    return _conn_to_out(conn)


@router.delete("/connections/{conn_id}")
async def delete_connection(
    conn_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "servicenow.manage")
    result = await db.execute(select(SnowConnection).where(SnowConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")
    await db.delete(conn)
    await db.commit()
    return {"ok": True}


@router.post("/connections/{conn_id}/test")
async def test_connection(
    conn_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "servicenow.manage")
    result = await db.execute(select(SnowConnection).where(SnowConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")

    client = _build_client(conn)
    try:
        success, message = await client.test_connection()
    finally:
        await client.close()

    conn.last_tested_at = datetime.now(timezone.utc)
    conn.test_status = "success" if success else "failed"
    await db.commit()

    return {"success": success, "message": message}


@router.get("/connections/{conn_id}/tables")
async def list_tables(
    conn_id: uuid.UUID,
    search: str = Query("", max_length=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "servicenow.manage")
    result = await db.execute(select(SnowConnection).where(SnowConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")

    client = _build_client(conn)
    try:
        tables = await client.list_tables(search)
    finally:
        await client.close()

    return tables


@router.get("/connections/{conn_id}/tables/{table}/fields")
async def list_table_fields(
    conn_id: uuid.UUID,
    table: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "servicenow.manage")
    if not re.match(r"^[a-zA-Z0-9_]+$", table):
        raise HTTPException(400, "Invalid table name")
    result = await db.execute(select(SnowConnection).where(SnowConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")

    client = _build_client(conn)
    try:
        fields = await client.list_table_fields(table)
    finally:
        await client.close()

    return fields


# ---------------------------------------------------------------------------
# Mapping endpoints
# ---------------------------------------------------------------------------


@router.get("/mappings", response_model=list[MappingOut])
async def list_mappings(
    connection_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "servicenow.manage")
    stmt = (
        select(SnowMapping)
        .options(selectinload(SnowMapping.field_mappings))
        .order_by(SnowMapping.created_at.desc())
    )
    if connection_id:
        stmt = stmt.where(SnowMapping.connection_id == connection_id)
    result = await db.execute(stmt)
    return [_mapping_to_out(m) for m in result.scalars().all()]


@router.post("/mappings", response_model=MappingOut)
async def create_mapping(
    body: MappingCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "servicenow.manage")

    # Validate connection exists
    conn_result = await db.execute(
        select(SnowConnection).where(SnowConnection.id == uuid.UUID(body.connection_id))
    )
    if not conn_result.scalar_one_or_none():
        raise HTTPException(404, "Connection not found")

    if not re.match(r"^[a-zA-Z0-9_]+$", body.snow_table):
        raise HTTPException(400, "Invalid ServiceNow table name")

    mapping = SnowMapping(
        connection_id=uuid.UUID(body.connection_id),
        card_type_key=body.card_type_key,
        snow_table=body.snow_table,
        sync_direction=body.sync_direction,
        sync_mode=body.sync_mode,
        max_deletion_ratio=body.max_deletion_ratio,
        filter_query=body.filter_query,
        skip_staging=body.skip_staging,
    )
    db.add(mapping)
    await db.flush()

    for fm_in in body.field_mappings:
        fm = SnowFieldMapping(
            mapping_id=mapping.id,
            turbo_field=fm_in.turbo_field,
            snow_field=fm_in.snow_field,
            direction=fm_in.direction,
            transform_type=fm_in.transform_type,
            transform_config=fm_in.transform_config,
            is_identity=fm_in.is_identity,
        )
        db.add(fm)

    await db.commit()

    # Reload with field mappings
    result = await db.execute(
        select(SnowMapping)
        .options(selectinload(SnowMapping.field_mappings))
        .where(SnowMapping.id == mapping.id)
    )
    return _mapping_to_out(result.scalar_one())


@router.get("/mappings/{mapping_id}", response_model=MappingOut)
async def get_mapping(
    mapping_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "servicenow.manage")
    result = await db.execute(
        select(SnowMapping)
        .options(selectinload(SnowMapping.field_mappings))
        .where(SnowMapping.id == mapping_id)
    )
    mapping = result.scalar_one_or_none()
    if not mapping:
        raise HTTPException(404, "Mapping not found")
    return _mapping_to_out(mapping)


@router.patch("/mappings/{mapping_id}", response_model=MappingOut)
async def update_mapping(
    mapping_id: uuid.UUID,
    body: MappingUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "servicenow.manage")
    result = await db.execute(
        select(SnowMapping)
        .options(selectinload(SnowMapping.field_mappings))
        .where(SnowMapping.id == mapping_id)
    )
    mapping = result.scalar_one_or_none()
    if not mapping:
        raise HTTPException(404, "Mapping not found")

    if body.card_type_key is not None:
        mapping.card_type_key = body.card_type_key
    if body.snow_table is not None:
        if not re.match(r"^[a-zA-Z0-9_]+$", body.snow_table):
            raise HTTPException(400, "Invalid ServiceNow table name")
        mapping.snow_table = body.snow_table
    if body.sync_direction is not None:
        mapping.sync_direction = body.sync_direction
    if body.sync_mode is not None:
        mapping.sync_mode = body.sync_mode
    if body.max_deletion_ratio is not None:
        mapping.max_deletion_ratio = body.max_deletion_ratio
    if body.filter_query is not None:
        mapping.filter_query = body.filter_query
    if body.skip_staging is not None:
        mapping.skip_staging = body.skip_staging
    if body.is_active is not None:
        mapping.is_active = body.is_active

    # Replace field mappings if provided
    if body.field_mappings is not None:
        # Delete existing
        for fm in list(mapping.field_mappings):
            await db.delete(fm)
        await db.flush()

        # Create new
        for fm_in in body.field_mappings:
            fm = SnowFieldMapping(
                mapping_id=mapping.id,
                turbo_field=fm_in.turbo_field,
                snow_field=fm_in.snow_field,
                direction=fm_in.direction,
                transform_type=fm_in.transform_type,
                transform_config=fm_in.transform_config,
                is_identity=fm_in.is_identity,
            )
            db.add(fm)

    await db.commit()

    # Reload
    result = await db.execute(
        select(SnowMapping)
        .options(selectinload(SnowMapping.field_mappings))
        .where(SnowMapping.id == mapping.id)
    )
    return _mapping_to_out(result.scalar_one())


@router.delete("/mappings/{mapping_id}")
async def delete_mapping(
    mapping_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "servicenow.manage")
    result = await db.execute(select(SnowMapping).where(SnowMapping.id == mapping_id))
    mapping = result.scalar_one_or_none()
    if not mapping:
        raise HTTPException(404, "Mapping not found")
    await db.delete(mapping)
    await db.commit()
    return {"ok": True}


@router.post("/mappings/{mapping_id}/preview")
async def preview_mapping(
    mapping_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Dry-run: fetch a sample of records and show how they would be mapped."""
    await PermissionService.require_permission(db, user, "servicenow.manage")
    result = await db.execute(
        select(SnowMapping)
        .options(selectinload(SnowMapping.field_mappings))
        .where(SnowMapping.id == mapping_id)
    )
    mapping = result.scalar_one_or_none()
    if not mapping:
        raise HTTPException(404, "Mapping not found")

    # Load connection
    conn_result = await db.execute(
        select(SnowConnection).where(SnowConnection.id == mapping.connection_id)
    )
    conn = conn_result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")

    client = _build_client(conn)
    try:
        snow_fields = [fm.snow_field for fm in mapping.field_mappings]
        records, total = await client.fetch_records(
            mapping.snow_table,
            fields=snow_fields,
            query=mapping.filter_query or "",
            limit=5,
        )
    finally:
        await client.close()

    from app.services.servicenow_service import FieldTransformer

    previews = []
    for record in records:
        transformed = FieldTransformer.apply_mappings(
            record, mapping.field_mappings, "snow_to_turbo"
        )
        previews.append(
            {
                "snow_record": record,
                "transformed": transformed,
            }
        )

    return {"total_records": total, "sample_count": len(previews), "previews": previews}


# ---------------------------------------------------------------------------
# Sync endpoints
# ---------------------------------------------------------------------------


@router.post("/sync/pull/{mapping_id}", response_model=SyncRunOut)
async def trigger_pull_sync(
    mapping_id: uuid.UUID,
    auto_apply: bool = Query(True, description="Auto-apply staged changes"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "servicenow.manage")
    result = await db.execute(
        select(SnowMapping)
        .options(selectinload(SnowMapping.field_mappings))
        .where(SnowMapping.id == mapping_id)
    )
    mapping = result.scalar_one_or_none()
    if not mapping:
        raise HTTPException(404, "Mapping not found")
    if not mapping.is_active:
        raise HTTPException(400, "Mapping is inactive")

    conn_result = await db.execute(
        select(SnowConnection).where(SnowConnection.id == mapping.connection_id)
    )
    conn = conn_result.scalar_one_or_none()
    if not conn or not conn.is_active:
        raise HTTPException(400, "Connection is inactive or not found")

    client = _build_client(conn)
    try:
        engine = SyncEngine(db, client)
        run = await engine.pull_sync(
            mapping,
            mapping.field_mappings,
            user_id=user.id,
            auto_apply=auto_apply,
        )
        await db.commit()
    finally:
        await client.close()

    return SyncRunOut(
        id=str(run.id),
        connection_id=str(run.connection_id),
        mapping_id=str(run.mapping_id) if run.mapping_id else None,
        status=run.status,
        direction=run.direction,
        started_at=run.started_at.isoformat() if run.started_at else None,
        completed_at=run.completed_at.isoformat() if run.completed_at else None,
        stats=run.stats,
        error_message=run.error_message,
        created_by=str(run.created_by) if run.created_by else None,
    )


@router.post("/sync/push/{mapping_id}", response_model=SyncRunOut)
async def trigger_push_sync(
    mapping_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "servicenow.manage")
    result = await db.execute(
        select(SnowMapping)
        .options(selectinload(SnowMapping.field_mappings))
        .where(SnowMapping.id == mapping_id)
    )
    mapping = result.scalar_one_or_none()
    if not mapping:
        raise HTTPException(404, "Mapping not found")
    if not mapping.is_active:
        raise HTTPException(400, "Mapping is inactive")

    conn_result = await db.execute(
        select(SnowConnection).where(SnowConnection.id == mapping.connection_id)
    )
    conn = conn_result.scalar_one_or_none()
    if not conn or not conn.is_active:
        raise HTTPException(400, "Connection is inactive or not found")

    client = _build_client(conn)
    try:
        engine = SyncEngine(db, client)
        run = await engine.push_sync(
            mapping,
            mapping.field_mappings,
            user_id=user.id,
        )
        await db.commit()
    finally:
        await client.close()

    return SyncRunOut(
        id=str(run.id),
        connection_id=str(run.connection_id),
        mapping_id=str(run.mapping_id) if run.mapping_id else None,
        status=run.status,
        direction=run.direction,
        started_at=run.started_at.isoformat() if run.started_at else None,
        completed_at=run.completed_at.isoformat() if run.completed_at else None,
        stats=run.stats,
        error_message=run.error_message,
        created_by=str(run.created_by) if run.created_by else None,
    )


@router.get("/sync/runs", response_model=list[SyncRunOut])
async def list_sync_runs(
    connection_id: uuid.UUID | None = None,
    mapping_id: uuid.UUID | None = None,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "servicenow.manage")
    stmt = select(SnowSyncRun).order_by(SnowSyncRun.started_at.desc()).limit(limit)
    if connection_id:
        stmt = stmt.where(SnowSyncRun.connection_id == connection_id)
    if mapping_id:
        stmt = stmt.where(SnowSyncRun.mapping_id == mapping_id)
    result = await db.execute(stmt)

    return [
        SyncRunOut(
            id=str(r.id),
            connection_id=str(r.connection_id),
            mapping_id=str(r.mapping_id) if r.mapping_id else None,
            status=r.status,
            direction=r.direction,
            started_at=r.started_at.isoformat() if r.started_at else None,
            completed_at=r.completed_at.isoformat() if r.completed_at else None,
            stats=r.stats,
            error_message=r.error_message,
            created_by=str(r.created_by) if r.created_by else None,
        )
        for r in result.scalars().all()
    ]


@router.get("/sync/runs/{run_id}", response_model=SyncRunOut)
async def get_sync_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "servicenow.manage")
    result = await db.execute(select(SnowSyncRun).where(SnowSyncRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, "Sync run not found")
    return SyncRunOut(
        id=str(run.id),
        connection_id=str(run.connection_id),
        mapping_id=str(run.mapping_id) if run.mapping_id else None,
        status=run.status,
        direction=run.direction,
        started_at=run.started_at.isoformat() if run.started_at else None,
        completed_at=run.completed_at.isoformat() if run.completed_at else None,
        stats=run.stats,
        error_message=run.error_message,
        created_by=str(run.created_by) if run.created_by else None,
    )


@router.get("/sync/runs/{run_id}/staged", response_model=list[StagedRecordOut])
async def list_staged_records(
    run_id: uuid.UUID,
    action: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "servicenow.manage")
    stmt = (
        select(SnowStagedRecord)
        .where(SnowStagedRecord.sync_run_id == run_id)
        .order_by(SnowStagedRecord.created_at)
    )
    if action:
        stmt = stmt.where(SnowStagedRecord.action == action)
    if status:
        stmt = stmt.where(SnowStagedRecord.status == status)
    result = await db.execute(stmt)

    return [
        StagedRecordOut(
            id=str(s.id),
            snow_sys_id=s.snow_sys_id,
            snow_data=s.snow_data,
            card_id=str(s.card_id) if s.card_id else None,
            action=s.action,
            diff=s.diff,
            status=s.status,
            error_message=s.error_message,
            created_at=s.created_at.isoformat() if s.created_at else None,
        )
        for s in result.scalars().all()
    ]


@router.post("/sync/runs/{run_id}/apply")
async def apply_staged_records(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Apply all pending staged records for a sync run."""
    await PermissionService.require_permission(db, user, "servicenow.manage")
    result = await db.execute(select(SnowSyncRun).where(SnowSyncRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, "Sync run not found")

    conn_result = await db.execute(
        select(SnowConnection).where(SnowConnection.id == run.connection_id)
    )
    conn = conn_result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")

    client = _build_client(conn)
    try:
        engine = SyncEngine(db, client)
        applied = await engine._apply_staged(run)
        await db.commit()
    finally:
        await client.close()

    return {"ok": True, "applied": applied}
