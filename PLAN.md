# Turbo EA — LeanIX Clone

## Overview

Turbo EA is a self-hosted Enterprise Architecture Management (EAM) platform — a faithful clone of SAP LeanIX. It provides a configurable metamodel, fact sheet management with rich detail pages, an inventory view with AG Grid, visual reports, diagrams, collaboration features, and data quality governance.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + TypeScript + Vite + MUI 5 |
| **Data Grid** | AG Grid Community |
| **Backend** | Python 3.12 + FastAPI |
| **Database** | PostgreSQL 16+ |
| **Real-time** | SSE (Server-Sent Events) via internal async event bus |
| **Icons** | Material Symbols Outlined |
| **Containers** | Docker Alpine |
| **Reverse Proxy** | Nginx Alpine |
| **Deployment** | Docker Compose on Unraid |

---

## LeanIX Feature Mapping

### Metamodel (12 Fact Sheet Types)

**Business Architecture:**
| Type | Key Fields | Hierarchy |
|------|-----------|-----------|
| Business Capability | name, description, lifecycle | Parent/Child (L1→L2→L3) |
| Business Context | name, description, lifecycle | Parent/Child |
| Organization | name, description | Parent/Child |

**Application Architecture:**
| Type | Key Fields | Hierarchy |
|------|-----------|-----------|
| Application | businessCriticality, functionalFit, technicalFit, hostingType, alias, totalAnnualCost | Parent/Child |
| Interface | frequency, dataDirection, technicalFit | Flat |
| Data Object | dataSensitivity, isPersonalData | Parent/Child |

**Technology Architecture:**
| Type | Key Fields | Hierarchy |
|------|-----------|-----------|
| IT Component | technicalFit, totalAnnualCost | Parent/Child |
| Tech Category | name, description | Parent/Child |
| Provider | website, headquarters | Flat |

**Transformation Architecture:**
| Type | Key Fields | Hierarchy |
|------|-----------|-----------|
| Platform | name, description, lifecycle | Flat |
| Objective | category, kpiDescription | Flat |
| Initiative | budget, status, startDate, endDate | Parent/Child |

### Common Fact Sheet Properties
- Name, Description (all types)
- Lifecycle: plan → phaseIn → active → phaseOut → endOfLife (each with date)
- Tags (multi-select from tag groups)
- Subscriptions: Responsible, Accountable, Observer (user assignments)
- Quality Seal: Approved / Broken (governance workflow)
- Completion Score: auto-calculated % based on filled fields + relations
- External ID, Alias
- Documents/Resources (links)
- Comments (threaded)
- To-Dos (assigned tasks)
- Full audit history

### Enum Values

**Business Criticality:** Mission Critical, Business Critical, Business Operational, Administrative

**Functional Fit:** Perfect, Appropriate, Insufficient, Unreasonable

**Technical Fit:** Fully Appropriate, Adequate, Unreasonable, Inappropriate

**Hosting Type:** On-Premise, Cloud SaaS, Cloud PaaS, Cloud IaaS, Hybrid

**Resource Classification** (IT Component ↔ Tech Category relation): Approved, Conditional, Investigating, Retiring, Unapproved

**Data Sensitivity:** Public, Internal, Confidential, Restricted

**Initiative Status:** Proposed, Approved, In Progress, Completed, Cancelled

### Standard Relations (20 types)

| # | Source → Target | Relation Key | Relation Attributes |
|---|----------------|-------------|-------------------|
| 1 | Application → Business Capability | relAppToBC | — |
| 2 | Application → Organization | relAppToOrg | usageType (user/owner) |
| 3 | Application → IT Component | relAppToITC | totalAnnualCost |
| 4 | Application → Interface | relAppToInterface | direction (provider/consumer) |
| 5 | Application → Data Object | relAppToDataObj | crudFlags (C/R/U/D) |
| 6 | Application → Provider | relAppToProvider | — |
| 7 | Application → Platform | relAppToPlatform | — |
| 8 | Application → Application | relAppToApp | description |
| 9 | Interface → Data Object | relInterfaceToDataObj | — |
| 10 | IT Component → Tech Category | relITCToTechCat | resourceClassification |
| 11 | IT Component → Provider | relITCToProvider | — |
| 12 | Objective → Business Capability | relObjToBC | — |
| 13 | Objective → Initiative | relObjToInitiative | — |
| 14 | Initiative → Application | relInitToApp | — |
| 15 | Initiative → IT Component | relInitToITC | — |
| 16 | Platform → Application | relPlatformToApp | — |
| 17 | Platform → IT Component | relPlatformToITC | — |
| 18 | Organization → Application | relOrgToApp | — |
| 19 | Business Context → Business Capability | relBCxToBC | — |
| 20 | Business Context → Application | relBCxToApp | — |

Plus parent/child (hierarchy) relations within: Business Capability, Business Context, Organization, Application, Data Object, IT Component, Tech Category, Initiative.

---

## Navigation Structure (LeanIX-like)

```
┌─────────────────────────────────────────────────────┐
│  [Logo] Turbo EA          [Search] [+ Create] [User]│
├──────────┬──────────────────────────────────────────┤
│ Dashboard│                                          │
│ Inventory│           Main Content Area              │
│ Reports ▸│                                          │
│  ├ Landscape                                        │
│  ├ Portfolio                                        │
│  ├ Matrix                                           │
│  ├ Roadmap                                          │
│  └ Cost                                             │
│ Diagrams │                                          │
│ Todos    │                                          │
│──────────│                                          │
│ Admin   ▸│                                          │
│  ├ Metamodel                                        │
│  ├ Tags                                             │
│  └ Users                                            │
└──────────┴──────────────────────────────────────────┘
```

---

## Database Schema

### Core Tables

```sql
-- Configurable metamodel
fact_sheet_types (
  id UUID PK,
  key VARCHAR(100) UNIQUE,     -- e.g. "Application"
  label VARCHAR(200),
  description TEXT,
  icon VARCHAR(100),
  color VARCHAR(20),
  category VARCHAR(50),        -- business/application/technology/transformation
  has_hierarchy BOOLEAN,
  fields_schema JSONB,         -- [{section, subsection, fields: [{key, label, type, options, required}]}]
  built_in BOOLEAN DEFAULT true,
  sort_order INT,
  created_at, updated_at
)

relation_types (
  id UUID PK,
  key VARCHAR(100) UNIQUE,
  label VARCHAR(200),
  source_type_key VARCHAR(100) FK,
  target_type_key VARCHAR(100) FK,
  attributes_schema JSONB,     -- [{key, label, type, options}]
  built_in BOOLEAN DEFAULT true,
  created_at, updated_at
)

-- Fact sheets (single polymorphic table)
fact_sheets (
  id UUID PK,
  type VARCHAR(100) FK → fact_sheet_types.key,
  name VARCHAR(500) NOT NULL,
  description TEXT,
  parent_id UUID FK → fact_sheets.id,  -- hierarchy
  lifecycle JSONB,             -- {plan, phaseIn, active, phaseOut, endOfLife}
  attributes JSONB,            -- type-specific fields
  status VARCHAR(20) DEFAULT 'ACTIVE',
  quality_seal VARCHAR(20) DEFAULT 'UNSET',  -- UNSET/APPROVED/BROKEN
  completion FLOAT DEFAULT 0,
  external_id VARCHAR(500),
  alias VARCHAR(500),
  created_by UUID FK, updated_by UUID FK,
  created_at, updated_at
)

-- Relations between fact sheets
relations (
  id UUID PK,
  type VARCHAR(100) FK → relation_types.key,
  source_id UUID FK → fact_sheets.id,
  target_id UUID FK → fact_sheets.id,
  attributes JSONB,
  description TEXT,
  created_at, updated_at
)

-- Subscriptions (data ownership)
subscriptions (
  id UUID PK,
  fact_sheet_id UUID FK,
  user_id UUID FK,
  role VARCHAR(20),            -- responsible/accountable/observer
  created_at
)

-- Tag system
tag_groups (
  id UUID PK,
  name VARCHAR(200),
  description TEXT,
  mode VARCHAR(20),            -- single/multi
  mandatory BOOLEAN DEFAULT false,
  created_at
)

tags (
  id UUID PK,
  tag_group_id UUID FK,
  name VARCHAR(200),
  color VARCHAR(20),
  sort_order INT
)

fact_sheet_tags (
  fact_sheet_id UUID FK,
  tag_id UUID FK,
  PRIMARY KEY (fact_sheet_id, tag_id)
)

-- Comments
comments (
  id UUID PK,
  fact_sheet_id UUID FK,
  user_id UUID FK,
  content TEXT,
  parent_id UUID FK → comments.id,  -- threading
  created_at, updated_at
)

-- Todos
todos (
  id UUID PK,
  fact_sheet_id UUID FK,
  description TEXT,
  status VARCHAR(20),          -- open/done
  assigned_to UUID FK,
  created_by UUID FK,
  due_date DATE,
  created_at, updated_at
)

-- Audit events
events (
  id UUID PK,
  fact_sheet_id UUID FK,
  user_id UUID FK,
  event_type VARCHAR(100),
  data JSONB,
  created_at
)

-- Documents/Resources
documents (
  id UUID PK,
  fact_sheet_id UUID FK,
  name VARCHAR(500),
  url TEXT,
  type VARCHAR(50),            -- link/document
  created_by UUID FK,
  created_at
)

-- Saved views / bookmarks
bookmarks (
  id UUID PK,
  user_id UUID FK,
  name VARCHAR(200),
  fact_sheet_type VARCHAR(100),
  filters JSONB,
  columns JSONB,
  sort JSONB,
  is_default BOOLEAN DEFAULT false,
  created_at, updated_at
)

-- Diagrams
diagrams (
  id UUID PK,
  name VARCHAR(500),
  type VARCHAR(50),            -- free_draw/data_flow
  data JSONB,                  -- diagram state (nodes, edges, positions)
  created_by UUID FK,
  created_at, updated_at
)

-- Users
users (
  id UUID PK,
  email VARCHAR(320) UNIQUE,
  display_name VARCHAR(200),
  password_hash VARCHAR(200),
  role VARCHAR(20) DEFAULT 'member',  -- admin/member/viewer
  is_active BOOLEAN DEFAULT true,
  created_at, updated_at
)
```

---

## API Routes

### Auth
- `POST /api/v1/auth/register` — Register user
- `POST /api/v1/auth/login` — Login → JWT
- `GET /api/v1/auth/me` — Current user

### Fact Sheets
- `GET /api/v1/fact-sheets` — List (filtered, paginated, sorted)
- `POST /api/v1/fact-sheets` — Create
- `GET /api/v1/fact-sheets/{id}` — Detail (with relations, subscriptions, tags)
- `PATCH /api/v1/fact-sheets/{id}` — Update
- `DELETE /api/v1/fact-sheets/{id}` — Archive
- `PATCH /api/v1/fact-sheets/bulk` — Bulk update
- `GET /api/v1/fact-sheets/{id}/history` — Audit log
- `POST /api/v1/fact-sheets/{id}/quality-seal` — Approve/break seal
- `GET /api/v1/fact-sheets/export` — CSV export

### Relations
- `GET /api/v1/relations` — List (filtered by fact_sheet_id, type)
- `POST /api/v1/relations` — Create
- `PATCH /api/v1/relations/{id}` — Update
- `DELETE /api/v1/relations/{id}` — Delete

### Subscriptions
- `GET /api/v1/fact-sheets/{id}/subscriptions`
- `POST /api/v1/fact-sheets/{id}/subscriptions`
- `DELETE /api/v1/subscriptions/{id}`

### Comments
- `GET /api/v1/fact-sheets/{id}/comments`
- `POST /api/v1/fact-sheets/{id}/comments`
- `PATCH /api/v1/comments/{id}`
- `DELETE /api/v1/comments/{id}`

### Todos
- `GET /api/v1/todos` — All todos (with filters)
- `GET /api/v1/fact-sheets/{id}/todos`
- `POST /api/v1/fact-sheets/{id}/todos`
- `PATCH /api/v1/todos/{id}`
- `DELETE /api/v1/todos/{id}`

### Tags
- `GET /api/v1/tag-groups` — List tag groups with tags
- `POST /api/v1/tag-groups` — Create group
- `POST /api/v1/tag-groups/{id}/tags` — Create tag in group
- `POST /api/v1/fact-sheets/{id}/tags` — Assign tags
- `DELETE /api/v1/fact-sheets/{id}/tags/{tagId}` — Remove tag

### Metamodel
- `GET /api/v1/metamodel/types` — List fact sheet type configs
- `POST /api/v1/metamodel/types` — Create custom type
- `PATCH /api/v1/metamodel/types/{key}` — Update type config
- `GET /api/v1/metamodel/relation-types` — List relation type configs
- `POST /api/v1/metamodel/relation-types` — Create custom relation type

### Reports
- `GET /api/v1/reports/dashboard` — Dashboard KPIs
- `GET /api/v1/reports/landscape` — Landscape data
- `GET /api/v1/reports/portfolio` — Portfolio scatter data
- `GET /api/v1/reports/matrix` — Matrix cross-reference
- `GET /api/v1/reports/roadmap` — Timeline data
- `GET /api/v1/reports/cost` — Cost aggregation

### Diagrams
- `GET /api/v1/diagrams`
- `POST /api/v1/diagrams`
- `GET /api/v1/diagrams/{id}`
- `PATCH /api/v1/diagrams/{id}`
- `DELETE /api/v1/diagrams/{id}`

### Documents
- `GET /api/v1/fact-sheets/{id}/documents`
- `POST /api/v1/fact-sheets/{id}/documents`
- `DELETE /api/v1/documents/{id}`

### Bookmarks
- `GET /api/v1/bookmarks`
- `POST /api/v1/bookmarks`
- `PATCH /api/v1/bookmarks/{id}`
- `DELETE /api/v1/bookmarks/{id}`

### Events
- `GET /api/v1/events/stream` — SSE real-time
- `GET /api/v1/events` — Query events

### Users (admin)
- `GET /api/v1/users`
- `PATCH /api/v1/users/{id}`

---

## Frontend Routes

| Route | Page | Description |
|-------|------|-------------|
| `/` | Dashboard | KPI widgets, recent activity, quick links |
| `/inventory` | Inventory | AG Grid with type filter, saved views |
| `/fact-sheets/:id` | Fact Sheet Detail | Tabbed detail: Overview, Relations, Subscriptions, Comments, Todos, History |
| `/reports/landscape` | Landscape Report | Grouped tiles with heat map coloring |
| `/reports/portfolio` | Portfolio Report | Bubble chart (functionalFit vs technicalFit) |
| `/reports/matrix` | Matrix Report | Cross-reference grid |
| `/reports/roadmap` | Roadmap | Timeline of lifecycle transitions |
| `/reports/cost` | Cost Report | Cost breakdowns by provider/app/capability |
| `/diagrams` | Diagram List | List of saved diagrams |
| `/diagrams/:id` | Diagram Editor | Free draw / data flow canvas |
| `/todos` | Todo List | All todos across fact sheets |
| `/admin/metamodel` | Metamodel Config | Configure fact sheet types, fields, relations |
| `/admin/tags` | Tag Management | Tag groups and tags CRUD |
| `/admin/users` | User Management | User roles and access |
| `/login` | Login | Auth page |

---

## Implementation Phases

### Phase 1: Foundation — Database + Metamodel + Auth + App Shell
**Backend:**
- Clean FastAPI app structure (config, database, models, schemas, API, services)
- All database models (fact_sheets, relations, subscriptions, comments, todos, tags, events, documents, bookmarks, diagrams, users, fact_sheet_types, relation_types)
- Seed 12 default fact sheet types with full fields_schema
- Seed 20+ default relation types
- JWT auth (stdlib HMAC-SHA256 + bcrypt)
- Event bus + SSE

**Frontend:**
- React + Vite + MUI app shell
- Sidebar navigation (LeanIX-like)
- Top bar with global search + quick create
- Auth (login/register)
- API client with JWT interceptor
- SSE hook for real-time updates

**Infrastructure:**
- Docker Compose (backend + frontend/nginx)
- External PostgreSQL support
- .env.example

### Phase 2: Fact Sheet CRUD + Detail Page + Inventory
**Backend:**
- Complete fact sheet CRUD API
- Dynamic field validation from metamodel
- Lifecycle management
- Hierarchy (parent/child)
- Completion score calculation
- Quality seal workflow
- Tag assignment
- Subscription management
- Comment CRUD
- Todo CRUD
- Document/resource links
- History/audit events
- Bulk update endpoint
- CSV export
- Bookmark/saved view CRUD

**Frontend:**
- **Inventory page**: AG Grid with dynamic columns from metamodel, type filter, lifecycle filter, tag filter, inline editing, multi-select bulk edit, saved views, CSV export
- **Fact sheet detail page**: Tabbed layout with:
  - Overview tab: Dynamic sections/subsections/fields from metamodel, lifecycle display, tags, documents
  - Relations tab: Grouped by relation type, add/remove relations
  - Subscriptions tab: Responsible/Accountable/Observer management
  - Comments tab: Threaded discussion
  - Todos tab: Task list
  - History tab: Audit log timeline
- **Create dialog**: Type selector + name + initial fields
- Quality seal badge + approve/break workflow

### Phase 3: Reports + Dashboard
**Backend:**
- Report data aggregation endpoints (landscape, portfolio, matrix, roadmap, cost, dashboard KPIs)

**Frontend:**
- **Dashboard**: KPI cards (total fact sheets by type, completion avg, lifecycle distribution, cost totals), recent activity feed, quick actions
- **Landscape Report**: Fact sheets as colored tiles grouped by a parent type (e.g., Apps by Business Capability), color = lifecycle/fit/criticality
- **Portfolio Report**: Bubble chart with configurable X/Y axes (functional fit vs technical fit, with size = cost, color = criticality)
- **Matrix Report**: Two-axis grid (e.g., Apps × Business Capabilities, colored by relation presence)
- **Roadmap**: Timeline visualization of lifecycle phases across fact sheets
- **Cost Report**: Bar/pie charts of cost by provider, by app, by capability

### Phase 4: Diagrams + Admin + Polish
**Backend:**
- Diagram CRUD
- Metamodel admin endpoints (add/edit types, fields, relation types)
- User management endpoints

**Frontend:**
- **Free Draw Diagram Editor**: Canvas with draggable fact sheet nodes, connectors, labels (using React Flow or similar)
- **Data Flow Diagram**: Auto-layout of interfaces between applications
- **Admin - Metamodel**: Configure fact sheet types, sections, fields, relation types
- **Admin - Tags**: Tag group and tag CRUD
- **Admin - Users**: User list, role assignment
- **Todos page**: Cross-fact-sheet todo list with filters

---

## Unraid Deployment

### Prerequisites
- Existing PostgreSQL container (16+)
- Docker Compose support

### Setup
```bash
mkdir -p /mnt/user/appdata/turbo-ea && cd /mnt/user/appdata/turbo-ea
git clone https://github.com/vincentmakes/turbo-ea.git .
cp .env.example .env
# Edit .env: POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, SECRET_KEY
docker compose up -d --build
```

Access: `http://<unraid-ip>:8920`

### Updating
```bash
cd /mnt/user/appdata/turbo-ea
git pull && docker compose up -d --build
```
