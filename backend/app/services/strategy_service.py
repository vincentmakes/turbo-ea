"""Strategic planning: TIME model, rationalization scoring, roadmap, traceability."""

import uuid
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fact_sheet import FactSheet, FactSheetStatus, FactSheetType
from app.models.relation import Relation, RelationType


# ---------------------------------------------------------------------------
# TIME model (Tolerate / Invest / Migrate / Eliminate)
# ---------------------------------------------------------------------------

SUITABILITY_SCORE = {
    "perfect": 4,
    "appropriate": 3,
    "insufficient": 2,
    "unreasonable": 1,
}

CRITICALITY_SCORE = {
    "mission_critical": 4,
    "business_critical": 3,
    "business_operational": 2,
    "administrative_service": 1,
}

LIFECYCLE_SCORE = {
    "plan": 1,
    "phase_in": 2,
    "active": 3,
    "phase_out": 4,
    "end_of_life": 5,
}


def _current_lifecycle_phase(lifecycle: dict | None) -> str:
    if not lifecycle:
        return "plan"
    today = date.today().isoformat()
    current = "plan"
    for phase in ["plan", "phase_in", "active", "phase_out", "end_of_life"]:
        if lifecycle.get(phase) and lifecycle[phase] <= today:
            current = phase
    return current


def _compute_time_quadrant(
    technical_suitability: str | None,
    business_criticality: str | None,
    lifecycle_phase: str,
) -> str:
    """Determine TIME quadrant for an application.

    TIME model:
    - Tolerate: low criticality + adequate tech → keep as-is
    - Invest: high criticality + good tech → invest to grow
    - Migrate: high criticality + poor tech → migrate urgently
    - Eliminate: low criticality + poor tech → eliminate/retire
    """
    suit_score = SUITABILITY_SCORE.get(technical_suitability or "", 2)
    crit_score = CRITICALITY_SCORE.get(business_criticality or "", 2)

    # Adjust for lifecycle - phase_out/end_of_life push toward eliminate/migrate
    lc_penalty = 0
    if lifecycle_phase in ("phase_out", "end_of_life"):
        lc_penalty = 1

    effective_suit = max(1, suit_score - lc_penalty)

    if crit_score >= 3 and effective_suit >= 3:
        return "invest"
    elif crit_score >= 3 and effective_suit < 3:
        return "migrate"
    elif crit_score < 3 and effective_suit >= 3:
        return "tolerate"
    else:
        return "eliminate"


@dataclass
class TimeModelItem:
    id: uuid.UUID
    name: str
    quadrant: str  # tolerate, invest, migrate, eliminate
    technical_suitability: str | None
    business_criticality: str | None
    lifecycle_phase: str
    relation_count: int


@dataclass
class RationalizationItem:
    id: uuid.UUID
    name: str
    score: float  # 0-100, higher = more rationalization needed
    reasons: list[str]
    time_quadrant: str
    technical_suitability: str | None
    business_criticality: str | None
    lifecycle_phase: str
    duplicate_count: int
    capability_overlap: int


@dataclass
class RoadmapEvent:
    id: uuid.UUID
    name: str
    fs_type: str
    phase: str
    date: str
    fact_sheet_id: uuid.UUID


@dataclass
class TraceabilityNode:
    id: uuid.UUID
    name: str
    fs_type: str
    children: list["TraceabilityNode"] = field(default_factory=list)


# ---------------------------------------------------------------------------
# TIME model computation
# ---------------------------------------------------------------------------

async def compute_time_model(db: AsyncSession) -> list[TimeModelItem]:
    apps_q = (
        select(FactSheet)
        .where(FactSheet.type == FactSheetType.APPLICATION, FactSheet.status == FactSheetStatus.ACTIVE)
        .order_by(FactSheet.name)
    )
    apps = list((await db.execute(apps_q)).scalars().all())
    if not apps:
        return []

    app_ids = [a.id for a in apps]

    # Count relations per app
    rel_q = (
        select(Relation.from_fact_sheet_id, func.count(Relation.id))
        .where(Relation.from_fact_sheet_id.in_(app_ids))
        .group_by(Relation.from_fact_sheet_id)
    )
    rel_counts = dict((await db.execute(rel_q)).all())

    results: list[TimeModelItem] = []
    for app in apps:
        attrs = app.attributes or {}
        tech_suit = attrs.get("technical_suitability")
        biz_crit = attrs.get("business_criticality")
        phase = _current_lifecycle_phase(app.lifecycle)
        quadrant = _compute_time_quadrant(tech_suit, biz_crit, phase)

        results.append(TimeModelItem(
            id=app.id,
            name=app.name,
            quadrant=quadrant,
            technical_suitability=tech_suit,
            business_criticality=biz_crit,
            lifecycle_phase=phase,
            relation_count=rel_counts.get(app.id, 0),
        ))

    return results


# ---------------------------------------------------------------------------
# Rationalization scoring
# ---------------------------------------------------------------------------

async def compute_rationalization(db: AsyncSession) -> list[RationalizationItem]:
    """Score applications for rationalization potential.

    High score = more reason to rationalize (consolidate/eliminate).
    Factors: poor suitability, low criticality, end-of-life, overlapping capabilities.
    """
    apps_q = (
        select(FactSheet)
        .where(FactSheet.type == FactSheetType.APPLICATION, FactSheet.status == FactSheetStatus.ACTIVE)
        .order_by(FactSheet.name)
    )
    apps = list((await db.execute(apps_q)).scalars().all())
    if not apps:
        return []

    app_ids = [a.id for a in apps]

    # Get app → capability relations for overlap detection
    cap_rels_q = (
        select(Relation.from_fact_sheet_id, Relation.to_fact_sheet_id)
        .where(
            Relation.type == RelationType.APPLICATION_TO_BUSINESS_CAPABILITY,
            Relation.from_fact_sheet_id.in_(app_ids),
        )
    )
    cap_rels = (await db.execute(cap_rels_q)).all()

    # Build capability → apps mapping
    cap_to_apps: dict[uuid.UUID, set[uuid.UUID]] = {}
    app_to_caps: dict[uuid.UUID, set[uuid.UUID]] = {}
    for app_id, cap_id in cap_rels:
        cap_to_apps.setdefault(cap_id, set()).add(app_id)
        app_to_caps.setdefault(app_id, set()).add(cap_id)

    results: list[RationalizationItem] = []
    for app in apps:
        attrs = app.attributes or {}
        tech_suit = attrs.get("technical_suitability")
        biz_crit = attrs.get("business_criticality")
        phase = _current_lifecycle_phase(app.lifecycle)
        quadrant = _compute_time_quadrant(tech_suit, biz_crit, phase)

        score = 0.0
        reasons: list[str] = []

        # Suitability penalty
        suit_score = SUITABILITY_SCORE.get(tech_suit or "", 2)
        if suit_score <= 1:
            score += 30
            reasons.append("Unreasonable technical suitability")
        elif suit_score <= 2:
            score += 15
            reasons.append("Insufficient technical suitability")

        # Low criticality
        crit_score = CRITICALITY_SCORE.get(biz_crit or "", 2)
        if crit_score <= 1:
            score += 20
            reasons.append("Administrative service only")
        elif crit_score <= 2:
            score += 10

        # Lifecycle penalty
        if phase in ("phase_out", "end_of_life"):
            score += 25
            reasons.append(f"Lifecycle: {phase.replace('_', ' ')}")

        # Capability overlap: count other apps serving same capabilities
        my_caps = app_to_caps.get(app.id, set())
        overlap_apps: set[uuid.UUID] = set()
        for cap_id in my_caps:
            for other_app in cap_to_apps.get(cap_id, set()):
                if other_app != app.id:
                    overlap_apps.add(other_app)

        duplicate_count = len(overlap_apps)
        if duplicate_count >= 3:
            score += 15
            reasons.append(f"{duplicate_count} apps share capabilities")
        elif duplicate_count >= 1:
            score += 5

        results.append(RationalizationItem(
            id=app.id,
            name=app.name,
            score=min(score, 100),
            reasons=reasons,
            time_quadrant=quadrant,
            technical_suitability=tech_suit,
            business_criticality=biz_crit,
            lifecycle_phase=phase,
            duplicate_count=duplicate_count,
            capability_overlap=len(my_caps),
        ))

    results.sort(key=lambda r: r.score, reverse=True)
    return results


# ---------------------------------------------------------------------------
# Roadmap
# ---------------------------------------------------------------------------

async def build_roadmap(db: AsyncSession, months_ahead: int = 24) -> list[RoadmapEvent]:
    """Build a roadmap from lifecycle dates across all active fact sheets."""
    fs_q = (
        select(FactSheet)
        .where(
            FactSheet.status == FactSheetStatus.ACTIVE,
            FactSheet.lifecycle.isnot(None),
        )
        .order_by(FactSheet.name)
    )
    items = list((await db.execute(fs_q)).scalars().all())

    events: list[RoadmapEvent] = []
    for fs in items:
        lc = fs.lifecycle or {}
        for phase_name, phase_date in lc.items():
            if phase_date:
                events.append(RoadmapEvent(
                    id=uuid.uuid4(),
                    name=fs.name,
                    fs_type=fs.type.value,
                    phase=phase_name,
                    date=str(phase_date),
                    fact_sheet_id=fs.id,
                ))

    events.sort(key=lambda e: e.date)
    return events


# ---------------------------------------------------------------------------
# Traceability: Objective → Initiative → Application
# ---------------------------------------------------------------------------

async def build_traceability(db: AsyncSession) -> list[TraceabilityNode]:
    """Build Objective → Initiative → Application traceability tree."""
    # Load objectives
    obj_q = (
        select(FactSheet)
        .where(FactSheet.type == FactSheetType.OBJECTIVE, FactSheet.status == FactSheetStatus.ACTIVE)
        .order_by(FactSheet.name)
    )
    objectives = list((await db.execute(obj_q)).scalars().all())

    # Load all relevant relations
    obj_to_init_q = select(Relation).where(Relation.type == RelationType.OBJECTIVE_TO_INITIATIVE)
    obj_to_init = list((await db.execute(obj_to_init_q)).scalars().all())

    init_to_app_q = select(Relation).where(Relation.type == RelationType.INITIATIVE_TO_APPLICATION)
    init_to_app = list((await db.execute(init_to_app_q)).scalars().all())

    obj_to_cap_q = select(Relation).where(Relation.type == RelationType.OBJECTIVE_TO_BUSINESS_CAPABILITY)
    obj_to_cap = list((await db.execute(obj_to_cap_q)).scalars().all())

    # Collect all referenced IDs
    all_ids: set[uuid.UUID] = set()
    for r in obj_to_init + init_to_app + obj_to_cap:
        all_ids.add(r.from_fact_sheet_id)
        all_ids.add(r.to_fact_sheet_id)
    for o in objectives:
        all_ids.add(o.id)

    name_map: dict[uuid.UUID, tuple[str, str]] = {}
    if all_ids:
        nm_q = select(FactSheet.id, FactSheet.name, FactSheet.type).where(FactSheet.id.in_(list(all_ids)))
        for fid, fname, ftype in (await db.execute(nm_q)).all():
            name_map[fid] = (fname, ftype.value if hasattr(ftype, 'value') else str(ftype))

    # Build index
    obj_initiatives: dict[uuid.UUID, list[uuid.UUID]] = {}
    for r in obj_to_init:
        obj_initiatives.setdefault(r.from_fact_sheet_id, []).append(r.to_fact_sheet_id)

    init_apps: dict[uuid.UUID, list[uuid.UUID]] = {}
    for r in init_to_app:
        init_apps.setdefault(r.from_fact_sheet_id, []).append(r.to_fact_sheet_id)

    obj_caps: dict[uuid.UUID, list[uuid.UUID]] = {}
    for r in obj_to_cap:
        obj_caps.setdefault(r.from_fact_sheet_id, []).append(r.to_fact_sheet_id)

    tree: list[TraceabilityNode] = []
    for obj in objectives:
        obj_node = TraceabilityNode(id=obj.id, name=obj.name, fs_type="objective")

        # Add linked capabilities
        for cap_id in obj_caps.get(obj.id, []):
            cap_name, cap_type = name_map.get(cap_id, ("Unknown", "business_capability"))
            obj_node.children.append(TraceabilityNode(id=cap_id, name=cap_name, fs_type=cap_type))

        # Add linked initiatives with their apps
        for init_id in obj_initiatives.get(obj.id, []):
            init_name, init_type = name_map.get(init_id, ("Unknown", "initiative"))
            init_node = TraceabilityNode(id=init_id, name=init_name, fs_type=init_type)

            for app_id in init_apps.get(init_id, []):
                app_name, app_type = name_map.get(app_id, ("Unknown", "application"))
                init_node.children.append(TraceabilityNode(id=app_id, name=app_name, fs_type=app_type))

            obj_node.children.append(init_node)

        tree.append(obj_node)

    return tree
