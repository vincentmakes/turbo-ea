"""TurboLens native integration — AI-powered EA intelligence.

Direct service calls replacing the old proxy-to-container pattern.
All TurboLens AI services now query the cards table directly and
use Turbo EA's AI configuration from app_settings.
"""

from __future__ import annotations

import enum
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import Float as SAFloat
from sqlalchemy import cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.turbolens import (
    TurboLensAnalysisRun,
    TurboLensAssessment,
    TurboLensComplianceFinding,
    TurboLensCveFinding,
    TurboLensDuplicateCluster,
    TurboLensModernization,
    TurboLensVendorAnalysis,
    TurboLensVendorHierarchy,
)
from app.models.user import User
from app.schemas.turbolens import (
    SUPPORTED_REGULATIONS,
    ComplianceBundleOut,
    ComplianceFindingDecisionUpdate,
    ComplianceFindingOut,
    CveFindingOut,
    CveFindingStatusUpdate,
    DuplicateClusterOut,
    ModernizationOut,
    SecurityOverviewOut,
    SecurityScanRequest,
    TurboLensAnalysisRunOut,
    TurboLensArchitectRequest,
    TurboLensAssessmentCreate,
    TurboLensAssessmentUpdate,
    TurboLensCommitRequest,
    TurboLensDuplicateStatusUpdate,
    TurboLensModernizeRequest,
    TurboLensOverviewOut,
    TurboLensStatusOut,
    VendorAnalysisOut,
    VendorHierarchyOut,
)
from app.services.permission_service import PermissionService
from app.services.turbolens_ai import get_ai_config, is_ai_configured

logger = logging.getLogger(__name__)


# ── Enums ─────────────────────────────────────────────────────────────────


class AnalysisType(str, enum.Enum):
    VENDOR_ANALYSIS = "vendor_analysis"
    VENDOR_RESOLUTION = "vendor_resolution"
    DUPLICATE_DETECTION = "duplicate_detection"
    MODERNIZATION = "modernization"
    ARCHITECT = "architect"
    ARCHITECT_COMMIT = "architect_commit"
    SECURITY_CVE = "security_cve"
    SECURITY_COMPLIANCE = "security_compliance"


SECURITY_SCAN_TYPES = (AnalysisType.SECURITY_CVE, AnalysisType.SECURITY_COMPLIANCE)


class AnalysisStatus(str, enum.Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


# ── Background task helper ────────────────────────────────────────────────


async def _run_analysis(
    run_id: str,
    service_fn: Callable[[AsyncSession], Awaitable[dict[str, Any]]],
    label: str,
) -> None:
    """Generic background task runner that updates TurboLensAnalysisRun status."""
    from app.database import async_session

    async with async_session() as db:
        try:
            result = await service_fn(db)

            run = await db.get(TurboLensAnalysisRun, uuid.UUID(run_id))
            if run:
                run.status = AnalysisStatus.COMPLETED
                run.completed_at = datetime.now(timezone.utc)
                run.results = result
                await db.commit()
        except Exception as e:
            logger.exception("%s failed: %s", label, e)
            # Use a fresh session since the original may be in a bad state
            async with async_session() as db2:
                run = await db2.get(TurboLensAnalysisRun, uuid.UUID(run_id))
                if run:
                    run.status = AnalysisStatus.FAILED
                    run.completed_at = datetime.now(timezone.utc)
                    run.error_message = str(e)
                    await db2.commit()


async def _create_analysis_run(
    db: AsyncSession,
    analysis_type: AnalysisType,
    user: User,
) -> TurboLensAnalysisRun:
    """Create an analysis run, raising 409 if one is already running."""
    existing = await db.execute(
        select(TurboLensAnalysisRun).where(
            TurboLensAnalysisRun.analysis_type == analysis_type,
            TurboLensAnalysisRun.status == AnalysisStatus.RUNNING,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"{analysis_type.value} analysis is already running")

    run = TurboLensAnalysisRun(
        id=uuid.uuid4(),
        analysis_type=analysis_type,
        status=AnalysisStatus.RUNNING,
        started_at=datetime.now(timezone.utc),
        created_by=user.id,
    )
    db.add(run)
    await db.commit()
    return run


router = APIRouter(prefix="/turbolens", tags=["TurboLens"])


# ── Status & Overview ──────────────────────────────────────────────────────


@router.get("/status")
async def turbolens_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TurboLensStatusOut:
    """Check if TurboLens AI is configured, enabled, and ready."""
    from app.models.app_settings import AppSettings

    config = await get_ai_config(db)
    configured = is_ai_configured(config)

    settings_row = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = settings_row.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    enabled = bool(general.get("turboLensEnabled", True))

    return TurboLensStatusOut(
        ai_configured=configured,
        ready=configured and enabled,
        enabled=enabled,
    )


@router.get("/overview")
async def turbolens_overview(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TurboLensOverviewOut:
    """Dashboard KPIs: card counts, quality, vendor/duplicate summaries."""
    await PermissionService.require_permission(db, user, "turbolens.view")

    active = Card.status != "ARCHIVED"

    # Card counts by type
    type_counts = await db.execute(
        select(Card.type, func.count(Card.id)).where(active).group_by(Card.type)
    )
    cards_by_type = {t: c for t, c in type_counts.all()}
    total_cards = sum(cards_by_type.values())

    # Average data quality
    quality_result = await db.execute(select(func.avg(Card.data_quality)).where(active))
    quality_avg = quality_result.scalar() or 0

    # Quality distribution: Bronze (<45), Silver (45-79), Gold (>=80)
    bronze_result = await db.execute(
        select(func.count(Card.id)).where(active, Card.data_quality < 45)
    )
    silver_result = await db.execute(
        select(func.count(Card.id)).where(active, Card.data_quality >= 45, Card.data_quality < 80)
    )
    gold_result = await db.execute(
        select(func.count(Card.id)).where(active, Card.data_quality >= 80)
    )
    quality_bronze = bronze_result.scalar() or 0
    quality_silver = silver_result.scalar() or 0
    quality_gold = gold_result.scalar() or 0

    # Total annual IT cost
    cost_result = await db.execute(
        select(func.sum(cast(Card.attributes["costTotalAnnual"].as_string(), SAFloat))).where(
            active, Card.attributes["costTotalAnnual"].isnot(None)
        )
    )
    total_cost = cost_result.scalar() or 0

    # Vendor count
    vendor_count = await db.execute(select(func.count(TurboLensVendorAnalysis.id)))
    v_count = vendor_count.scalar() or 0

    # Duplicate cluster count
    dup_count_result = await db.execute(select(func.count(TurboLensDuplicateCluster.id)))
    dup_count = dup_count_result.scalar() or 0

    # Modernization count
    mod_count_result = await db.execute(select(func.count(TurboLensModernization.id)))
    mod_count = mod_count_result.scalar() or 0

    # Top issues: low quality cards
    low_quality = await db.execute(
        select(Card.id, Card.name, Card.type, Card.data_quality)
        .where(active, Card.data_quality < 40)
        .order_by(Card.data_quality.asc())
        .limit(10)
    )
    top_issues = [
        {
            "id": str(r.id),
            "name": r.name,
            "type": r.type,
            "data_quality": r.data_quality,
        }
        for r in low_quality.all()
    ]

    return TurboLensOverviewOut(
        total_cards=total_cards,
        cards_by_type=cards_by_type,
        quality_avg=round(quality_avg, 1),
        quality_bronze=quality_bronze,
        quality_silver=quality_silver,
        quality_gold=quality_gold,
        total_cost=round(total_cost, 2),
        vendor_count=v_count,
        duplicate_clusters=dup_count,
        modernization_count=mod_count,
        top_issues=top_issues,
    )


# ── Vendor Analysis ───────────────────────────────────────────────────────


@router.post("/vendors/analyse")
async def trigger_vendor_analysis(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Trigger vendor categorisation (background task)."""
    await PermissionService.require_permission(db, user, "turbolens.manage")

    run = await _create_analysis_run(db, AnalysisType.VENDOR_ANALYSIS, user)

    async def _service(db_: AsyncSession) -> dict[str, Any]:
        from app.services.turbolens_vendors import analyse_vendors

        return await analyse_vendors(db_)

    background_tasks.add_task(_run_analysis, str(run.id), _service, "Vendor analysis")
    return {"run_id": str(run.id), "status": "running"}


@router.get("/vendors")
async def get_vendors(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[VendorAnalysisOut]:
    """Get categorised vendors."""
    await PermissionService.require_permission(db, user, "turbolens.view")

    result = await db.execute(
        select(TurboLensVendorAnalysis).order_by(TurboLensVendorAnalysis.app_count.desc())
    )
    return [
        VendorAnalysisOut.model_validate(v, from_attributes=True) for v in result.scalars().all()
    ]


# ── Vendor Resolution ─────────────────────────────────────────────────────


@router.post("/vendors/resolve")
async def trigger_vendor_resolution(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Trigger vendor hierarchy resolution (background task)."""
    await PermissionService.require_permission(db, user, "turbolens.manage")

    run = await _create_analysis_run(db, AnalysisType.VENDOR_RESOLUTION, user)

    async def _service(db_: AsyncSession) -> dict[str, Any]:
        from app.services.turbolens_vendors import resolve_vendors

        return await resolve_vendors(db_)

    background_tasks.add_task(_run_analysis, str(run.id), _service, "Vendor resolution")
    return {"run_id": str(run.id), "status": "running"}


@router.get("/vendors/hierarchy")
async def get_vendor_hierarchy(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[VendorHierarchyOut]:
    """Get canonical vendor hierarchy tree."""
    await PermissionService.require_permission(db, user, "turbolens.view")

    result = await db.execute(
        select(TurboLensVendorHierarchy).order_by(TurboLensVendorHierarchy.app_count.desc())
    )
    return [
        VendorHierarchyOut.model_validate(v, from_attributes=True) for v in result.scalars().all()
    ]


# ── Duplicate Detection ───────────────────────────────────────────────────


@router.post("/duplicates/analyse")
async def trigger_duplicate_detection(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Trigger duplicate detection (background task)."""
    await PermissionService.require_permission(db, user, "turbolens.manage")

    run = await _create_analysis_run(db, AnalysisType.DUPLICATE_DETECTION, user)

    async def _service(db_: AsyncSession) -> dict[str, Any]:
        from app.services.turbolens_duplicates import detect_duplicates

        return await detect_duplicates(db_)

    background_tasks.add_task(_run_analysis, str(run.id), _service, "Duplicate detection")
    return {"run_id": str(run.id), "status": "running"}


@router.get("/duplicates")
async def get_duplicates(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[DuplicateClusterOut]:
    """Get duplicate clusters."""
    await PermissionService.require_permission(db, user, "turbolens.view")

    result = await db.execute(
        select(TurboLensDuplicateCluster).order_by(TurboLensDuplicateCluster.analysed_at.desc())
    )
    return [
        DuplicateClusterOut.model_validate(c, from_attributes=True) for c in result.scalars().all()
    ]


@router.patch("/duplicates/{cluster_id}/status")
async def update_duplicate_status(
    cluster_id: str,
    body: TurboLensDuplicateStatusUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update cluster status (confirm/dismiss/investigate)."""
    await PermissionService.require_permission(db, user, "turbolens.manage")

    cluster = await db.get(TurboLensDuplicateCluster, uuid.UUID(cluster_id))
    if not cluster:
        raise HTTPException(404, "Cluster not found")

    valid_statuses = {"pending", "confirmed", "investigating", "dismissed"}
    if body.status not in valid_statuses:
        raise HTTPException(400, f"Invalid status. Must be one of: {valid_statuses}")

    cluster.status = body.status
    await db.commit()
    await db.refresh(cluster)
    return DuplicateClusterOut.model_validate(cluster, from_attributes=True)


# ── Modernization ─────────────────────────────────────────────────────────


@router.post("/duplicates/modernize")
async def trigger_modernization(
    body: TurboLensModernizeRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Trigger modernization assessment for a card type."""
    await PermissionService.require_permission(db, user, "turbolens.manage")

    run = await _create_analysis_run(db, AnalysisType.MODERNIZATION, user)

    target_type = body.target_type
    modernization_type = body.modernization_type

    async def _service(db_: AsyncSession) -> dict[str, Any]:
        from app.services.turbolens_duplicates import assess_modernization

        return await assess_modernization(db_, target_type, modernization_type)

    background_tasks.add_task(_run_analysis, str(run.id), _service, "Modernization")
    return {"run_id": str(run.id), "status": "running"}


@router.get("/duplicates/modernizations")
async def get_modernizations(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ModernizationOut]:
    """Get modernization assessments."""
    await PermissionService.require_permission(db, user, "turbolens.view")

    result = await db.execute(
        select(TurboLensModernization).order_by(TurboLensModernization.analysed_at.desc())
    )
    return [
        ModernizationOut.model_validate(m, from_attributes=True) for m in result.scalars().all()
    ]


# ── Architecture AI ───────────────────────────────────────────────────────


@router.get("/architect/objectives")
async def architect_objectives(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    search: str | None = None,
):
    """Search Objective cards for architect objective selection."""
    from sqlalchemy import or_

    await PermissionService.require_permission(db, user, "turbolens.manage")

    q = select(Card).where(Card.type == "Objective", Card.status != "ARCHIVED")
    if search:
        q = q.where(
            or_(
                Card.name.ilike(f"%{search}%"),
                Card.description.ilike(f"%{search}%"),
            )
        )
    q = q.order_by(Card.name).limit(50)
    result = await db.execute(q)
    cards = result.scalars().all()
    return [
        {
            "id": str(c.id),
            "name": c.name,
            "description": c.description,
            "subtype": c.subtype,
        }
        for c in cards
    ]


@router.get("/architect/capabilities")
async def architect_capabilities(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    search: str | None = None,
):
    """Search BusinessCapability cards for architect capability selection."""
    from sqlalchemy import or_

    await PermissionService.require_permission(db, user, "turbolens.manage")

    q = select(Card).where(Card.type == "BusinessCapability", Card.status != "ARCHIVED")
    if search:
        q = q.where(
            or_(
                Card.name.ilike(f"%{search}%"),
                Card.description.ilike(f"%{search}%"),
            )
        )
    q = q.order_by(Card.name).limit(50)
    result = await db.execute(q)
    cards = result.scalars().all()
    return [
        {
            "id": str(c.id),
            "name": c.name,
            "description": c.description,
        }
        for c in cards
    ]


@router.get("/architect/objective-dependencies")
async def architect_objective_dependencies(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    objective_ids: str = "",
):
    """Fetch dependency subgraph for selected Objectives (BFS depth 3)."""
    from app.models.relation import Relation
    from app.models.relation_type import RelationType

    await PermissionService.require_permission(db, user, "turbolens.manage")

    ids = [oid.strip() for oid in objective_ids.split(",") if oid.strip()]
    if not ids:
        return {"nodes": [], "edges": []}

    # Load all active cards
    full_result = await db.execute(select(Card).where(Card.status == "ACTIVE"))
    all_cards = full_result.scalars().all()
    card_map = {str(c.id): c for c in all_cards}

    # Validate objective IDs
    seed_ids = {oid for oid in ids if oid in card_map}
    if not seed_ids:
        return {"nodes": [], "edges": []}

    # Load all relations + relation type labels
    all_card_ids = list(card_map.keys())
    card_uuids = [uuid.UUID(cid) for cid in all_card_ids]
    rels_result = await db.execute(
        select(Relation).where(
            (Relation.source_id.in_(card_uuids)) | (Relation.target_id.in_(card_uuids))
        )
    )
    rels = rels_result.scalars().all()

    rt_result = await db.execute(
        select(RelationType.key, RelationType.label, RelationType.reverse_label)
    )
    rel_type_info = {row[0]: {"label": row[1], "reverse_label": row[2]} for row in rt_result.all()}

    # BFS depth 3
    adj: dict[str, list[tuple[str, str]]] = {}
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        if sid in card_map and tid in card_map:
            adj.setdefault(sid, []).append((tid, r.type))
            adj.setdefault(tid, []).append((sid, r.type))

    # BFS depth-1: only direct neighbors of selected objectives
    visited: set[str] = set(seed_ids)
    for nid in seed_ids:
        for neighbor, _ in adj.get(nid, []):
            visited.add(neighbor)

    # Build ancestor path
    def _ancestor_path(card_id: str) -> list[str]:
        path: list[str] = []
        cur = card_map.get(card_id)
        seen: set[str] = set()
        while cur and cur.parent_id:
            pid = str(cur.parent_id)
            if pid in seen:
                break
            seen.add(pid)
            parent = card_map.get(pid)
            if not parent:
                break
            path.insert(0, parent.name)
            cur = parent
        return path

    nodes = []
    for nid in visited:
        card = card_map.get(nid)
        if not card:
            continue
        nodes.append(
            {
                "id": nid,
                "name": card.name,
                "type": card.type,
                "lifecycle": card.lifecycle,
                "attributes": card.attributes,
                "parent_id": str(card.parent_id) if card.parent_id else None,
                "path": _ancestor_path(nid),
            }
        )

    edges = []
    seen_edges: set[str] = set()
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        if sid in visited and tid in visited:
            edge_key = f"{min(sid, tid)}:{max(sid, tid)}"
            if edge_key not in seen_edges:
                seen_edges.add(edge_key)
                rt_info = rel_type_info.get(r.type, {})
                edges.append(
                    {
                        "source": sid,
                        "target": tid,
                        "type": r.type,
                        "label": rt_info.get("label", r.type),
                        "reverse_label": rt_info.get("reverse_label"),
                    }
                )

    return {"nodes": nodes, "edges": edges}


@router.post("/architect/phase1")
async def architect_phase1(
    body: TurboLensArchitectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Phase 1: business & functional clarification questions."""
    await PermissionService.require_permission(db, user, "turbolens.manage")

    if not body.requirement:
        raise HTTPException(400, "Requirement is required for Phase 1")

    from app.services.turbolens_architect import phase1_questions

    obj_ids = body.objective_ids if isinstance(body.objective_ids, list) else []
    caps = body.selected_capabilities if isinstance(body.selected_capabilities, list) else []
    result = await phase1_questions(db, body.requirement, obj_ids or None, caps or None)
    return result


@router.post("/architect/phase2")
async def architect_phase2(
    body: TurboLensArchitectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Phase 2: technical & NFR deep-dive questions."""
    await PermissionService.require_permission(db, user, "turbolens.manage")

    if not body.requirement or not body.phase1_qa:
        raise HTTPException(400, "Requirement and phase1QA are required for Phase 2")

    from app.services.turbolens_architect import phase2_questions

    qa_list = body.phase1_qa if isinstance(body.phase1_qa, list) else []
    obj_ids = body.objective_ids if isinstance(body.objective_ids, list) else []
    caps = body.selected_capabilities if isinstance(body.selected_capabilities, list) else []
    result = await phase2_questions(db, body.requirement, qa_list, obj_ids or None, caps or None)
    return result


@router.post("/architect/phase3/options")
async def architect_phase3_options(
    body: TurboLensArchitectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Phase 3a: generate solution options."""
    await PermissionService.require_permission(db, user, "turbolens.manage")

    if not body.requirement or not body.all_qa:
        raise HTTPException(400, "Requirement and allQA are required")

    from app.services.turbolens_architect import phase3_options

    qa_list = body.all_qa if isinstance(body.all_qa, list) else []
    obj_ids = body.objective_ids if isinstance(body.objective_ids, list) else []
    caps = body.selected_capabilities if isinstance(body.selected_capabilities, list) else []
    return await phase3_options(db, body.requirement, qa_list, obj_ids or None, caps or None)


@router.post("/architect/phase3/gaps")
async def architect_phase3_gaps(
    body: TurboLensArchitectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Phase 3b: identify products needed for the business requirements."""
    await PermissionService.require_permission(db, user, "turbolens.manage")

    if not body.requirement or not body.all_qa:
        raise HTTPException(400, "Requirement and allQA are required")
    if not body.selected_option:
        raise HTTPException(400, "selectedOption is required for gap analysis")

    from app.services.turbolens_architect import phase3_gaps

    qa_list = body.all_qa if isinstance(body.all_qa, list) else []
    option = body.selected_option if isinstance(body.selected_option, dict) else {}
    obj_ids = body.objective_ids if isinstance(body.objective_ids, list) else []
    caps = body.selected_capabilities if isinstance(body.selected_capabilities, list) else []
    return await phase3_gaps(db, body.requirement, qa_list, option, obj_ids or None, caps or None)


@router.post("/architect/phase3/deps")
async def architect_phase3_deps(
    body: TurboLensArchitectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Phase 3c: dependency analysis for selected products."""
    await PermissionService.require_permission(db, user, "turbolens.manage")

    if not body.requirement or not body.all_qa:
        raise HTTPException(400, "Requirement and allQA are required")
    if not body.selected_option:
        raise HTTPException(400, "selectedOption is required")
    if not body.selected_products:
        raise HTTPException(400, "selectedProducts is required")

    from app.services.turbolens_architect import phase3_deps

    qa_list = body.all_qa if isinstance(body.all_qa, list) else []
    option = body.selected_option if isinstance(body.selected_option, dict) else {}
    products = body.selected_products if isinstance(body.selected_products, list) else []
    return await phase3_deps(db, body.requirement, qa_list, option, products)


@router.post("/architect/phase3")
async def architect_phase3(
    body: TurboLensArchitectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Phase 4: capability mapping with selected option context."""
    await PermissionService.require_permission(db, user, "turbolens.manage")

    if not body.requirement or not body.all_qa:
        raise HTTPException(400, "Requirement and allQA are required for Phase 3")

    from app.models.relation import Relation
    from app.models.relation_type import RelationType
    from app.services.turbolens_architect import phase3_capability_mapping

    qa_list = body.all_qa if isinstance(body.all_qa, list) else []
    obj_ids = body.objective_ids or []
    option = body.selected_option if isinstance(body.selected_option, dict) else None

    # Fetch dependency subgraph for the selected objectives
    dep_graph: dict[str, Any] = {"nodes": [], "edges": []}
    if obj_ids:
        full_result = await db.execute(select(Card).where(Card.status == "ACTIVE"))
        all_cards = full_result.scalars().all()
        card_map = {str(c.id): c for c in all_cards}

        seed_ids = {oid for oid in obj_ids if oid in card_map}
        if seed_ids:
            card_uuids = [uuid.UUID(cid) for cid in card_map]
            rels_result = await db.execute(
                select(Relation).where(
                    (Relation.source_id.in_(card_uuids)) | (Relation.target_id.in_(card_uuids))
                )
            )
            rels = rels_result.scalars().all()

            rt_result = await db.execute(
                select(
                    RelationType.key,
                    RelationType.label,
                    RelationType.reverse_label,
                )
            )
            rel_type_info = {
                row[0]: {"label": row[1], "reverse_label": row[2]} for row in rt_result.all()
            }

            adj: dict[str, list[tuple[str, str]]] = {}
            for r in rels:
                sid, tid = str(r.source_id), str(r.target_id)
                if sid in card_map and tid in card_map:
                    adj.setdefault(sid, []).append((tid, r.type))
                    adj.setdefault(tid, []).append((sid, r.type))

            # BFS depth-1: only direct neighbors of selected objectives
            visited: set[str] = set(seed_ids)
            for nid in seed_ids:
                for neighbor, _ in adj.get(nid, []):
                    visited.add(neighbor)

            dep_nodes = []
            for nid in visited:
                card = card_map.get(nid)
                if card:
                    dep_nodes.append(
                        {
                            "id": nid,
                            "name": card.name,
                            "type": card.type,
                            "subtype": card.subtype,
                        }
                    )

            dep_edges = []
            seen_e: set[str] = set()
            for r in rels:
                sid, tid = str(r.source_id), str(r.target_id)
                if sid in visited and tid in visited:
                    ek = f"{min(sid, tid)}:{max(sid, tid)}"
                    if ek not in seen_e:
                        seen_e.add(ek)
                        rt_info = rel_type_info.get(r.type, {})
                        dep_edges.append(
                            {
                                "source": sid,
                                "target": tid,
                                "type": r.type,
                                "label": rt_info.get("label", r.type),
                                "reverse_label": rt_info.get("reverse_label"),
                            }
                        )

            dep_graph = {"nodes": dep_nodes, "edges": dep_edges}

    sel_recs = body.selected_recommendations or []
    caps = body.selected_capabilities if isinstance(body.selected_capabilities, list) else []
    result = await phase3_capability_mapping(
        db,
        body.requirement,
        qa_list,
        obj_ids,
        dep_graph,
        option,
        sel_recs,
        caps or None,
    )

    # Record the run
    run = TurboLensAnalysisRun(
        id=uuid.uuid4(),
        analysis_type=AnalysisType.ARCHITECT,
        status=AnalysisStatus.COMPLETED,
        started_at=datetime.now(timezone.utc),
        completed_at=datetime.now(timezone.utc),
        results=result,
        created_by=user.id,
    )
    db.add(run)
    await db.commit()

    return result


# ── Security & Compliance ─────────────────────────────────────────────────


async def _load_card_names(db: AsyncSession, card_ids: set[uuid.UUID]) -> dict[str, str]:
    if not card_ids:
        return {}
    result = await db.execute(select(Card.id, Card.name).where(Card.id.in_(card_ids)))
    return {str(cid): name for cid, name in result.all()}


@router.post("/security/cve-scan")
async def trigger_cve_scan(
    body: SecurityScanRequest | None,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Trigger the CVE (NVD + AI prioritisation) pipeline only."""
    await PermissionService.require_permission(db, user, "security_compliance.manage")

    run = await _create_analysis_run(db, AnalysisType.SECURITY_CVE, user)
    include_itc = body.include_itc if body else True
    user_id = str(user.id)

    async def _service(db_: AsyncSession) -> dict[str, Any]:
        from app.services.turbolens_security import run_cve_scan

        return await run_cve_scan(db_, run.id, user_id, include_itc=include_itc)

    background_tasks.add_task(_run_analysis, str(run.id), _service, "CVE scan")
    return {"run_id": str(run.id), "status": "running"}


@router.post("/security/compliance-scan")
async def trigger_compliance_scan(
    body: SecurityScanRequest | None,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Trigger the compliance (per-regulation AI gap analysis) pipeline only."""
    await PermissionService.require_permission(db, user, "security_compliance.manage")

    run = await _create_analysis_run(db, AnalysisType.SECURITY_COMPLIANCE, user)
    regulations = (body.regulations if body else None) or list(SUPPORTED_REGULATIONS)
    user_id = str(user.id)

    async def _service(db_: AsyncSession) -> dict[str, Any]:
        from app.services.turbolens_security import run_compliance_scan

        return await run_compliance_scan(db_, run.id, user_id, regulations=regulations)

    background_tasks.add_task(_run_analysis, str(run.id), _service, "Compliance scan")
    return {"run_id": str(run.id), "status": "running"}


@router.get("/security/active-runs")
async def security_active_runs(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, TurboLensAnalysisRunOut | None]:
    """Return the latest running CVE + compliance scans.

    Used by the UI on mount to reattach polling and show progress even
    after a page refresh. Either key is ``null`` when no scan of that
    type is currently running.
    """
    await PermissionService.require_permission(db, user, "security_compliance.view")

    out: dict[str, TurboLensAnalysisRunOut | None] = {"cve": None, "compliance": None}
    for key, scan_type in (
        ("cve", AnalysisType.SECURITY_CVE),
        ("compliance", AnalysisType.SECURITY_COMPLIANCE),
    ):
        result = await db.execute(
            select(TurboLensAnalysisRun)
            .where(
                TurboLensAnalysisRun.analysis_type == scan_type,
                TurboLensAnalysisRun.status == AnalysisStatus.RUNNING,
            )
            .order_by(TurboLensAnalysisRun.started_at.desc())
            .limit(1)
        )
        run = result.scalar_one_or_none()
        if run:
            out[key] = TurboLensAnalysisRunOut.model_validate(run, from_attributes=True)
    return out


@router.get("/security/overview")
async def security_overview(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SecurityOverviewOut:
    """KPIs + risk matrix + top critical findings for the dashboard."""
    await PermissionService.require_permission(db, user, "security_compliance.view")

    from app.schemas.turbolens import SecurityScanRunOut
    from app.services.turbolens_security import (
        build_risk_matrix,
        compliance_score,
        finding_to_dict,
    )

    async def _latest(scan_type: AnalysisType) -> SecurityScanRunOut:
        result = await db.execute(
            select(TurboLensAnalysisRun)
            .where(TurboLensAnalysisRun.analysis_type == scan_type)
            .order_by(TurboLensAnalysisRun.started_at.desc())
            .limit(1)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return SecurityScanRunOut()
        # While the scan is running, results holds the progress dict.
        # Once complete, it holds the final summary. Split them apart.
        progress = None
        summary = None
        if isinstance(row.results, dict):
            if row.status == AnalysisStatus.RUNNING:
                progress = row.results.get("progress") or None
            else:
                summary = row.results
        return SecurityScanRunOut(
            run_id=str(row.id),
            status=row.status,
            started_at=row.started_at,
            completed_at=row.completed_at,
            error=row.error_message,
            progress=progress,
            summary=summary,
        )

    cve_run = await _latest(AnalysisType.SECURITY_CVE)
    compliance_run = await _latest(AnalysisType.SECURITY_COMPLIANCE)

    cve_res = await db.execute(select(TurboLensCveFinding))
    cve_rows = list(cve_res.scalars().all())

    compliance_res = await db.execute(select(TurboLensComplianceFinding))
    compliance_rows = list(compliance_res.scalars().all())

    by_severity: dict[str, int] = {}
    by_status: dict[str, int] = {}
    by_probability: dict[str, int] = {}
    for row in cve_rows:
        by_severity[row.severity] = by_severity.get(row.severity, 0) + 1
        by_status[row.status] = by_status.get(row.status, 0) + 1
        by_probability[row.probability] = by_probability.get(row.probability, 0) + 1

    by_regulation: dict[str, list[TurboLensComplianceFinding]] = {}
    for comp_row in compliance_rows:
        by_regulation.setdefault(comp_row.regulation, []).append(comp_row)
    compliance_scores = {reg: compliance_score(rows) for reg, rows in by_regulation.items()}

    compliance_by_status: dict[str, dict[str, int]] = {}
    for reg in SUPPORTED_REGULATIONS:
        status_counts: dict[str, int] = {}
        for comp_row in by_regulation.get(reg, []):
            status_counts[comp_row.status] = status_counts.get(comp_row.status, 0) + 1
        compliance_by_status[reg] = status_counts

    # Top 5 criticals, joined with card names.
    from app.services.turbolens_security import load_risk_references

    criticals = sorted(
        (r for r in cve_rows if r.severity in ("critical", "high")),
        key=lambda r: (r.severity != "critical", -(r.cvss_score or 0.0)),
    )[:5]
    name_map = await _load_card_names(db, {r.card_id for r in criticals})
    risk_refs = await load_risk_references(db, {r.risk_id for r in criticals if r.risk_id})
    top_critical = [
        CveFindingOut.model_validate(
            finding_to_dict(
                r,
                name_map.get(str(r.card_id)),
                risk_reference=risk_refs.get(str(r.risk_id)) if r.risk_id else None,
            )
        )
        for r in criticals
    ]

    return SecurityOverviewOut(
        cve_run=cve_run,
        compliance_run=compliance_run,
        total_findings=len(cve_rows),
        by_severity=by_severity,
        by_status=by_status,
        by_probability=by_probability,
        risk_matrix=build_risk_matrix(cve_rows),
        compliance_scores=compliance_scores,
        compliance_by_status=compliance_by_status,
        top_critical=top_critical,
    )


_SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "unknown": 4}
_PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


@router.get("/security/findings")
async def list_cve_findings(
    severity: str | None = None,
    probability: str | None = None,
    status: str | None = None,
    card_id: str | None = None,
    card_type: str | None = None,
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Paginated CVE findings list. ``probability`` + ``severity`` together
    drive the risk-matrix drill-through from the Security Overview.
    """
    await PermissionService.require_permission(db, user, "security_compliance.view")

    from app.services.turbolens_security import finding_to_dict, load_risk_references

    stmt = select(TurboLensCveFinding)
    if severity:
        stmt = stmt.where(TurboLensCveFinding.severity == severity)
    if probability:
        stmt = stmt.where(TurboLensCveFinding.probability == probability)
    if status:
        stmt = stmt.where(TurboLensCveFinding.status == status)
    if card_type:
        stmt = stmt.where(TurboLensCveFinding.card_type == card_type)
    if card_id:
        try:
            stmt = stmt.where(TurboLensCveFinding.card_id == uuid.UUID(card_id))
        except ValueError as exc:
            raise HTTPException(400, "Invalid card_id") from exc

    rows_res = await db.execute(stmt)
    rows = list(rows_res.scalars().all())
    rows.sort(
        key=lambda r: (
            _PRIORITY_ORDER.get(r.priority, 9),
            _SEVERITY_ORDER.get(r.severity, 9),
            -(r.cvss_score or 0.0),
        )
    )

    total = len(rows)
    page = max(page, 1)
    page_size = max(min(page_size, 200), 1)
    start = (page - 1) * page_size
    page_rows = rows[start : start + page_size]
    name_map = await _load_card_names(db, {r.card_id for r in page_rows})
    risk_refs = await load_risk_references(db, {r.risk_id for r in page_rows if r.risk_id})
    items = [
        CveFindingOut.model_validate(
            finding_to_dict(
                r,
                name_map.get(str(r.card_id)),
                risk_reference=risk_refs.get(str(r.risk_id)) if r.risk_id else None,
            )
        )
        for r in page_rows
    ]
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


async def _one_cve_out(db: AsyncSession, row: TurboLensCveFinding) -> "CveFindingOut":
    """Shared serialiser for /findings/{id} get + patch — resolves the
    card name and the promoted risk reference in a single round-trip.
    """
    from app.services.turbolens_security import finding_to_dict, load_risk_references

    name_map = await _load_card_names(db, {row.card_id})
    risk_refs = await load_risk_references(db, {row.risk_id} if row.risk_id else set())
    return CveFindingOut.model_validate(
        finding_to_dict(
            row,
            name_map.get(str(row.card_id)),
            risk_reference=risk_refs.get(str(row.risk_id)) if row.risk_id else None,
        )
    )


@router.get("/security/findings/{finding_id}")
async def get_cve_finding(
    finding_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CveFindingOut:
    await PermissionService.require_permission(db, user, "security_compliance.view")
    row = await db.get(TurboLensCveFinding, uuid.UUID(finding_id))
    if not row:
        raise HTTPException(404, "Finding not found")
    return await _one_cve_out(db, row)


@router.patch("/security/findings/{finding_id}")
async def update_cve_finding_status(
    finding_id: str,
    body: CveFindingStatusUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CveFindingOut:
    await PermissionService.require_permission(db, user, "security_compliance.manage")
    row = await db.get(TurboLensCveFinding, uuid.UUID(finding_id))
    if not row:
        raise HTTPException(404, "Finding not found")
    row.status = body.status
    await db.commit()
    await db.refresh(row)
    return await _one_cve_out(db, row)


@router.get("/security/compliance")
async def list_compliance(
    regulation: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ComplianceBundleOut]:
    await PermissionService.require_permission(db, user, "security_compliance.view")

    from app.services.turbolens_security import (
        compliance_score,
        compliance_to_dict,
        load_reviewer_names,
        load_risk_references,
    )

    stmt = select(TurboLensComplianceFinding)
    if regulation:
        stmt = stmt.where(TurboLensComplianceFinding.regulation == regulation)
    if status:
        stmt = stmt.where(TurboLensComplianceFinding.status == status)

    rows_res = await db.execute(stmt)
    rows = list(rows_res.scalars().all())

    card_ids = {r.card_id for r in rows if r.card_id}
    name_map = await _load_card_names(db, card_ids)
    risk_refs = await load_risk_references(db, {r.risk_id for r in rows if r.risk_id})
    reviewer_names = await load_reviewer_names(db, {r.reviewed_by for r in rows if r.reviewed_by})

    grouped: dict[str, list[TurboLensComplianceFinding]] = {}
    for row in rows:
        grouped.setdefault(row.regulation, []).append(row)

    bundles: list[ComplianceBundleOut] = []
    order = SUPPORTED_REGULATIONS if not regulation else (regulation,)
    for reg in order:
        reg_rows = grouped.get(reg, [])
        items = [
            ComplianceFindingOut.model_validate(
                compliance_to_dict(
                    row,
                    name_map.get(str(row.card_id)) if row.card_id else None,
                    risk_reference=risk_refs.get(str(row.risk_id)) if row.risk_id else None,
                    reviewer_name=(
                        reviewer_names.get(str(row.reviewed_by)) if row.reviewed_by else None
                    ),
                )
            )
            for row in reg_rows
        ]
        bundles.append(
            ComplianceBundleOut(
                regulation=reg,
                score=compliance_score(reg_rows),
                findings=items,
            )
        )
    return bundles


# Decisions the user can set explicitly. ``risk_tracked`` is set by the
# promote endpoint, ``auto_resolved`` is set by the scanner; neither is
# user-settable here.
_USER_SETTABLE_COMPLIANCE_DECISIONS: frozenset[str] = frozenset(
    {"open", "acknowledged", "accepted"}
)


@router.patch("/security/compliance-findings/{finding_id}")
async def update_compliance_finding_decision(
    finding_id: str,
    body: ComplianceFindingDecisionUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ComplianceFindingOut:
    """Set the human decision on a compliance finding.

    Allowed transitions are between ``open`` / ``acknowledged`` /
    ``accepted``. ``accepted`` requires a ``review_note``. Cannot be used
    to set ``risk_tracked`` (use ``POST /risks/promote/compliance/{id}``)
    or ``auto_resolved`` (set by the scanner).
    """
    await PermissionService.require_permission(db, user, "security_compliance.manage")
    decision = (body.decision or "").strip()
    if decision not in _USER_SETTABLE_COMPLIANCE_DECISIONS:
        raise HTTPException(
            400,
            "decision must be one of open, acknowledged, accepted",
        )
    note = (body.review_note or "").strip() or None
    if decision == "accepted" and not note:
        raise HTTPException(400, "review_note is required when accepting a finding")

    row = await db.get(TurboLensComplianceFinding, uuid.UUID(finding_id))
    if not row:
        raise HTTPException(404, "Finding not found")

    # Cannot overwrite an active risk_tracked decision through this
    # endpoint — the user must close the linked Risk first.
    if row.decision == "risk_tracked" and row.risk_id is not None:
        raise HTTPException(
            409,
            "Finding is tracked by a Risk. Close or unlink the Risk first.",
        )

    row.decision = decision
    row.review_note = note
    row.reviewed_by = user.id
    row.reviewed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(row)

    from app.services.turbolens_security import (
        compliance_to_dict,
        load_reviewer_names,
        load_risk_references,
    )

    card_name = None
    if row.card_id:
        names = await _load_card_names(db, {row.card_id})
        card_name = names.get(str(row.card_id))
    risk_refs = await load_risk_references(db, {row.risk_id}) if row.risk_id else {}
    reviewer_names = await load_reviewer_names(db, {row.reviewed_by}) if row.reviewed_by else {}
    return ComplianceFindingOut.model_validate(
        compliance_to_dict(
            row,
            card_name,
            risk_reference=risk_refs.get(str(row.risk_id)) if row.risk_id else None,
            reviewer_name=(reviewer_names.get(str(row.reviewed_by)) if row.reviewed_by else None),
        )
    )


@router.get("/cards/{card_id}/compliance-findings")
async def list_card_compliance_findings(
    card_id: str,
    include_auto_resolved: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ComplianceFindingOut]:
    """All compliance findings scoped to a single card.

    Ordered by severity then regulation/article. Used by the Compliance
    tab on the Card Detail page (mirrors ``GET /cards/{id}/risks``).
    """
    await PermissionService.require_permission(db, user, "security_compliance.view")
    try:
        card_uuid = uuid.UUID(card_id)
    except ValueError as exc:
        raise HTTPException(400, "Invalid card id") from exc

    stmt = select(TurboLensComplianceFinding).where(TurboLensComplianceFinding.card_id == card_uuid)
    if not include_auto_resolved:
        stmt = stmt.where(TurboLensComplianceFinding.auto_resolved.is_(False))
    rows = list((await db.execute(stmt)).scalars().all())

    from app.services.turbolens_security import (
        compliance_to_dict,
        load_reviewer_names,
        load_risk_references,
    )

    name_map = await _load_card_names(db, {card_uuid})
    risk_refs = await load_risk_references(db, {r.risk_id for r in rows if r.risk_id})
    reviewer_names = await load_reviewer_names(db, {r.reviewed_by for r in rows if r.reviewed_by})

    severity_order = {
        "critical": 0,
        "high": 1,
        "medium": 2,
        "low": 3,
        "info": 4,
    }
    rows.sort(
        key=lambda r: (
            severity_order.get(r.severity, 99),
            r.regulation,
            r.regulation_article or "",
        )
    )

    return [
        ComplianceFindingOut.model_validate(
            compliance_to_dict(
                row,
                name_map.get(str(card_uuid)),
                risk_reference=risk_refs.get(str(row.risk_id)) if row.risk_id else None,
                reviewer_name=(
                    reviewer_names.get(str(row.reviewed_by)) if row.reviewed_by else None
                ),
            )
        )
        for row in rows
    ]


@router.get("/security/export.csv")
async def export_cve_findings_csv(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Stream CVE findings as CSV (OWASP / NIST standard column order)."""
    import csv
    import io

    from fastapi.responses import StreamingResponse

    await PermissionService.require_permission(db, user, "security_compliance.view")

    rows_res = await db.execute(select(TurboLensCveFinding))
    rows = list(rows_res.scalars().all())
    name_map = await _load_card_names(db, {r.card_id for r in rows})

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "Card",
            "Card Type",
            "CVE",
            "CVSS",
            "Severity",
            "Attack Vector",
            "Probability",
            "Priority",
            "Patch Available",
            "Published",
            "Last Modified",
            "Status",
            "Vendor",
            "Product",
            "Version",
            "Business Impact",
            "Remediation",
            "Description",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                name_map.get(str(row.card_id), ""),
                row.card_type,
                row.cve_id,
                row.cvss_score if row.cvss_score is not None else "",
                row.severity,
                row.attack_vector or "",
                row.probability,
                row.priority,
                "yes" if row.patch_available else "no",
                row.published_date.isoformat() if row.published_date else "",
                row.last_modified_date.isoformat() if row.last_modified_date else "",
                row.status,
                row.vendor,
                row.product,
                row.version or "",
                (row.business_impact or "").replace("\n", " "),
                (row.remediation or "").replace("\n", " "),
                (row.description or "").replace("\n", " ")[:500],
            ]
        )
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=turbolens_cve_findings.csv"},
    )


# ── Analysis History ──────────────────────────────────────────────────────


@router.get("/analysis-runs")
async def get_analysis_runs(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TurboLensAnalysisRunOut]:
    """List analysis runs."""
    await PermissionService.require_permission(db, user, "turbolens.view")

    result = await db.execute(
        select(TurboLensAnalysisRun).order_by(TurboLensAnalysisRun.started_at.desc()).limit(100)
    )
    return [
        TurboLensAnalysisRunOut.model_validate(r, from_attributes=True)
        for r in result.scalars().all()
    ]


@router.get("/analysis-runs/{run_id}")
async def get_analysis_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get a specific analysis run with results."""
    await PermissionService.require_permission(db, user, "turbolens.view")

    run = await db.get(TurboLensAnalysisRun, uuid.UUID(run_id))
    if not run:
        raise HTTPException(404, "Analysis run not found")

    return TurboLensAnalysisRunOut.model_validate(run, from_attributes=True)


# ── Assessments ──────────────────────────────────────────────────────────


async def _assessment_to_dict(
    db: AsyncSession, a: TurboLensAssessment, *, full: bool = False
) -> dict:
    """Convert assessment model to response dict."""
    creator_name = None
    if a.created_by:
        u = await db.get(User, a.created_by)
        if u:
            creator_name = u.display_name

    initiative_name = None
    if a.initiative_id:
        card = await db.get(Card, a.initiative_id)
        if card:
            initiative_name = card.name

    data: dict[str, Any] = {
        "id": str(a.id),
        "title": a.title,
        "requirement": a.requirement,
        "status": a.status,
        "initiative_id": str(a.initiative_id) if a.initiative_id else None,
        "initiative_name": initiative_name,
        "created_by": str(a.created_by) if a.created_by else None,
        "created_by_name": creator_name,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }
    if full:
        data["session_data"] = a.session_data
    else:
        data["session_data"] = None
    return data


@router.post("/assessments")
async def save_assessment(
    body: TurboLensAssessmentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Save an architecture assessment session."""
    await PermissionService.require_permission(db, user, "turbolens.manage")

    assessment = TurboLensAssessment(
        id=uuid.uuid4(),
        title=body.title,
        requirement=body.requirement,
        session_data=body.session_data,
        status="saved",
        created_by=user.id,
    )
    db.add(assessment)
    await db.commit()
    await db.refresh(assessment)
    return await _assessment_to_dict(db, assessment, full=True)


@router.get("/assessments")
async def list_assessments(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all architecture assessments."""
    await PermissionService.require_permission(db, user, "turbolens.view")

    result = await db.execute(
        select(TurboLensAssessment).order_by(TurboLensAssessment.created_at.desc()).limit(100)
    )
    assessments = result.scalars().all()
    return [await _assessment_to_dict(db, a) for a in assessments]


@router.get("/assessments/{assessment_id}")
async def get_assessment(
    assessment_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get a full assessment with session data."""
    await PermissionService.require_permission(db, user, "turbolens.view")

    assessment = await db.get(TurboLensAssessment, uuid.UUID(assessment_id))
    if not assessment:
        raise HTTPException(404, "Assessment not found")
    return await _assessment_to_dict(db, assessment, full=True)


@router.patch("/assessments/{assessment_id}")
async def update_assessment(
    assessment_id: str,
    body: TurboLensAssessmentUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update a saved (non-committed) assessment."""
    await PermissionService.require_permission(db, user, "turbolens.manage")

    assessment = await db.get(TurboLensAssessment, uuid.UUID(assessment_id))
    if not assessment:
        raise HTTPException(404, "Assessment not found")
    if assessment.status == "committed":
        raise HTTPException(409, "Cannot update a committed assessment")

    if body.title is not None:
        assessment.title = body.title
    if body.requirement is not None:
        assessment.requirement = body.requirement
    if body.session_data is not None:
        assessment.session_data = body.session_data

    await db.commit()
    await db.refresh(assessment)
    return await _assessment_to_dict(db, assessment, full=True)


# ── Commit & Create Initiative ───────────────────────────────────────────


@router.post("/architect/commit")
async def architect_commit(
    body: TurboLensCommitRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Commit an assessment: create Initiative, cards, relations, and ADR."""
    await PermissionService.require_permission(db, user, "turbolens.manage")

    assessment = await db.get(TurboLensAssessment, uuid.UUID(body.assessment_id))
    if not assessment:
        raise HTTPException(404, "Assessment not found")
    if assessment.status == "committed":
        raise HTTPException(409, "Assessment already committed")

    run = await _create_analysis_run(db, AnalysisType.ARCHITECT_COMMIT, user)

    commit_data = {
        "assessment_id": body.assessment_id,
        "initiative_name": body.initiative_name,
        "start_date": body.start_date,
        "end_date": body.end_date,
        "selected_card_ids": body.selected_card_ids,
        "selected_relation_indices": body.selected_relation_indices,
        "objective_ids": body.objective_ids,
        "renamed_cards": body.renamed_cards,
        "user_id": str(user.id),
    }

    async def _commit(db_: AsyncSession) -> dict[str, Any]:
        from app.services.turbolens_commit import execute_commit

        return await execute_commit(db_, str(run.id), commit_data)

    background_tasks.add_task(_run_analysis, str(run.id), _commit, "ArchitectCommit")
    return {"run_id": str(run.id), "status": "running"}
