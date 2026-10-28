---
title: "The homepage is three seeded dashboards of widgets, editable by admins; charts are ECharts, the grid is react-grid-layout, Recharts stays elsewhere"
author: Claude
date: 2026-10-28
branch: claude/sleepy-archimedes-su7k6e
cost: { minutes: 63, tokens: 616718 }
id: l-b83ba765
scope: repo
status: active
src: agent
touches:
  - docs/api/openapi.json
  - frontend/src/features/dashboard/OverviewTab.tsx
  - frontend/src/features/dashboard/Dashboard.tsx
  - frontend/src/features/dashboard/TrendIndicator.tsx
  - backend/app/services/kpi_snapshot_service.py
  - backend/app/api/v1/reports.py
  - frontend/src/hooks/useChartTheme.ts
  - backend/app/models/saved_report.py
---

## Decided
- All three homepage tabs (Overview, My Workspace, Admin) became seeded, restorable dashboards made of widgets, not only Overview: the user wanted every existing section to be a widget an admin can remove and bring back.
- A generic, admin-configured Chart / KPI widget backed by one read-scope-aware aggregation endpoint (keys only, never labels or card ids), rather than only porting the four fixed charts. KPI tiles built this way get daily trend snapshots keyed by the canonical query string, captured on save so a new tile has a baseline at once; trends stay landscape-wide and are shown to unrestricted readers only, like the four built-in KPIs.
- Dashboards are managed from a kebab menu on the homepage itself (new, duplicate, settings with access by role, hide, reorder, reset to default, delete); the user preferred that over an admin page.
- Apache ECharts (own 60-line wrapper over `echarts/core`, no `echarts-for-react`) draws dashboard charts; react-grid-layout 2.x is the grid. Recharts stays for the other reports and the extension SDK; migrating them is a separate follow-up.
- Dashboards are a workspace-transfer config section keyed by `key`; widget configs may never hold a card, relation or tag id (422 `config_holds_an_id`), which is what makes the column transfer verbatim.
- Counts without a lifecycle filter run as one SQL GROUP BY; sums, averages, lifecycle buckets and sankey read one row per card. Both paths feed the same aggregate, pinned equal by a parity test.
- Managers (`admin.dashboards`) see every dashboard, hidden or restricted, so a new empty one can be reached and edited.

## Tried and ruled out
- Allowlisting the new JSONB columns in the workspace id-bearing guard: that guard scans entity sections only; a stale allowlist entry fails it. A config section needs no entry.
- Reusing the existing startup baseline capture for the new snapshot table: it returns early whenever the old table has a row, i.e. on every upgraded install.
- Keeping the built-in dashboard names next to their layouts: the translate pass and the seed i18n test only read `seed.py`, so the names live there and the layouts elsewhere.

## Watch out
- A translated doc sibling must reference its own locale's screenshot filename from `pages.ts`; the translator pointed every sibling at the English PNG.
- The Vite production build runs out of memory in a cloud session with default Node heap; lint, tsc and targeted Vitest runs are the local checks, the build and full suites are CI's.
- `trail check` flags the regenerated `docs/api/openapi.json` against an unrelated "chart order" learning; it is a false positive.

In the code:
- Backend: `backend/app/api/v1/dashboards.py`, `services/dashboard_{defaults,service,query,kpi_service}.py`, migration `159_dashboards.py`, `DASHBOARD_NAMES` in `seed.py`, `SHEET_DASHBOARDS` in `workspace_io/schema.py`.
- Frontend: `frontend/src/features/dashboard/` (`Dashboard.tsx`, `DashboardGrid.tsx`, `DashboardSources.tsx`, `charts/`, `widgets/`, `customize/`); parity test `widgets/registry.test.ts`.
- Rule file: `.claude/rules/dashboards.md`. Plan: `/root/.claude/plans/the-current-dashboards-on-twinkling-pillow.md`.
