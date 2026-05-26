# Turbo EA — End-to-End Tests

Playwright E2E tests for the full Turbo EA application.

## Prerequisites

- Node.js 20+
- A running Turbo EA instance (local or Docker)
- Demo data seeded: `SEED_DEMO=true SEED_BPM=true SEED_PPM=true`

## Setup

```bash
cd e2e
npm install
npm run install-browsers   # downloads Chromium
```

## Running

```bash
# Against local dev stack (default: http://localhost:8920)
npm test

# Against a specific instance
E2E_BASE_URL=http://localhost:8920 npm test

# With custom admin credentials
E2E_ADMIN_EMAIL=admin@example.com E2E_ADMIN_PASSWORD=secret npm test

# Single spec
npx playwright test tests/auth.spec.ts

# With browser UI (useful for debugging)
npm run test:ui
```

## Test Suites

| File | Feature Area | Key Scenarios |
|------|-------------|---------------|
| `tests/auth.spec.ts` | Authentication | Login form, validation, bad credentials, successful login, logout, session clear |
| `tests/dashboard.spec.ts` | Dashboard | KPI tiles, nav links, workspace tab, notification bell, create button |
| `tests/inventory.spec.ts` | Inventory | Grid rows, search filter, type filter, column toggle, card navigation, export, create dialog, bookmark |
| `tests/card-details.spec.ts` | Card Detail | Header, type badge, approval status, data quality, description, lifecycle, relations, all tabs (Comments, Todos, Stakeholders, History, Resources), inline name edit |
| `tests/reports.spec.ts` | Reports | Portfolio, Capability Map, Lifecycle, Dependencies, Cost, Matrix, Data Quality, EOL, Saved Reports |
| `tests/diagrams.spec.ts` | Diagrams | Gallery, create diagram, DrawIO editor iframe, sync button |
| `tests/bpm.spec.ts` | BPM | Dashboard KPIs, process navigator, filter controls, process card link, reports tab |
| `tests/ppm.spec.ts` | PPM | Portfolio dashboard, Gantt, initiative detail (Overview, Status Reports, Budget, Risk, Tasks, Gantt tabs) |
| `tests/grc.spec.ts` | GRC | Governance (ADR grid, new ADR dialog), Risk Register (matrix, new risk dialog, create/delete), Compliance (heatmap, scan button, new finding) |
| `tests/todos.spec.ts` | Todos & Surveys | Todo list, status filter, new todo dialog, create/toggle, Surveys tab |
| `tests/admin.spec.ts` | Admin | Metamodel (type list, edit action), Users (list, invite), Settings (tabs: General, AI, BPM, PPM, ArchiMate), Surveys admin |
| `tests/catalogues.spec.ts` | Catalogues | Capability (L1 grid, search, level chips, select + create button), Principles, Process, Value Stream |
| `tests/archimate/feature-flag.spec.ts` | ArchiMate | Nav show/hide when enabled/disabled, ModuleGate, admin tab |
| `tests/archimate/diagram-editor.spec.ts` | ArchiMate Editor | Gallery, create dialog, palette layers, toolbar, back navigation |
| `tests/archimate/demo-data.spec.ts` | ArchiMate Data | arch_* card types, relation types, AMEFF export |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `E2E_BASE_URL` | `http://localhost:8920` | Base URL of the running app |
| `E2E_ADMIN_EMAIL` | `admin@turboea.demo` | Admin user email (matches demo seed) |
| `E2E_ADMIN_PASSWORD` | `TurboEA!2025` | Admin user password |

## Notes

- Tests are **resilient**: where features depend on module flags (BPM, PPM, ArchiMate), tests skip gracefully when the module is disabled or demo data is absent.
- API calls use `context.request` to bypass UI where setup/teardown data is needed.
- Each test cleans up cards/risks/diagrams it creates via API.
- The `loginAsAdmin` helper injects the JWT token directly into `sessionStorage` — no login form interaction needed for `beforeEach` setup.
