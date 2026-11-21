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
