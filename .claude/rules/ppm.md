---
paths:
  - "frontend/src/features/ppm/**"
  - "backend/app/services/ppm_*.py"
  - "backend/app/services/seed_demo_ppm.py"
  - "backend/app/api/v1/ppm*.py"
---

# Project Portfolio Management

> Loaded when you touch `frontend/src/features/ppm/**`, `backend/app/services/ppm_*.py`, `backend/app/services/seed_demo_ppm.py`, `backend/app/api/v1/ppm*.py` (full list in the frontmatter). Moved verbatim from `CLAUDE.md`; edit it here.

## PPM (Project Portfolio Management)

Optional module (toggled via admin settings) for managing Initiative cards as full projects.

### Architecture
- **Scoped to Initiative cards** — All PPM data (reports, WBS, tasks, budgets, costs, risks) is linked to Initiative cards via `initiative_id` FK
- **Feature flag**: `usePpmEnabled()` hook (module-level singleton cache, fetches `GET /settings/ppm-enabled`)
- **Cost sync**: Creating/updating/deleting budget or cost lines auto-syncs the Initiative card's `costBudget` and `costActual` attributes and recalculates data quality
- **WBS rollup**: Task status changes trigger bottom-up completion recalculation through the WBS hierarchy
- **Task-Todo sync**: Assigning a PPM task auto-creates a system Todo (`is_system=true`); clearing assignee deletes it
- **Notifications**: Task assignment sends a `task_assigned` notification
- **Permissions**: `ppm.view` (read) and `ppm.manage` (write), granted to admin, bpm_admin, and member roles
- **A row points only at a work package of its own initiative**: `wbs_of_initiative(db, initiative_id, wbs_id, detail=…)` (`services/ppm_gantt_move.py`; `parse_uuid` first, so a malformed id is 400, never a DB 500) is the one check behind a task's `wbs_id` (`create_task`; `update_task` only when the package changes, so the dialog re-sending the current one passes), a work package's `parent_id` (`create_wbs` / `update_wbs`) and a Gantt drop (`_check_new_parent`) — another initiative's package is 400 (#1457; the routes accepted it until 2.221.0). An unknown `assignee_id` (task, WBS) / risk `owner_id` is 400 through `_require_user` (`api/v1/ppm.py`), not an FK 500. Guards: `TestTaskWorkPackageScope`, `TestUnknownPersonReferences` (`tests/api/test_ppm.py`), `TestWbsOfInitiative` / `TestParseUuid` (`tests/services/test_ppm_gantt_move.py`).
- **Rollback declines PPM-derived card events**: `_plan_card_updated` (`services/rollback_service.py`) returns `_unsupported` for a `card.updated` whose `source` is in `_DERIVED_CARD_UPDATE_SOURCES` (`ppm_rollup` / `ppm_cost_rollup`, published by `_publish_initiative_rollup`). PPM rows publish no event a rollback could reverse, so restoring the Initiative's rolled-up attributes would leave them out of step with the rows they are calculated from. A new roll-up source joins that set. Guards: `test_card_updated_by_a_ppm_rollup_is_declined` / `test_the_derived_card_update_sources` (`tests/services/test_rollback_planning.py`), `TestPpmRollupRollback` (`tests/services/test_rollback_service.py`).
- **MCP** (→ `.claude/rules/mcp-server.md`): `get_ppm_plan`, `list_ppm_status_reports`, `list_ppm_risks`, `get_ppm_task_comments`, `save_ppm_work_packages`, `save_ppm_tasks`, `save_ppm_status_reports`, `save_ppm_risks`, `add_ppm_task_comment`, `set_ppm_dependencies` call these routes with the user's token. The routes do not check the module switch, so every tool asks `GET /settings/ppm-enabled` first (`ppm_disabled`). The only delete exposed is a dependency link; work packages, tasks, reports, risks and budget/cost lines stay web-only. A route-shape or schema-literal change here must be mirrored in `mcp-server/turbo_ea_mcp/ppm.py`.
- **Board filters**: `GET /reports/ppm/filter-data` returns the same initiatives as `/gantt` (both: ACTIVE + `read_scope.where(Card, mode="module")`, neither reads the type's `is_hidden`) through `build_portfolio_payload` + `redact_portfolio_costs`, projected by `ppm_portfolio_service.card_filter_payload`. The board fetches it only when the Filters section is first opened (or opens unfolded, as remembered) or the URL carries `?filters=`; matching is client-side with the reports' `matchesStaticFilters`, the matching id set narrows inside `filterItems` so group anchors survive, and the KPI tiles follow what the board shows (`shownDashboard`). **The link is the board's state; the browser remembers the last state** (`ppmBoardPrefs.ts`, key `turboea.ppm.portfolio.prefs`: the board's own link parameters plus the Filters fold). The container restores the remembered parameters only onto a link that carries no board parameter, and mounts the board only once the observed link shows them (the view and container read their opening state from the link); what is remembered comes from the view's state via `onBoardStateChange`, never read back from the link; Reset clears the memory, strips the board parameters and remounts the board. The public portal board remembers nothing.

### Frontend Components
- **`PpmPortfolio.tsx`** — Portfolio dashboard with Gantt visualization, KPI cards, grouping by related card type
- **`PpmProjectDetail.tsx`** — Tabbed initiative detail (overview, reports, cost, risks, tasks, gantt, details)
- **`PpmTaskBoard.tsx`** — Kanban board with @dnd-kit drag-drop (todo/in_progress/done/blocked columns)
- **`PpmRiskTab.tsx`** — Risk matrix visualization (probability x impact grid) and risk cards
- **`PpmCostTab.tsx`** — Budget lines (planned by fiscal year) and cost lines (actuals)
- **`PpmGanttTab.tsx`** — Timeline view of WBS items with milestones and completion bars

### Demo Data
`seed_demo_ppm.py` populates PPM data for 6 Initiative cards when `SEED_DEMO=true` or `SEED_PPM=true`. Includes status reports, WBS hierarchies, tasks, budget/cost lines, and risks with varied project health stories.
