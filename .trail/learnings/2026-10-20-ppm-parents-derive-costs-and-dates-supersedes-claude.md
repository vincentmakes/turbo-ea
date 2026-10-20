---
title: "PPM parents derive costs and dates from the initiatives beneath them (supersedes \"roll-ups stay out of the portfolio\")"
author: Claude
date: 2026-10-20
branch: feat/ppm-portfolio-rollup
touches:
  - backend/app/services/ppm_rollup.py
  - backend/app/services/ppm_portfolio_service.py
  - backend/app/api/v1/ppm.py
  - backend/app/schemas/ppm.py
  - backend/app/schemas/ppm_public.py
  - frontend/src/features/ppm/ppmPortfolioModel.ts
  - frontend/src/features/ppm/PpmPortfolioView.tsx
  - frontend/src/features/ppm/PpmOverviewTab.tsx
  - docs/guide/ppm.md
  - docs/admin/calculations.md
---

## Decided
- **This supersedes the "Roll-ups stay out of the portfolio" decision** in `2026-10-20-ppm-portfolio-hierarchy-and-subtype-sub-claude.md`. The calculated-field recipe it pointed at never reached the PPM surfaces (the board, its KPI bar and the Overview tab sum `ppm_budget_lines` / `ppm_cost_lines`, never card attributes), so the board now derives on its own. The recipe stays documented for the Inventory, reports and card portals.
- Rule: **own data if any, else the descendants'**, decided separately for costs and for dates. Costs derive when the parent has no budget or cost line at all (`id not in build_cost_aggregates(...)`: a zero-amount line counts as data) *and* some initiative beneath has lines; dates derive when the parent has neither `startDate` nor `endDate` (min start / max end beneath, ISO strings compare as dates). A parent with lines of its own never adds its children's: a program's own lines usually already cover its projects.
- Computed on read, in memory, in the pure `services/ppm_rollup.py`, over the rows `build_gantt_items` already loaded — so the read scope, archived status and a portal's filters all apply for free (a chain broken by a missing initiative stops there, like `parent_id`), and `TestQueryCount` on the portal is untouched. Travels as a separate `rollup` field (`PpmRollup` / `PpmPublicRollup`, no ids; the public cost quartet follows `show_costs`, dates and count are published). The row's own `capex_*` / `start_date` stay as recorded.
- `groupTotals` and the KPI bar keep summing **own** lines only — a parent's derived figures are its children's lines, which are board rows too.
- Frontend reads everything through `rowFigures(item)` (`ppmPortfolioModel.ts`): `barModel`, `hasAnyCost`, the export (with **Costs from** / **Dates from** columns) and the view. Derived = outlined cost bars + italic label + tooltip, dashed Gantt bar + italic quarters + tooltip; `data-derived="costs" | "dates"` marks them for tests.
- The Overview tab's "Beneath this initiative" line comes from `GET /ppm/initiatives/{id}/rollup` (`build_initiative_rollup`: `collect_descendants`, then one query narrowed to ACTIVE Initiatives in the module-mode read scope). It always sums the descendants alone, beside the parent's own figures. Nothing is ever stored: a stored roll-up goes stale on a child edit, re-parent, archive or restore.

## Watch out
- MUI `Tooltip` with a string title sets `aria-label` on its child: tests find derived bars and quarters with `getByLabelText`.
- Styles are emotion classes: read positions with `getComputedStyle(el).left`, not `el.style.left`; a transparent background computes to `rgba(0, 0, 0, 0)` in jsdom.
- `:scope > div > div` did not resolve as expected in jsdom; walk `firstElementChild` instead.
- The demo's programs carry their own dates but no PPM lines, so on the demo only their cost bars are derived (screenshot `101_ppm_portfolio_hierarchy`).
