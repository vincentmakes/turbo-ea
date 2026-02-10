"""Reporting endpoints: dashboard KPIs, landscape, matrix, CSV export."""

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.report_service import (
    build_landscape_report,
    build_matrix_report,
    compute_dashboard,
    export_fact_sheets_csv,
    export_relations_csv,
)

router = APIRouter()


# --- Response schemas ---


class KPICardResponse(BaseModel):
    label: str
    value: int | float | str
    icon: str
    trend: float | None = None
    color: str = "primary"


class HealthScoreResponse(BaseModel):
    label: str
    score: float
    color: str


class TypeBreakdownResponse(BaseModel):
    type: str
    count: int
    active: int
    archived: int


class DashboardResponse(BaseModel):
    kpis: list[KPICardResponse]
    health_scores: list[HealthScoreResponse]
    type_breakdown: list[TypeBreakdownResponse]
    lifecycle_distribution: dict[str, int]
    recent_changes_count: int
    completeness_avg: float


class LandscapeItemResponse(BaseModel):
    id: str
    name: str
    fs_type: str
    lifecycle_phase: str
    business_criticality: str | None
    technical_suitability: str | None
    completion: float
    tag_names: list[str]
    relation_count: int


class MatrixCellResponse(BaseModel):
    from_id: str
    from_name: str
    to_id: str
    to_name: str
    relation_type: str
    count: int


class MatrixReportResponse(BaseModel):
    rows: list[str]
    columns: list[str]
    cells: list[MatrixCellResponse]
    row_type: str
    col_type: str


# --- Endpoints ---


@router.get("/dashboard", response_model=DashboardResponse)
async def get_dashboard(
    db: AsyncSession = Depends(get_db),
):
    """Get executive dashboard KPIs, health scores, and breakdowns."""
    data = await compute_dashboard(db)
    return DashboardResponse(
        kpis=[
            KPICardResponse(label=k.label, value=k.value, icon=k.icon, trend=k.trend, color=k.color)
            for k in data.kpis
        ],
        health_scores=[
            HealthScoreResponse(label=h.label, score=h.score, color=h.color)
            for h in data.health_scores
        ],
        type_breakdown=[
            TypeBreakdownResponse(type=t.type, count=t.count, active=t.active, archived=t.archived)
            for t in data.type_breakdown
        ],
        lifecycle_distribution=data.lifecycle_distribution,
        recent_changes_count=data.recent_changes_count,
        completeness_avg=data.completeness_avg,
    )


@router.get("/landscape", response_model=list[LandscapeItemResponse])
async def get_landscape(
    fs_type: str | None = Query(None, description="Filter by fact sheet type"),
    db: AsyncSession = Depends(get_db),
):
    """Get landscape report of all fact sheets with key metadata."""
    items = await build_landscape_report(db, fs_type)
    return [
        LandscapeItemResponse(
            id=i.id,
            name=i.name,
            fs_type=i.fs_type,
            lifecycle_phase=i.lifecycle_phase,
            business_criticality=i.business_criticality,
            technical_suitability=i.technical_suitability,
            completion=i.completion,
            tag_names=i.tag_names,
            relation_count=i.relation_count,
        )
        for i in items
    ]


@router.get("/matrix", response_model=MatrixReportResponse)
async def get_matrix(
    row_type: str = Query("application", description="Row fact sheet type"),
    col_type: str = Query("business_capability", description="Column fact sheet type"),
    db: AsyncSession = Depends(get_db),
):
    """Get matrix report of relations between two fact sheet types."""
    data = await build_matrix_report(db, row_type, col_type)
    return MatrixReportResponse(
        rows=data.rows,
        columns=data.columns,
        cells=[
            MatrixCellResponse(
                from_id=c.from_id,
                from_name=c.from_name,
                to_id=c.to_id,
                to_name=c.to_name,
                relation_type=c.relation_type,
                count=c.count,
            )
            for c in data.cells
        ],
        row_type=data.row_type,
        col_type=data.col_type,
    )


@router.get("/export/fact-sheets")
async def export_fact_sheets(
    fs_type: str | None = Query(None, description="Filter by fact sheet type"),
    db: AsyncSession = Depends(get_db),
):
    """Export fact sheets as CSV download."""
    csv_content = await export_fact_sheets_csv(db, fs_type)
    filename = f"fact_sheets_{fs_type or 'all'}.csv"
    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/relations")
async def export_relations(
    db: AsyncSession = Depends(get_db),
):
    """Export all relations as CSV download."""
    csv_content = await export_relations_csv(db)
    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="relations.csv"'},
    )
