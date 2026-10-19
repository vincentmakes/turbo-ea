---
title: "PPM budget line description: where cost-line fields live and what already allows several lines per fiscal year"
author: Claude
date: 2026-10-19
branch: feat/ppm-budget-line-description
cost: { minutes: 9, tokens: 238495 }
touches:
  - backend/app/models/ppm_cost_line.py
  - docs/api/openapi.json
  - scripts/dump_openapi.py
---

## Decided
- Budget lines (`PpmBudgetLine`, `backend/app/models/ppm_cost_line.py`, same file as `PpmCostLine`) had no `description` at any layer; cost lines have one everywhere. Adding it is a layer-by-layer copy of the cost-line pattern: model + Alembic 155 (latest was 154; copy the idempotent `_columns()` guard of `148_hierarchy_edge_labels.py`), the three `PpmBudgetLine*` schemas in `schemas/ppm.py`, `_budget_line_out` and the create constructor in `api/v1/ppm.py` (PATCH already applies set fields via a `setattr` loop), `types/index.ts`, and the dialog + table in `features/ppm/PpmCostTab.tsx`.
- The field is optional/nullable: existing rows have none and FY + category already names a line.
- "Several budget lines per fiscal year and category" needs no code: no unique constraint (migration 052), no check in the route or the dialog, and every consumer sums (`budgetTotals` in `costChartData.ts`, `PpmOverviewTab` reduces, `calculation_ppm.py` and `ppm_portfolio_service.py` `GROUP BY … SUM`). The description is what makes a second line distinguishable; pin it with a two-lines-same-pair test rather than adding any dedupe.
- Label and header reuse `common:labels.description` (present in all 10 locales), so no new i18n keys. Render the cell through `LinkifiedText` like the cost table cell.

## Tried and ruled out
- Making description required like the cost line: would force text onto every existing row for no gain.
- Adding a uniqueness guard "for safety": it would remove the behaviour the user asked for.

## Watch out
- `tests/services/test_workspace_io_id_bearing_columns.py` fails on any new Text column until `("PpmBudgetLines", "description"): PROSE` is added beside the PpmCostLines entry; workspace transfer itself picks the column up by introspection.
- `PpmCostTab.test.tsx` asserts exact POST/PATCH bodies with `toEqual` and an exact column-header list, so sending `description` breaks three existing assertions that must be updated, not worked around.
- `docs/api/openapi.json` must be regenerated with `python scripts/dump_openapi.py` or CI fails on drift.
- No seed test pins the demo budget rows, so splitting demo lines on one FY + category is safe as long as each initiative's commented total stays the same.
