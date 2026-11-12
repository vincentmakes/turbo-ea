---
title: "An Initiative's Budget and Actual Cost are lifetime totals written by the PPM cost sync, but the Cost Report reads them as this fiscal year's cost (#1362)"
author: Claude
date: 2026-11-12
branch: claude/focused-lamport-vmc50l
cost: { minutes: 2, tokens: 104003 }
id: l-bc9c7d68
scope: repo
status: active
src: agent
touches:
  - backend/app/api/v1/ppm.py
  - backend/app/services/card_write_service.py
  - backend/app/api/v1/reports.py
  - backend/app/services/calculation_ppm.py
---

## Decided
Diagnosis only; the fix is proposed to the owner and not yet approved. The follow-up in discussion #1362 (an initiative with €25k budget lines in FY 2026 and FY 2027 shows €50k under "Current fiscal year: FY 2026") is not a seeded calculation. The PPM cost sync sums every budget line into the card's Budget field and every cost-line actual into Actual Cost, with no fiscal-year filter, and the card shows those fields as auto-managed, which users read as "calculated". The Cost Report treats any cost field as one annual figure for the current fiscal year, so a multi-year programme shows its lifetime budget as this year's cost, out of the box.

Proposed (my recommendation, awaiting the owner's word): the cost reports read the current-fiscal-year slice straight from the PPM lines for Initiatives that have them (budget lines by their fiscal year, cost lines by date), keep the hand-entered figure when there are no lines, leave the card field meaning "project total", and say in the tile tooltip that it is the year's share of a larger total.

## Tried and ruled out
- Making the card's Budget field itself the current-year figure: changes its meaning on the card, the PPM portfolio and portals, and the stored value is stale at every fiscal-year rollover until a line is edited.
- Seeding extra "current FY" cost fields: same rollover staleness, a built-in metamodel migration, and the report is still wrong by default.
- The calculated-field workaround given in the thread: fine only with the current-fiscal-year variable rather than a hard-coded year, and no scheduled job re-runs calculations when the fiscal year turns.

## Watch out
- Open decisions: undated cost lines belong to no fiscal year (recommend leaving them out of the report's actuals); whether the lifecycle "live in fiscal year" gate still decides if an Initiative appears at all (recommend yes, one rule); custom cost fields fed by the lifetime PPM total cannot be detected by the report.
- The Capability Map total cost, process map and TurboLens sums read Application costs only, so they are not affected.

In the code:
- `backend/app/api/v1/ppm.py` `_sync_initiative_costs` (~L95-140) writes `costBudget` / `costActual` as all-years sums.
- `backend/app/services/card_write_service.py` `_PPM_MANAGED_FIELDS`, `_get_ppm_exclusions`; frontend `ppmAutoFieldKeys` in `features/cards/CardDetail.tsx`.
- Cost attribute reads in `backend/app/api/v1/reports.py`: ~L1416 (`/reports/cost`), ~L1604 (aggregated related cards), ~L1679 (primary cards).
- Per-year aggregation already exists: `build_ppm_map` in `backend/app/services/calculation_ppm.py` (`byYear`, `currentFiscalYear`, `unscheduled*`).
- `PpmBudgetLine.fiscal_year` is a stored column; `PpmCostLine.date` is nullable.
- Read a discussion with `gh api -X GET repos/<owner>/<repo>/discussions/<n>` and `.../comments`.
