---
title: "PPM initiative pages derive budget and actuals per side from the initiatives beneath (refines the all-or-nothing roll-up)"
author: Claude
date: 2026-10-20
branch: feat/ppm-initiative-derived-financials
touches:
  - backend/app/services/ppm_rollup.py
  - backend/app/services/ppm_portfolio_service.py
  - backend/app/services/calculation_ppm.py
  - backend/app/schemas/ppm.py
  - frontend/src/features/ppm/derivedFinancials.ts
  - frontend/src/features/ppm/DerivedValue.tsx
  - frontend/src/features/ppm/PpmProjectDetail.tsx
  - frontend/src/features/ppm/PpmOverviewTab.tsx
  - frontend/src/features/ppm/PpmCostTab.tsx
  - frontend/src/features/ppm/ppmPortfolioModel.ts
  - docs/guide/ppm.md
  - docs/admin/calculations.md
---

## Decided
- **Budget and actuals derive independently, everywhere.** This refines the all-or-nothing cost rule in `2026-10-20-ppm-parents-derive-costs-and-dates-supersedes-claude.md`: the planned pair derives when the initiative has no *budget* line and some initiative beneath has one; the actual pair when it has no *cost* line and some beneath has one. The board (`rollup_for_board(parents, figures, presence, dates)`, `Rollup.planned` / `Rollup.actual`, `rowFigures().derivedBudget` / `derivedActual`), the Overview and the Budget & Costs tab all apply the same split, so they never disagree about what is derived.
- Presence per kind costs no extra query: `load_cost_rows` runs the two grouped queries once, `cost_aggregates_from` and `cost_presence_from` read the same `CostRows`. The portal's `TestQueryCount` is unchanged. `build_cost_aggregates` was removed (no caller left).
- **One fetch on the initiative page.** `PpmProjectDetail.loadData` reads `/ppm/initiatives/{id}/rollup` in its `Promise.all`, `.catch(() => null)` so a `subtree_too_large` never blanks the page, and passes `rollup` to both tabs; the Overview no longer has its own query. Every line mutation already calls `onRefresh`, so the derived figures follow.
- The per-fiscal-year split reuses `build_ppm_map`'s `byYear` (the one fiscal-year definition) summed by the pure `ppm_rollup.sum_by_year`; the undated bucket needed the additive keys `unscheduledCapexActual` / `unscheduledOpexActual`. All-zero years are dropped there.
- Frontend decision lives in `derivedFinancials.ts`: a side is derived iff the initiative has no own lines of that kind **and** `derivedYearGroups(rollup, side)` is non-empty, and a derived side's KPI is `sumRows` of those same rows — so the summary bar and the table footer can never disagree. Own sums use `bucketFor` (case-insensitive), like the table footers; the old summary bar compared categories exactly.
- The cost tab only derives the budget once its own budget lines are known (`budgetKnown && totals.budget.derived`): while they load the list reads `[]`, which would otherwise flash the derived table.
- Derived tables are read-only rows under a caption row (`data-derived`, `data-derived-row`), no toggles/edit/delete; the "+ add" header buttons stay because recording a line is how the user takes the figure back. The spend charts stay on own lines.

## Watch out
- `rollup.total_planned` (raw-category `cost_aggregates_from`) and `by_year` (lower-cased `build_ppm_map`) can differ for a mixed-case category; the tabs use `by_year` for derived figures, the "Beneath this initiative" line still prints `total_*`. Pre-existing, left alone.
- Demo screenshots `41_ppm_overview` / `43_ppm_budget_costs` open "SAP S/4HANA Migration", a leaf project with its own lines, so the derived rendering never shows there; a program (no lines, children with lines) would.
- MUI's default `error.dark` is `#c62828` (an over-budget outlined fill in tests), not `#b71c1c`.
