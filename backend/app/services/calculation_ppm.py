"""PPM budget and cost data, shaped for the formula context.

The PPM module keeps budgets and costs in their own tables and rolls only two
combined totals (``costBudget`` / ``costActual``) onto the Initiative card, so a
formula could never see the capex/opex split or a single fiscal year. This
module exposes the full breakdown under a ``ppm`` context root.

Two shapes, deliberately:

* flat totals (``ppm.capexBudget`` …) for the common case;
* ``ppm.byYear``, a **list of dicts** rather than a year-keyed mapping, so the
  existing ``FILTER`` / ``PLUCK`` builtins work on it and no new formula
  functions are needed::

      SUM(PLUCK(FILTER(ppm.byYear, "year", 2026), "capexBudget"))

Beside the money, the same root carries the initiative's **delivery** figures
(#1111): ``ppm.completion`` (the very number the Overview tab shows — the mean
of the root work packages' completion), work-package / milestone counts, task
counts by status plus ``tasksOverdue``, PPM risk counts, and the latest status
report's date and three health flags. A formula such as ``ppm.completion``
targeting a ``percentage`` field is how real progress reaches a card and a
published portal, which otherwise only ever see attributes.

Everything is aggregated for *all* initiatives in a context at once — a fixed
handful of grouped queries regardless of how many related cards there are —
because the context is rebuilt per card per calculation and ``workspace_io``
runs it over every card in the database.
"""

from __future__ import annotations

import re
import uuid
from datetime import date as date_type
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import case, extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_settings import AppSettings
from app.models.ppm_cost_line import PpmBudgetLine, PpmCostLine
from app.models.ppm_risk import PpmRisk
from app.models.ppm_status_report import PpmStatusReport
from app.models.ppm_task import PpmTask
from app.models.ppm_wbs import PpmWbs
from app.services.ppm_portfolio_service import latest_reports

INITIATIVE_TYPE = "Initiative"

# capex / opex / total × budget / planned / actual
_MEASURES = ("Budget", "Planned", "Actual")
_BUCKETS = ("capex", "opex", "total")

# Task status → the ``ppm.tasks<Status>`` counter it lands in. Mirrors the
# status vocabulary of ``PpmTaskStatus`` in the frontend types.
_TASK_STATUS_KEYS = {
    "todo": "tasksTodo",
    "in_progress": "tasksInProgress",
    "done": "tasksDone",
    "blocked": "tasksBlocked",
}

_PPM_REFERENCE = re.compile(r"\bppm\b")


def needs_ppm(formula: str) -> bool:
    """Whether a formula reads the ``ppm`` root at all.

    Gates the aggregation queries so a workspace with no PPM formulas pays
    nothing. Deliberately a token match rather than an AST walk: a reference can
    legitimately live inside a *string literal*, as in
    ``PLUCK(relations.relInitiativeToApp, "ppm.capexBudget")``, which an AST
    pass would not see. A false positive costs two harmless queries; a false
    negative would be a wrong number, so this errs wide on purpose.
    """
    return bool(_PPM_REFERENCE.search(formula or ""))


def _fiscal_year(year: int, month: int, start_month: int) -> int:
    """Fiscal year for a (year, month), named after the year the year *ends* in.

    Note the ``start_month > 1`` guard. Without it every date would land in
    ``year + 1`` on a January start, because ``month >= 1`` is always true.
    """
    return year + (1 if 1 < start_month <= 12 and month >= start_month else 0)


def fiscal_year_for(value: date_type | None, start_month: int) -> int | None:
    """Fiscal year a date falls in, named after the year the year *ends* in.

    With a start month of October, 2025-10-15 opens FY2026 and 2025-09-30 closes
    FY2025 — the US-federal / UK convention. With the default start month of
    January the fiscal year is just the calendar year, so the distinction only
    ever shows up on installs that changed the setting.

    ``None`` for a dateless row: it still counts towards the totals, it just
    belongs to no particular year (see ``unscheduled*`` in the payload).
    """
    if value is None:
        return None
    return _fiscal_year(value.year, value.month, start_month)


async def get_fiscal_year_start(db: AsyncSession) -> int:
    """Fiscal year start month (1-12) from app settings; January by default.

    Read per run, never cached in module state: an admin can change it in-flight
    via ``PATCH /settings/fiscal-year-start``, and a stale process-wide cache
    would make workers disagree. Bulk callers hoist it out of their loop and
    pass it down, so this is one query per recalculation, not one per card.
    """
    row = (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    month = general.get("fiscalYearStart", 1)
    return month if isinstance(month, int) and 1 <= month <= 12 else 1


def _zero_measures() -> dict[str, float]:
    return {f"{bucket}{measure}": 0.0 for measure in _MEASURES for bucket in _BUCKETS}


def empty_ppm(current_fiscal_year: int | None = None) -> dict[str, Any]:
    """The ``ppm`` payload for a card that has no PPM data.

    Every non-Initiative card gets this rather than ``None`` so that a formula
    referencing ``ppm.capexBudget`` on the wrong card type reads ``0`` instead of
    crashing — the same reasoning as seeding ``relations`` with empty lists.
    """
    payload: dict[str, Any] = _zero_measures()
    payload["currentFiscalYear"] = current_fiscal_year
    payload["unscheduledPlanned"] = 0.0
    payload["unscheduledActual"] = 0.0
    payload["byYear"] = []
    payload.update(_zero_delivery())
    return payload


def _zero_delivery() -> dict[str, Any]:
    """The delivery half of the payload for an initiative with no PPM rows.

    Counts read ``0`` so arithmetic never trips on a blank; the latest-report
    fields read ``None`` because "no report yet" and "on track" are different
    facts, and a formula should be able to tell them apart with ``COALESCE``.
    """
    return {
        "completion": 0.0,
        "wbsCount": 0,
        "milestoneCount": 0,
        "taskCount": 0,
        "tasksTodo": 0,
        "tasksInProgress": 0,
        "tasksDone": 0,
        "tasksBlocked": 0,
        "tasksOverdue": 0,
        "riskCount": 0,
        "risksOpen": 0,
        "riskScoreMax": 0,
        "reportCount": 0,
        "reportDate": None,
        "scheduleHealth": None,
        "costHealth": None,
        "scopeHealth": None,
    }


async def root_wbs_completion_map(
    db: AsyncSession, initiative_ids: list[uuid.UUID]
) -> dict[str, float]:
    """Overall completion per initiative: the mean of its **root** work packages.

    One definition shared by ``GET /ppm/initiatives/{id}/completion`` (the
    Overview tab) and the ``ppm.completion`` formula variable, so a card can
    never show one number on its Overview tab and another in a calculated
    field. Children are deliberately ignored — every root already carries its
    subtree rolled up by ``_rollup_wbs_from_tasks`` — and an initiative with no
    work packages is absent from the result (callers read that as ``0``).
    """
    if not initiative_ids:
        return {}
    rows = await db.execute(
        select(PpmWbs.initiative_id, func.avg(PpmWbs.completion))
        .where(PpmWbs.initiative_id.in_(initiative_ids), PpmWbs.parent_id.is_(None))
        .group_by(PpmWbs.initiative_id)
    )
    return {str(initiative_id): round(float(avg or 0), 1) for initiative_id, avg in rows.all()}


async def _build_delivery_map(
    db: AsyncSession, initiative_ids: list[uuid.UUID], today: date_type
) -> dict[str, dict[str, Any]]:
    """The non-money half of ``build_ppm_map``: five grouped queries in total."""
    delivery: dict[str, dict[str, Any]] = {str(i): _zero_delivery() for i in initiative_ids}

    for key, value in (await root_wbs_completion_map(db, initiative_ids)).items():
        delivery[key]["completion"] = value

    wbs_rows = await db.execute(
        select(PpmWbs.initiative_id, PpmWbs.is_milestone, func.count(PpmWbs.id))
        .where(PpmWbs.initiative_id.in_(initiative_ids))
        .group_by(PpmWbs.initiative_id, PpmWbs.is_milestone)
    )
    for initiative_id, is_milestone, count in wbs_rows.all():
        delivery[str(initiative_id)]["milestoneCount" if is_milestone else "wbsCount"] = int(count)

    # ``tasksOverdue`` rides on the same grouped query as the status counts:
    # a task is overdue when its due date has passed and it is not done. The
    # cutoff is the caller's ``today`` so tests and bulk runs agree on a day.
    overdue = case((PpmTask.due_date < today, 1), else_=0)
    task_rows = await db.execute(
        select(
            PpmTask.initiative_id,
            PpmTask.status,
            func.count(PpmTask.id),
            func.coalesce(func.sum(overdue), 0),
        )
        .where(PpmTask.initiative_id.in_(initiative_ids))
        .group_by(PpmTask.initiative_id, PpmTask.status)
    )
    for initiative_id, status, count, overdue_count in task_rows.all():
        entry = delivery[str(initiative_id)]
        entry["taskCount"] += int(count)
        status_key = _TASK_STATUS_KEYS.get(status)
        if status_key:
            entry[status_key] += int(count)
        if status != "done":
            entry["tasksOverdue"] += int(overdue_count or 0)

    risk_rows = await db.execute(
        select(
            PpmRisk.initiative_id,
            PpmRisk.status,
            func.count(PpmRisk.id),
            func.max(PpmRisk.risk_score),
        )
        .where(PpmRisk.initiative_id.in_(initiative_ids))
        .group_by(PpmRisk.initiative_id, PpmRisk.status)
    )
    for initiative_id, status, count, score_max in risk_rows.all():
        entry = delivery[str(initiative_id)]
        entry["riskCount"] += int(count)
        if status == "open":
            entry["risksOpen"] += int(count)
        entry["riskScoreMax"] = max(entry["riskScoreMax"], int(score_max or 0))

    report_rows = await db.execute(
        select(PpmStatusReport.initiative_id, func.count(PpmStatusReport.id))
        .where(PpmStatusReport.initiative_id.in_(initiative_ids))
        .group_by(PpmStatusReport.initiative_id)
    )
    for initiative_id, count in report_rows.all():
        delivery[str(initiative_id)]["reportCount"] = int(count)
    for initiative_id, report in (await latest_reports(db, initiative_ids)).items():
        entry = delivery[str(initiative_id)]
        entry["reportDate"] = report.report_date.isoformat() if report.report_date else None
        entry["scheduleHealth"] = report.schedule_health
        entry["costHealth"] = report.cost_health
        entry["scopeHealth"] = report.scope_health

    return delivery


def _add(target: dict[str, float], bucket: str | None, measure: str, amount: float) -> None:
    """Add to the total bucket, and to capex/opex when the category is one of them."""
    target[f"total{measure}"] += amount
    if bucket:
        target[f"{bucket}{measure}"] += amount


def _bucket_for(category: str | None) -> str | None:
    """Map a free-text category onto capex/opex, or None when it is neither.

    ``category`` is a plain text column, so an imported or hand-edited row can
    hold anything. Unrecognised categories still count towards the totals; they
    simply land in neither split.
    """
    key = (category or "").strip().lower()
    return key if key in ("capex", "opex") else None


async def build_ppm_map(
    db: AsyncSession,
    initiative_ids: list[uuid.UUID],
    *,
    start_month: int,
    today: date_type | None = None,
) -> dict[str, dict[str, Any]]:
    """Aggregate PPM data for several initiatives at once.

    Returns ``{str(initiative_id): payload}``: the money (two queries) and the
    delivery figures (five more), a fixed count independent of how many
    initiatives are asked for.
    """
    if not initiative_ids:
        return {}
    today = today or datetime.now(timezone.utc).date()
    current_fy = fiscal_year_for(today, start_month)

    totals: dict[str, dict[str, float]] = {str(i): _zero_measures() for i in initiative_ids}
    unscheduled: dict[str, dict[str, float]] = {
        str(i): {"unscheduledPlanned": 0.0, "unscheduledActual": 0.0} for i in initiative_ids
    }
    per_year: dict[str, dict[int, dict[str, float]]] = {}

    def slot(initiative_id: str, year: int) -> dict[str, float]:
        return per_year.setdefault(initiative_id, {}).setdefault(year, _zero_measures())

    # Budget lines carry their fiscal year as a stored column — nothing to derive.
    budget_rows = await db.execute(
        select(
            PpmBudgetLine.initiative_id,
            PpmBudgetLine.fiscal_year,
            func.lower(PpmBudgetLine.category),
            func.coalesce(func.sum(PpmBudgetLine.amount), 0),
        )
        .where(PpmBudgetLine.initiative_id.in_(initiative_ids))
        .group_by(
            PpmBudgetLine.initiative_id,
            PpmBudgetLine.fiscal_year,
            func.lower(PpmBudgetLine.category),
        )
    )
    for initiative_id, fiscal_year, category, amount in budget_rows.all():
        key = str(initiative_id)
        bucket = _bucket_for(category)
        value = float(amount or 0)
        _add(totals[key], bucket, "Budget", value)
        if fiscal_year is not None:
            _add(slot(key, int(fiscal_year)), bucket, "Budget", value)

    # Cost lines carry a date, not a fiscal year. Group by (year, month) in SQL
    # so the row count stays bounded by 12 × years × categories rather than one
    # row per transaction, but keep the fiscal-year *semantics* in the pure
    # helper above — one definition of the convention, unit-testable without a
    # database.
    year_col = extract("year", PpmCostLine.date)
    month_col = extract("month", PpmCostLine.date)
    cost_rows = await db.execute(
        select(
            PpmCostLine.initiative_id,
            year_col,
            month_col,
            func.lower(PpmCostLine.category),
            func.coalesce(func.sum(PpmCostLine.planned), 0),
            func.coalesce(func.sum(PpmCostLine.actual), 0),
        )
        .where(PpmCostLine.initiative_id.in_(initiative_ids))
        .group_by(PpmCostLine.initiative_id, year_col, month_col, func.lower(PpmCostLine.category))
    )
    for initiative_id, year, month, category, planned, actual in cost_rows.all():
        key = str(initiative_id)
        bucket = _bucket_for(category)
        fiscal_year = None if year is None else _fiscal_year(int(year), int(month), start_month)
        for measure, amount in (("Planned", planned), ("Actual", actual)):
            value = float(amount or 0)
            _add(totals[key], bucket, measure, value)
            if fiscal_year is None:
                unscheduled[key][f"unscheduled{measure}"] += value
            else:
                _add(slot(key, fiscal_year), bucket, measure, value)

    delivery = await _build_delivery_map(db, initiative_ids, today)

    result: dict[str, dict[str, Any]] = {}
    for initiative_id, measures in totals.items():
        payload: dict[str, Any] = dict(measures)
        payload["currentFiscalYear"] = current_fy
        payload.update(unscheduled[initiative_id])
        payload["byYear"] = [
            {"year": year, **year_measures}
            for year, year_measures in sorted((per_year.get(initiative_id) or {}).items())
        ]
        payload.update(delivery[initiative_id])
        result[initiative_id] = payload
    return result
