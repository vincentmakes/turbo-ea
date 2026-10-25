---
paths:
  - "backend/app/services/card_flags.py"
  - "backend/app/services/lifecycle.py"
  - "backend/app/services/fiscal_year.py"
  - "backend/app/services/eol_service.py"
  - "backend/app/services/calculation_ppm.py"
  - "backend/app/api/v1/reports.py"
  - "backend/app/api/v1/eol.py"
  - "frontend/src/features/reports/Cost*"
  - "frontend/src/features/reports/Eol*"
  - "frontend/src/features/reports/DataQuality*"
  - "frontend/src/features/reports/portfolioHelpers.ts"
  - "frontend/src/lib/eol.ts"
  - "frontend/src/lib/fiscalYear.ts"
---

# Card health flags, EOL coverage and fiscal-year cost rules

> Loaded when you touch `backend/app/services/card_flags.py`, `backend/app/services/lifecycle.py`, `backend/app/services/fiscal_year.py`, `backend/app/services/eol_service.py`, … (full list in the frontmatter). Moved verbatim from `CLAUDE.md`; edit it here.

- **A cross-cutting card health flag has exactly one definition, in `backend/app/services/card_flags.py`.** "Orphaned" and "stale" are each read by three surfaces — an inventory filter (`GET /cards?<flag>=true`), a Data Quality KPI tile with its drill-down panel (`GET /reports/data-quality` + `?scope=`), and a deep link from one to the other (`buildInventoryFlagUrl`) — so if the definitions diverged, clicking a count of 37 would land on a grid showing something else. The same module owns **EOL coverage** (added 2.122.0 for [#1065](https://github.com/vincentmakes/turbo-ea/discussions/1065)): `has_eol_coverage` is an endoflife.date link (`attributes.eol_product` *and* `eol_cycle`) **or** a manual `lifecycle.endOfLife` date — the manual date is the company's own decommission date, which the EOL report has always accepted in its own right, so "not recorded" has to mean neither. Its consumers are the EOL report's `missing` rows and the Data Quality report's coverage chart — which exists in **both forms**, counted in Python for the dashboard totals and queried in SQL by `eol_bucket_condition` for the chart's drill-down panel, so `tests/services/test_eol_coverage.py` runs the two over a matrix of awkward JSONB shapes and pins them equal. Write those SQL negations **positively** (`_jsonb_absent`): `attributes->>'eol_product'` is SQL NULL for an absent key *and* for JSON null, and `NOT NULL` is not TRUE, so `not_(and_(...))` silently drops exactly the cards a "nothing recorded" filter exists to find. `EOL_TYPES` (Application, ITComponent) is the eligible population — EOL is not a metamodel concept, so it cannot be derived from `fields_schema` — mirrored on the frontend by `frontend/src/lib/eol.ts`, which also owns the per-status colours the EOL report and the inventory column share. Resolving a *status* (as opposed to coverage) is an outbound call to endoflife.date, so it lives in `backend/app/services/eol_service.py` behind a 30-minute per-product cache, and `GET /eol/card-status` commits its session before calling it. Guard tests: `backend/tests/services/test_eol_coverage.py`, `tests/api/test_reports_eol.py`, `tests/api/test_reports_extended.py`.

- **The cost reports show the current fiscal year only, and "does this card's cost count" has one definition: `is_live_in_fiscal_year` (`backend/app/services/lifecycle.py`).** An annual cost counts **in full** when the current fiscal year falls between the one the card goes `active` in and the one its `endOfLife` falls in, both ends included — deliberately no pro-rating. Missing dates follow the time-travel reports' `hasStartedByDate` (`features/reports/portfolioHelpers.ts`): a `plan`/`phaseIn` date without `active` is still planned, no start date means always started, no `endOfLife` means never retires — so a card with no lifecycle always counts. `GET /reports/cost-treemap` and `GET /reports/cost` take **no year parameter** on purpose: a card carries one annual figure and real costs change year to year, so the same number shown against another year would mislead (a year picker was built and removed for that reason before 2.150.0 shipped). Both apply the rule to the related cards an aggregate sums as well as the primary cards, and return `fiscal_year` + `fiscal_year_start` so the page can name the year (`CostReport`'s toolbar chip). Fiscal-year arithmetic (`fiscal_year_for`, `current_fiscal_year`, `get_fiscal_year_start`, a year named after the calendar year it **ends** in) lives in the leaf `backend/app/services/fiscal_year.py` (re-exported by `calculation_ppm.py`); the frontend's `fiscalYearLabel` (`frontend/src/lib/fiscalYear.ts`) is the one way a fiscal year is named on screen, PPM's charts included. Guard tests: `tests/services/test_lifecycle.py`, `tests/api/test_reports_cost_fiscal_year.py`, `CostReport.test.tsx`.
