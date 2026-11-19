from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StringConstraints

from app.schemas.cost_items import INT32_MAX, KEY_PATTERN

# Stripped before the length check: "   " is no label.
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class LicenseMetricCreate(BaseModel):
    key: str = Field(..., pattern=KEY_PATTERN)
    label: Label
    translations: dict[str, str] | None = None


class LicenseMetricUpdate(BaseModel):
    # A metric's key never changes: a ``key`` in the body is refused, not ignored.
    model_config = ConfigDict(extra="forbid")

    label: Label | None = None
    translations: dict[str, str] | None = None
    archived: bool | None = None
    sort_order: int | None = Field(None, ge=0, le=INT32_MAX)


class LicenseTypeCreate(BaseModel):
    key: str = Field(..., pattern=KEY_PATTERN)
    label: Label
    translations: dict[str, str] | None = None


class LicenseTypeUpdate(BaseModel):
    # A type never moves to another metric: a ``metric_key`` in the body is refused.
    model_config = ConfigDict(extra="forbid")

    label: Label | None = None
    translations: dict[str, str] | None = None
    archived: bool | None = None
    sort_order: int | None = Field(None, ge=0, le=INT32_MAX)


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


class ReportMetric(BaseModel):
    metric: str
    status: str
    worst_pct: float | None
    licensed_total: int
    actual_total: int | None
    types: list[LicenseTypeResultOut]


class ReportRow(BaseModel):
    id: str
    name: str
    type: str
    alias: str | None
    logo_updated_at: datetime | None = None
    attributes: dict
    group: str | None = None
    status: str | None
    worst_pct: float | None
    worst_no_licence: bool
    confirmed: bool
    by_metric: list[ReportMetric]


class ReportAggregate(BaseModel):
    id: str
    name: str
    type: str


class LicenseReportOut(BaseModel):
    fiscal_year: int
    current_fiscal_year: int
    fiscal_year_start: int
    years: list[int]
    aggregate: ReportAggregate | None
    rows: list[ReportRow]
    metrics_in_year: list[str]
    types_in_year: list[str]


class ImportIssueOut(BaseModel):
    row: int
    component: str
    reason: str
    detail: str = ""
    metric: str = ""


class ImportResultOut(BaseModel):
    matched: int
    applied: int
    skipped: list[ImportIssueOut]
