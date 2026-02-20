# Turbo EA

Self-hosted Enterprise Architecture Management platform that creates a **digital twin of a company's IT landscape**. Fully admin-configurable metamodel — card types, fields, subtypes, relations, stakeholder roles, and calculated fields are all data, not code.

**Current version**: See `/VERSION` (single source of truth for backend + frontend).

## Quick Start

```bash
cp .env.example .env          # Edit secrets and DB credentials
docker compose up --build -d  # Starts backend (port 8000) + frontend (port 8920)
```

The first user to register automatically gets the `admin` role. Set `SEED_DEMO=true` to pre-populate with the NexaTech Industries demo dataset.

---

## Architecture Overview

```
┌───────────────────────────────────────────────────────────┐
│  Browser                                                  │
│  React 18 + MUI 6 + React Router 7 + Recharts + AG Grid  │
│  Vite dev server (port 5173) / Nginx in production        │
└──────────────────────────┬────────────────────────────────┘
                           │  /api/* (proxy)
┌──────────────────────────▼────────────────────────────────┐
│  FastAPI Backend (Python 3.12, uvicorn, port 8000)        │
│  SQLAlchemy 2 (async) + Alembic migrations                │
│  RBAC permissions + JWT auth (HMAC-SHA256, bcrypt)        │
│  SSE event stream for real-time updates                   │
└──────────────────────────┬────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────┐
│  PostgreSQL (asyncpg driver)                              │
│  External container on `guac-net` Docker network          │
└───────────────────────────────────────────────────────────┘
```

**DrawIO** is self-hosted inside the frontend Docker image (cloned at build time from `jgraph/drawio` v26.0.9) and served under `/drawio/` by Nginx.

---

## Terminology

The codebase uses **"cards"** throughout (models, routes, UI). Earlier documentation may reference "fact sheets" — this has been fully renamed. The core entity table is `cards`, the API route is `/api/v1/cards`, and the frontend route is `/cards/:id`.

---

## Project Structure

```
turbo-ea/
├── VERSION                            # SemVer (single source of truth)
├── .dockerignore                      # Root-level (both services use root context)
├── docker-compose.yml
├── .env.example
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── deps.py                # Auth dependency (get_current_user)
│   │   │   └── v1/
│   │   │       ├── router.py          # Mounts all API routers
│   │   │       ├── auth.py            # /auth (login, register, me, SSO)
│   │   │       ├── cards.py           # /cards CRUD + hierarchy + approval status
│   │   │       ├── metamodel.py       # /metamodel (types + relation types + field/section usage)
│   │   │       ├── relations.py       # /relations CRUD
│   │   │       ├── stakeholders.py    # /cards/:id/stakeholders (role assignments)
│   │   │       ├── stakeholder_roles.py # /stakeholder-roles (per-type role definitions)
│   │   │       ├── roles.py           # /roles (app-level RBAC management)
│   │   │       ├── calculations.py    # /calculations (computed field formulas)
│   │   │       ├── bpm.py             # /bpm (BPMN diagram CRUD + templates)
│   │   │       ├── bpm_assessments.py # /bpm (process assessments)
│   │   │       ├── bpm_reports.py     # /bpm/reports (maturity, risk, automation)
│   │   │       ├── bpm_workflow.py    # /bpm (process flow version approval)
│   │   │       ├── diagrams.py        # /diagrams CRUD (DrawIO XML storage)
│   │   │       ├── soaw.py            # /soaw (Statement of Architecture Work)
│   │   │       ├── reports.py         # /reports (dashboard, portfolio, matrix, etc.)
│   │   │       ├── saved_reports.py   # /saved-reports (persisted report configs)
│   │   │       ├── tags.py            # /tag-groups + /cards/:id/tags
│   │   │       ├── comments.py        # /cards/:id/comments (threaded)
│   │   │       ├── todos.py           # /todos + /cards/:id/todos
│   │   │       ├── documents.py       # /cards/:id/documents (link storage)
│   │   │       ├── bookmarks.py       # /bookmarks (saved inventory views)
│   │   │       ├── events.py          # /events + /events/stream (SSE)
│   │   │       ├── users.py           # /users CRUD (admin only)
│   │   │       ├── settings.py        # /settings (logo, currency, SMTP)
│   │   │       ├── surveys.py         # /surveys (data-maintenance surveys)
│   │   │       ├── eol.py             # /eol (End-of-Life proxy for endoflife.date)
│   │   │       ├── web_portals.py     # /web-portals (public portal management)
│   │   │       ├── notifications.py   # /notifications (user notifications)
│   │   │       └── servicenow.py      # /servicenow (CMDB sync integration)
│   │   ├── core/
│   │   │   └── security.py            # JWT creation/validation, bcrypt
│   │   ├── models/                    # SQLAlchemy ORM models (see Database section)
│   │   ├── schemas/                   # Pydantic request/response models
│   │   ├── services/
│   │   │   ├── event_bus.py           # In-memory pub/sub + SSE streaming
│   │   │   ├── permission_service.py  # RBAC permission checks (5-min cache)
│   │   │   ├── calculation_engine.py  # Safe formula eval (simpleeval sandbox)
│   │   │   ├── bpmn_parser.py         # BPMN 2.0 XML → element extraction
│   │   │   ├── element_relation_sync.py # Link BPMN elements to EA cards
│   │   │   ├── servicenow_service.py  # ServiceNow API client + sync
│   │   │   ├── seed.py                # Default metamodel (14 types, 30+ relations)
│   │   │   ├── seed_demo.py           # NexaTech Industries demo dataset
│   │   │   ├── seed_demo_bpm.py       # Demo BPM processes
│   │   │   ├── notification_service.py # In-memory + DB notification management
│   │   │   └── email_service.py       # SMTP-based email sending
│   │   ├── config.py                  # Settings from env vars + APP_VERSION
│   │   ├── database.py                # Async engine + session factory
│   │   └── main.py                    # FastAPI app, lifespan (migrations + seed)
│   ├── alembic/                       # Database migrations
│   ├── tests/
│   ├── pyproject.toml
│   └── Dockerfile                     # Python 3.12-alpine + uvicorn (root context)
│
├── frontend/
│   ├── src/
│   │   ├── api/client.ts              # Fetch wrapper with JWT + error handling
│   │   ├── types/index.ts             # All TypeScript interfaces
│   │   ├── globals.d.ts               # __APP_VERSION__ type declaration
│   │   ├── hooks/
│   │   │   ├── useAuth.ts             # Login/register/logout + token in localStorage
│   │   │   ├── useMetamodel.ts        # Cached metamodel types + relation types
│   │   │   ├── useEventStream.ts      # SSE subscription hook
│   │   │   ├── useCurrency.ts         # Global currency format + symbol cache
│   │   │   ├── usePermissions.ts      # Effective permissions for current card
│   │   │   ├── useCalculatedFields.ts # Track calculated fields per type
│   │   │   ├── useBpmEnabled.ts       # BPM feature flag
│   │   │   ├── useSavedReport.ts      # Saved report caching
│   │   │   ├── useThumbnailCapture.ts # SVG → PNG for report thumbnails
│   │   │   └── useTimeline.ts         # Process timeline data
│   │   ├── layouts/AppLayout.tsx       # Top nav bar + mobile drawer + badge debounce
│   │   ├── components/
│   │   │   ├── CreateCardDialog.tsx
│   │   │   ├── LifecycleBadge.tsx
│   │   │   ├── ApprovalStatusBadge.tsx
│   │   │   ├── MaterialSymbol.tsx
│   │   │   ├── NotificationBell.tsx
│   │   │   ├── NotificationPreferencesDialog.tsx
│   │   │   ├── EolLinkSection.tsx
│   │   │   ├── VendorField.tsx
│   │   │   ├── ErrorBoundary.tsx
│   │   │   ├── ColorPicker.tsx
│   │   │   └── KeyInput.tsx
│   │   ├── features/
│   │   │   ├── auth/LoginPage.tsx
│   │   │   ├── dashboard/Dashboard.tsx
│   │   │   ├── inventory/InventoryPage.tsx  # AG Grid + memoized configs
│   │   │   ├── cards/
│   │   │   │   ├── CardDetail.tsx           # Main container + tab navigation
│   │   │   │   └── sections/               # Modular section components
│   │   │   │       ├── index.ts             # Barrel export
│   │   │   │       ├── cardDetailUtils.tsx   # Shared utilities (DataQualityRing, FieldEditor)
│   │   │   │       ├── DescriptionSection.tsx
│   │   │   │       ├── LifecycleSection.tsx
│   │   │   │       ├── AttributeSection.tsx  # Custom fields per section
│   │   │   │       ├── HierarchySection.tsx
│   │   │   │       ├── RelationsSection.tsx
│   │   │   │       ├── StakeholdersTab.tsx
│   │   │   │       ├── CommentsTab.tsx
│   │   │   │       ├── TodosTab.tsx
│   │   │   │       └── HistoryTab.tsx
│   │   │   ├── bpm/                         # Business Process Management
│   │   │   │   ├── BpmDashboard.tsx
│   │   │   │   ├── ProcessFlowEditorPage.tsx
│   │   │   │   ├── BpmnModeler.tsx          # bpmn-js integration
│   │   │   │   ├── BpmnViewer.tsx
│   │   │   │   ├── BpmnTemplateChooser.tsx
│   │   │   │   ├── ProcessFlowTab.tsx       # Embedded in card detail
│   │   │   │   ├── ProcessAssessmentPanel.tsx
│   │   │   │   ├── ProcessNavigator.tsx
│   │   │   │   ├── ElementLinker.tsx
│   │   │   │   └── BpmReportPage.tsx
│   │   │   ├── diagrams/                    # DrawIO editor + sync panel
│   │   │   ├── reports/                     # 9 report types
│   │   │   ├── ea-delivery/                 # SoAW editor + preview + DOCX export
│   │   │   ├── todos/TodosPage.tsx
│   │   │   ├── surveys/SurveyRespond.tsx
│   │   │   ├── web-portals/PortalViewer.tsx
│   │   │   └── admin/
│   │   │       ├── MetamodelAdmin.tsx       # Type list + relation graph orchestrator
│   │   │       ├── metamodel/               # Modular metamodel admin components
│   │   │       │   ├── index.ts
│   │   │       │   ├── constants.ts         # FIELD_TYPE_OPTIONS, icons, colors
│   │   │       │   ├── helpers.ts           # Validation, defaults
│   │   │       │   ├── TypeDetailDrawer.tsx  # Type editor + field/section CRUD
│   │   │       │   ├── FieldEditorDialog.tsx # Field config (type, options, weight)
│   │   │       │   ├── StakeholderRolePanel.tsx # Per-type role definitions
│   │   │       │   └── MetamodelGraph.tsx   # Relation type SVG visualization
│   │   │       ├── CardLayoutEditor.tsx      # Section ordering, DnD fields, columns, groups
│   │   │       ├── TagsAdmin.tsx
│   │   │       ├── UsersAdmin.tsx
│   │   │       ├── SettingsAdmin.tsx
│   │   │       ├── EolAdmin.tsx
│   │   │       ├── SurveysAdmin.tsx
│   │   │       ├── SurveyBuilder.tsx
│   │   │       ├── SurveyResults.tsx
│   │   │       ├── WebPortalsAdmin.tsx
│   │   │       └── ServiceNowAdmin.tsx
│   │   ├── App.tsx                          # Routes + MUI theme
│   │   └── main.tsx                         # React entry point
│   ├── drawio-config/                       # PreConfig.js, PostConfig.js
│   ├── nginx.conf                           # API proxy + DrawIO + security headers
│   ├── package.json
│   ├── vite.config.ts                       # __APP_VERSION__ injection from VERSION file
│   └── Dockerfile                           # Multi-stage: node → drawio → nginx (root context)
│
├── plan.md
└── Statement_of_Architecture_Work_Template.md
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | `db` | PostgreSQL hostname |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DB` | `turboea` | Database name |
| `POSTGRES_USER` | `turboea` | Database user |
| `POSTGRES_PASSWORD` | *(required)* | Database password |
| `SECRET_KEY` | *(required)* | HMAC key for JWT signing |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` (24h) | JWT token lifetime |
| `HOST_PORT` | `8920` | Port exposed on the host for the frontend |
| `RESET_DB` | `false` | Drop all tables and re-create + re-seed on startup |
| `SEED_DEMO` | `false` | Populate NexaTech Industries demo data on startup |
| `SEED_BPM` | `false` | Populate demo BPM processes |
| `ENVIRONMENT` | `production` | Runtime environment |
| `ALLOWED_ORIGINS` | `http://localhost:8920` | CORS allowed origins |

For local frontend dev without Docker, create `frontend/.env.development`:
```
VITE_DRAWIO_URL=https://embed.diagrams.net
```

---

## Database Schema

All tables use UUID primary keys and `created_at`/`updated_at` timestamps (from `UUIDMixin` + `TimestampMixin` in `backend/app/models/base.py`).

### Core Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `users` | `User` | Email, display_name, password_hash, role_key (FK to roles), is_active |
| `card_types` | `CardType` | Metamodel: types with key, label, icon, color, category, subtypes (JSONB), fields_schema (JSONB), section_config (JSONB), stakeholder_roles (JSONB), has_hierarchy, built_in, is_hidden, sort_order |
| `relation_types` | `RelationType` | Metamodel: allowed relations between types with label, reverse_label, cardinality, attributes_schema (JSONB) |
| `cards` | `Card` | The core entity. Type, subtype, name, description, parent_id (hierarchy), lifecycle (JSONB), attributes (JSONB), status, approval_status, data_quality (float 0-100) |
| `relations` | `Relation` | Links between cards. Type key, source_id, target_id, attributes (JSONB) |

### RBAC Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `roles` | `Role` | App-level roles with key, label, permissions (JSONB), is_system, sort_order |
| `stakeholder_role_definitions` | `StakeholderRoleDefinition` | Per-card-type stakeholder role definitions with permissions |
| `stakeholders` | `Stakeholder` | User role assignments on specific cards |

### BPM Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `process_diagrams` | `ProcessDiagram` | BPMN 2.0 XML storage linked to BusinessProcess cards |
| `process_elements` | `ProcessElement` | Extracted BPMN elements (tasks, events, gateways, lanes) |
| `process_flow_versions` | `ProcessFlowVersion` | Version history with approval workflow (draft/pending/published/archived) |
| `process_assessments` | `ProcessAssessment` | Process scores: efficiency, effectiveness, compliance |

### Calculation Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `calculations` | `Calculation` | Admin-defined formulas: name, formula, target_type_key, target_field_key, is_active, execution_order |

### Supporting Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `tag_groups` | `TagGroup` | Tag categories with mode (single/multi), create_mode, restrict_to_types |
| `tags` | `Tag` | Individual tags within groups, with optional color |
| `card_tags` | (association) | M:N join table |
| `comments` | `Comment` | Threaded comments on cards (self-referential parent_id) |
| `todos` | `Todo` | Tasks linked to cards, assignable to users, with due dates |
| `documents` | `Document` | URL/link attachments on cards |
| `bookmarks` | `Bookmark` | Saved inventory filter/column/sort views per user |
| `events` | `Event` | Audit trail: event_type + JSONB data, linked to card and user |
| `diagrams` | `Diagram` | DrawIO diagram storage: name, type, data (JSONB with XML + thumbnail) |
| `diagram_initiatives` | (association) | M:N between diagrams and initiative cards |
| `statement_of_architecture_works` | `SoAW` | TOGAF SoAW documents linked to initiatives |
| `app_settings` | `AppSettings` | Singleton row: email_settings, general_settings, custom_logo |
| `surveys` | `Survey` | Data-maintenance surveys with target_type, filters, actions |
| `survey_responses` | `SurveyResponse` | Per card + user responses |
| `notifications` | `Notification` | Per-user notifications |
| `web_portals` | `WebPortal` | Public portals with slug-based URLs |
| `saved_reports` | `SavedReport` | Persisted report configurations with thumbnails |
| `sso_invitations` | `SsoInvitation` | Pre-assigned SSO invitations |

### ServiceNow Integration Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `snow_connections` | — | ServiceNow instance connection details |
| `snow_mappings` | — | Card type ↔ ServiceNow table mappings |
| `snow_field_mappings` | — | Field-level mapping rules |
| `snow_sync_runs` | — | Sync execution history |
| `snow_staged_records` | — | Staged records for review before apply |
| `snow_identity_map` | — | Persistent ID mapping between systems |

### Migrations

Located in `backend/alembic/versions/`. The app auto-runs Alembic on startup:
- Fresh DB: `create_all` + stamp head
- Existing DB without Alembic: stamp head
- Normal: `upgrade head` (run pending migrations)
- `RESET_DB=true`: drop all + recreate + stamp head

---

## API Reference

Base path: `/api/v1`. All endpoints except auth and public portals require `Authorization: Bearer <token>`.

### Authentication (`/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | No | Register (first user gets admin) |
| POST | `/auth/login` | No | Login, returns `{access_token}` |
| GET | `/auth/me` | Yes | Current user info |

### Metamodel (`/metamodel`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/metamodel/types` | List types. `?include_hidden=true` for soft-deleted |
| GET | `/metamodel/types/{key}` | Get single type |
| POST | `/metamodel/types` | Create custom type |
| PATCH | `/metamodel/types/{key}` | Update type (fields_schema, section_config, stakeholder_roles, etc.) |
| DELETE | `/metamodel/types/{key}` | Soft-delete built-in, hard-delete custom |
| GET | `/metamodel/types/{key}/field-usage` | Count cards using a specific field |
| GET | `/metamodel/types/{key}/section-usage` | Count cards using any field in a section |
| GET | `/metamodel/types/{key}/option-usage` | Count cards using a specific select option |
| GET | `/metamodel/relation-types` | List relation types. `?type_key=X` to filter |
| POST | `/metamodel/relation-types` | Create relation type |
| PATCH | `/metamodel/relation-types/{key}` | Update relation type |
| DELETE | `/metamodel/relation-types/{key}` | Soft-delete / hard-delete |

### Cards (`/cards`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cards` | Paginated list. Query: `type`, `status`, `search`, `parent_id`, `approval_status`, `page`, `page_size`, `sort_by`, `sort_dir` |
| POST | `/cards` | Create card. Auto-computes data quality, runs calculations |
| GET | `/cards/{id}` | Get card with tags + stakeholders |
| PATCH | `/cards/{id}` | Update. Breaks approval on substantive changes, recalculates quality |
| DELETE | `/cards/{id}` | Archives (soft-delete: status=ARCHIVED) |
| PATCH | `/cards/bulk` | Bulk update multiple cards |
| GET | `/cards/{id}/hierarchy` | Ancestors, children, computed level |
| GET | `/cards/{id}/history` | Paginated event history |
| POST | `/cards/{id}/approval-status` | `?action=approve\|reject\|reset` |
| GET | `/cards/export/csv` | Export as CSV. `?type=X` |

### RBAC (`/roles`, `/stakeholder-roles`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/roles` | List app-level roles |
| POST | `/roles` | Create role with permissions |
| PATCH | `/roles/{id}` | Update role permissions |
| DELETE | `/roles/{id}` | Delete non-system role |
| GET | `/stakeholder-roles` | List per-type stakeholder role definitions |
| GET | `/cards/{id}/effective-permissions` | Get effective permissions for current user on a card |

### Calculations (`/calculations`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/calculations` | List all calculations |
| GET | `/calculations/calculated-fields` | Map of type_key → calculated field_keys |
| POST | `/calculations` | Create calculation formula |
| PATCH | `/calculations/{id}` | Update formula |
| DELETE | `/calculations/{id}` | Delete calculation |
| POST | `/calculations/{id}/run` | Execute calculation on all matching cards |

### BPM (`/bpm`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/bpm/processes/{id}/diagram` | Get BPMN XML for a process |
| PUT | `/bpm/processes/{id}/diagram` | Save BPMN XML (auto-extracts elements) |
| GET | `/bpm/processes/{id}/elements` | List extracted BPMN elements |
| GET | `/bpm/templates` | List BPMN starter templates |
| GET | `/bpm/process-flow-versions` | List versions for a process |
| POST | `/bpm/process-flow-versions` | Create draft version |
| POST | `/bpm/process-flow-versions/{id}/submit` | Submit for approval |
| POST | `/bpm/process-flow-versions/{id}/approve` | Approve and publish |
| POST | `/bpm/process-flow-versions/{id}/reject` | Reject with comment |
| GET | `/bpm/reports/dashboard` | Process maturity KPIs |
| GET | `/bpm/reports/risk` | Risk assessment overview |
| GET | `/bpm/reports/automation` | Automation levels |

### Reports (`/reports`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/reports/dashboard` | KPIs: counts by type, avg data quality, approvals, events |
| GET | `/reports/landscape` | Cards grouped by a related type |
| GET | `/reports/portfolio` | Bubble chart data: configurable X/Y/size/color axes |
| GET | `/reports/matrix` | Cross-reference grid between two types |
| GET | `/reports/roadmap` | Lifecycle timeline data |
| GET | `/reports/cost` | Cost aggregation (simple bar) |
| GET | `/reports/cost-treemap` | Treemap with optional grouping |
| GET | `/reports/capability-heatmap` | Business capability hierarchy with app counts |
| GET | `/reports/dependencies` | Network graph: nodes + edges with BFS depth limiting |
| GET | `/reports/data-quality` | Completeness dashboard |

### Saved Reports (`/saved-reports`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/saved-reports` | List saved report configs |
| POST | `/saved-reports` | Save report configuration with thumbnail |
| PATCH | `/saved-reports/{id}` | Update saved report |
| DELETE | `/saved-reports/{id}` | Delete saved report |

### ServiceNow (`/servicenow`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/servicenow/connections` | List ServiceNow connections |
| POST | `/servicenow/connections` | Create connection |
| POST | `/servicenow/connections/{id}/test` | Test connectivity |
| GET | `/servicenow/mappings` | List type/field mappings |
| POST | `/servicenow/sync/pull` | Pull records from ServiceNow |
| POST | `/servicenow/sync/push` | Push records to ServiceNow |
| GET | `/servicenow/staged` | List staged records for review |
| POST | `/servicenow/staged/apply` | Apply staged records |

### Other Endpoints

| Category | Key Endpoints |
|----------|--------------|
| **Relations** | `GET/POST /relations`, `PATCH/DELETE /relations/{id}` |
| **Stakeholders** | `GET/POST /cards/{id}/stakeholders`, `PATCH/DELETE /stakeholders/{id}` |
| **Tags** | `GET/POST /tag-groups`, `POST /cards/{id}/tags` |
| **Comments** | `GET/POST /cards/{id}/comments`, `PATCH/DELETE /comments/{id}` |
| **Todos** | `GET/POST /todos`, `GET/POST /cards/{id}/todos` |
| **Documents** | `GET/POST /cards/{id}/documents`, `DELETE /documents/{id}` |
| **Bookmarks** | `GET/POST /bookmarks`, `PATCH/DELETE /bookmarks/{id}` |
| **Diagrams** | `GET/POST /diagrams`, `GET/PATCH/DELETE /diagrams/{id}` |
| **SoAW** | `GET/POST /soaw`, `GET/PATCH/DELETE /soaw/{id}` |
| **Surveys** | Full CRUD + `/surveys/{id}/send`, `/surveys/{id}/respond/{card_id}` |
| **EOL** | `/eol/products`, `/eol/products/fuzzy`, `/eol/mass-search`, `/eol/mass-link` |
| **Web Portals** | CRUD + `/web-portals/public/{slug}` (no auth) |
| **Notifications** | `GET /notifications`, badge counts, mark read |
| **Settings** | Email SMTP, currency, logo upload |
| **Users** | CRUD (admin only), self-update |
| **Events** | `GET /events`, `GET /events/stream` (SSE) |
| **Health** | `GET /api/health` (no auth, includes version) |

**API docs**: Available at `/api/docs` (Swagger UI) and `/api/openapi.json`.

---

## Frontend Architecture

### Tech Stack
- **React 18** with TypeScript
- **MUI 6** (Material UI) for component library
- **React Router 7** for client-side routing
- **AG Grid** for data tables (inventory page)
- **Recharts** for charts (portfolio, cost, lifecycle reports)
- **bpmn-js** for BPMN 2.0 diagram editing
- **TipTap** for rich text editing (SoAW sections)
- **@dnd-kit** for drag-and-drop (card layout editor)
- **docx** + **file-saver** for DOCX export (SoAW)
- **xlsx** (vendored v0.20.3) for Excel import/export
- **Vite** for build tooling with `@` path alias to `./src`

### Routing (`App.tsx`)

| Path | Component | Description |
|------|-----------|-------------|
| `/` | `Dashboard` | KPI cards, type breakdown, recent activity |
| `/inventory` | `InventoryPage` | AG Grid table with memoized configs |
| `/cards/:id` | `CardDetail` | Modular detail: sections + tabs |
| `/reports/portfolio` | `PortfolioReport` | Bubble/scatter chart |
| `/reports/capability-map` | `CapabilityMapReport` | Heatmap of business capabilities |
| `/reports/lifecycle` | `LifecycleReport` | Timeline visualization |
| `/reports/dependencies` | `DependencyReport` | Network graph |
| `/reports/cost` | `CostReport` | Treemap + bar chart |
| `/reports/matrix` | `MatrixReport` | Cross-reference grid |
| `/reports/data-quality` | `DataQualityReport` | Completeness dashboard |
| `/reports/eol` | `EolReport` | End-of-Life status |
| `/reports/saved` | `SavedReportsPage` | Saved report gallery |
| `/bpm` | `BpmDashboard` | BPM maturity overview |
| `/bpm/processes/:id/flow` | `ProcessFlowEditorPage` | BPMN editor with approval workflow |
| `/diagrams` | `DiagramsPage` | Diagram gallery with thumbnails |
| `/diagrams/:id` | `DiagramEditor` | DrawIO iframe editor |
| `/ea-delivery` | `EADeliveryPage` | SoAW document list |
| `/ea-delivery/soaw/new` | `SoAWEditor` | Create new SoAW |
| `/ea-delivery/soaw/:id` | `SoAWEditor` | Edit SoAW |
| `/ea-delivery/soaw/:id/preview` | `SoAWPreview` | Read-only preview |
| `/todos` | `TodosPage` | Todos + Surveys (tabbed) |
| `/surveys/:surveyId/respond/:cardId` | `SurveyRespond` | Respond to survey |
| `/portal/:slug` | `PortalViewer` | Public portal (no auth) |
| `/admin/metamodel` | `MetamodelAdmin` | Card types + relations |
| `/admin/users` | `UsersAdmin` | User management |
| `/admin/settings` | `SettingsAdmin` | Logo, currency, SMTP |
| `/admin/eol` | `EolAdmin` | Mass EOL linking |
| `/admin/surveys` | `SurveysAdmin` | Survey management |
| `/admin/surveys/new` | `SurveyBuilder` | Create survey |
| `/admin/surveys/:id` | `SurveyBuilder` | Edit survey |
| `/admin/surveys/:id/results` | `SurveyResults` | View/apply responses |
| `/admin/web-portals` | `WebPortalsAdmin` | Portal management |
| `/admin/servicenow` | `ServiceNowAdmin` | ServiceNow sync config |

### Key Patterns

**API Client** (`src/api/client.ts`): Thin fetch wrapper that auto-injects the JWT from localStorage. Methods: `api.get()`, `api.post()`, `api.patch()`, `api.delete()`. Handles 204 empty responses and formats validation errors.

**Authentication** (`hooks/useAuth.ts`): Token stored in `localStorage.token`. On load, validates via `GET /auth/me`. SSO callback support via `/auth/callback`.

**Metamodel Cache** (`hooks/useMetamodel.ts`): Module-level singleton cache. Fetches types + relation types once, shared across all components. `invalidateCache()` forces re-fetch.

**Permissions** (`hooks/usePermissions.ts`): Fetches effective permissions for a card by combining app-level role + stakeholder roles. Used by CardDetail to enable/disable edit controls.

**Calculated Fields** (`hooks/useCalculatedFields.ts`): Fetches `type_key → field_keys[]` map. CardDetail uses this to show "calc" badges and prevent manual editing of computed fields.

**Real-time Updates** (`hooks/useEventStream.ts`): SSE connection to `/events/stream`. Auto-reconnects on error. Badge count refresh debounced at 500ms via `AppLayout.tsx`.

**Currency** (`hooks/useCurrency.ts`): Module-level singleton cache. Provides `fmt()`, `fmtShort()`, and `symbol` for consistent cost display.

**Data Quality Scoring**: Backend auto-computes `data_quality` (0-100%) based on `fields_schema` weights. Approval status auto-breaks to `BROKEN` when approved items are edited.

**Card Detail Sections**: Each section is an independent component in `features/cards/sections/`, wrapped in `ErrorBoundary`. Section ordering is controlled by `section_config.__order` in the metamodel. Custom sections are rendered via `AttributeSection` (fully data-driven from `fields_schema`).

**MUI Dialog Nesting**: When dialogs are nested (e.g., TypeDetailDrawer contains FieldEditorDialog), inner dialogs use `disableRestoreFocus` to prevent `aria-hidden` focus warnings.

---

## Metamodel

The default metamodel seeds 14 card types across 4 layers and 30+ relation types. Created on first startup by `backend/app/services/seed.py`.

### Card Types

| Key | Label | Icon | Color | Layer | Hierarchy | Subtypes |
|-----|-------|------|-------|-------|-----------|----------|
| `Objective` | Objective | flag | #c7527d | Strategy & Transformation | No | - |
| `Platform` | Platform | layers | #027446 | Strategy & Transformation | No | Digital, Technical |
| `Initiative` | Initiative | rocket_launch | #33cc58 | Strategy & Transformation | Yes | Idea, Program, Project, Epic |
| `Organization` | Organization | corporate_fare | #2889ff | Business Architecture | Yes | Business Unit, Region, Legal Entity, Team, Customer |
| `BusinessCapability` | Business Capability | account_tree | #003399 | Business Architecture | Yes | - |
| `BusinessContext` | Business Context | swap_horiz | #fe6690 | Business Architecture | Yes | Process, Value Stream, Customer Journey, Business Product, ESG Capability |
| `BusinessProcess` | Business Process | schema | #8e24aa | Business Architecture | Yes | Core, Support, Management |
| `Application` | Application | apps | #0f7eb5 | Application & Data | Yes | Business Application, Microservice, AI Agent, Deployment |
| `Interface` | Interface | sync_alt | #02afa4 | Application & Data | No | Logical Interface, API, MCP Server |
| `DataObject` | Data Object | database | #774fcc | Application & Data | Yes | - |
| `ITComponent` | IT Component | memory | #d29270 | Technical Architecture | Yes | Software, Hardware, SaaS, PaaS, IaaS, Service, AI Model |
| `TechCategory` | Tech Category | category | #a6566d | Technical Architecture | Yes | - |
| `Provider` | Provider | storefront | #ffa31f | Technical Architecture | No | - |
| `System` | System | dns | #5B738B | Technical Architecture | No | - |

### Fields Schema Structure

Each type has a `fields_schema` (JSONB array of sections):
```json
[
  {
    "section": "Section Name",
    "columns": 1,
    "groups": ["Group Name"],
    "fields": [
      {
        "key": "fieldKey",
        "label": "Display Label",
        "type": "text|number|cost|boolean|date|url|single_select|multiple_select",
        "options": [{"key": "k", "label": "L", "color": "#hex"}],
        "required": false,
        "weight": 1,
        "readonly": false,
        "column": 0,
        "group": "Group Name"
      }
    ]
  }
]
```

The special section name `__description` feeds extra fields into the Description section. All other sections are rendered as custom `AttributeSection` components.

### Section Config

Each type has an optional `section_config` (JSONB) controlling layout:
```json
{
  "__order": ["description", "eol", "lifecycle", "custom:0", "custom:1", "hierarchy", "relations"],
  "description": { "defaultExpanded": true, "hidden": false },
  "custom:0": { "defaultExpanded": true, "hidden": false }
}
```

### Field Types

| Type | Description | Rendering |
|------|-------------|-----------|
| `text` | Plain text | TextField |
| `number` | Numeric | NumberField |
| `cost` | Numeric with currency formatting | NumberField + currency symbol |
| `boolean` | Toggle | Switch |
| `date` | ISO date | DatePicker |
| `url` | Validated URL (http/https/mailto) | Clickable link input |
| `single_select` | Single choice from options | Select dropdown |
| `multiple_select` | Multiple choices from options | Multi-select chips |

---

## RBAC (Role-Based Access Control)

### Multi-level Permission System

1. **App-level Roles** (`roles` table): System-wide roles like admin, member, viewer, bpm_admin. Each role has a JSONB `permissions` field with granular capability flags. Cached with 5-minute TTL by `PermissionService`.

2. **Stakeholder Roles** (`stakeholder_role_definitions`): Per-card-type role definitions. Each card type can define custom roles (e.g., Application → "technical_application_owner"). Roles carry per-type permissions.

3. **Stakeholders** (`stakeholders` table): User ↔ card assignments with a specific role. A user can hold multiple stakeholder roles on different cards.

4. **Effective Permissions**: For any user + card combination, the system computes the union of:
   - App-level role permissions
   - All stakeholder role permissions the user holds on that card
   - Result exposed via `GET /cards/{id}/effective-permissions`

### Permission Checking (Backend)
```python
await PermissionService.require_permission(db, user, "admin.metamodel")
await PermissionService.check_card_permission(db, user, card_id, "card.edit")
```

---

## Calculations (Computed Fields)

Admin-defined formulas that automatically compute field values when cards are saved.

### Engine (`calculation_engine.py`)
- Safe sandboxed evaluation using `simpleeval`
- **Built-in functions**: IF, SUM, AVG, MIN, MAX, COUNT, ROUND, ABS, COALESCE, LOWER, UPPER, CONCAT, CONTAINS, PLUCK, FILTER, MAP_SCORE
- **Context variables**: Card attributes, relations data, lifecycle info
- Automatic execution on card save via `run_calculations_for_card()`
- Dependency ordering via `execution_order` field

### Example Formulas
```
SUM(PLUCK(related_applications, "costTotalAnnual"))
IF(riskLevel == "critical", 100, IF(riskLevel == "high", 75, 25))
COUNT(FILTER(related_interfaces, "status", "ACTIVE"))
```

---

## BPM (Business Process Management)

### Architecture
- **BusinessProcess** card type with fields: process type, maturity level, automation level, risk level, frequency
- **BPMN 2.0 Editor**: bpmn-js integration with 6 starter templates
- **Element Extraction**: `bpmn_parser.py` extracts tasks, events, gateways, lanes from BPMN XML
- **Element Linking**: `ElementLinker.tsx` connects BPMN elements to Application/DataObject/ITComponent cards
- **Approval Workflow**: Process flows go through draft → pending → published → archived states

### BPM Reports
- Process maturity dashboard
- Risk assessment overview
- Automation level analysis

### Card Detail Integration
BusinessProcess cards show extra tabs in CardDetail:
- **Process Flow** tab: Embedded BPMN viewer/editor
- **Assessments** tab: Process assessment scores

---

## DrawIO Integration

### How It Works
1. **Build time**: Frontend Dockerfile clones `jgraph/drawio` v26.0.9
2. **Runtime**: Nginx serves DrawIO at `/drawio/` (same origin)
3. **Editor**: `DiagramEditor.tsx` loads DrawIO in a same-origin iframe
4. **Communication**: Direct DOM access to iframe's `mxGraph` API. Graph reference stored on `iframe.contentWindow.__turboGraph`

### Shape System (`src/features/diagrams/drawio-shapes.ts`)
Cards are represented as mxGraph cells with custom XML user objects:
```xml
<object label="App Name" factSheetId="uuid" factSheetType="Application" />
```

Key functions: `insertFactSheetIntoGraph()`, `insertPendingFactSheet()`, `markCellSynced()`, `expandFactSheetGroup()`, `scanDiagramItems()`, `stampEdgeAsRelation()`, `extractFactSheetIds()`

---

## ServiceNow Integration

Bi-directional sync between Turbo EA cards and ServiceNow CMDB.

- **Connections**: Multiple ServiceNow instances with credential management
- **Mappings**: Card type ↔ ServiceNow table mappings with field-level rules
- **Sync modes**: Pull (ServiceNow → Turbo), Push (Turbo → ServiceNow)
- **Staging**: Records staged for admin review before applying changes
- **Identity persistence**: `snow_identity_map` maintains ID mappings across syncs

---

## Version Management

Single source of truth: `/VERSION` file at project root.

- **Backend**: `config.py` reads VERSION → exports `APP_VERSION` → exposed in `/api/health`
- **Frontend**: `vite.config.ts` reads VERSION → injects `__APP_VERSION__` global → displayed in user menu (AppLayout)
- **Docker**: Both Dockerfiles `COPY VERSION ./VERSION` before building
- **Local dev**: Frontend checks `../VERSION` (from frontend dir) then `./VERSION` (Docker)

---

## Security

### Docker Hardening
- Non-root users: frontend runs as `nginx`, backend as `appuser`
- `cap_drop: ALL` + `no-new-privileges: true`
- Memory limits: backend 512M, frontend 256M
- Backend only exposed via internal Docker network (not to host)

### Nginx Security Headers
- Content-Security-Policy (strict, self-only with font/DrawIO exceptions)
- X-Frame-Options: SAMEORIGIN
- X-Content-Type-Options: nosniff
- Strict-Transport-Security: max-age=31536000
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: camera/microphone/geolocation disabled
- Request body limit: 5MB

### JWT Implementation
- Manually constructed HS256 JWT in `core/security.py`
- Payload: `{sub: user_id, role: role_key, iat, exp}`
- Passwords hashed with bcrypt
- Token sent as `Authorization: Bearer <token>`

---

## Development

### Local Development (without Docker)

**Backend:**
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -e ".[dev]"
# Ensure PostgreSQL is running with correct credentials
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev    # Vite dev server on port 5173, proxies /api to :8000
```

### Linting & Testing

**Backend:**
```bash
cd backend
ruff check .          # Lint (rules: E, F, I, N, W)
ruff format .         # Auto-format
pytest                # Run tests (asyncio_mode=auto)
```

**Frontend:**
```bash
cd frontend
npm run lint          # ESLint
npm run build         # TypeScript check + Vite build
```

### Database Reset
Set `RESET_DB=true` to drop all tables and re-seed on next startup.

### Key Libraries

**Backend:**
- FastAPI 0.115+ with Pydantic 2.10+
- SQLAlchemy 2.0+ (async via asyncpg)
- Alembic for migrations
- bcrypt for password hashing
- simpleeval for safe formula evaluation
- sse-starlette for Server-Sent Events
- ruff for linting (target: Python 3.12)

**Frontend:**
- React 18 + TypeScript 5.6
- MUI 6 + Emotion for styling
- AG Grid for data tables
- Recharts for visualizations
- bpmn-js for BPMN editing
- TipTap for rich text editing
- @dnd-kit for drag-and-drop
- docx + file-saver for DOCX generation
- xlsx (vendored 0.20.3) for Excel import/export

---

## Docker Architecture

### docker-compose.yml
Both services use **root build context** (`context: .`) on the `guac-net` external network:
- **backend**: `dockerfile: backend/Dockerfile`, Python 3.12-alpine, uvicorn on port 8000 (internal only)
- **frontend**: `dockerfile: frontend/Dockerfile`, multi-stage build, port 80 mapped to `HOST_PORT`

PostgreSQL is external (not managed by this compose file).

### Frontend Dockerfile (multi-stage, root context)
1. **build stage**: `node:20-alpine` — copies `frontend/package.json` + `VERSION`, npm ci, vite build
2. **drawio stage**: `alpine/git` — clone jgraph/drawio v26.0.9
3. **production stage**: `nginx:alpine` — serve built frontend + DrawIO + security configs, runs as non-root `nginx` user

### Backend Dockerfile (root context)
Single stage: `python:3.12-alpine` — copies `VERSION` + `backend/`, pip install, runs as non-root `appuser`

### Nginx Configuration
- `/api/*` → proxy to `backend:8000` (with SSE support headers)
- `/drawio/*` → static DrawIO assets (30-day cache, no-transform)
- `/*` → SPA fallback to `index.html`
- Security headers on all responses
- Static assets → 1-year cache with `immutable`
