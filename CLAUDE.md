# Turbo EA

Self-hosted Enterprise Architecture Management platform that creates a **digital twin of a company's IT landscape**. Inspired by LeanIX, with a fully admin-configurable metamodel — fact sheet types, fields, subtypes, and relations are all data, not code.

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
│  JWT auth (HMAC-SHA256, bcrypt passwords)                 │
│  SSE event stream for real-time updates                   │
└──────────────────────────┬────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────┐
│  PostgreSQL (asyncpg driver)                              │
│  External container on `guac-net` Docker network          │
└───────────────────────────────────────────────────────────┘
```

**DrawIO** is self-hosted inside the frontend Docker image (cloned at build time from `jgraph/drawio` v26.0.9) and served under `/drawio/` by Nginx. The diagram editor embeds it in a same-origin iframe.

---

## Project Structure

```
turbo-ea/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── deps.py               # Auth dependency (get_current_user)
│   │   │   └── v1/
│   │   │       ├── router.py          # Mounts all API routers
│   │   │       ├── auth.py            # /auth (login, register, me)
│   │   │       ├── fact_sheets.py     # /fact-sheets CRUD + hierarchy + quality seal
│   │   │       ├── metamodel.py       # /metamodel (types + relation types CRUD)
│   │   │       ├── relations.py       # /relations CRUD
│   │   │       ├── diagrams.py        # /diagrams CRUD (DrawIO XML storage)
│   │   │       ├── soaw.py            # /soaw (Statement of Architecture Work)
│   │   │       ├── reports.py         # /reports (dashboard, portfolio, matrix, etc.)
│   │   │       ├── tags.py            # /tag-groups + /fact-sheets/:id/tags
│   │   │       ├── subscriptions.py   # /subscriptions (user roles on fact sheets)
│   │   │       ├── comments.py        # /fact-sheets/:id/comments (threaded)
│   │   │       ├── todos.py           # /todos + /fact-sheets/:id/todos
│   │   │       ├── documents.py       # /fact-sheets/:id/documents (link storage)
│   │   │       ├── bookmarks.py       # /bookmarks (saved inventory views)
│   │   │       ├── events.py          # /events + /events/stream (SSE)
│   │   │       ├── users.py           # /users CRUD (admin only)
│   │   │       ├── settings.py        # /settings (logo, currency, SMTP, logo visibility)
│   │   │       ├── surveys.py         # /surveys (data-maintenance surveys)
│   │   │       ├── eol.py             # /eol (End-of-Life proxy for endoflife.date)
│   │   │       ├── web_portals.py     # /web-portals (public portal management)
│   │   │       └── notifications.py   # /notifications (user notifications)
│   │   ├── core/
│   │   │   └── security.py            # JWT creation/validation, bcrypt
│   │   ├── models/                    # SQLAlchemy ORM models (see Database section)
│   │   ├── schemas/                   # Pydantic request/response models
│   │   ├── services/
│   │   │   ├── event_bus.py           # In-memory pub/sub + SSE streaming
│   │   │   ├── seed.py                # Default LeanIX metamodel (13 types, 29 relations)
│   │   │   ├── seed_demo.py           # NexaTech Industries demo dataset
│   │   │   ├── notification_service.py # In-memory + DB notification management
│   │   │   └── email_service.py       # SMTP-based email sending
│   │   ├── config.py                  # Settings from env vars
│   │   ├── database.py                # Async engine + session factory
│   │   └── main.py                    # FastAPI app, lifespan (migrations + seed)
│   ├── alembic/                       # Database migrations
│   ├── tests/
│   ├── pyproject.toml
│   └── Dockerfile                     # Python 3.12-alpine + uvicorn
│
├── frontend/
│   ├── src/
│   │   ├── api/client.ts              # Fetch wrapper with JWT + error handling
│   │   ├── types/index.ts             # All TypeScript interfaces
│   │   ├── hooks/
│   │   │   ├── useAuth.ts             # Login/register/logout + token in localStorage
│   │   │   ├── useMetamodel.ts        # Cached metamodel types + relation types
│   │   │   ├── useEventStream.ts      # SSE subscription hook
│   │   │   └── useCurrency.ts         # Global currency format + symbol cache
│   │   ├── layouts/AppLayout.tsx       # Top nav bar + mobile drawer + routing
│   │   ├── components/
│   │   │   ├── CreateFactSheetDialog.tsx
│   │   │   ├── LifecycleBadge.tsx
│   │   │   ├── QualitySealBadge.tsx
│   │   │   ├── MaterialSymbol.tsx
│   │   │   ├── NotificationBell.tsx       # Navbar notification bell with unread count
│   │   │   ├── NotificationPreferencesDialog.tsx
│   │   │   ├── EolLinkSection.tsx         # EOL product linking UI
│   │   │   └── VendorField.tsx            # Vendor autocomplete field
│   │   ├── features/
│   │   │   ├── auth/LoginPage.tsx
│   │   │   ├── dashboard/Dashboard.tsx
│   │   │   ├── inventory/             # AG Grid data table + Excel import/export
│   │   │   ├── fact-sheets/FactSheetDetail.tsx
│   │   │   ├── diagrams/             # DrawIO editor + sync panel + shapes
│   │   │   ├── reports/              # 8 report types (see Reports section)
│   │   │   ├── ea-delivery/          # SoAW editor + preview + DOCX export
│   │   │   ├── todos/TodosPage.tsx
│   │   │   ├── surveys/              # MySurveys + SurveyRespond pages
│   │   │   ├── web-portals/          # PortalViewer (public portal rendering)
│   │   │   └── admin/               # MetamodelAdmin, TagsAdmin, UsersAdmin,
│   │   │                            # SettingsAdmin, EolAdmin, SurveysAdmin,
│   │   │                            # SurveyBuilder, SurveyResults, WebPortalsAdmin
│   │   ├── App.tsx                   # Routes + MUI theme
│   │   └── main.tsx                  # React entry point
│   ├── drawio-config/                # PreConfig.js, PostConfig.js (placeholders)
│   ├── nginx.conf                    # API proxy + DrawIO + SPA fallback
│   ├── package.json
│   ├── vite.config.ts
│   └── Dockerfile                    # Multi-stage: node build → drawio clone → nginx
│
├── docker-compose.yml
├── .env.example
├── plan.md                           # Detailed roadmap (metamodel overhaul + reports)
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
| `POSTGRES_PASSWORD` | `changeme` | Database password |
| `SECRET_KEY` | `dev-secret-key-change-in-production` | HMAC key for JWT signing |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` (24h) | JWT token lifetime |
| `HOST_PORT` | `8920` | Port exposed on the host for the frontend |
| `RESET_DB` | `false` | Drop all tables and re-create + re-seed on startup |
| `SEED_DEMO` | `false` | Populate NexaTech Industries demo data on startup |

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
| `users` | `User` | Email, display_name, password_hash, role (`admin`/`member`/`viewer`), is_active |
| `fact_sheet_types` | `FactSheetType` | Metamodel: configurable types with key, label, icon, color, category, subtypes (JSONB), fields_schema (JSONB), has_hierarchy, built_in, is_hidden, sort_order |
| `relation_types` | `RelationType` | Metamodel: allowed relations between types with label, reverse_label, cardinality (`1:1`/`1:n`/`n:m`), attributes_schema (JSONB) |
| `fact_sheets` | `FactSheet` | The core entity. Type, subtype, name, description, parent_id (self-referential hierarchy), lifecycle (JSONB), attributes (JSONB), status (`ACTIVE`/`ARCHIVED`), quality_seal (`DRAFT`/`APPROVED`/`REJECTED`/`BROKEN`), completion (float 0-100) |
| `relations` | `Relation` | Links between fact sheets. Type (matches relation_type key), source_id, target_id, attributes (JSONB), description |

### Supporting Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `subscriptions` | `Subscription` | User roles on fact sheets: responsible, observer, technical_application_owner, business_application_owner |
| `tag_groups` | `TagGroup` | Tag categories with mode (single/multi), create_mode (open/restricted), restrict_to_types |
| `tags` | `Tag` | Individual tags within groups, with optional color |
| `fact_sheet_tags` | `FactSheetTag` | M:N join table (composite PK) |
| `comments` | `Comment` | Threaded comments on fact sheets (self-referential parent_id) |
| `todos` | `Todo` | Tasks linked to fact sheets, assignable to users, with due dates |
| `documents` | `Document` | URL/link attachments on fact sheets |
| `bookmarks` | `Bookmark` | Saved inventory filter/column/sort views per user |
| `events` | `Event` | Audit trail: event_type + JSONB data, linked to fact_sheet and user |
| `diagrams` | `Diagram` | DrawIO diagram storage: name, type, data (JSONB with XML + thumbnail) |
| `diagram_initiatives` | (association table) | M:N between diagrams and initiative fact sheets |
| `statement_of_architecture_works` | `SoAW` | TOGAF SoAW documents linked to initiatives, with JSONB sections |
| `app_settings` | `AppSettings` | Singleton row (id='default'): email_settings (JSONB), general_settings (JSONB with currency), custom_logo (LargeBinary), custom_logo_mime |
| `surveys` | `Survey` | Admin-created data-maintenance surveys targeting fact sheet types with filters and field actions |
| `survey_responses` | `SurveyResponse` | Individual response records (one per fact sheet + user pair per survey) |
| `notifications` | `Notification` | Per-user notifications with types: todo_assigned, fact_sheet_updated, comment_added, quality_seal_changed, soaw_sign_requested, soaw_signed, subscription_update |
| `web_portals` | `WebPortal` | Public web portals: configurable views of fact sheets with slug-based URLs, display fields, card config |

### Migrations

Located in `backend/alembic/versions/`. The app auto-runs Alembic on startup:
- Fresh DB: `create_all` + stamp head
- Existing DB without Alembic: stamp head
- Normal: `upgrade head` (run pending migrations)
- `RESET_DB=true`: drop all + recreate + stamp head

---

## API Reference

Base path: `/api/v1`. All endpoints except auth require `Authorization: Bearer <token>`.

### Authentication (`/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | No | Register (first user gets admin). Body: `{email, display_name, password}` |
| POST | `/auth/login` | No | Login. Body: `{email, password}`. Returns `{access_token}` |
| GET | `/auth/me` | Yes | Current user info |

### Metamodel (`/metamodel`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/metamodel/types` | List types. `?include_hidden=true` to show soft-deleted |
| GET | `/metamodel/types/{key}` | Get single type |
| POST | `/metamodel/types` | Create custom type |
| PATCH | `/metamodel/types/{key}` | Update type (label, icon, color, fields_schema, subtypes, etc.) |
| DELETE | `/metamodel/types/{key}` | Soft-delete built-in (is_hidden=true), hard-delete custom (if no instances) |
| GET | `/metamodel/relation-types` | List relation types. `?type_key=X` filters by connected type |
| GET | `/metamodel/relation-types/{key}` | Get single relation type |
| POST | `/metamodel/relation-types` | Create relation type (validates source/target types exist) |
| PATCH | `/metamodel/relation-types/{key}` | Update relation type |
| DELETE | `/metamodel/relation-types/{key}` | Soft-delete built-in, hard-delete custom |

### Fact Sheets (`/fact-sheets`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/fact-sheets` | Paginated list. Query: `type`, `status`, `search`, `parent_id`, `quality_seal`, `page`, `page_size`, `sort_by`, `sort_dir` |
| POST | `/fact-sheets` | Create fact sheet. Auto-computes completion score, syncs capability levels |
| GET | `/fact-sheets/{id}` | Get single fact sheet with tags + subscriptions |
| PATCH | `/fact-sheets/{id}` | Update. Breaks quality seal on substantive changes, recalculates completion |
| DELETE | `/fact-sheets/{id}` | Archives (soft-delete: sets status=ARCHIVED) |
| PATCH | `/fact-sheets/bulk` | Bulk update multiple fact sheets |
| GET | `/fact-sheets/{id}/hierarchy` | Ancestors (root-first), children, computed level |
| GET | `/fact-sheets/{id}/history` | Paginated event history |
| POST | `/fact-sheets/{id}/quality-seal?action=approve|reject|reset` | Manage quality seal |
| GET | `/fact-sheets/export/csv` | Export as CSV. `?type=X` to filter |
| POST | `/fact-sheets/fix-hierarchy-names` | One-time cleanup for hierarchy prefix bug |

### Relations (`/relations`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/relations` | List. `?fact_sheet_id=X` and/or `?type=X` |
| POST | `/relations` | Create relation |
| PATCH | `/relations/{id}` | Update relation attributes |
| DELETE | `/relations/{id}` | Delete relation |

### Reports (`/reports`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/reports/dashboard` | KPIs: counts by type, avg completion, quality seals, recent events |
| GET | `/reports/landscape` | Fact sheets grouped by a related type |
| GET | `/reports/portfolio` | Bubble chart data: configurable X/Y/size/color axes |
| GET | `/reports/matrix` | Cross-reference grid between two types |
| GET | `/reports/roadmap` | Lifecycle timeline data |
| GET | `/reports/cost` | Cost aggregation (simple bar) |
| GET | `/reports/cost-treemap` | Treemap with optional grouping by related type |
| GET | `/reports/capability-heatmap` | Business capability hierarchy with app counts, costs, risks |
| GET | `/reports/dependencies` | Network graph: nodes + edges with BFS depth limiting |
| GET | `/reports/data-quality` | Completeness dashboard: by-type stats, orphaned/stale counts, worst items |

### Diagrams (`/diagrams`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/diagrams` | List. `?initiative_id=X` to filter |
| POST | `/diagrams` | Create with optional initiative_ids |
| GET | `/diagrams/{id}` | Get with full data + extracted fact_sheet_refs |
| PATCH | `/diagrams/{id}` | Update (auto-extracts fact sheet refs from XML) |
| DELETE | `/diagrams/{id}` | Delete diagram |

### Statement of Architecture Work (`/soaw`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/soaw` | List. `?initiative_id=X` to filter |
| POST | `/soaw` | Create SoAW |
| GET | `/soaw/{id}` | Get SoAW |
| PATCH | `/soaw/{id}` | Update sections, status, document_info |
| DELETE | `/soaw/{id}` | Delete SoAW |

### Surveys (`/surveys`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/surveys` | List surveys (admin) |
| POST | `/surveys` | Create survey (admin) |
| GET | `/surveys/my` | Get surveys assigned to current user |
| GET | `/surveys/{id}` | Get survey detail |
| PATCH | `/surveys/{id}` | Update survey (admin) |
| DELETE | `/surveys/{id}` | Delete survey (admin) |
| POST | `/surveys/{id}/preview` | Preview survey targets |
| POST | `/surveys/{id}/send` | Send survey to targets (admin) |
| POST | `/surveys/{id}/close` | Close survey (admin) |
| GET | `/surveys/{id}/responses` | List survey responses |
| POST | `/surveys/{id}/apply` | Apply selected responses to fact sheets (bulk update) |
| GET | `/surveys/{id}/respond/{fs_id}` | Get survey response form for a fact sheet |
| POST | `/surveys/{id}/respond/{fs_id}` | Submit survey response |

### End-of-Life (`/eol`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/eol/products` | List all products from endoflife.date |
| GET | `/eol/products/fuzzy` | Fuzzy search products (auto-complete) |
| GET | `/eol/products/{product}` | Get release cycles for a product |
| POST | `/eol/mass-search` | Mass search EOL candidates for multiple fact sheets |
| POST | `/eol/mass-link` | Link fact sheets to EOL products/cycles |

### Web Portals (`/web-portals`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/web-portals` | List portals (admin) |
| POST | `/web-portals` | Create portal (admin) |
| GET | `/web-portals/{id}` | Get portal detail (admin) |
| PATCH | `/web-portals/{id}` | Update portal (admin) |
| DELETE | `/web-portals/{id}` | Delete portal (admin) |
| GET | `/web-portals/public/{slug}` | Get portal for public viewing (no auth) |
| GET | `/web-portals/public/{slug}/relation-options` | Available relations for portal filtering (no auth) |
| GET | `/web-portals/public/{slug}/fact-sheets` | Get fact sheets for portal with filters (no auth) |

### Notifications (`/notifications`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/notifications` | List notifications for current user |
| GET | `/notifications/unread-count` | Get count of unread notifications |
| GET | `/notifications/badge-counts` | Get badge counts (open todos + pending surveys) |
| PATCH | `/notifications/{id}/read` | Mark notification as read |
| POST | `/notifications/mark-all-read` | Mark all notifications as read |

### Settings (`/settings`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/settings/email` | Admin | Get SMTP configuration |
| PATCH | `/settings/email` | Admin | Update SMTP configuration |
| POST | `/settings/email/test` | Admin | Send test email |
| GET | `/settings/currency` | Public | Get global display currency |
| PATCH | `/settings/currency` | Admin | Update currency |
| GET | `/settings/logo` | Public | Get current logo image (custom or default) |
| GET | `/settings/favicon` | Public | Get favicon image |
| GET | `/settings/logo/info` | Admin | Get logo metadata (has_custom_logo, mime_type) |
| POST | `/settings/logo` | Admin | Upload custom logo (max 2 MB; PNG, JPEG, SVG, WebP, GIF) |
| DELETE | `/settings/logo` | Admin | Reset to default logo |

### Other Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tag-groups` | List tag groups with their tags |
| POST | `/tag-groups` | Create tag group |
| POST | `/tag-groups/{id}/tags` | Create tag in group |
| POST | `/fact-sheets/{id}/tags` | Assign tags (body: `[tag_id, ...]`) |
| DELETE | `/fact-sheets/{id}/tags/{tag_id}` | Remove tag |
| GET | `/fact-sheets/{id}/subscriptions` | List subscriptions |
| POST | `/fact-sheets/{id}/subscriptions` | Create subscription (validates role + type) |
| PATCH | `/subscriptions/{id}` | Update subscription role |
| DELETE | `/subscriptions/{id}` | Delete subscription |
| GET | `/subscription-roles` | List role definitions for UI |
| GET | `/fact-sheets/{id}/comments` | List threaded comments |
| POST | `/fact-sheets/{id}/comments` | Create comment |
| PATCH | `/comments/{id}` | Edit comment |
| DELETE | `/comments/{id}` | Delete comment |
| GET | `/todos` | List all todos. `?status=X`, `?assigned_to=X` |
| GET | `/fact-sheets/{id}/todos` | Fact sheet todos |
| POST | `/fact-sheets/{id}/todos` | Create todo |
| PATCH | `/todos/{id}` | Update todo |
| DELETE | `/todos/{id}` | Delete todo |
| GET | `/fact-sheets/{id}/documents` | List documents |
| POST | `/fact-sheets/{id}/documents` | Add document link |
| DELETE | `/documents/{id}` | Delete document |
| GET | `/bookmarks` | List user's saved views |
| POST | `/bookmarks` | Create bookmark |
| PATCH | `/bookmarks/{id}` | Update bookmark |
| DELETE | `/bookmarks/{id}` | Delete bookmark |
| GET | `/users` | List users (auth required) |
| GET | `/users/{id}` | Get user |
| POST | `/users` | Create user (admin only) |
| PATCH | `/users/{id}` | Update user (admin: all fields; self: display_name + password) |
| DELETE | `/users/{id}` | Soft-delete (deactivate) user (admin only, cannot delete self) |
| GET | `/events` | List events. `?fact_sheet_id=X` |
| GET | `/events/stream` | SSE endpoint for real-time event streaming |
| GET | `/api/health` | Health check (no auth) |

**API docs**: Available at `/api/docs` (Swagger UI) and `/api/openapi.json`.

---

## Frontend Architecture

### Tech Stack
- **React 18** with TypeScript
- **MUI 6** (Material UI) for component library
- **React Router 7** for client-side routing
- **AG Grid** for data tables (inventory page)
- **Recharts** for charts (portfolio, cost, lifecycle reports)
- **TipTap** for rich text editing (SoAW sections)
- **docx** + **file-saver** for DOCX export (SoAW)
- **xlsx** for Excel import/export (inventory)
- **Vite** for build tooling with `@` path alias to `./src`

### Routing (`App.tsx`)

| Path | Component | Description |
|------|-----------|-------------|
| `/` | `Dashboard` | KPI cards, type breakdown, recent activity |
| `/inventory` | `InventoryPage` | AG Grid table with type filter, search, column customization, Excel import/export |
| `/fact-sheets/:id` | `FactSheetDetail` | Full detail view: fields, lifecycle, hierarchy, relations, subscriptions, comments, todos, documents, history |
| `/reports/portfolio` | `PortfolioReport` | Bubble/scatter chart (TIME model) |
| `/reports/capability-map` | `CapabilityMapReport` | Heatmap of business capabilities |
| `/reports/lifecycle` | `LifecycleReport` | Timeline visualization |
| `/reports/dependencies` | `DependencyReport` | Network graph |
| `/reports/cost` | `CostReport` | Treemap + bar chart |
| `/reports/matrix` | `MatrixReport` | Cross-reference grid |
| `/reports/data-quality` | `DataQualityReport` | Completeness dashboard |
| `/reports/eol` | `EolReport` | End-of-Life status report for IT components |
| `/diagrams` | `DiagramsPage` | Diagram gallery with thumbnails |
| `/diagrams/:id` | `DiagramEditor` | DrawIO iframe editor with fact sheet sidebar |
| `/ea-delivery` | `EADeliveryPage` | SoAW document list |
| `/ea-delivery/soaw/new` | `SoAWEditor` | Create new SoAW |
| `/ea-delivery/soaw/:id` | `SoAWEditor` | Edit SoAW |
| `/ea-delivery/soaw/:id/preview` | `SoAWPreview` | Read-only SoAW preview |
| `/todos` | `TodosPage` | Global todo list |
| `/surveys` | `MySurveys` | List surveys assigned to current user |
| `/surveys/:surveyId/respond/:factSheetId` | `SurveyRespond` | Respond to a survey for a specific fact sheet |
| `/portal/:slug` | `PortalViewer` | Public portal view (no auth required) |
| `/admin/metamodel` | `MetamodelAdmin` | Manage fact sheet types + relation types |
| `/admin/tags` | `TagsAdmin` | Manage tag groups + tags |
| `/admin/users` | `UsersAdmin` | Manage users (admin only) |
| `/admin/settings` | `SettingsAdmin` | Logo, currency, SMTP email, logo visibility toggle |
| `/admin/eol` | `EolAdmin` | Mass search + link IT components to EOL products |
| `/admin/surveys` | `SurveysAdmin` | Admin survey list |
| `/admin/surveys/new` | `SurveyBuilder` | Create new data-maintenance survey |
| `/admin/surveys/:id` | `SurveyBuilder` | Edit survey |
| `/admin/surveys/:id/results` | `SurveyResults` | View survey responses, apply bulk changes |
| `/admin/web-portals` | `WebPortalsAdmin` | Create and manage public web portals |

### Key Patterns

**API Client** (`src/api/client.ts`): Thin fetch wrapper that auto-injects the JWT from localStorage. Methods: `api.get()`, `api.post()`, `api.patch()`, `api.delete()`. Handles 204 empty responses and formats validation errors.

**Authentication** (`hooks/useAuth.ts`): Token stored in `localStorage.token`. On load, validates via `GET /auth/me`. If invalid, clears token. No user = login page shown.

**Metamodel Cache** (`hooks/useMetamodel.ts`): Module-level singleton cache. Fetches types + relation types once, shared across all components. `invalidateCache()` forces re-fetch.

**Real-time Updates** (`hooks/useEventStream.ts`): SSE connection to `/events/stream`. Components use this to refresh on external changes.

**Completion Scoring**: Backend auto-computes `completion` (0-100%) based on `fields_schema` weights. Description and lifecycle each contribute weight 1. Quality seal auto-breaks to `BROKEN` when approved items are edited.

**Currency** (`hooks/useCurrency.ts`): Module-level singleton cache. Fetches currency from `/settings/currency` once. Provides `fmt()` (full format), `fmtShort()` (compact), and `symbol` for consistent cost display.

**Notifications**: `NotificationBell` component in the navbar shows unread count. Badge counts (open todos + pending surveys) refresh on SSE events and navigation. Backend `notification_service.py` handles persistence and mark-as-read.

**Logo Visibility**: Per-portal toggle stored in `card_config.show_logo` (default: true). When disabled, the logo is hidden from the portal header. Navbar logo height is 45px.

**Hierarchy**: Fact sheets with `has_hierarchy=true` support parent-child trees (parent_id). BusinessCapability enforces max depth of 5 levels with auto-computed `capabilityLevel` attribute.

---

## Metamodel (Default LeanIX Seed)

The default metamodel seeds 13 fact sheet types across 4 layers and 29 relation types. It is created on first startup by `backend/app/services/seed.py`.

### Fact Sheet Types

| Key | Label | Icon | Color | Layer | Hierarchy | Subtypes |
|-----|-------|------|-------|-------|-----------|----------|
| `Objective` | Objective | flag | #c7527d | Strategy & Transformation | No | - |
| `Platform` | Platform | layers | #027446 | Strategy & Transformation | No | Digital, Technical |
| `Initiative` | Initiative | rocket_launch | #33cc58 | Strategy & Transformation | Yes | Idea, Program, Project, Epic |
| `Organization` | Organization | corporate_fare | #2889ff | Business Architecture | Yes | Business Unit, Region, Legal Entity, Team, Customer |
| `BusinessCapability` | Business Capability | account_tree | #003399 | Business Architecture | Yes | - |
| `BusinessContext` | Business Context | swap_horiz | #fe6690 | Business Architecture | Yes | Process, Value Stream, Customer Journey, Business Product, ESG Capability |
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
    "fields": [
      {
        "key": "fieldKey",
        "label": "Display Label",
        "type": "text|number|boolean|date|single_select|multiple_select",
        "options": [{"key": "k", "label": "L", "color": "#hex"}],
        "required": false,
        "weight": 1,
        "readonly": false
      }
    ]
  }
]
```

### Relation Types

29 built-in relations (all `n:m` cardinality). Created by `seed.py`. Some have `attributes_schema` for additional per-relation data.

| Key | Source | Label | Target | Reverse Label | Attributes |
|-----|--------|-------|--------|---------------|------------|
| `relObjectiveToBC` | Objective | improves | BusinessCapability | is improved by | - |
| `relPlatformToObjective` | Platform | supports | Objective | is supported by | - |
| `relPlatformToApp` | Platform | runs | Application | runs on | - |
| `relPlatformToITC` | Platform | implements | ITComponent | is implemented by | - |
| `relInitiativeToObjective` | Initiative | supports | Objective | is supported by | - |
| `relInitiativeToPlatform` | Initiative | affects | Platform | is affected by | - |
| `relInitiativeToBC` | Initiative | improves | BusinessCapability | is improved by | - |
| `relInitiativeToApp` | Initiative | affects | Application | is affected by | - |
| `relInitiativeToInterface` | Initiative | affects | Interface | is affected by | - |
| `relInitiativeToDataObj` | Initiative | affects | DataObject | is affected by | - |
| `relInitiativeToITC` | Initiative | affects | ITComponent | is affected by | - |
| `relInitiativeToSystem` | Initiative | affects | System | is affected by | - |
| `relOrgToObjective` | Organization | owns | Objective | is owned by | - |
| `relOrgToInitiative` | Organization | owns | Initiative | is owned by | - |
| `relOrgToBizCtx` | Organization | owns | BusinessContext | is owned by | - |
| `relOrgToApp` | Organization | uses | Application | is used by | usageType (Owner/User/Stakeholder) |
| `relOrgToITC` | Organization | owns | ITComponent | is owned by | - |
| `relAppToBC` | Application | supports | BusinessCapability | is supported by | functionalSuitability, supportType |
| `relAppToBizCtx` | Application | supports | BusinessContext | is supported by | - |
| `relAppToInterface` | Application | provides / consumes | Interface | is provided / consumed by | - |
| `relAppToDataObj` | Application | CRUD | DataObject | is used by | crudCreate, crudRead, crudUpdate, crudDelete (booleans) |
| `relAppToITC` | Application | uses | ITComponent | is used by | technicalSuitability, costTotalAnnual |
| `relAppToSystem` | Application | runs on | System | runs | - |
| `relITCToTechCat` | ITComponent | belongs to | TechCategory | includes | resourceClassification |
| `relITCToPlatform` | ITComponent | implements | Platform | is implemented by | - |
| `relInterfaceToDataObj` | Interface | transfers | DataObject | is transferred by | - |
| `relInterfaceToITC` | Interface | uses | ITComponent | is used by | - |
| `relProviderToInitiative` | Provider | supports | Initiative | is supported by | - |
| `relProviderToITC` | Provider | offers | ITComponent | is offered by | - |
| `relBizCtxToBC` | BusinessContext | is associated with | BusinessCapability | is associated with | - |

---

## DrawIO Integration

### How It Works

1. **Build time**: The frontend Dockerfile clones `jgraph/drawio` v26.0.9 and copies the static webapp to `/usr/share/nginx/drawio/`
2. **Runtime**: Nginx serves DrawIO at `/drawio/` (same origin as the app)
3. **Editor**: `DiagramEditor.tsx` loads DrawIO in a same-origin iframe
4. **Communication**: Direct DOM access to the iframe's `mxGraph` API (not postMessage). The graph reference is stored on `iframe.contentWindow.__turboGraph`

### Shape System (`src/features/diagrams/drawio-shapes.ts`)

Fact sheets are represented as mxGraph cells with custom XML user objects:
```xml
<object label="App Name" factSheetId="uuid" factSheetType="Application" />
```

Key functions:
- `insertFactSheetIntoGraph()` — Add a fact sheet shape (colored rounded rectangle)
- `insertPendingFactSheet()` — Add unsynced shape (dashed border)
- `markCellSynced()` — Switch from dashed to solid after backend creation
- `expandFactSheetGroup()` / `collapseFactSheetGroup()` — Expand/collapse related fact sheets
- `scanDiagramItems()` — Extract pending + synced items from the graph
- `stampEdgeAsRelation()` — Style an edge as a typed relation
- `extractFactSheetIds()` — Parse XML for factSheetId attributes

### DrawIO Config

- `PreConfig.js` — Placeholder (loaded before app.min.js)
- `PostConfig.js` — Placeholder (all logic via parent-window iframe access)
- PWA manifest and service worker are stripped from DrawIO's index.html at build time
- `<!--email_off-->` injected to prevent Cloudflare Email Obfuscation breaking DrawIO

---

## Statement of Architecture Work (SoAW)

TOGAF-compliant document generation linked to Initiative fact sheets.

### Data Model
Stored in the `statement_of_architecture_works` table with JSONB columns:
- `document_info`: `{prepared_by, reviewed_by, review_date}`
- `version_history`: `[{version, date, revised_by, description}]`
- `sections`: `{section_key: {content: "html", hidden: bool, table_data?, togaf_data?}}`

### Frontend
- `SoAWEditor.tsx` — TipTap rich text editor per section, editable tables
- `SoAWPreview.tsx` — Read-only formatted preview
- `soawTemplate.ts` — Template with all TOGAF sections
- `soawExport.ts` — DOCX export using the `docx` library

---

## Surveys (Data-Maintenance Workflows)

Admin-driven surveys for maintaining fact sheet data quality at scale.

### Workflow
1. **Admin creates** a survey targeting a fact sheet type, with optional tag/relation/attribute filters
2. **Admin defines actions** per field: "maintain" (user edits the value) or "confirm" (user verifies current value)
3. **Admin sends** the survey — targets are determined by fact sheet subscriptions (responsible, observer, etc.)
4. **Users receive** notifications and respond via `/surveys/:surveyId/respond/:factSheetId`
5. **Admin reviews** responses in `/admin/surveys/:id/results` and applies changes in bulk

### Data Model
- `surveys` table: title, description, target_type (fact sheet type key), filters (JSONB), actions (JSONB array), status (draft/sent/closed)
- `survey_responses` table: survey_id, fact_sheet_id, user_id, responses (JSONB), submitted_at

---

## End-of-Life (EOL) Management

Integration with the [endoflife.date](https://endoflife.date) API for tracking technology lifecycle status.

### Features
- **Fuzzy product search**: Auto-complete against 300+ products from endoflife.date
- **Mass search**: Automatically match IT Component names against EOL products
- **Mass link**: Bulk-link fact sheets to specific products and release cycles
- **EOL Report** (`/reports/eol`): Visualize EOL risk across the IT landscape
- **Admin page** (`/admin/eol`): Manage EOL product links

### How It Works
The backend proxies requests to `https://endoflife.date/api/` and caches responses. EOL data is stored on fact sheets as attributes (linked product, cycle, EOL date, support status).

---

## Web Portals (Public Views)

Configurable, public-facing views of the EA landscape accessible without authentication.

### Features
- **Slug-based URLs**: Access via `/portal/:slug` (no login required)
- **Configurable**: Choose which fact sheet type to display, which fields to show, card layout
- **Logo toggle**: Per-portal option to show or hide the application logo in the portal header
- **Relation filtering**: Visitors can filter by related fact sheets
- **Admin management**: Create, edit, delete portals via `/admin/web-portals`

### Data Model
- `web_portals` table: name, slug (unique), fact_sheet_type, display_fields (JSONB), card_config (JSONB with toggles + show_logo), filters (JSONB), is_published

---

## Notification System

In-app and email notifications for users.

### Notification Types
`todo_assigned`, `fact_sheet_updated`, `comment_added`, `quality_seal_changed`, `soaw_sign_requested`, `soaw_signed`, `subscription_update`

### Components
- **Backend**: `notification_service.py` creates notifications on relevant events, persists to DB
- **Email**: `email_service.py` sends SMTP emails when configured (admin settings)
- **Frontend**: `NotificationBell` in navbar shows unread count, `NotificationPreferencesDialog` for per-type preferences
- **Badge counts**: Open todos + pending surveys shown as dots on nav items

---

## Application Settings

Singleton `app_settings` table (id='default') manages global configuration:

| Setting | Storage | Description |
|---------|---------|-------------|
| SMTP/Email | `email_settings` (JSONB) | Host, port, user, password, TLS, from address, app base URL |
| Currency | `general_settings.currency` | Display currency for all cost values (default: USD) |
| Custom logo | `custom_logo` (LargeBinary) | Custom logo image bytes (max 2 MB) |
| Logo MIME | `custom_logo_mime` (Text) | MIME type of custom logo |

---

## Event System

### Backend (`services/event_bus.py`)
In-memory pub/sub using `asyncio.Queue`. Events are:
1. Persisted to the `events` table (audit trail)
2. Broadcast to all SSE subscribers in real-time

Event types: `fact_sheet.created`, `fact_sheet.updated`, `fact_sheet.archived`, `fact_sheet.quality_seal.*`, `relation.created`, `relation.deleted`, `comment.created`, `notification.created`, `todo.created`, `todo.updated`, `todo.deleted`, `survey.sent`, `survey.responded`

### Frontend (`hooks/useEventStream.ts`)
`EventSource` connection to `/api/v1/events/stream`. Auto-reconnects on error.

---

## Authentication & Authorization

### JWT Implementation
- Manually constructed HS256 JWT (no PyJWT dependency) in `core/security.py`
- Payload: `{sub: user_id, role: admin|member|viewer, iat, exp}`
- Passwords hashed with bcrypt
- Token sent as `Authorization: Bearer <token>`

### Roles
| Role | Capabilities |
|------|-------------|
| `admin` | Full CRUD on everything including users, metamodel, user management |
| `member` | CRUD on fact sheets, relations, comments, todos, diagrams, SoAW |
| `viewer` | Read-only access (enforced on specific endpoints) |

### Subscription Roles (per fact sheet)
- `responsible` — Primary owner (all types)
- `observer` — Watching for changes (all types)
- `technical_application_owner` — Application type only
- `business_application_owner` — Application type only

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
Set `RESET_DB=true` to drop all tables and re-seed on next startup. This is useful during metamodel development.

### Key Libraries

**Backend:**
- FastAPI 0.115+ with Pydantic 2.10+
- SQLAlchemy 2.0+ (async via asyncpg)
- Alembic for migrations
- bcrypt for password hashing
- sse-starlette for Server-Sent Events
- ruff for linting (target: Python 3.12)

**Frontend:**
- React 18 + TypeScript 5.6
- MUI 6 + Emotion for styling
- AG Grid for data tables
- Recharts for visualizations
- TipTap for rich text editing
- docx + file-saver for DOCX generation
- xlsx for Excel import/export

---

## Docker Architecture

### docker-compose.yml
Two services on the `guac-net` external network:
- **backend**: Python 3.12-alpine, uvicorn on port 8000
- **frontend**: Multi-stage build (node → drawio git clone → nginx), port 80 mapped to `HOST_PORT`

PostgreSQL is external (not managed by this compose file).

### Frontend Dockerfile (multi-stage)
1. **build stage**: `node:20-alpine` — npm install + vite build
2. **drawio stage**: `alpine/git` — clone jgraph/drawio v26.0.9
3. **production stage**: `nginx:alpine` — serve built frontend + DrawIO + custom configs

### Nginx Configuration
- `/api/*` → proxy to `backend:8000` (with SSE support headers)
- `/drawio/index.html` → `no-store, no-transform` (prevents Cloudflare issues)
- `/drawio/*` → static DrawIO assets (30-day cache, no-transform)
- `/*` → SPA fallback to `index.html`
- Static assets (js, css, images) → 1-year cache with `immutable`

---

## Roadmap

See `plan.md` for the full implementation plan covering:
1. **Metamodel Overhaul** — Full admin CRUD for types, fields, subtypes, and relations. Metamodel graph visualization.
2. **Reports Redesign** — 7 interactive reports (Portfolio, Capability Map, Lifecycle, Dependencies, Cost Treemap, Matrix, Data Quality) with Recharts, configurable axes, chart/table toggle, and export.
