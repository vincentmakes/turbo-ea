from datetime import date as date_type
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# --- Status Reports ---


class PpmStatusReportCreate(BaseModel):
    report_date: date_type
    schedule_health: Literal["onTrack", "atRisk", "offTrack"] = "onTrack"
    cost_health: Literal["onTrack", "atRisk", "offTrack"] = "onTrack"
    scope_health: Literal["onTrack", "atRisk", "offTrack"] = "onTrack"
    summary: str | None = None
    accomplishments: str | None = None
    next_steps: str | None = None


class PpmStatusReportUpdate(BaseModel):
    report_date: date_type | None = None
    schedule_health: Literal["onTrack", "atRisk", "offTrack"] | None = None
    cost_health: Literal["onTrack", "atRisk", "offTrack"] | None = None
    scope_health: Literal["onTrack", "atRisk", "offTrack"] | None = None
    summary: str | None = None
    accomplishments: str | None = None
    next_steps: str | None = None


class ReporterOut(BaseModel):
    id: str
    display_name: str


class PpmStatusReportOut(BaseModel):
    id: str
    initiative_id: str
    reporter_id: str
    reporter: ReporterOut | None = None
    report_date: date_type
    schedule_health: str
    cost_health: str
    scope_health: str
    summary: str | None
    accomplishments: str | None
    next_steps: str | None
    created_at: datetime
    updated_at: datetime


# --- Cost Lines ---


class PpmCostLineCreate(BaseModel):
    description: str
    category: Literal["capex", "opex"]
    planned: float = 0
    actual: float = 0
    date: date_type | None = None


class PpmCostLineUpdate(BaseModel):
    description: str | None = None
    category: Literal["capex", "opex"] | None = None
    planned: float | None = None
    actual: float | None = None
    date: date_type | None = None


class PpmCostLineOut(BaseModel):
    id: str
    initiative_id: str
    description: str
    category: str
    planned: float
    actual: float
    date: date_type | None = None
    created_at: datetime
    updated_at: datetime


# --- Budget Lines ---


class PpmBudgetLineCreate(BaseModel):
    fiscal_year: int
    category: Literal["capex", "opex"]
    amount: float = 0


class PpmBudgetLineUpdate(BaseModel):
    fiscal_year: int | None = None
    category: Literal["capex", "opex"] | None = None
    amount: float | None = None


class PpmBudgetLineOut(BaseModel):
    id: str
    initiative_id: str
    fiscal_year: int
    category: str
    amount: float
    created_at: datetime
    updated_at: datetime


# --- Risks ---


class PpmRiskCreate(BaseModel):
    title: str
    description: str | None = None
    probability: int = Field(3, ge=1, le=5)
    impact: int = Field(3, ge=1, le=5)
    mitigation: str | None = None
    owner_id: str | None = None
    status: Literal["open", "mitigating", "mitigated", "closed", "accepted"] = "open"


class PpmRiskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    probability: int | None = Field(None, ge=1, le=5)
    impact: int | None = Field(None, ge=1, le=5)
    mitigation: str | None = None
    owner_id: str | None = None
    status: Literal["open", "mitigating", "mitigated", "closed", "accepted"] | None = None


class PpmRiskOut(BaseModel):
    id: str
    initiative_id: str
    title: str
    description: str | None
    probability: int
    impact: int
    risk_score: int
    mitigation: str | None
    owner_id: str | None
    owner_name: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime


# --- Tasks ---


class PpmTaskCreate(BaseModel):
    title: str
    description: str | None = None
    status: Literal["todo", "in_progress", "done", "blocked"] = "todo"
    priority: Literal["critical", "high", "medium", "low"] = "medium"
    assignee_id: str | None = None
    start_date: date_type | None = None
    due_date: date_type | None = None
    sort_order: int = 0
    tags: list[str] = []
    wbs_id: str | None = None


class PpmTaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: Literal["todo", "in_progress", "done", "blocked"] | None = None
    priority: Literal["critical", "high", "medium", "low"] | None = None
    assignee_id: str | None = None
    start_date: date_type | None = None
    due_date: date_type | None = None
    sort_order: int | None = None
    tags: list[str] | None = None
    wbs_id: str | None = None


class PpmTaskOut(BaseModel):
    id: str
    initiative_id: str
    title: str
    description: str | None
    status: str
    priority: str
    assignee_id: str | None
    assignee_name: str | None = None
    start_date: date_type | None = None
    due_date: date_type | None
    sort_order: int
    tags: list[str]
    wbs_id: str | None = None
    comment_count: int = 0
    created_at: datetime
    updated_at: datetime


# --- Task Comments ---


class PpmTaskCommentCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)


class PpmTaskCommentUpdate(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)


class PpmTaskCommentOut(BaseModel):
    id: str
    task_id: str
    user_id: str
    user_display_name: str
    content: str
    created_at: datetime
    updated_at: datetime


# --- WBS (Work Breakdown Structure) ---


class PpmWbsCreate(BaseModel):
    title: str
    description: str | None = None
    parent_id: str | None = None
    start_date: date_type | None = None
    end_date: date_type | None = None
    sort_order: int = 0


class PpmWbsUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    parent_id: str | None = None
    start_date: date_type | None = None
    end_date: date_type | None = None
    sort_order: int | None = None


class PpmWbsOut(BaseModel):
    id: str
    initiative_id: str
    parent_id: str | None
    title: str
    description: str | None
    start_date: date_type | None
    end_date: date_type | None
    sort_order: int
    progress: float = 0
    task_count: int = 0
    created_at: datetime
    updated_at: datetime


# --- Gantt / Dashboard ---


class PpmGanttStakeholder(BaseModel):
    user_id: str
    display_name: str
    role_key: str


class PpmGanttItem(BaseModel):
    id: str
    name: str
    subtype: str | None
    status: str | None
    parent_id: str | None
    start_date: str | None
    end_date: str | None
    cost_budget: float | None
    cost_actual: float | None
    capex_planned: float = 0
    capex_actual: float = 0
    opex_planned: float = 0
    opex_actual: float = 0
    group_id: str | None = None
    group_name: str | None = None
    latest_report: PpmStatusReportOut | None = None
    latest_report_id: str | None = None
    stakeholders: list[PpmGanttStakeholder] = []


class PpmGroupOption(BaseModel):
    type_key: str
    type_label: str
