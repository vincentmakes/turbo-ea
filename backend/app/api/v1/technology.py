"""Technology analytics endpoints: risk scoring, cost aggregation, tech radar, risk matrix."""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.fact_sheet import FactSheetType
from app.services.risk_service import (
    compute_tech_risk_scores,
    get_app_tech_stacks,
    get_provider_cost_summaries,
    get_risk_matrix_data,
    get_tech_radar_data,
)

router = APIRouter()


# --- Response schemas ---


class TechRiskResponse(BaseModel):
    fact_sheet_id: str
    name: str
    fs_type: str
    lifecycle_phase: str
    lifecycle_risk: float
    resource_classification: str | None
    classification_risk: float
    dependent_app_count: int
    aggregate_risk: float


class ProviderCostResponse(BaseModel):
    provider_id: str
    provider_name: str
    component_count: int
    total_cost: float
    app_count: int


class TechStackComponentResponse(BaseModel):
    id: str
    name: str
    category: str | None
    lifecycle_phase: str | None
    resource_classification: str | None
    cost: float | None


class AppTechStackResponse(BaseModel):
    app_id: str
    app_name: str
    business_criticality: str | None
    components: list[dict]


class TechRadarItemResponse(BaseModel):
    id: str
    name: str
    category: str | None
    ring: str
    quadrant: str
    app_count: int


class RiskMatrixItemResponse(BaseModel):
    id: str
    name: str
    technical_suitability: str | None
    business_criticality: str | None
    lifecycle_phase: str
    tech_risk: float
    component_count: int


# --- Endpoints ---


@router.get("/risk-scores", response_model=list[TechRiskResponse])
async def get_tech_risk_scores(
    type: FactSheetType | None = Query(None, description="Filter by fact sheet type"),
    db: AsyncSession = Depends(get_db),
):
    """Get technology risk scores for IT Components, sorted by risk descending."""
    scores = await compute_tech_risk_scores(db, fs_type=type)
    return [
        TechRiskResponse(
            fact_sheet_id=str(s.fact_sheet_id),
            name=s.name,
            fs_type=s.fs_type,
            lifecycle_phase=s.lifecycle_phase,
            lifecycle_risk=s.lifecycle_risk,
            resource_classification=s.resource_classification,
            classification_risk=s.classification_risk,
            dependent_app_count=s.dependent_app_count,
            aggregate_risk=s.aggregate_risk,
        )
        for s in scores
    ]


@router.get("/provider-costs", response_model=list[ProviderCostResponse])
async def get_provider_costs(
    db: AsyncSession = Depends(get_db),
):
    """Get cost aggregation per provider."""
    summaries = await get_provider_cost_summaries(db)
    return [
        ProviderCostResponse(
            provider_id=str(s.provider_id),
            provider_name=s.provider_name,
            component_count=s.component_count,
            total_cost=s.total_cost,
            app_count=s.app_count,
        )
        for s in summaries
    ]


@router.get("/tech-stacks", response_model=list[AppTechStackResponse])
async def get_tech_stacks(
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Get applications with their technology stack (IT Components)."""
    stacks = await get_app_tech_stacks(db, limit)
    return [
        AppTechStackResponse(
            app_id=str(s.app_id),
            app_name=s.app_name,
            business_criticality=s.business_criticality,
            components=s.components,
        )
        for s in stacks
    ]


@router.get("/radar", response_model=list[TechRadarItemResponse])
async def get_tech_radar(
    db: AsyncSession = Depends(get_db),
):
    """Get technology radar data (IT Components mapped to rings and quadrants)."""
    data = await get_tech_radar_data(db)
    return [
        TechRadarItemResponse(
            id=str(d.id),
            name=d.name,
            category=d.category,
            ring=d.ring,
            quadrant=d.quadrant,
            app_count=d.app_count,
        )
        for d in data
    ]


@router.get("/risk-matrix", response_model=list[RiskMatrixItemResponse])
async def get_risk_matrix(
    db: AsyncSession = Depends(get_db),
):
    """Get risk matrix data for applications (technical fitness vs business criticality)."""
    data = await get_risk_matrix_data(db)
    return [
        RiskMatrixItemResponse(
            id=str(d.id),
            name=d.name,
            technical_suitability=d.technical_suitability,
            business_criticality=d.business_criticality,
            lifecycle_phase=d.lifecycle_phase,
            tech_risk=d.tech_risk,
            component_count=d.component_count,
        )
        for d in data
    ]
