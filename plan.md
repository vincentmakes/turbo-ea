# PPM Module Redesign Plan

## Summary

Complete redesign of the PPM module based on PPM best practices (Planview, Clarity, Monday.com, Smartsheet patterns). The core principle: **the Gantt chart IS the portfolio overview**, project detail is a first-class routed page with dedicated tabs for Cost, Risks, and Tasks, and the task manager becomes a proper Kanban board.

---

## Architecture Changes Overview

### What Changes
| Area | Current | Redesigned |
|------|---------|------------|
| Portfolio view | Two tabs (KPI dashboard + Gantt) | Single view: compact KPI bar + Gantt chart |
| Gantt grouping | By parent Initiative (hierarchy) | User-selectable: group by any related card type |
| Project access | Inline component inside dashboard | Dedicated route `/ppm/:id` |
| Project tabs | Overview, Status Reports, Tasks | Overview, Reports, Cost, Risks, Tasks |
| Monthly report | Contains cost lines, risks, % complete | Simplified: RAG status + summary + accomplishments + next steps only |
| Cost management | Embedded in status report | Own tab with dedicated `ppm_cost_lines` table |
| Risk management | Embedded in status report as simple text | Own tab with dedicated `ppm_risks` table (probability × impact scoring) |
| Task manager | AG Grid table with filter drawer | Kanban board (default) + list view toggle, built with @dnd-kit |
| Task model | Has start_date | Remove start_date, keep only due_date |

### What Stays
- PpmTask and PpmStatusReport tables (with schema modifications)
- Permission system (ppm.view, ppm.manage)
- Relation to Initiative cards
- Stakeholder assignments
- All existing API endpoint paths (backwards-compatible additions)

---

## Step 1: Database Migration (`050_ppm_redesign.py`)

### New table: `ppm_cost_lines`
```
id              UUID PK
initiative_id   UUID FK → cards.id ON DELETE CASCADE
description     TEXT NOT NULL
category        TEXT NOT NULL  (capex | opex)
planned         FLOAT DEFAULT 0
actual          FLOAT DEFAULT 0
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

### New table: `ppm_risks`
```
id              UUID PK
initiative_id   UUID FK → cards.id ON DELETE CASCADE
title           TEXT NOT NULL
description     TEXT
probability     INTEGER NOT NULL (1-5)
impact          INTEGER NOT NULL (1-5)
risk_score      INTEGER  (computed: probability × impact, stored for sorting)
mitigation      TEXT
owner_id        UUID FK → users.id (nullable)
status          TEXT DEFAULT 'open'  (open | mitigating | mitigated | closed | accepted)
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

### Alter `ppm_status_reports`
- ADD `accomplishments TEXT`
- ADD `next_steps TEXT`
- DROP `percent_complete` column
- DROP `cost_lines` column (JSONB → moved to dedicated table)
- DROP `risks` column (JSONB → moved to dedicated table)

### Alter `ppm_tasks`
- DROP `start_date` column

### Data migration
- For each existing report that has `cost_lines` JSONB data, migrate rows into `ppm_cost_lines` table
- For each existing report that has `risks` JSONB data, migrate rows into `ppm_risks` table
- This is a non-destructive migration: create new tables first, migrate data, then drop columns

---

## Step 2: Backend Models

### New model: `PpmCostLine` (`backend/app/models/ppm_cost_line.py`)
- Fields: id, initiative_id, description, category, planned, actual
- Mixins: UUIDMixin, TimestampMixin

### New model: `PpmRisk` (`backend/app/models/ppm_risk.py`)
- Fields: id, initiative_id, title, description, probability, impact, risk_score, mitigation, owner_id, status
- Mixins: UUIDMixin, TimestampMixin

### Update: `PpmStatusReport` model
- Remove: `percent_complete`, `cost_lines`, `risks`
- Add: `accomplishments`, `next_steps`

### Update: `PpmTask` model
- Remove: `start_date`

### Register in `backend/app/models/__init__.py`

---

## Step 3: Backend Schemas (`backend/app/schemas/ppm.py`)

### Remove
- `CostLine` schema (no longer embedded in reports)

### Update `PpmStatusReportCreate`
- Remove: `percent_complete`, `cost_lines`, `risks`
- Add: `accomplishments: str | None = None`, `next_steps: str | None = None`

### Update `PpmStatusReportUpdate` — same removals/additions

### Update `PpmStatusReportOut` — same removals/additions

### New `PpmCostLineCreate`
- `description: str`, `category: Literal["capex", "opex"]`, `planned: float = 0`, `actual: float = 0`

### New `PpmCostLineUpdate` (all optional)

### New `PpmCostLineOut` (with id, initiative_id, timestamps)

### New `PpmRiskCreate`
- `title: str`, `description: str | None = None`, `probability: int = Field(ge=1, le=5)`, `impact: int = Field(ge=1, le=5)`, `mitigation: str | None = None`, `owner_id: str | None = None`, `status: Literal["open", "mitigating", "mitigated", "closed", "accepted"] = "open"`

### New `PpmRiskUpdate` (all optional)

### New `PpmRiskOut` (with id, risk_score, owner_name, timestamps)

### Update `PpmTaskCreate` / `PpmTaskUpdate` / `PpmTaskOut`
- Remove `start_date`

### Update `PpmGanttItem`
- Add: `organization_id: str | None`, `organization_name: str | None`
- Add: `latest_report_id: str | None` (for quick link to report)
- Remove: `cost_budget`, `cost_actual` (these come from cost lines now, or keep as card attributes for the KPI bar)

---

## Step 4: Backend API Endpoints

### New endpoints in `ppm.py`

**Cost Lines:**
- `GET /ppm/initiatives/{id}/costs` → list cost lines
- `POST /ppm/initiatives/{id}/costs` → create cost line (ppm.manage)
- `PATCH /ppm/costs/{cost_id}` → update cost line
- `DELETE /ppm/costs/{cost_id}` → delete cost line

**Risks:**
- `GET /ppm/initiatives/{id}/risks` → list risks (with owner_name joined)
- `POST /ppm/initiatives/{id}/risks` → create risk (ppm.manage)
- `PATCH /ppm/risks/{risk_id}` → update risk
- `DELETE /ppm/risks/{risk_id}` → delete risk

### Update Gantt endpoint (`ppm_reports.py`)

The `/reports/ppm/gantt` endpoint needs to:
1. Accept a query param `?group_by={relation_type_key}` (e.g. `?group_by=Organization`)
2. For each initiative, look up relations to find which card of the group_by type it's connected to
3. Return `group_id`, `group_name` on each GanttItem
4. Also return available grouping options (relation types where Initiative is source or target)

New endpoint:
- `GET /reports/ppm/group-options` → returns list of card types that Initiative has relations to (for the grouping dropdown)

### Update report CRUD
- Remove cost_lines/risks/percent_complete from create/update handlers
- Add accomplishments/next_steps

### Update task CRUD
- Remove start_date from create/update

---

## Step 5: Frontend Routing

### Update `App.tsx`
```
/ppm            → PpmPortfolio (renamed from PpmDashboard)
/ppm/:id        → PpmProjectDetail (new dedicated route, replaces inline PpmInitiativeDetail)
```

Both as `lazy()` imports.

---

## Step 6: Frontend — Portfolio Page (`PpmPortfolio.tsx`)

Replaces `PpmDashboard.tsx`. Single-page layout:

### Layout
```
┌──────────────────────────────────────────────────────────────┐
│ [icon] Project Portfolio Management                          │
├──────────────────────────────────────────────────────────────┤
│ KPI Bar: | 24 Projects | $12.5M Budget | 8 On Track | 3 At Risk | 2 Off Track │
├──────────────────────────────────────────────────────────────┤
│ [Search] [Group by: ▼ Organization] [Filter Subtype: ▼ All] │
├──────────────────────────────────────────────────────────────┤
│                    GANTT CHART                                │
│ ┌─────────────────────────────────────────────────────────┐  │
│ │ ▼ Organization A (3)                                    │  │
│ │   Project Name  | PM    | ████████▓▓▓ | S C Sc | 📄   │  │
│ │   Project Name  | PM    | ██████████  | S C Sc | 📄   │  │
│ │ ▼ Organization B (2)                                    │  │
│ │   Project Name  | PM    | ████        | S C Sc | 📄   │  │
│ └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Key features
- **Group by dropdown**: Populated from `/reports/ppm/group-options`. Options are card types Initiative has relations to (Organization, Platform, Business Capability, Objective, etc.). Default: Organization.
- **Collapsible groups**: Each group header shows group name + count. Click to collapse.
- **Row columns**: Project Name (clickable → navigates to `/ppm/:id`) | PM | Gantt bar | S/C/Sc RAG dots | Report link icon (📄)
- **RAG dots**: 3 dedicated columns with colored circles. Header shows "S" "C" "Sc" with tooltip explaining Schedule/Cost/Scope. Gray dot if no report.
- **Report link icon**: Small document icon. If latest report exists, clicking it navigates to `/ppm/:id?tab=reports`. Grayed out if no report.
- **Today line**: Red vertical line on the Gantt chart showing current date
- **Quarter labels**: Q1 2026, Q2 2026, etc. in the Gantt header
- **Row click**: Navigate to `/ppm/:id` via React Router

### Removed from current implementation
- Portfolio Overview tab (KPIs + pie charts + status distribution)
- Pie charts
- Status distribution section
- Separate Gantt tab

---

## Step 7: Frontend — Project Detail Page (`PpmProjectDetail.tsx`)

Replaces `PpmInitiativeDetail.tsx`. New routed component at `/ppm/:id`.

### Layout
```
┌──────────────────────────────────────────────────────────────┐
│ ← Back to Portfolio    Project Name    [Program chip]        │
├──────────────────────────────────────────────────────────────┤
│ [Overview] [Reports] [Cost] [Risks] [Tasks]                  │
├──────────────────────────────────────────────────────────────┤
│                    TAB CONTENT                                │
└──────────────────────────────────────────────────────────────┘
```

### Tab 0: Overview
- **Header card**: Project name, subtype, status, date range, description
- **Health summary**: 3 RAG indicators from latest report (or "No reports yet")
- **Key financials summary**: Total budget vs actual (aggregated from cost lines)
- **Stakeholders**: List of assigned stakeholders with roles
- **Related cards**: Shows related Applications, Business Capabilities, etc. (uses existing relations)

### Tab 1: Reports (monthly status reports)
- List of reports in reverse chronological order
- Each report displayed as a **document-style card** (not a form):
  - Date + reporter name
  - 3 RAG dots in a row
  - Summary text
  - Accomplishments text
  - Next steps text
- "Add Report" button opens simplified StatusReportDialog
- Edit/delete actions on each report

### Tab 2: Cost
- **Summary bar**: Total Planned | Total Actual | Variance | CAPEX total | OPEX total
- **MUI Table** with columns: Description | Category | Planned | Actual | Variance
- Inline editing (click cell to edit)
- Add/delete buttons
- Budget health indicator (green/yellow/red based on burn rate)

### Tab 3: Risks
- **Risk summary**: Open risks count by severity (probability × impact)
- **MUI Table** with columns: Title | Probability (1-5) | Impact (1-5) | Score | Status | Owner | Mitigation
- Color-coded score cells (1-5 green, 6-12 yellow, 15-25 red)
- Add/edit/delete via dialog
- Risk status workflow: open → mitigating → mitigated/closed/accepted

### Tab 4: Tasks (Kanban board)
- See Step 8 below

---

## Step 8: Frontend — Task Board (`PpmTaskBoard.tsx`)

Replaces `PpmTaskManager.tsx`. Built with `@dnd-kit` (already in the project).

### Kanban View (default)
```
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ TO DO (5)   │ │ IN PROGRESS │ │ DONE (8)    │ │ BLOCKED (1) │
│             │ │ (3)         │ │             │ │             │
│ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │
│ │▌Task    │ │ │ │▌Task    │ │ │ │▌Task    │ │ │ │▌Task    │ │
│ │ 🧑 Due  │ │ │ │ 🧑 Due  │ │ │ │ 🧑 Due  │ │ │ │ 🧑 Due  │ │
│ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │
│ ┌─────────┐ │ │             │ │             │ │             │
│ │▌Task    │ │ │             │ │             │ │             │
│ │ 🧑 Due  │ │ │             │ │             │ │             │
│ └─────────┘ │ │             │ │             │ │             │
│             │ │             │ │             │ │             │
│ [+ Add]     │ │ [+ Add]     │ │             │ │             │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
```

### Task Card Design
- **Left border**: 3px colored by priority (critical=red, high=orange, medium=yellow, low=green)
- **Title**: Bold text, truncated with ellipsis
- **Bottom row**: Assignee avatar (initials circle) + due date (red text if overdue)
- **Hover**: Subtle elevation, edit icon appears
- **Click**: Opens task edit dialog

### Interactions
- **Drag-and-drop** between columns (updates status via PATCH)
- **Drag-and-drop** within column (reorders via sort_order)
- **Quick add**: "+" button at bottom of each column creates task in that status
- **Click task**: Opens PpmTaskDialog for editing

### List View (toggle)
- Simple MUI Table/List showing: Title | Priority | Assignee | Due Date | Status
- Toggle between Kanban ↔ List via icon buttons in the toolbar
- Same data, different layout

### Implementation with @dnd-kit
- `DndContext` wrapping the board
- One `SortableContext` per column (todo, in_progress, done, blocked)
- Each task card uses `useSortable`
- `DragOverlay` for the floating card during drag
- `onDragEnd` → PATCH `/ppm/tasks/{id}` with new status + sort_order
- `closestCorners` collision detection for cross-column moves
- `PointerSensor` + `KeyboardSensor` for accessibility

### PpmTaskDialog updates
- Remove start_date field
- Add user selector for assignee (dropdown of all users)
- Keep: title, description, priority, due_date, assignee

---

## Step 9: Frontend — StatusReportDialog Simplification

The dialog now only contains:
1. **Report date** (date picker)
2. **RAG status toggles** (Schedule, Cost, Scope — 3 toggle groups)
3. **Summary** (multiline text — executive summary of current status)
4. **Accomplishments** (multiline text — what was achieved this period)
5. **Next steps** (multiline text — what's planned for next period)

Removed: percent_complete slider, cost lines section, risks section.

---

## Step 10: TypeScript Types (`frontend/src/types/index.ts`)

### Update existing
- `PpmStatusReport`: remove `percent_complete`, `cost_lines`, `risks`. Add `accomplishments`, `next_steps`
- `PpmTask`: remove `start_date`
- `PpmGanttItem`: add `group_id`, `group_name`, `latest_report_id`

### New types
- `PpmCostLine`: `{ id, initiative_id, description, category, planned, actual, created_at, updated_at }`
- `PpmRisk`: `{ id, initiative_id, title, description, probability, impact, risk_score, mitigation, owner_id, owner_name, status, created_at, updated_at }`
- `PpmGroupOption`: `{ type_key, type_label }` (for the group-by dropdown)

### Remove
- `PpmCostLine` (the old embedded type in reports)
- `PpmDashboardData` (the dashboard with pie charts is gone)

---

## Step 11: i18n Updates

### New keys needed (all 8 locales)

**ppm namespace** — new/changed keys:
- `portfolio` — "Portfolio"
- `groupBy` — "Group by"
- `noGroup` — "Unassigned"
- `viewReport` — "View latest report"
- `noReportAvailable` — "No report available"
- `accomplishments` — "Accomplishments"
- `nextSteps` — "Next Steps"
- `costManagement` — "Cost Management"
- `riskManagement` — "Risk Management"
- `addCostItem` — "Add Cost Item"
- `addRisk` — "Add Risk"
- `riskTitle` — "Risk Title"
- `probability` — "Probability"
- `impact` — "Impact"
- `riskScore` — "Risk Score"
- `mitigation` — "Mitigation Plan"
- `riskOwner` — "Owner"
- `riskStatus` — "Status"
- `riskStatusOpen` — "Open"
- `riskStatusMitigating` — "Mitigating"
- `riskStatusMitigated` — "Mitigated"
- `riskStatusClosed` — "Closed"
- `riskStatusAccepted` — "Accepted"
- `variance` — "Variance"
- `totalPlanned` — "Total Planned"
- `totalActual` — "Total Actual"
- `kanbanView` — "Board view"
- `listView` — "List view"
- `quickAdd` — "Quick add"
- `overdue` — "Overdue"
- `dueToday` — "Due today"

### Remove unused keys
- `ganttChart` (merged into portfolio)
- `portfolioOverview` (removed)
- `budgetUtilization` (removed from KPIs)
- `byStatus` (pie chart removed)
- `costLineDescription` (cost lines no longer in reports)
- `addCostLine` (renamed to addCostItem)
- `percentComplete` (removed from reports)
- `taskStartDate` (removed)

---

## Step 12: Files to Create/Modify/Delete

### New files
- `backend/alembic/versions/050_ppm_redesign.py` — migration
- `backend/app/models/ppm_cost_line.py` — CostLine model
- `backend/app/models/ppm_risk.py` — Risk model
- `frontend/src/features/ppm/PpmPortfolio.tsx` — new portfolio page
- `frontend/src/features/ppm/PpmProjectDetail.tsx` — new routed project detail
- `frontend/src/features/ppm/PpmTaskBoard.tsx` — Kanban board
- `frontend/src/features/ppm/PpmCostTab.tsx` — cost management tab
- `frontend/src/features/ppm/PpmRiskTab.tsx` — risk management tab
- `frontend/src/features/ppm/PpmReportsTab.tsx` — simplified reports list
- `frontend/src/features/ppm/PpmOverviewTab.tsx` — project overview tab
- `frontend/src/features/ppm/PpmTaskCard.tsx` — Kanban card component

### Modified files
- `backend/app/models/__init__.py` — register new models
- `backend/app/models/ppm_status_report.py` — update columns
- `backend/app/models/ppm_task.py` — remove start_date
- `backend/app/schemas/ppm.py` — update all schemas
- `backend/app/api/v1/ppm.py` — add cost/risk CRUD, update report/task handlers
- `backend/app/api/v1/ppm_reports.py` — update gantt endpoint with grouping
- `frontend/src/types/index.ts` — update PPM types
- `frontend/src/features/ppm/StatusReportDialog.tsx` — simplify
- `frontend/src/features/ppm/PpmTaskDialog.tsx` — remove start_date, add user dropdown
- `frontend/src/App.tsx` — update routes
- `frontend/src/i18n/locales/*/ppm.json` — all 8 locales

### Delete files
- `frontend/src/features/ppm/PpmDashboard.tsx` — replaced by PpmPortfolio
- `frontend/src/features/ppm/PpmInitiativeDetail.tsx` — replaced by PpmProjectDetail
- `frontend/src/features/ppm/PpmTaskManager.tsx` — replaced by PpmTaskBoard
- `frontend/src/features/ppm/PpmGanttChart.tsx` — rebuilt inside PpmPortfolio

---

## Implementation Order

1. **Migration + Models** (backend foundation)
2. **Schemas** (Pydantic updates)
3. **API endpoints** (cost CRUD, risk CRUD, updated report/task/gantt)
4. **TypeScript types** (frontend types)
5. **PpmPortfolio** (portfolio Gantt page with grouping)
6. **PpmProjectDetail + routing** (dedicated route with tabs)
7. **PpmOverviewTab** (project overview)
8. **PpmReportsTab + StatusReportDialog** (simplified reports)
9. **PpmCostTab** (cost management)
10. **PpmRiskTab** (risk register)
11. **PpmTaskBoard + PpmTaskCard** (Kanban with @dnd-kit)
12. **i18n** (all 8 locales)
13. **Cleanup** (delete old files, update imports)
14. **Lint + test**
