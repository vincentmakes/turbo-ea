from __future__ import annotations

from pydantic import BaseModel, Field, StrictInt

from app.schemas.cost_items import KEY_PATTERN


class LicenseMetricCreate(BaseModel):
    key: str = Field(..., pattern=KEY_PATTERN)
    label: str = Field(..., min_length=1, max_length=100)
    translations: dict[str, str] | None = None


class LicenseMetricUpdate(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=100)
    translations: dict[str, str] | None = None
    archived: bool | None = None
    sort_order: int | None = Field(None, ge=0, le=2147483647)


class LicenseTypeCreate(BaseModel):
    key: str = Field(..., pattern=KEY_PATTERN)
    label: str = Field(..., min_length=1, max_length=100)
    translations: dict[str, str] | None = None


class LicenseTypeUpdate(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=100)
    translations: dict[str, str] | None = None
    archived: bool | None = None
    sort_order: int | None = Field(None, ge=0, le=2147483647)


class LicenseTypeOut(BaseModel):
    id: str
    metric_key: str
    key: str
    label: str
    sort_order: int
    archived: bool
    translations: dict[str, str] = {}


class LicenseMetricOut(BaseModel):
    id: str
    key: str
    label: str
    sort_order: int
    archived: bool
    translations: dict[str, str] = {}
    types: list[LicenseTypeOut]


class LicenseCellWrite(BaseModel):
    licensed: StrictInt = Field(..., ge=0, le=1_000_000_000)
    actual: StrictInt | None = Field(None, ge=0, le=1_000_000_000)


class LicenseTypeResultOut(BaseModel):
    key: str
    licensed: int
    actual: int | None
    pct: float | None
    no_licence: bool
    status: str


class MetricResultOut(BaseModel):
    metric: str
    types: list[LicenseTypeResultOut]
    has_actual: bool
    status: str
    worst_pct: float | None
    worst_no_licence: bool
    licensed_total: int
    actual_total: int | None


class YearLicensesOut(BaseModel):
    fiscal_year: int
    is_current: bool
    is_forecast: bool
    confirmed: bool
    fallback_from: int | None
    metrics: list[MetricResultOut]
    status: str | None
    pair_keys: list[str]


class YearLicensesDetailOut(YearLicensesOut):
    can_edit: bool


class CardLicensesOut(BaseModel):
    can_edit: bool
    years: list[YearLicensesOut]


class ReportTypeCell(BaseModel):
    licensed: int
    actual: int | None
    pct: float | None
    no_licence: bool
    status: str


class ReportRow(BaseModel):
    id: str
    name: str
    type: str
    attributes: dict
    group: str | None = None
    status: str | None
    worst_pct: float | None
    worst_no_licence: bool
    licensed_total: int
    actual_total: int | None
    by_type: dict[str, ReportTypeCell]


class ReportTrendCell(BaseModel):
    licensed: int
    actual: int | None


class ReportTrendYear(BaseModel):
    fiscal_year: int
    cards: dict[str, dict[str, ReportTrendCell]]


class ReportAggregate(BaseModel):
    id: str
    name: str
    type: str


class LicenseReportOut(BaseModel):
    fiscal_year: int
    current_fiscal_year: int
    fiscal_year_start: int
    metric: str
    years: list[int]
    license_types: list[LicenseTypeOut]
    aggregate: ReportAggregate | None
    rows: list[ReportRow]
    trend: list[ReportTrendYear]


class ImportIssueOut(BaseModel):
    row: int
    component: str
    reason: str
    detail: str = ""


class ImportResultOut(BaseModel):
    matched: int
    applied: int
    skipped: list[ImportIssueOut]
    flagged: list[ImportIssueOut]
