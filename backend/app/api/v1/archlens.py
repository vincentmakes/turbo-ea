"""ArchLens integration — connection management, data sync, and AI analysis."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.encryption import decrypt_value, encrypt_value
from app.database import get_db
from app.models.app_settings import AppSettings
from app.models.archlens import ArchLensAnalysisRun, ArchLensConnection
from app.models.user import User
from app.schemas.archlens import (
    ArchLensArchitectRequest,
    ArchLensConnectionCreate,
    ArchLensConnectionOut,
    ArchLensConnectionUpdate,
    ArchLensSyncRequest,
)
from app.services.archlens_service import ArchLensClient
from app.services.permission_service import PermissionService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/archlens", tags=["ArchLens"])

PASSWORD_MASK = "••••••••"

# Turbo EA providerType → ArchLens ai_provider mapping
_PROVIDER_MAP = {
    "anthropic": "claude",
    "openai": "openai",
}


def _mask_credentials(conn: ArchLensConnection) -> ArchLensConnectionOut:
    return ArchLensConnectionOut(
        id=str(conn.id),
        name=conn.name,
        instance_url=conn.instance_url,
        is_active=conn.is_active,
        last_tested_at=conn.last_tested_at,
        test_status=conn.test_status,
        last_synced_at=conn.last_synced_at,
        sync_status=conn.sync_status,
        created_at=conn.created_at,
        updated_at=conn.updated_at,
    )


def _get_workspace_key(conn: ArchLensConnection) -> str:
    """Derive the ArchLens workspace key from the Turbo EA URL."""
    creds = conn.credentials or {}
    turbo_url: str = str(creds.get("turbo_ea_url", ""))
    if turbo_url:
        return turbo_url.rstrip("/")
    return conn.instance_url.rstrip("/")


async def _push_ai_config_if_available(
    client: ArchLensClient, db: AsyncSession
) -> tuple[bool, str]:
    """Read Turbo EA AI settings and push them to ArchLens if compatible."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    ai = general.get("ai", {})

    provider_type = ai.get("providerType", "")
    archlens_provider = _PROVIDER_MAP.get(provider_type)
    if not archlens_provider:
        return False, f"Provider '{provider_type}' not supported by ArchLens"

    encrypted_key = ai.get("apiKey", "")
    if not encrypted_key:
        return False, "No AI API key configured in Turbo EA"

    api_key = decrypt_value(encrypted_key)
    if not api_key:
        return False, "AI API key is empty"

    return await client.push_ai_config(archlens_provider, api_key)


# ── Connections CRUD ────────────────────────────────────────────────────────


@router.get("/connections", response_model=list[ArchLensConnectionOut])
async def list_connections(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "archlens.manage")
    result = await db.execute(select(ArchLensConnection))
    return [_mask_credentials(c) for c in result.scalars().all()]


@router.post("/connections", response_model=ArchLensConnectionOut)
async def create_connection(
    body: ArchLensConnectionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "archlens.manage")
    creds = body.credentials or {}
    if "password" in creds and creds["password"] != PASSWORD_MASK:
        creds["password"] = encrypt_value(creds["password"])
    conn = ArchLensConnection(
        id=uuid.uuid4(),
        name=body.name,
        instance_url=str(body.instance_url).rstrip("/"),
        credentials=creds,
        is_active=body.is_active,
    )
    db.add(conn)
    await db.commit()
    await db.refresh(conn)
    return _mask_credentials(conn)


@router.patch("/connections/{conn_id}", response_model=ArchLensConnectionOut)
async def update_connection(
    conn_id: uuid.UUID,
    body: ArchLensConnectionUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "archlens.manage")
    result = await db.execute(select(ArchLensConnection).where(ArchLensConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")
    if body.name is not None:
        conn.name = body.name
    if body.instance_url is not None:
        conn.instance_url = str(body.instance_url).rstrip("/")
    if body.is_active is not None:
        conn.is_active = body.is_active
    if body.credentials is not None:
        creds = body.credentials
        if "password" in creds and creds["password"] != PASSWORD_MASK:
            creds["password"] = encrypt_value(creds["password"])
        conn.credentials = creds
    await db.commit()
    await db.refresh(conn)
    return _mask_credentials(conn)


@router.delete("/connections/{conn_id}")
async def delete_connection(
    conn_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "archlens.manage")
    await db.execute(delete(ArchLensConnection).where(ArchLensConnection.id == conn_id))
    await db.commit()
    return {"ok": True}


# ── Test connectivity ───────────────────────────────────────────────────────


@router.post("/connections/{conn_id}/test")
async def test_connection(
    conn_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "archlens.manage")
    result = await db.execute(select(ArchLensConnection).where(ArchLensConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")

    client = ArchLensClient(conn.instance_url)
    ok, msg = await client.test_connection()

    now = datetime.now(timezone.utc)
    await db.execute(
        update(ArchLensConnection)
        .where(ArchLensConnection.id == conn_id)
        .values(
            last_tested_at=now,
            test_status="ok" if ok else "failed",
        )
    )
    await db.commit()
    return {"ok": ok, "message": msg}


# ── Data sync ───────────────────────────────────────────────────────────────


@router.post("/connections/{conn_id}/sync")
async def sync_data(
    conn_id: uuid.UUID,
    body: ArchLensSyncRequest | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "archlens.manage")
    result = await db.execute(select(ArchLensConnection).where(ArchLensConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")

    creds = conn.credentials or {}
    turbo_url = (body and body.turbo_ea_url) or creds.get("turbo_ea_url", "")
    email = (body and body.email) or creds.get("email", "")
    raw_password = creds.get("password", "")
    password = (body and body.password) or decrypt_value(raw_password)

    if not turbo_url or not email or not password:
        raise HTTPException(
            400,
            "Turbo EA URL, email, and password are required. "
            "Store them in connection credentials or pass them in the request.",
        )

    # Update sync status
    await db.execute(
        update(ArchLensConnection)
        .where(ArchLensConnection.id == conn_id)
        .values(sync_status="syncing")
    )
    await db.commit()

    client = ArchLensClient(conn.instance_url)
    try:
        sync_result = await client.trigger_sync(turbo_url, email, password)
        now = datetime.now(timezone.utc)
        await db.execute(
            update(ArchLensConnection)
            .where(ArchLensConnection.id == conn_id)
            .values(
                last_synced_at=now,
                sync_status="completed",
            )
        )
        await db.commit()

        # Auto-push Turbo EA AI config to ArchLens after successful sync
        ai_ok, ai_msg = await _push_ai_config_if_available(client, db)
        if ai_ok:
            logger.info("AI config pushed to ArchLens: %s", ai_msg)

        return {"ok": True, "result": sync_result, "ai_config_pushed": ai_ok}
    except Exception as exc:
        await db.execute(
            update(ArchLensConnection)
            .where(ArchLensConnection.id == conn_id)
            .values(sync_status="failed")
        )
        await db.commit()
        raise HTTPException(502, f"Sync failed: {exc}") from exc


# ── Overview ────────────────────────────────────────────────────────────────


@router.get("/connections/{conn_id}/overview")
async def get_overview(
    conn_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "archlens.view")
    result = await db.execute(select(ArchLensConnection).where(ArchLensConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")

    client = ArchLensClient(conn.instance_url)
    workspace = _get_workspace_key(conn)
    return await client.get_overview(workspace)


# ── Vendor analysis ─────────────────────────────────────────────────────────


@router.post("/connections/{conn_id}/analyse/vendors")
async def trigger_vendor_analysis(
    conn_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "archlens.manage")
    result = await db.execute(select(ArchLensConnection).where(ArchLensConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")

    # Create analysis run record
    run = ArchLensAnalysisRun(
        id=uuid.uuid4(),
        connection_id=conn_id,
        analysis_type="vendor_analysis",
        status="running",
        created_by=user.id,
    )
    db.add(run)
    await db.commit()

    client = ArchLensClient(conn.instance_url)
    workspace = _get_workspace_key(conn)
    try:
        analysis_result = await client.trigger_vendor_analysis(workspace)
        now = datetime.now(timezone.utc)
        await db.execute(
            update(ArchLensAnalysisRun)
            .where(ArchLensAnalysisRun.id == run.id)
            .values(
                status="completed",
                completed_at=now,
                results=analysis_result,
            )
        )
        await db.commit()
        return {"ok": True, "run_id": str(run.id), "result": analysis_result}
    except Exception as exc:
        await db.execute(
            update(ArchLensAnalysisRun)
            .where(ArchLensAnalysisRun.id == run.id)
            .values(status="failed", error_message=str(exc))
        )
        await db.commit()
        raise HTTPException(502, f"Vendor analysis failed: {exc}") from exc


@router.get("/connections/{conn_id}/vendors")
async def get_vendors(
    conn_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "archlens.view")
    result = await db.execute(select(ArchLensConnection).where(ArchLensConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")

    client = ArchLensClient(conn.instance_url)
    workspace = _get_workspace_key(conn)
    return await client.get_vendors(workspace)


@router.get("/connections/{conn_id}/vendor-hierarchy")
async def get_vendor_hierarchy(
    conn_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "archlens.view")
    result = await db.execute(select(ArchLensConnection).where(ArchLensConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")

    client = ArchLensClient(conn.instance_url)
    workspace = _get_workspace_key(conn)
    return await client.get_vendor_hierarchy(workspace)


# ── Duplicate detection ─────────────────────────────────────────────────────


@router.post("/connections/{conn_id}/analyse/duplicates")
async def trigger_duplicate_detection(
    conn_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "archlens.manage")
    result = await db.execute(select(ArchLensConnection).where(ArchLensConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")

    run = ArchLensAnalysisRun(
        id=uuid.uuid4(),
        connection_id=conn_id,
        analysis_type="duplicate_detection",
        status="running",
        created_by=user.id,
    )
    db.add(run)
    await db.commit()

    client = ArchLensClient(conn.instance_url)
    workspace = _get_workspace_key(conn)
    try:
        detection_result = await client.trigger_duplicate_detection(workspace)
        now = datetime.now(timezone.utc)
        await db.execute(
            update(ArchLensAnalysisRun)
            .where(ArchLensAnalysisRun.id == run.id)
            .values(
                status="completed",
                completed_at=now,
                results=detection_result,
            )
        )
        await db.commit()
        return {
            "ok": True,
            "run_id": str(run.id),
            "result": detection_result,
        }
    except Exception as exc:
        await db.execute(
            update(ArchLensAnalysisRun)
            .where(ArchLensAnalysisRun.id == run.id)
            .values(status="failed", error_message=str(exc))
        )
        await db.commit()
        raise HTTPException(502, f"Duplicate detection failed: {exc}") from exc


@router.get("/connections/{conn_id}/duplicates")
async def get_duplicates(
    conn_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "archlens.view")
    result = await db.execute(select(ArchLensConnection).where(ArchLensConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")

    client = ArchLensClient(conn.instance_url)
    workspace = _get_workspace_key(conn)
    return await client.get_duplicates(workspace)


# ── Architecture AI ─────────────────────────────────────────────────────────


@router.post("/connections/{conn_id}/architect")
async def run_architect(
    conn_id: uuid.UUID,
    body: ArchLensArchitectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "archlens.manage")
    result = await db.execute(select(ArchLensConnection).where(ArchLensConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")

    client = ArchLensClient(conn.instance_url)
    workspace = _get_workspace_key(conn)

    if body.phase == 1:
        if not body.requirement:
            raise HTTPException(400, "requirement is required for phase 1")
        return await client.architect_phase1(workspace, body.requirement)
    elif body.phase == 2:
        if not body.requirement or not body.phase1_qa:
            raise HTTPException(400, "requirement and phase1QA required for phase 2")
        return await client.architect_phase2(workspace, body.requirement, body.phase1_qa)
    elif body.phase == 3:
        if not body.requirement or not body.all_qa:
            raise HTTPException(400, "requirement and allQA required for phase 3")
        return await client.architect_phase3(workspace, body.requirement, body.all_qa)
    else:
        raise HTTPException(400, "phase must be 1, 2, or 3")


# ── Analysis history ────────────────────────────────────────────────────────


@router.get("/analysis-runs")
async def list_analysis_runs(
    connection_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "archlens.view")
    q = select(ArchLensAnalysisRun).order_by(ArchLensAnalysisRun.started_at.desc())
    if connection_id:
        q = q.where(ArchLensAnalysisRun.connection_id == connection_id)
    q = q.limit(50)
    result = await db.execute(q)
    runs = result.scalars().all()
    return [
        {
            "id": str(r.id),
            "connection_id": str(r.connection_id),
            "analysis_type": r.analysis_type,
            "status": r.status,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "completed_at": (r.completed_at.isoformat() if r.completed_at else None),
            "error_message": r.error_message,
        }
        for r in runs
    ]


# ── Push AI config ─────────────────────────────────────────────────────────


@router.post("/connections/{conn_id}/push-ai-config")
async def push_ai_config(
    conn_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "archlens.manage")
    result = await db.execute(select(ArchLensConnection).where(ArchLensConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connection not found")

    client = ArchLensClient(conn.instance_url)
    ok, msg = await _push_ai_config_if_available(client, db)
    if not ok:
        raise HTTPException(400, msg)
    return {"ok": True, "message": msg}
