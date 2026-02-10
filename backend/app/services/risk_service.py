"""Technology risk scoring, obsolescence analysis, and cost aggregation."""

import uuid
from dataclasses import dataclass

from sqlalchemy import case, cast, func, select, Float
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fact_sheet import FactSheet, FactSheetStatus, FactSheetType
from app.models.relation import Relation, RelationType


# ---------------------------------------------------------------------------
# Risk scoring helpers
# ---------------------------------------------------------------------------

# Lifecycle phase → risk weight (higher = worse)
LIFECYCLE_RISK_WEIGHT: dict[str, float] = {
    "plan": 0.1,
    "phase_in": 0.2,
    "active": 0.0,
    "phase_out": 0.6,
    "end_of_life": 1.0,
}

RESOURCE_CLASSIFICATION_RISK: dict[str, float] = {
    "standard": 0.0,
    "non_standard": 0.5,
    "phasing_out": 1.0,
}


def _current_lifecycle_phase(lifecycle: dict | None) -> str:
    """Determine the current lifecycle phase based on dates."""
    if not lifecycle:
        return "plan"
    from datetime import date

    today = date.today().isoformat()
    current = "plan"
    for phase in ["plan", "phase_in", "active", "phase_out", "end_of_life"]:
        if lifecycle.get(phase) and lifecycle[phase] <= today:
            current = phase
    return current


@dataclass
class TechRiskScore:
    fact_sheet_id: uuid.UUID
    name: str
    fs_type: str
    lifecycle_phase: str
    lifecycle_risk: float
    resource_classification: str | None
    classification_risk: float
    dependent_app_count: int
    aggregate_risk: float  # 0.0 – 1.0


@dataclass
class ProviderCostSummary:
    provider_id: uuid.UUID
    provider_name: str
    component_count: int
    total_cost: float
    app_count: int


@dataclass
class AppTechStack:
    app_id: uuid.UUID
    app_name: str
    business_criticality: str | None
    components: list[dict]


@dataclass
class TechRadarItem:
    id: uuid.UUID
    name: str
    category: str | None
    ring: str  # adopt, trial, assess, hold
    quadrant: str  # based on category grouping
    app_count: int


# ---------------------------------------------------------------------------
# Risk scoring
# ---------------------------------------------------------------------------

async def compute_tech_risk_scores(
    db: AsyncSession,
    fs_type: FactSheetType | None = None,
) -> list[TechRiskScore]:
    """Compute risk scores for IT Components (or all tech types)."""
    query = (
        select(FactSheet)
        .where(FactSheet.status == FactSheetStatus.ACTIVE)
    )
    if fs_type:
        query = query.where(FactSheet.type == fs_type)
    else:
        query = query.where(
            FactSheet.type.in_([FactSheetType.IT_COMPONENT, FactSheetType.PLATFORM])
        )
    query = query.order_by(FactSheet.name)

    result = await db.execute(query)
    items = list(result.scalars().all())

    if not items:
        return []

    # Count dependent applications per component
    ids = [item.id for item in items]
    dep_query = (
        select(Relation.to_fact_sheet_id, func.count(Relation.id))
        .where(
            Relation.to_fact_sheet_id.in_(ids),
            Relation.type == RelationType.APPLICATION_TO_IT_COMPONENT,
        )
        .group_by(Relation.to_fact_sheet_id)
    )
    dep_result = await db.execute(dep_query)
    dep_counts: dict[uuid.UUID, int] = dict(dep_result.all())

    scores: list[TechRiskScore] = []
    for item in items:
        phase = _current_lifecycle_phase(item.lifecycle)
        lc_risk = LIFECYCLE_RISK_WEIGHT.get(phase, 0.0)

        attrs = item.attributes or {}
        rc = attrs.get("resource_classification", "standard")
        rc_risk = RESOURCE_CLASSIFICATION_RISK.get(rc, 0.0)

        dep_count = dep_counts.get(item.id, 0)

        # Aggregate risk: weighted combination
        # lifecycle is primary, classification secondary, app count amplifies
        base_risk = lc_risk * 0.6 + rc_risk * 0.4
        # Amplify by dependency count (more dependents = higher organizational risk)
        amplifier = min(1.0 + dep_count * 0.05, 2.0) if dep_count > 0 else 1.0
        aggregate = min(base_risk * amplifier, 1.0)

        scores.append(TechRiskScore(
            fact_sheet_id=item.id,
            name=item.name,
            fs_type=item.type.value,
            lifecycle_phase=phase,
            lifecycle_risk=lc_risk,
            resource_classification=rc,
            classification_risk=rc_risk,
            dependent_app_count=dep_count,
            aggregate_risk=round(aggregate, 3),
        ))

    # Sort by risk descending
    scores.sort(key=lambda s: s.aggregate_risk, reverse=True)
    return scores


# ---------------------------------------------------------------------------
# Provider cost aggregation
# ---------------------------------------------------------------------------

async def get_provider_cost_summaries(db: AsyncSession) -> list[ProviderCostSummary]:
    """Aggregate costs per provider from IT Component → Provider relations."""
    providers_q = (
        select(FactSheet)
        .where(FactSheet.type == FactSheetType.PROVIDER, FactSheet.status == FactSheetStatus.ACTIVE)
        .order_by(FactSheet.name)
    )
    providers = list((await db.execute(providers_q)).scalars().all())

    if not providers:
        return []

    provider_ids = [p.id for p in providers]

    # Get IT Component → Provider relations with cost attribute
    rels_q = (
        select(Relation)
        .where(
            Relation.type == RelationType.IT_COMPONENT_TO_PROVIDER,
            Relation.to_fact_sheet_id.in_(provider_ids),
        )
    )
    rels = list((await db.execute(rels_q)).scalars().all())

    # Group by provider
    provider_data: dict[uuid.UUID, dict] = {p.id: {"name": p.name, "components": set(), "total_cost": 0.0} for p in providers}

    for rel in rels:
        pid = rel.to_fact_sheet_id
        if pid in provider_data:
            provider_data[pid]["components"].add(rel.from_fact_sheet_id)
            cost = (rel.attributes or {}).get("cost", 0)
            try:
                provider_data[pid]["total_cost"] += float(cost)
            except (ValueError, TypeError):
                pass

    # Count apps per provider (apps → IT components → provider)
    component_ids = set()
    comp_to_provider: dict[uuid.UUID, set[uuid.UUID]] = {}
    for rel in rels:
        component_ids.add(rel.from_fact_sheet_id)
        comp_to_provider.setdefault(rel.from_fact_sheet_id, set()).add(rel.to_fact_sheet_id)

    app_counts: dict[uuid.UUID, set[uuid.UUID]] = {pid: set() for pid in provider_ids}
    if component_ids:
        app_rels_q = (
            select(Relation.from_fact_sheet_id, Relation.to_fact_sheet_id)
            .where(
                Relation.type == RelationType.APPLICATION_TO_IT_COMPONENT,
                Relation.to_fact_sheet_id.in_(list(component_ids)),
            )
        )
        app_rels = (await db.execute(app_rels_q)).all()
        for app_id, comp_id in app_rels:
            for pid in comp_to_provider.get(comp_id, set()):
                app_counts[pid].add(app_id)

    summaries = []
    for p in providers:
        d = provider_data[p.id]
        summaries.append(ProviderCostSummary(
            provider_id=p.id,
            provider_name=d["name"],
            component_count=len(d["components"]),
            total_cost=round(d["total_cost"], 2),
            app_count=len(app_counts.get(p.id, set())),
        ))

    summaries.sort(key=lambda s: s.total_cost, reverse=True)
    return summaries


# ---------------------------------------------------------------------------
# Tech stack per application
# ---------------------------------------------------------------------------

async def get_app_tech_stacks(db: AsyncSession, limit: int = 100) -> list[AppTechStack]:
    """Get applications with their technology stacks (IT Components)."""
    apps_q = (
        select(FactSheet)
        .where(FactSheet.type == FactSheetType.APPLICATION, FactSheet.status == FactSheetStatus.ACTIVE)
        .order_by(FactSheet.name)
        .limit(limit)
    )
    apps = list((await db.execute(apps_q)).scalars().all())
    if not apps:
        return []

    app_ids = [a.id for a in apps]

    # Get app → IT component relations
    rels_q = (
        select(Relation)
        .where(
            Relation.type == RelationType.APPLICATION_TO_IT_COMPONENT,
            Relation.from_fact_sheet_id.in_(app_ids),
        )
    )
    rels = list((await db.execute(rels_q)).scalars().all())

    # Load component details
    comp_ids = list({r.to_fact_sheet_id for r in rels})
    comps: dict[uuid.UUID, FactSheet] = {}
    if comp_ids:
        comp_q = select(FactSheet).where(FactSheet.id.in_(comp_ids))
        comps = {c.id: c for c in (await db.execute(comp_q)).scalars().all()}

    # Group by app
    app_comps: dict[uuid.UUID, list[dict]] = {a.id: [] for a in apps}
    for rel in rels:
        comp = comps.get(rel.to_fact_sheet_id)
        if comp:
            app_comps[rel.from_fact_sheet_id].append({
                "id": str(comp.id),
                "name": comp.name,
                "category": (comp.attributes or {}).get("category"),
                "lifecycle_phase": _current_lifecycle_phase(comp.lifecycle),
                "resource_classification": (comp.attributes or {}).get("resource_classification"),
                "cost": (rel.attributes or {}).get("cost"),
            })

    stacks = []
    for app in apps:
        components = app_comps.get(app.id, [])
        if components:  # Only include apps that have tech stack
            stacks.append(AppTechStack(
                app_id=app.id,
                app_name=app.name,
                business_criticality=(app.attributes or {}).get("business_criticality"),
                components=components,
            ))

    return stacks


# ---------------------------------------------------------------------------
# Technology radar
# ---------------------------------------------------------------------------

def _lifecycle_to_ring(phase: str) -> str:
    """Map lifecycle phase to radar ring."""
    return {
        "plan": "assess",
        "phase_in": "trial",
        "active": "adopt",
        "phase_out": "hold",
        "end_of_life": "hold",
    }.get(phase, "assess")


CATEGORY_QUADRANT: dict[str, str] = {
    "SaaS": "Platforms",
    "IaaS": "Infrastructure",
    "PaaS": "Platforms",
    "Hardware": "Infrastructure",
    "Service": "Tools",
    "DBMS": "Data Management",
    "OS": "Infrastructure",
}


async def get_tech_radar_data(db: AsyncSession) -> list[TechRadarItem]:
    """Build technology radar data from IT Components."""
    query = (
        select(FactSheet)
        .where(FactSheet.type == FactSheetType.IT_COMPONENT, FactSheet.status == FactSheetStatus.ACTIVE)
        .order_by(FactSheet.name)
    )
    items = list((await db.execute(query)).scalars().all())
    if not items:
        return []

    ids = [i.id for i in items]
    dep_query = (
        select(Relation.to_fact_sheet_id, func.count(Relation.id))
        .where(
            Relation.to_fact_sheet_id.in_(ids),
            Relation.type == RelationType.APPLICATION_TO_IT_COMPONENT,
        )
        .group_by(Relation.to_fact_sheet_id)
    )
    dep_counts = dict((await db.execute(dep_query)).all())

    radar: list[TechRadarItem] = []
    for item in items:
        attrs = item.attributes or {}
        category = attrs.get("category", "Service")
        phase = _current_lifecycle_phase(item.lifecycle)

        radar.append(TechRadarItem(
            id=item.id,
            name=item.name,
            category=category,
            ring=_lifecycle_to_ring(phase),
            quadrant=CATEGORY_QUADRANT.get(category, "Tools"),
            app_count=dep_counts.get(item.id, 0),
        ))

    return radar


# ---------------------------------------------------------------------------
# Risk matrix data (for apps: technical fitness vs business criticality)
# ---------------------------------------------------------------------------

@dataclass
class RiskMatrixItem:
    id: uuid.UUID
    name: str
    technical_suitability: str | None
    business_criticality: str | None
    lifecycle_phase: str
    tech_risk: float  # aggregate from dependent IT components
    component_count: int


async def get_risk_matrix_data(db: AsyncSession) -> list[RiskMatrixItem]:
    """Get risk matrix data for applications."""
    apps_q = (
        select(FactSheet)
        .where(FactSheet.type == FactSheetType.APPLICATION, FactSheet.status == FactSheetStatus.ACTIVE)
        .order_by(FactSheet.name)
    )
    apps = list((await db.execute(apps_q)).scalars().all())
    if not apps:
        return []

    app_ids = [a.id for a in apps]

    # Get app → IT component relations
    rels_q = (
        select(Relation)
        .where(
            Relation.type == RelationType.APPLICATION_TO_IT_COMPONENT,
            Relation.from_fact_sheet_id.in_(app_ids),
        )
    )
    rels = list((await db.execute(rels_q)).scalars().all())

    comp_ids = list({r.to_fact_sheet_id for r in rels})
    comps: dict[uuid.UUID, FactSheet] = {}
    if comp_ids:
        comp_q = select(FactSheet).where(FactSheet.id.in_(comp_ids))
        comps = {c.id: c for c in (await db.execute(comp_q)).scalars().all()}

    # Calculate tech risk per app
    app_comp_risks: dict[uuid.UUID, list[float]] = {a.id: [] for a in apps}
    app_comp_counts: dict[uuid.UUID, int] = {a.id: 0 for a in apps}

    for rel in rels:
        comp = comps.get(rel.to_fact_sheet_id)
        if comp:
            phase = _current_lifecycle_phase(comp.lifecycle)
            lc_risk = LIFECYCLE_RISK_WEIGHT.get(phase, 0.0)
            rc = (comp.attributes or {}).get("resource_classification", "standard")
            rc_risk = RESOURCE_CLASSIFICATION_RISK.get(rc, 0.0)
            comp_risk = lc_risk * 0.6 + rc_risk * 0.4
            app_comp_risks[rel.from_fact_sheet_id].append(comp_risk)
            app_comp_counts[rel.from_fact_sheet_id] = app_comp_counts.get(rel.from_fact_sheet_id, 0) + 1

    matrix: list[RiskMatrixItem] = []
    for app in apps:
        attrs = app.attributes or {}
        risks = app_comp_risks.get(app.id, [])
        avg_risk = sum(risks) / len(risks) if risks else 0.0

        matrix.append(RiskMatrixItem(
            id=app.id,
            name=app.name,
            technical_suitability=attrs.get("technical_suitability"),
            business_criticality=attrs.get("business_criticality"),
            lifecycle_phase=_current_lifecycle_phase(app.lifecycle),
            tech_risk=round(avg_risk, 3),
            component_count=app_comp_counts.get(app.id, 0),
        ))

    return matrix
