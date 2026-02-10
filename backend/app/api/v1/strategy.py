"""Strategic planning endpoints: TIME model, rationalization, roadmap, traceability."""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.strategy_service import (
    build_roadmap,
    build_traceability,
    compute_rationalization,
    compute_time_model,
)

router = APIRouter()


# --- Response schemas ---


class TimeModelResponse(BaseModel):
    id: str
    name: str
    quadrant: str
    technical_suitability: str | None
    business_criticality: str | None
    lifecycle_phase: str
    relation_count: int


class RationalizationResponse(BaseModel):
    id: str
    name: str
    score: float
    reasons: list[str]
    time_quadrant: str
    technical_suitability: str | None
    business_criticality: str | None
    lifecycle_phase: str
    duplicate_count: int
    capability_overlap: int


class RoadmapEventResponse(BaseModel):
    id: str
    name: str
    fs_type: str
    phase: str
    date: str
    fact_sheet_id: str


class TraceabilityNodeResponse(BaseModel):
    id: str
    name: str
    fs_type: str
    children: list["TraceabilityNodeResponse"] = []


# --- Endpoints ---


@router.get("/time-model", response_model=list[TimeModelResponse])
async def get_time_model(
    db: AsyncSession = Depends(get_db),
):
    """Get TIME model (Tolerate/Invest/Migrate/Eliminate) for all applications."""
    items = await compute_time_model(db)
    return [
        TimeModelResponse(
            id=str(i.id),
            name=i.name,
            quadrant=i.quadrant,
            technical_suitability=i.technical_suitability,
            business_criticality=i.business_criticality,
            lifecycle_phase=i.lifecycle_phase,
            relation_count=i.relation_count,
        )
        for i in items
    ]


@router.get("/rationalization", response_model=list[RationalizationResponse])
async def get_rationalization(
    db: AsyncSession = Depends(get_db),
):
    """Get rationalization scores for applications (sorted by score desc)."""
    items = await compute_rationalization(db)
    return [
        RationalizationResponse(
            id=str(i.id),
            name=i.name,
            score=i.score,
            reasons=i.reasons,
            time_quadrant=i.time_quadrant,
            technical_suitability=i.technical_suitability,
            business_criticality=i.business_criticality,
            lifecycle_phase=i.lifecycle_phase,
            duplicate_count=i.duplicate_count,
            capability_overlap=i.capability_overlap,
        )
        for i in items
    ]


@router.get("/roadmap", response_model=list[RoadmapEventResponse])
async def get_roadmap(
    months: int = Query(24, ge=1, le=120, description="Months ahead to include"),
    db: AsyncSession = Depends(get_db),
):
    """Get roadmap timeline of lifecycle events."""
    events = await build_roadmap(db, months)
    return [
        RoadmapEventResponse(
            id=str(e.id),
            name=e.name,
            fs_type=e.fs_type,
            phase=e.phase,
            date=e.date,
            fact_sheet_id=str(e.fact_sheet_id),
        )
        for e in events
    ]


@router.get("/traceability", response_model=list[TraceabilityNodeResponse])
async def get_traceability(
    db: AsyncSession = Depends(get_db),
):
    """Get Objective → Initiative → Application traceability tree."""
    def convert(node) -> TraceabilityNodeResponse:
        return TraceabilityNodeResponse(
            id=str(node.id),
            name=node.name,
            fs_type=node.fs_type,
            children=[convert(c) for c in node.children],
        )

    tree = await build_traceability(db)
    return [convert(n) for n in tree]
