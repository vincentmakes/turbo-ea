---
title: "Grouping the PPM Budget & Costs tables by fiscal year: what the design settled and what the mutation gate taught"
author: Claude
date: 2026-10-19
branch: feat/ppm-budget-table-grouping
cost: { minutes: 85, tokens: 459528 }
touches:
  - CHANGELOG.md
  - docs/guide/ppm.ar.md
  - docs/guide/ppm.da.md
  - docs/guide/ppm.de.md
  - docs/guide/ppm.es.md
  - docs/guide/ppm.fr.md
  - docs/guide/ppm.it.md
  - docs/guide/ppm.md
  - docs/guide/ppm.pt.md
  - docs/guide/ppm.ru.md
---

## Decided
- Both tables on `PpmCostTab.tsx` group lines by fiscal year with a header row per year (toggle with `aria-expanded`, `fiscalYearLabel`, line count, CapEx / OpEx / Total subtotals), the Amount column is split into CapEx and OpEx columns plus Total, and a plain `TableFooter` row carries the grand totals. Pure helpers live in `features/ppm/costTableGroups.ts` and reuse `bucketFor` / `fiscalYearFor` from `costChartData.ts`; `currentFiscalYear` was lifted into `costChartData.ts` so the charts and the tab share one definition.
- Only the current fiscal year is open on load (user-confirmed). The expanded set stays `null` until the first toggle and the default is derived from the data (`defaultExpandedKey`: current year, else the latest year, else Undated), because `costLines` arrives as `[]` while loading and "initialise once the lines arrive" cannot tell loading from empty.
- A save opens the year the line lands in (`useExpandedGroups().open(key)`): without it, the "+" on a collapsed year ends with the new line hidden, which the review caught and no test had.
- A line whose category is neither capex nor opex shows its amount in the Total cell only, matching `budgetTotals`.
- The `toggleYear` aria label is a colon form ("Show or hide the lines: {{year}}") because it interpolates any group label, Undated included, and the prepositional forms broke in ru/fr/es/de.

## Tried and ruled out
- A sticky footer: the `TableContainer` scrolls sideways but has no max height, so `position: sticky; bottom: 0` does nothing. Plain footer row.
- `{/* Stryker disable next-line ... */}` JSX comments: Stryker does not read that form (both mutants survived under it on PR #1275). Hoist the literal to a module constant with the `//` line form instead, as `LOADING_CELL_SX` does.
- Sorting the Undated cost group by date: a junk date string sorted after an empty one; Undated keeps input order, dated groups sort by date.

## Watch out
- `PpmCostTab.test.tsx` must mock `GET /settings/fiscal-year-start` and call `resetFiscalYearStart()` in `beforeEach` (copy `PpmCostCharts.test.tsx`), and pins `Date` to 2026-06-15 with `vi.useFakeTimers({ toFake: ["Date"] })` so the default-open year does not drift with the clock.
- Cost lines are props and render at once; budget lines are fetched. A test that reads the budget table before its GET resolves is a race: wait on the budget table's year header first.
- "FY 2026" now appears in both tables; scope lookups with `within()` on the `data-testid` of each `TableContainer`.
- A `useMemo` over a prop (`groupCostLines(costLines, …)`) only carries a mutation score if some test rerenders with a new prop value; a first-render-only test leaves the deps array mutant alive.
