"""ArchLens native integration — AI-powered EA intelligence.

Direct service calls replacing the old proxy-to-container pattern.
All ArchLens AI services now query the cards table directly and
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
from app.models.archlens import (
    ArchLensAnalysisRun,
    ArchLensDuplicateCluster,
    ArchLensModernization,
    ArchLensVendorAnalysis,
    ArchLensVendorHierarchy,
)
from app.models.card import Card
from app.models.user import User
from app.schemas.archlens import (
    ArchLensAnalysisRunOut,
    ArchLensArchitectRequest,
    ArchLensDuplicateStatusUpdate,
    ArchLensModernizeRequest,
    ArchLensOverviewOut,
    ArchLensStatusOut,
    DuplicateClusterOut,
    ModernizationOut,
    VendorAnalysisOut,
    VendorHierarchyOut,
)
from app.services.archlens_ai import get_ai_config, is_ai_configured
from app.services.permission_service import PermissionService

logger = logging.getLogger(__name__)


# ── Enums ─────────────────────────────────────────────────────────────────


class AnalysisType(str, enum.Enum):
    VENDOR_ANALYSIS = "vendor_analysis"
    VENDOR_RESOLUTION = "vendor_resolution"
    DUPLICATE_DETECTION = "duplicate_detection"
    MODERNIZATION = "modernization"
    ARCHITECT = "architect"


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
    """Generic background task runner that updates ArchLensAnalysisRun status."""
    from app.database import async_session

    async with async_session() as db:
        try:
            result = await service_fn(db)

            run = await db.get(ArchLensAnalysisRun, uuid.UUID(run_id))
            if run:
                run.status = AnalysisStatus.COMPLETED
                run.completed_at = datetime.now(timezone.utc)
                run.results = result
                await db.commit()
        except Exception as e:
            logger.exception("%s failed: %s", label, e)
            # Use a fresh session since the original may be in a bad state
            async with async_session() as db2:
                run = await db2.get(ArchLensAnalysisRun, uuid.UUID(run_id))
                if run:
                    run.status = AnalysisStatus.FAILED
                    run.completed_at = datetime.now(timezone.utc)
                    run.error_message = str(e)
                    await db2.commit()


async def _create_analysis_run(
    db: AsyncSession,
    analysis_type: AnalysisType,
    user: User,
) -> ArchLensAnalysisRun:
    """Create an analysis run, raising 409 if one is already running."""
    existing = await db.execute(
        select(ArchLensAnalysisRun).where(
            ArchLensAnalysisRun.analysis_type == analysis_type,
            ArchLensAnalysisRun.status == AnalysisStatus.RUNNING,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"{analysis_type.value} analysis is already running")

    run = ArchLensAnalysisRun(
        id=uuid.uuid4(),
        analysis_type=analysis_type,
        status=AnalysisStatus.RUNNING,
        started_at=datetime.now(timezone.utc),
        created_by=user.id,
    )
    db.add(run)
    await db.commit()
    return run


router = APIRouter(prefix="/archlens", tags=["ArchLens"])


# ── Status & Overview ──────────────────────────────────────────────────────


@router.get("/status")
async def archlens_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ArchLensStatusOut:
    """Check if ArchLens AI is configured and ready."""
    config = await get_ai_config(db)
    configured = is_ai_configured(config)
    return ArchLensStatusOut(ai_configured=configured, ready=configured)


@router.get("/overview")
async def archlens_overview(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ArchLensOverviewOut:
    """Dashboard KPIs: card counts, quality, vendor/duplicate summaries."""
    await PermissionService.require_permission(db, user, "archlens.view")

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
    vendor_count = await db.execute(select(func.count(ArchLensVendorAnalysis.id)))
    v_count = vendor_count.scalar() or 0

    # Duplicate cluster count
    dup_count_result = await db.execute(select(func.count(ArchLensDuplicateCluster.id)))
    dup_count = dup_count_result.scalar() or 0

    # Modernization count
    mod_count_result = await db.execute(select(func.count(ArchLensModernization.id)))
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

    return ArchLensOverviewOut(
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
    await PermissionService.require_permission(db, user, "archlens.manage")

    run = await _create_analysis_run(db, AnalysisType.VENDOR_ANALYSIS, user)

    async def _service(db_: AsyncSession) -> dict[str, Any]:
        from app.services.archlens_vendors import analyse_vendors

        return await analyse_vendors(db_)

    background_tasks.add_task(_run_analysis, str(run.id), _service, "Vendor analysis")
    return {"run_id": str(run.id), "status": "running"}


@router.get("/vendors")
async def get_vendors(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[VendorAnalysisOut]:
    """Get categorised vendors."""
    await PermissionService.require_permission(db, user, "archlens.view")

    result = await db.execute(
        select(ArchLensVendorAnalysis).order_by(ArchLensVendorAnalysis.app_count.desc())
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
    await PermissionService.require_permission(db, user, "archlens.manage")

    run = await _create_analysis_run(db, AnalysisType.VENDOR_RESOLUTION, user)

    async def _service(db_: AsyncSession) -> dict[str, Any]:
        from app.services.archlens_vendors import resolve_vendors

        return await resolve_vendors(db_)

    background_tasks.add_task(_run_analysis, str(run.id), _service, "Vendor resolution")
    return {"run_id": str(run.id), "status": "running"}


@router.get("/vendors/hierarchy")
async def get_vendor_hierarchy(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[VendorHierarchyOut]:
    """Get canonical vendor hierarchy tree."""
    await PermissionService.require_permission(db, user, "archlens.view")

    result = await db.execute(
        select(ArchLensVendorHierarchy).order_by(ArchLensVendorHierarchy.app_count.desc())
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
    await PermissionService.require_permission(db, user, "archlens.manage")

    run = await _create_analysis_run(db, AnalysisType.DUPLICATE_DETECTION, user)

    async def _service(db_: AsyncSession) -> dict[str, Any]:
        from app.services.archlens_duplicates import detect_duplicates

        return await detect_duplicates(db_)

    background_tasks.add_task(_run_analysis, str(run.id), _service, "Duplicate detection")
    return {"run_id": str(run.id), "status": "running"}


@router.get("/duplicates")
async def get_duplicates(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[DuplicateClusterOut]:
    """Get duplicate clusters."""
    await PermissionService.require_permission(db, user, "archlens.view")

    result = await db.execute(
        select(ArchLensDuplicateCluster).order_by(ArchLensDuplicateCluster.analysed_at.desc())
    )
    return [
        DuplicateClusterOut.model_validate(c, from_attributes=True) for c in result.scalars().all()
    ]


@router.patch("/duplicates/{cluster_id}/status")
async def update_duplicate_status(
    cluster_id: str,
    body: ArchLensDuplicateStatusUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update cluster status (confirm/dismiss/investigate)."""
    await PermissionService.require_permission(db, user, "archlens.manage")

    cluster = await db.get(ArchLensDuplicateCluster, uuid.UUID(cluster_id))
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
    body: ArchLensModernizeRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Trigger modernization assessment for a card type."""
    await PermissionService.require_permission(db, user, "archlens.manage")

    run = await _create_analysis_run(db, AnalysisType.MODERNIZATION, user)

    target_type = body.target_type
    modernization_type = body.modernization_type

    async def _service(db_: AsyncSession) -> dict[str, Any]:
        from app.services.archlens_duplicates import assess_modernization

        return await assess_modernization(db_, target_type, modernization_type)

    background_tasks.add_task(_run_analysis, str(run.id), _service, "Modernization")
    return {"run_id": str(run.id), "status": "running"}


@router.get("/duplicates/modernizations")
async def get_modernizations(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ModernizationOut]:
    """Get modernization assessments."""
    await PermissionService.require_permission(db, user, "archlens.view")

    result = await db.execute(
        select(ArchLensModernization).order_by(ArchLensModernization.analysed_at.desc())
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

    await PermissionService.require_permission(db, user, "archlens.manage")

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


@router.get("/architect/objective-dependencies")
async def architect_objective_dependencies(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    objective_ids: str = "",
):
    """Fetch dependency subgraph for selected Objectives (BFS depth 3)."""
    from app.models.relation import Relation
    from app.models.relation_type import RelationType

    await PermissionService.require_permission(db, user, "archlens.manage")

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
    body: ArchLensArchitectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Phase 1: business & functional clarification questions."""
    await PermissionService.require_permission(db, user, "archlens.manage")

    if not body.requirement:
        raise HTTPException(400, "Requirement is required for Phase 1")

    from app.services.archlens_architect import phase1_questions

    result = await phase1_questions(db, body.requirement)
    return result


@router.post("/architect/phase2")
async def architect_phase2(
    body: ArchLensArchitectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Phase 2: technical & NFR deep-dive questions."""
    await PermissionService.require_permission(db, user, "archlens.manage")

    if not body.requirement or not body.phase1_qa:
        raise HTTPException(400, "Requirement and phase1QA are required for Phase 2")

    from app.services.archlens_architect import phase2_questions

    qa_list = body.phase1_qa if isinstance(body.phase1_qa, list) else []
    result = await phase2_questions(db, body.requirement, qa_list)
    return result


@router.post("/architect/phase3/options")
async def architect_phase3_options(
    body: ArchLensArchitectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Phase 3a: generate solution options."""
    await PermissionService.require_permission(db, user, "archlens.manage")

    if not body.requirement or not body.all_qa:
        raise HTTPException(400, "Requirement and allQA are required")

    from app.services.archlens_architect import phase3_options

    qa_list = body.all_qa if isinstance(body.all_qa, list) else []
    return await phase3_options(db, body.requirement, qa_list)


@router.post("/architect/phase3/gaps")
async def architect_phase3_gaps(
    body: ArchLensArchitectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Phase 3b: gap analysis for a selected solution option."""
    await PermissionService.require_permission(db, user, "archlens.manage")

    if not body.requirement or not body.all_qa:
        raise HTTPException(400, "Requirement and allQA are required")
    if not body.selected_option:
        raise HTTPException(400, "selectedOption is required for gap analysis")

    from app.services.archlens_architect import phase3_gaps

    qa_list = body.all_qa if isinstance(body.all_qa, list) else []
    option = body.selected_option if isinstance(body.selected_option, dict) else {}
    return await phase3_gaps(db, body.requirement, qa_list, option)


@router.post("/architect/phase3")
async def architect_phase3(
    body: ArchLensArchitectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Phase 4: capability mapping with selected option context."""
    await PermissionService.require_permission(db, user, "archlens.manage")

    if not body.requirement or not body.all_qa:
        raise HTTPException(400, "Requirement and allQA are required for Phase 3")

    from app.models.relation import Relation
    from app.models.relation_type import RelationType
    from app.services.archlens_architect import phase3_capability_mapping

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

    result = await phase3_capability_mapping(
        db, body.requirement, qa_list, obj_ids, dep_graph, option
    )

    # Record the run
    run = ArchLensAnalysisRun(
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


# ── Analysis History ──────────────────────────────────────────────────────


@router.get("/analysis-runs")
async def get_analysis_runs(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ArchLensAnalysisRunOut]:
    """List analysis runs."""
    await PermissionService.require_permission(db, user, "archlens.view")

    result = await db.execute(
        select(ArchLensAnalysisRun).order_by(ArchLensAnalysisRun.started_at.desc()).limit(100)
    )
    return [
        ArchLensAnalysisRunOut.model_validate(r, from_attributes=True)
        for r in result.scalars().all()
    ]


@router.get("/analysis-runs/{run_id}")
async def get_analysis_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get a specific analysis run with results."""
    await PermissionService.require_permission(db, user, "archlens.view")

    run = await db.get(ArchLensAnalysisRun, uuid.UUID(run_id))
    if not run:
        raise HTTPException(404, "Analysis run not found")

    return ArchLensAnalysisRunOut.model_validate(run, from_attributes=True)
