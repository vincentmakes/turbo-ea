---
paths:
  - "backend/app/services/dashboard_defaults.py"
  - "backend/app/services/dashboard_service.py"
  - "backend/app/services/dashboard_query.py"
  - "backend/app/services/dashboard_kpi_service.py"
  - "backend/app/api/v1/dashboards.py"
  - "backend/app/models/dashboard.py"
  - "backend/app/schemas/dashboard.py"
  - "frontend/src/features/dashboard/**"
---

# Homepage dashboards

> Loaded when you touch the dashboard services, `api/v1/dashboards.py`, the `Dashboard` model or schemas, or `frontend/src/features/dashboard/**` (full list in the frontmatter).

The homepage `/` is a set of admin-editable **dashboards** (table `dashboards`, migration `160_dashboards.py`), each a list of widgets on a 12-column react-grid-layout grid; charts are Apache ECharts (`frontend/src/components/charts/EChart.tsx`, the app-wide wrapper, with the shared chrome in `components/charts/chrome.ts`; the widget builders are `charts/buildOption.ts`). Three built-ins — `overview`, `workspace`, `admin` — reproduce the former static tabs. Managing them needs `admin.dashboards`; every write records one Security & admin row (`admin.dashboard.created/updated/deleted/duplicated/reset`, items `dashboard_widget.added/removed`). Dashboards travel in a workspace transfer (sheet `Dashboards`); `dashboard_kpi_snapshots` is instance-local and does not.

## Invariants

### 1. Widget types are one frozen set, in two places

`WIDGET_TYPES` in `backend/app/services/dashboard_defaults.py` is the closed set the API accepts — and so are `CHART_KINDS` and `SOURCE_SERIES` (the module report series a `source` widget may draw: `risks_metrics`, `compliance_overview`, `ppm_dashboard`, `bpm_dashboard`), mirrored by `widgets/sourceSeries.ts` and pinned by the same source scan; `WIDGET_META` in `frontend/src/features/dashboard/widgets/widgetMeta.ts` (re-exported by `widgets/registry.ts`) mirrors it, with the component, family, permission and sources of each type. **A new widget type is a change to both files in the same PR**, plus its component in `registry.ts`'s `componentFor` and an English label. The source scan in `widgets/registry.test.ts` ("knows exactly the widget types the backend accepts, both ways") reads `dashboard_defaults.py` as text and fails a type that exists on one side only. Keep the same discipline for `KPI_PRESETS` (mirrored by `widgets/kpiPresets.ts`) and `CHART_KINDS` (the chart builders in `charts/buildOption.ts`), which the scan does not pin.

Why: a type the backend accepts but the frontend does not know renders as "Unknown widget" for everyone; a type the frontend offers but the backend refuses makes **Save** fail with 422.

### 2. No card, relation or tag id in a widget config

A widget config names the landscape only by **keys** — card-type keys, field keys, status and phase values, relation-type keys. `dashboard_service.widget_config_problem` rejects any UUID anywhere in a config with 422 `config_holds_an_id` (`contains_uuid` walks keys and values).

A **response** may carry card ids: the `related:<rt>` dimension and a sankey end grouped by `card` return card ids as row keys with a `labels` map, every one of them resolved through the caller's `CardReadScope` (a hidden related card leaves the card under `none` and out of `labels`), and folded server-side to `top` keys. The rule is about what is *stored*.

Why: an id would leak a card to a dashboard reader who may not read it (the `CardReadScope` rule: a card the caller may not read does not exist for them), and it would not survive a workspace transfer to another instance, where every id is different. Keys are the same everywhere. Do not add a "pin this card" widget that stores an id; resolve such a thing at read time through the caller's scope instead.

### 3. Trends are landscape-wide and shown to unrestricted readers only

KPI snapshots (`dashboard_kpi_snapshots`, and the presets' `kpi_snapshots`) are computed through an unrestricted read scope, daily at 02:00 UTC (`main.py`), once at startup when the table is empty, and on every save of a dashboard that carries a KPI query (`capture_for_queries` — a new tile gets its baseline at once). `kpi_with_trend` and `kpi_history` return a trend / points only when the caller's `CardReadScope` is unrestricted. A restricted reader gets their own scoped value and **no** trend: their count compared with the whole landscape's would be a "trend" made of the cards they cannot see. The caption reads the real `comparison_days` — never hard-code 30.

The data endpoints (`/dashboards/query`, `/kpi`, `/kpi-history`) require `reports.ea_dashboard`, apply `CardReadScope` to every row, and a sum or average of a **cost** field additionally requires `costs.view` and counts only the cards `is_live_in_fiscal_year` keeps (the Cost report's one definition), naming the year in `fiscal_year` / `fiscal_year_start`. Flags (`orphaned`, `stale`, `with_/without_stakeholders`, `eol_*`, `related:/unrelated:<rt>`) are the `card_flags.py` conditions, never re-derived, and every one is SQL so a flagged count keeps the `GROUP BY` fast path. A module `source` widget reads an existing report endpoint under that report's own permission and module flag; `/compliance/overview` is not read-scoped (it counts findings) — pre-existing, noted here, not widened.

### 4. `/` stays ungated; a tab is gated by its widgets

`/` is in `INTENTIONALLY_UNGATED` (`frontend/src/lib/routePermissions.ts`) — every signed-in user lands there. Each widget carries its own permission (`reports.ea_dashboard` for the overview family and generic KPI/chart, `admin.users` for the admin family, none for the workspace family); `visibleWidgets` drops what the viewer lacks and a tab with no visible widget is not shown. That is how the old Overview / Admin gating is reproduced — do not add a route permission for `/`. The Admin built-in additionally **states** its access: `DEFAULT_DASHBOARDS["admin"]["access_permission"]` seeds its `allowed_roles` with every active role holding `admin.users` (`roles_holding`), the admin role on a fresh install, so the Settings dialog shows who sees it instead of "everyone" (a user correction). A wildcard role is accepted in `allowed_roles` for that reason; it sees every dashboard whether listed or not. **Reset to default** restores that seeded access as well as the widgets (`seeded_access`, for a spec with an `access_permission`; a built-in stating none keeps whatever access it has), and its log row names the roles by label like an edit does. Access alone never widens what a role sees — the dialog names the widgets' permissions under the field.

Dashboard-level access (`allowed_roles`) is separate: empty = everyone; a wildcard role and any holder of `admin.dashboards` see every dashboard, hidden or not. `allowed_roles` is access-control config and is returned to managers only (`dashboard_payload`, the `_user_response_lite` precedent). Impersonation decides the role (`effective_role_key`).

### 5. Edits to the shipped defaults never reach existing installs

Seeding (`seed_dashboards`) is **insert-only** and keyed by `key`: an admin's layout is never overwritten on upgrade. A change to `DEFAULT_DASHBOARDS` therefore reaches existing installs only through **Reset to default** (`POST /dashboards/{id}/reset`, built-ins only). Do not write a migration that rewrites `dashboards.widgets`. A shipped **default that must reach existing rows** — access, not layout, such as the Admin dashboard's `allowed_roles` (migration `161_admin_dashboard_access.py`) — goes through a guarded data migration that rewrites only rows still carrying the pre-change value (`[]` there), the `072` / `158` pattern; `dashboards.widgets` is still never rewritten by a migration. Built-in dashboard names live in `DASHBOARD_NAMES` in `seed.py` (where `/translate` and `test_i18n_seed.py` look), not in `dashboard_defaults.py`.

## Traps

- **Widget ids are stable identities.** The audit diff (`widget_items`) reports added / removed by widget id; a moved or resized widget is the same widget. Duplicate assigns new widget ids (`copied_widget_id`); keep ids unique per dashboard (`duplicate_widget_id`).
- **One fetch per source per dashboard.** Widgets read the shared report payloads through `useDashboardSource(name)` (`DashboardSources.tsx`); never a bare `api.get` in a widget's `useEffect`.
- **Colours come from `theme/tokens.ts`** (`CHART_CATEGORICAL`, status colours for status dimensions) through `useEChartsTheme`; ECharts does not inherit `dir`, so RTL is handled in `components/charts/echartsTheme.ts` and `chrome.ts`, and react-grid-layout has no RTL prop, so the grid mirrors item `x` itself (the `useIsRtl` rule).
- **`flags` is canonical on both sides** (split, trim, dedupe, sort, join) — a `field_validator` on `DashboardQuery` and `normalizeFlags` in `dashboardQuery.ts` — or two widgets with the same filters would store two snapshot keys. `top` is a query parameter of `/query` only, never a query field, so it never enters a key.
- **`metricKey` must stay byte-identical on both sides** (`metricKey` in `dashboardQuery.ts` ↔ `dashboard_query.metric_key`): it is the key a KPI snapshot is stored and looked up by.

## Guard tests

- `backend/tests/api/test_dashboards.py` — CRUD, visibility (role-restricted, hidden, impersonation), 422 on invalid widgets, duplicate / reset, cost metric needs `costs.view`, trend only for unrestricted readers.
- `backend/tests/services/test_dashboard_defaults.py`, `test_dashboard_service.py`, `test_dashboard_query.py`, `test_dashboard_kpi_service.py` — the vocabulary, layouts that fit the grid, insert-only seeding, `contains_uuid`, `can_see`, audit items, landscape-wide capture.
- `frontend/src/features/dashboard/widgets/registry.test.ts` — backend ↔ frontend widget-type parity (source scan) and per-family permissions.
