"""Report service: dashboard KPIs, landscape reports, matrix reports, CSV export."""

import csv
import io
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.models.fact_sheet import FactSheet, FactSheetStatus, FactSheetType
from app.models.relation import Relation, RelationType
from app.models.tag import FactSheetTag, Tag


# ---------------------------------------------------------------------------
# Dashboard KPIs
# ---------------------------------------------------------------------------

@dataclass
class HealthScore:
    label: str
    score: float  # 0-100
    color: str  # green/yellow/red


@dataclass
class KPICard:
    label: str
    value: int | float | str
    icon: str
    trend: float | None = None  # percentage change vs previous period
    color: str = "primary"


@dataclass
class TypeBreakdown:
    type: str
    count: int
    active: int
    archived: int


@dataclass
class DashboardData:
    kpis: list[KPICard]
    health_scores: list[HealthScore]
    type_breakdown: list[TypeBreakdown]
    lifecycle_distribution: dict[str, int]
    recent_changes_count: int
    completeness_avg: float


async def compute_dashboard(db: AsyncSession) -> DashboardData:
    """Compute all dashboard KPI data."""
    # Total counts by type
    type_q = (
        select(FactSheet.type, FactSheet.status, func.count(FactSheet.id))
        .group_by(FactSheet.type, FactSheet.status)
    )
    type_rows = (await db.execute(type_q)).all()

    type_map: dict[str, dict[str, int]] = {}
    for fs_type, fs_status, cnt in type_rows:
        key = fs_type.value if hasattr(fs_type, "value") else str(fs_type)
        if key not in type_map:
            type_map[key] = {"active": 0, "archived": 0}
        status_key = fs_status.value if hasattr(fs_status, "value") else str(fs_status)
        type_map[key][status_key] = cnt

    type_breakdown = [
        TypeBreakdown(
            type=t,
            count=counts["active"] + counts["archived"],
            active=counts["active"],
            archived=counts["archived"],
        )
        for t, counts in sorted(type_map.items())
    ]

    total_active = sum(tb.active for tb in type_breakdown)
    total_all = sum(tb.count for tb in type_breakdown)

    # Relation count
    rel_count_q = select(func.count(Relation.id))
    rel_count = (await db.execute(rel_count_q)).scalar() or 0

    # Average completion
    avg_q = (
        select(func.avg(FactSheet.completion))
        .where(FactSheet.status == FactSheetStatus.ACTIVE)
    )
    completeness_avg = (await db.execute(avg_q)).scalar() or 0.0

    # Recent events (last 7 days)
    week_ago = datetime.utcnow() - timedelta(days=7)
    recent_q = (
        select(func.count(Event.id))
        .where(Event.created_at >= week_ago)
    )
    recent_changes = (await db.execute(recent_q)).scalar() or 0

    # Previous week for trend
    two_weeks_ago = datetime.utcnow() - timedelta(days=14)
    prev_q = (
        select(func.count(Event.id))
        .where(Event.created_at >= two_weeks_ago, Event.created_at < week_ago)
    )
    prev_changes = (await db.execute(prev_q)).scalar() or 0
    change_trend = (
        ((recent_changes - prev_changes) / prev_changes * 100)
        if prev_changes > 0
        else 0.0
    )

    # Lifecycle distribution for active fact sheets
    active_fs_q = (
        select(FactSheet)
        .where(FactSheet.status == FactSheetStatus.ACTIVE, FactSheet.lifecycle.isnot(None))
    )
    active_with_lc = list((await db.execute(active_fs_q)).scalars().all())

    lifecycle_dist: dict[str, int] = {
        "plan": 0, "phase_in": 0, "active": 0, "phase_out": 0, "end_of_life": 0, "undefined": 0,
    }
    today = date.today().isoformat()
    for fs in active_with_lc:
        lc = fs.lifecycle or {}
        current = "undefined"
        for phase in ["plan", "phase_in", "active", "phase_out", "end_of_life"]:
            if lc.get(phase) and lc[phase] <= today:
                current = phase
        lifecycle_dist[current] += 1

    # Count fact sheets with no lifecycle
    no_lc_count = total_active - len(active_with_lc)
    lifecycle_dist["undefined"] += no_lc_count

    # Health scores
    health_scores = _compute_health_scores(
        total_active, completeness_avg, lifecycle_dist, type_map
    )

    # KPI cards
    app_count = type_map.get("application", {}).get("active", 0)
    kpis = [
        KPICard(label="Total Fact Sheets", value=total_active, icon="inventory_2"),
        KPICard(label="Applications", value=app_count, icon="apps", color="info"),
        KPICard(label="Relations", value=rel_count, icon="link", color="secondary"),
        KPICard(
            label="Changes (7d)",
            value=recent_changes,
            icon="trending_up",
            trend=round(change_trend, 1),
            color="warning",
        ),
        KPICard(label="Avg Completion", value=f"{completeness_avg:.0f}%", icon="task_alt", color="success"),
    ]

    return DashboardData(
        kpis=kpis,
        health_scores=health_scores,
        type_breakdown=type_breakdown,
        lifecycle_distribution=lifecycle_dist,
        recent_changes_count=recent_changes,
        completeness_avg=round(completeness_avg, 1),
    )


def _compute_health_scores(
    total_active: int,
    completeness_avg: float,
    lifecycle_dist: dict[str, int],
    type_map: dict[str, dict[str, int]],
) -> list[HealthScore]:
    """Compute health scores for different dimensions."""
    scores: list[HealthScore] = []

    # Data completeness health
    comp_score = min(completeness_avg, 100)
    scores.append(HealthScore(
        label="Data Completeness",
        score=round(comp_score, 1),
        color="green" if comp_score >= 70 else "yellow" if comp_score >= 40 else "red",
    ))

    # Lifecycle coverage: % of active FS with defined lifecycle
    defined_lc = sum(v for k, v in lifecycle_dist.items() if k != "undefined")
    lc_total = defined_lc + lifecycle_dist.get("undefined", 0)
    lc_score = (defined_lc / lc_total * 100) if lc_total > 0 else 0
    scores.append(HealthScore(
        label="Lifecycle Coverage",
        score=round(lc_score, 1),
        color="green" if lc_score >= 70 else "yellow" if lc_score >= 40 else "red",
    ))

    # Technical debt: % of apps NOT in phase_out/end_of_life
    eol_count = lifecycle_dist.get("phase_out", 0) + lifecycle_dist.get("end_of_life", 0)
    app_active = type_map.get("application", {}).get("active", 0)
    if app_active > 0:
        tech_health = max(0, (1 - eol_count / app_active)) * 100
    else:
        tech_health = 100
    scores.append(HealthScore(
        label="Technical Health",
        score=round(tech_health, 1),
        color="green" if tech_health >= 70 else "yellow" if tech_health >= 40 else "red",
    ))

    return scores


# ---------------------------------------------------------------------------
# Landscape Report
# ---------------------------------------------------------------------------

@dataclass
class LandscapeItem:
    id: str
    name: str
    fs_type: str
    lifecycle_phase: str
    business_criticality: str | None
    technical_suitability: str | None
    completion: float
    tag_names: list[str]
    relation_count: int


async def build_landscape_report(
    db: AsyncSession,
    fs_type: str | None = None,
) -> list[LandscapeItem]:
    """Build a landscape report: all fact sheets with key metadata."""
    q = (
        select(FactSheet)
        .where(FactSheet.status == FactSheetStatus.ACTIVE)
        .order_by(FactSheet.type, FactSheet.name)
    )
    if fs_type:
        q = q.where(FactSheet.type == fs_type)
    items = list((await db.execute(q)).scalars().all())
    if not items:
        return []

    fs_ids = [i.id for i in items]

    # Relation counts
    rel_q = (
        select(Relation.from_fact_sheet_id, func.count(Relation.id))
        .where(Relation.from_fact_sheet_id.in_(fs_ids))
        .group_by(Relation.from_fact_sheet_id)
    )
    rel_counts = dict((await db.execute(rel_q)).all())

    # Also count incoming relations
    rel_to_q = (
        select(Relation.to_fact_sheet_id, func.count(Relation.id))
        .where(Relation.to_fact_sheet_id.in_(fs_ids))
        .group_by(Relation.to_fact_sheet_id)
    )
    rel_to_counts = dict((await db.execute(rel_to_q)).all())

    # Tags
    tag_q = (
        select(FactSheetTag.fact_sheet_id, Tag.name)
        .join(Tag, Tag.id == FactSheetTag.tag_id)
        .where(FactSheetTag.fact_sheet_id.in_(fs_ids))
    )
    tag_rows = (await db.execute(tag_q)).all()
    tag_map: dict[uuid.UUID, list[str]] = {}
    for fs_id, tag_name in tag_rows:
        tag_map.setdefault(fs_id, []).append(tag_name)

    today = date.today().isoformat()
    results: list[LandscapeItem] = []
    for fs in items:
        attrs = fs.attributes or {}
        lc = fs.lifecycle or {}
        phase = "undefined"
        for p in ["plan", "phase_in", "active", "phase_out", "end_of_life"]:
            if lc.get(p) and lc[p] <= today:
                phase = p

        total_rels = rel_counts.get(fs.id, 0) + rel_to_counts.get(fs.id, 0)
        results.append(LandscapeItem(
            id=str(fs.id),
            name=fs.name,
            fs_type=fs.type.value,
            lifecycle_phase=phase,
            business_criticality=attrs.get("business_criticality"),
            technical_suitability=attrs.get("technical_suitability"),
            completion=fs.completion,
            tag_names=tag_map.get(fs.id, []),
            relation_count=total_rels,
        ))

    return results


# ---------------------------------------------------------------------------
# Matrix Report: Type × Type via Relations
# ---------------------------------------------------------------------------

@dataclass
class MatrixCell:
    from_id: str
    from_name: str
    to_id: str
    to_name: str
    relation_type: str
    count: int


@dataclass
class MatrixReport:
    rows: list[str]  # from fact sheet names
    columns: list[str]  # to fact sheet names
    cells: list[MatrixCell]
    row_type: str
    col_type: str


async def build_matrix_report(
    db: AsyncSession,
    row_type: str = "application",
    col_type: str = "business_capability",
) -> MatrixReport:
    """Build a matrix of relations between two fact sheet types."""
    # Get row items
    row_q = (
        select(FactSheet)
        .where(FactSheet.status == FactSheetStatus.ACTIVE, FactSheet.type == row_type)
        .order_by(FactSheet.name)
    )
    row_items = list((await db.execute(row_q)).scalars().all())

    # Get col items
    col_q = (
        select(FactSheet)
        .where(FactSheet.status == FactSheetStatus.ACTIVE, FactSheet.type == col_type)
        .order_by(FactSheet.name)
    )
    col_items = list((await db.execute(col_q)).scalars().all())

    if not row_items or not col_items:
        return MatrixReport(rows=[], columns=[], cells=[], row_type=row_type, col_type=col_type)

    row_ids = [r.id for r in row_items]
    col_ids = [c.id for c in col_items]

    # Find relations between row and col items
    rel_q = (
        select(
            Relation.from_fact_sheet_id,
            Relation.to_fact_sheet_id,
            Relation.type,
            func.count(Relation.id),
        )
        .where(
            Relation.from_fact_sheet_id.in_(row_ids),
            Relation.to_fact_sheet_id.in_(col_ids),
        )
        .group_by(Relation.from_fact_sheet_id, Relation.to_fact_sheet_id, Relation.type)
    )
    rel_rows = (await db.execute(rel_q)).all()

    # Also check reverse direction
    rev_q = (
        select(
            Relation.to_fact_sheet_id,
            Relation.from_fact_sheet_id,
            Relation.type,
            func.count(Relation.id),
        )
        .where(
            Relation.to_fact_sheet_id.in_(row_ids),
            Relation.from_fact_sheet_id.in_(col_ids),
        )
        .group_by(Relation.to_fact_sheet_id, Relation.from_fact_sheet_id, Relation.type)
    )
    rev_rows = (await db.execute(rev_q)).all()

    name_map = {r.id: r.name for r in row_items}
    name_map.update({c.id: c.name for c in col_items})

    cells: list[MatrixCell] = []
    for from_id, to_id, rel_type, cnt in rel_rows:
        rel_val = rel_type.value if hasattr(rel_type, "value") else str(rel_type)
        cells.append(MatrixCell(
            from_id=str(from_id),
            from_name=name_map.get(from_id, ""),
            to_id=str(to_id),
            to_name=name_map.get(to_id, ""),
            relation_type=rel_val,
            count=cnt,
        ))

    for from_id, to_id, rel_type, cnt in rev_rows:
        rel_val = rel_type.value if hasattr(rel_type, "value") else str(rel_type)
        cells.append(MatrixCell(
            from_id=str(from_id),
            from_name=name_map.get(from_id, ""),
            to_id=str(to_id),
            to_name=name_map.get(to_id, ""),
            relation_type=rel_val,
            count=cnt,
        ))

    return MatrixReport(
        rows=[r.name for r in row_items],
        columns=[c.name for c in col_items],
        cells=cells,
        row_type=row_type,
        col_type=col_type,
    )


# ---------------------------------------------------------------------------
# CSV Export
# ---------------------------------------------------------------------------

async def export_fact_sheets_csv(
    db: AsyncSession,
    fs_type: str | None = None,
) -> str:
    """Export fact sheets as CSV string."""
    q = (
        select(FactSheet)
        .where(FactSheet.status == FactSheetStatus.ACTIVE)
        .order_by(FactSheet.type, FactSheet.name)
    )
    if fs_type:
        q = q.where(FactSheet.type == fs_type)

    items = list((await db.execute(q)).scalars().all())

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "ID", "Name", "Type", "Status", "Description",
        "Lifecycle Phase", "Business Criticality", "Technical Suitability",
        "Completion", "External ID", "Created At", "Updated At",
    ])

    today = date.today().isoformat()
    for fs in items:
        attrs = fs.attributes or {}
        lc = fs.lifecycle or {}
        phase = "undefined"
        for p in ["plan", "phase_in", "active", "phase_out", "end_of_life"]:
            if lc.get(p) and lc[p] <= today:
                phase = p

        writer.writerow([
            str(fs.id),
            fs.name,
            fs.type.value,
            fs.status.value,
            fs.description or "",
            phase,
            attrs.get("business_criticality", ""),
            attrs.get("technical_suitability", ""),
            f"{fs.completion:.0f}",
            fs.external_id or "",
            fs.created_at.isoformat() if fs.created_at else "",
            fs.updated_at.isoformat() if fs.updated_at else "",
        ])

    return output.getvalue()


async def export_relations_csv(db: AsyncSession) -> str:
    """Export all relations as CSV string."""
    q = select(Relation).order_by(Relation.type, Relation.created_at)
    items = list((await db.execute(q)).scalars().all())

    # Get all fact sheet names
    all_ids: set[uuid.UUID] = set()
    for r in items:
        all_ids.add(r.from_fact_sheet_id)
        all_ids.add(r.to_fact_sheet_id)

    name_map: dict[uuid.UUID, str] = {}
    if all_ids:
        nm_q = select(FactSheet.id, FactSheet.name).where(FactSheet.id.in_(list(all_ids)))
        for fid, fname in (await db.execute(nm_q)).all():
            name_map[fid] = fname

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "ID", "Type", "From ID", "From Name", "To ID", "To Name", "Created At",
    ])

    for r in items:
        writer.writerow([
            str(r.id),
            r.type.value,
            str(r.from_fact_sheet_id),
            name_map.get(r.from_fact_sheet_id, ""),
            str(r.to_fact_sheet_id),
            name_map.get(r.to_fact_sheet_id, ""),
            r.created_at.isoformat() if r.created_at else "",
        ])

    return output.getvalue()
