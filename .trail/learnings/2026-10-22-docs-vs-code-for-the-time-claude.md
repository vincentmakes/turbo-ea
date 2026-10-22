---
title: "Docs vs code for the TIME / Application Portfolio story (#1310)"
author: Claude
date: 2026-10-22
branch: claude/nice-babbage-j8jexc
cost: { minutes: 33, tokens: 459573 }
touches:
  - docs/admin/calculations.md
  - docs/beginners-guide/customise-the-metamodel.md
  - docs/guide/reports.md
  - docs/guide/saved-reports.md
  - docs/reference/glossary.md
  - CHANGELOG.md
  - VERSION
  - backend/app/services/calculation_engine.py
  - backend/tests/services/test_calculation_example_formulas.py
  - frontend/src/features/admin/CalculationsAdmin.page.test.tsx
---

## Decided
- The Portfolio "bubble chart" (X/Y/size axes, named views) never shipped. The real `/reports/portfolio` page is grouped boxes: **Group by** (single-select/yes-no field or related type) + **Color apps by** (select/multi/yes-no field, no lifecycle option) + Search, filters, Chart/Table view. The maintainer's recommended analysis: TIME Model as a calculated field from Functional x Technical Suitability, Application Portfolio grouped by Business Criticality and coloured by TIME Model.
- The canonical TIME formula reads the built-in `functionalSuitability` (perfect/appropriate/insufficient/unreasonable) and `technicalSuitability` (fullyAppropriate/adequate/unreasonable/inappropriate), with a 1-4 score and a 2.5 threshold. The Formula Reference example in `CalculationsAdmin.tsx`, `docs/admin/calculations*.md` and the beginner's guide all carry the same block; `backend/tests/services/test_calculation_example_formulas.py` reads it off the TSX and checks fields, option keys and quadrants against `seed.TYPES` + `_evaluate_formula`.
- Docs-only changes take no version bump. The example fix (product UI) shipped as 2.176.1.

## Tried and ruled out
- A formula fallback to the current value (`data.timeModel`) when a rating is missing: `detect_cycles` refuses a calculation that reads its own target. A missing rating yields `None`, which clears the field, so the gaps stay visible.
- Trusting an Explore agent's "Owner" stakeholder role: line 687 of seed.py is `USAGE_TYPE_OPTIONS` (relation attribute). The default stakeholder roles are `responsible` "Responsible" and `observer`. Application adds Business/Technical Application Owner.

## Watch out
- Business Criticality and TIME Model are **required** on Application, and an empty required field pins data quality to 0% (`data_quality.py` gate; a calculation does NOT mark its target readonly). Any guide promising a first-pass DQ% on stock Application is wrong.
- Activating a calculation does not run it; "Recalculate all" on its row does.
- Excel import matches rows by the `id` column only (not by name). The Capability Catalogue sits in the user menu → Reference Catalogues, and ticking a child does not tick its parent.
- Still open: `GET /reports/portfolio` (reports.py:939) still serves bubble data with `x_axis`/`y_axis` defaulting to nonexistent `functionalFit`/`technicalFit`, and the MCP tool `get_portfolio_report` and `docs/admin/mcp.md` describe it as bubble-chart data. The UI does not use it.
- Web session frontend deps: `npm ci` (npm 10) rejects the lockfile; `npx -y npm@11 ci` works (CI is Node 24).
