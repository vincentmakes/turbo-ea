---
title: "In the Cost Report, help and row notes open on a tap; an Initiative's stored budget with no PPM lines counts in full with a note; cost viewing permission alone…"
author: Claude
date: 2026-11-12
branch: claude/focused-lamport-vmc50l
cost: { minutes: 39, tokens: 117764 }
id: l-e0ffc4f1
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - VERSION
  - backend/app/api/v1/reports.py
  - backend/app/services/card_write_service.py
  - backend/app/services/dashboard_query.py
  - backend/app/services/ppm_fiscal_costs.py
  - backend/tests/api/test_dashboards.py
  - backend/tests/api/test_reports_cost_ppm_fiscal_year.py
  - backend/tests/services/test_dashboard_query.py
  - backend/tests/services/test_ppm_fiscal_costs.py
---

## Decided
Owner decisions on the follow-up to the fiscal-year slice (#1362, PR #1395):
- The year's figure of an Initiative's PPM budget stays readable with the cost viewing permission alone. It is cost data, and the same reader can already see the card's total and any per-year formula result.
- An Initiative with a stored Budget or Actual Cost and no PPM lines counts in full. The report marks it only when the PPM module is on and no calculation writes the field, because without lines the field is handed back to calculations and a formula result may already be the year's figure. The backend names the basis neutrally (card value, not "typed").
- The two PPM-fed fields are labelled "(PPM)" where a cost field or source is picked, with the module on: one marker at the field rather than an icon on every row.
- Old dashboard KPI snapshots for Initiative cost sums and averages are deleted by a migration once PPM lines of that kind exist, so the trend restarts instead of showing a false drop.
- The owner reported the report's question marks did nothing on an iPad: they were hand-rolled hover-only tooltips. Help and note marks now use the shared help-tip component, which opens on a tap.

## Tried and ruled out
- Requiring the PPM permission to slice, or hiding PPM-backed Initiatives from readers without it: the first keeps the overstated figure for that role, the second makes their totals too low.
- Spreading a typed budget evenly over the Initiative's years: invents numbers and is pro-rating, which the cost reports avoid.
- Narrowing the snapshot deletion to tiles whose value really changed: it would mean evaluating each tile's query inside the migration.

## Watch out
- A tooltip is portaled, but React events still bubble through the component tree: a tap on the open bubble reached the table row and opened the card. The help-tip stops clicks inside its bubble without preventing them, so links in the text still work.
- The translation skill only finds missing keys. A reworded English string or doc paragraph must be named to it explicitly.
- Real iPad Safari was not available; the tap check ran in Chromium with touch emulation.

In the code:
- `frontend/src/components/HelpTip.tsx` (`icon`, `testId`, `slotProps.popper.onClick`); `frontend/src/features/reports/CostReport.tsx` (`typedTotalIds`, `nameWithShared`); `frontend/src/lib/ppmCostFields.ts`; UI_GUIDELINES §3.17.
- `backend/app/services/ppm_fiscal_costs.py` (`FiscalCosts.basis`, `BASIS_CARD_VALUE`, `budget_line_rows`, `cost_line_rows`, also read by `build_ppm_map`); payload field `cost_basis`.
- `backend/alembic/versions/172_reset_initiative_cost_kpi_snapshots.py` (`stale_keys`, `reset_snapshots`).
