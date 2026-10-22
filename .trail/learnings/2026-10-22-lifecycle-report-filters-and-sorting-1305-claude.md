---
title: "Lifecycle report filters and sorting (#1305): one shared filter section, sub-card roll-up, one sort for chart and table"
author: Claude
date: 2026-10-22
branch: feat/lifecycle-report-filters-1305
cost: { minutes: 67, tokens: 629794 }
touches:
  - CHANGELOG.md
  - VERSION
  - backend/app/api/v1/reports.py
  - backend/app/services/portfolio_payload.py
  - backend/tests/api/test_reports_extended.py
  - backend/tests/services/test_portfolio_payload.py
  - docs/api/openapi.json
  - docs/guide/reports.ar.md
  - docs/guide/reports.da.md
  - docs/guide/reports.de.md
---

## Decided
- The Portfolio / Flexible Portfolio filter rows were inline in `PortfolioReport.tsx`; they are now `CardFilterSection.tsx` (render only) + `cardFilters.ts` (pure: options, sub-card expansion, counts, export summary, saved-config restore). Lifecycle and both portfolios render it, so the filters cannot drift. Capability Map still keeps its own older copy.
- `GET /reports/roadmap?type=X` returns the same filter payload as `/reports/app-portfolio` (relations per side, tag_ids, relation_types, groupable_types with ancestor closure, tag_groups) through `services/portfolio_payload.py`. No type, or an unknown/hidden type, keeps the plain rows and never 404s, so old saved reports open.
- *Include sub-cards* widens a related-card pick with `expandRelationFilters` (uses `expandScopeIds` over `groupable_types` parent_ids) before `matchesStaticFilters`; the matcher is unchanged. With it on, `ancestor_only` members become pickable, and Portfolio's "View in inventory" link is hidden (the inventory cannot express a subtree).
- Lifecycle sort lives in `lifecycleSort.ts`: one order drives the chart rows and the table, missing values last in both directions, ties by name, select fields by option order (`attr:<key>`), legacy saved `eol` maps to `endOfLife`, an unknown key falls back to name without being written back. The default sort (name asc) is not listed in the export header.

## Tried and ruled out
- Leaving the chart in payload order: the discussion asked for a review order, and payload order is the database's.

## Watch out
- Lifecycle's existing tests expected payload order on the chart and "missing first on descending"; they were updated deliberately, not to make them pass.
- A Tooltip with a string title around a FormControlLabel overrides the switch's accessible name; use `describeChild`.
- `trail check` flags only word-level matches with unrelated learnings on this change.
