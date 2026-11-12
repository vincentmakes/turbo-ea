---
title: "Surfaces that name a fiscal year count an Initiative's Budget and Actual Cost from that year's PPM lines only; the card field stays the all-years total (#1362)"
author: Claude
date: 2026-11-12
branch: claude/focused-lamport-vmc50l
cost: { minutes: 30, tokens: 117270 }
id: l-c1689882
scope: repo
status: active
replaces: l-bc9c7d68
src: agent
touches:
  - backend/app/api/v1/reports.py
  - backend/app/services/dashboard_query.py
---

## Decided
The PPM cost sync writes the sum of every budget line and every cost-line actual into an Initiative's Budget and Actual Cost, so the card shows all-years totals. The Cost report and the dashboard's cost sum/average, which name the current fiscal year, read those two fields through a read-time slice: budget lines of that fiscal year, cost lines dated in it. The owner approved this plan with these choices: undated cost lines count in no year; the lifecycle "live in fiscal year" rule still decides whether the Initiative appears; an Initiative without lines of that kind keeps its typed figure; cost viewing permission alone gates the report. An item carries the all-lines total only when some of it lies outside the year, read from the lines rather than the stored attribute, and in a Split drill it is shared by the same count as the cost.

## Tried and ruled out
- Storing the current-year figure on the card, or seeding extra "current FY" fields: both go stale when the fiscal year turns and change what Budget means elsewhere.
- Reusing the formula context builder for the slice: it runs five delivery queries the report does not need; a parity test pins the two definitions equal instead.
- Deleting old dashboard KPI snapshots so the trend does not show a false drop: destructive on installed data and not asked for; left as is.

## Watch out
- On the dashboard a year with nothing in it is "no figure", not zero, so the card leaves an average's denominator, as the Cost report drops a zero item.
- A custom cost field fed by the lifetime PPM total is not detectable; the docs point to the per-year formula with the current-fiscal-year variable.
- A new surface that names a fiscal year for a cost must read through the same slice.

In the code:
- `backend/app/services/ppm_fiscal_costs.py` (`load_fiscal_costs`, `FiscalCosts.value` / `lifetime` / `total`, `LineSums`); callers in `backend/app/api/v1/reports.py` (`cost_report`, `cost_treemap`) and `backend/app/services/dashboard_query.py` (`_fiscal_costs_for`, `sliced_metric`).
- Payload field `lifetime_cost`; frontend `fiscalSliceNote` in `features/reports/costTreemapOption.ts` and `CostReport.tsx`; key `cost.fiscalSliceNote`.
- Tests: `tests/services/test_ppm_fiscal_costs.py`, `tests/api/test_reports_cost_ppm_fiscal_year.py`, `tests/api/test_dashboards.py`.
