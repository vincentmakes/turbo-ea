---
title: "Answering the PR mutation gate on a lifted service (#1305): what killed 140 backend survivors and what a push costs"
author: Claude
date: 2026-10-22
branch: feat/lifecycle-report-filters-1305
cost: { minutes: 40, tokens: 1483435 }
touches:
  - backend/tests/services/test_portfolio_payload.py
  - frontend/src/features/reports/CardFilterSection.test.tsx
  - frontend/src/features/reports/LifecycleReport.filters.test.tsx
  - frontend/src/features/reports/PortfolioReport.test.tsx
  - frontend/src/features/reports/cardFilters.test.ts
  - frontend/src/features/reports/cardFilters.ts
  - frontend/src/features/reports/lifecycleSort.test.ts
  - frontend/src/features/reports/lifecycleSort.ts
  - backend/app/api/v1/reports.py
  - backend/app/services/portfolio_payload.py
---

## Decided
- A function lifted verbatim out of a route (`build_portfolio_payload`) arrives with ~120 survivors even though the route's API tests pass: mutmut scores it by its own tests. Killing them needed exact-shape assertions (full item / relation / relation-type / tag-group dicts, non-empty `attributes`, `translations`, `attributes_schema`), an archived card on every side (primary, related, ancestor, organisation), and a dedicated read-scope role: `CardReadScope` reads any mode that is not `"module"` as inventory, so a role holding only `reports.ea_dashboard` (no `inventory.view`, no View cells) is the one fixture that separates `mode="module"` from the mutated `mode=None` / `"MODULE"`.
- Dangling parent pointers: an unrestricted reader keeps a related member's `parent_id` that points at an archived parent; a restricted reader (any role with a View deny, or no `inventory.view`) has it scrubbed to `None`. Pin both, or the `is_unrestricted` mutants survive.
- Survivors kept as equivalent on `portfolio_payload.py`: `range(10)`→`11`, `continue`→`break` on an ancestor already in `related_map` (unreachable), `parent_id or …` adding `None` to an `IN (NULL)` lookup, `other = ""`, `app_relations.get(aid, [])` on a dict pre-seeded per card, `setdefault(tid, None)` only reachable through an org relation that never lands there.
- Stryker on `LifecycleReport.tsx`: the Sort by menu options, the restored search / folded section, Reset in both reports and re-picking the same type each kill a cluster; what remains is sx literals, `?? []` fallbacks on payload fields the tests always supply, and i18n fallback labels — stop there.

## Tried and ruled out
- Pushing while `Frontend Mutation Tests` was still running: `ci.yml` has `cancel-in-progress: true`, so a push throws away the 65-minute Stryker run. Commit locally, wait for the job, then push once.

## Watch out
- The job log tail does not carry the score; download the `mutation-backend` / `mutation-frontend` artifact (`gh api …/artifacts/{id}/zip`) and count `status` in the JSON record.
- A `Tooltip` with a string title around a `FormControlLabel` overrides the switch's accessible name; `describeChild` keeps the label as the name.
- The local Postgres started with `pg_ctl` under `/var/lib/postgresql/turbo-test` dies with every worker restart; `pg_isready -h localhost` first.
