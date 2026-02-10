# EA Turbo - Enterprise Architecture Management Platform

## Overview

EA Turbo is a self-hosted Enterprise Architecture Management (EAM) platform inspired by SAP LeanIX, designed for deployment on Unraid. It provides application portfolio management, business capability mapping, technology risk management, and integration architecture visualization through an event-driven API architecture.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + TypeScript + Vite |
| **Data Grid** | AG Grid Community (inventory, inline edit, mass edit) |
| **Backend** | Python 3.12 + FastAPI |
| **Database** | PostgreSQL 16 |
| **Event Bus** | Internal async event system (Redis Pub/Sub for scaling) |
| **Icons** | Material Symbols Outlined (Google Fonts) |
| **Container** | Docker (Alpine-based images) |
| **Reverse Proxy** | Nginx (Alpine) |
| **Deployment** | Docker Compose on Unraid |

---

## Architecture

### Event-Driven Design

```
┌──────────────┐     ┌───────────────┐     ┌──────────────────┐
│   React UI   │────▶│  FastAPI      │────▶│  PostgreSQL      │
│   (Vite)     │◀────│  Backend      │◀────│  Database        │
└──────────────┘     │               │     └──────────────────┘
       ▲             │  Event Bus    │
       │             │  ┌─────────┐  │     ┌──────────────────┐
       └─────────────│──│ SSE/WS  │  │────▶│  Redis (optional)│
                     │  └─────────┘  │     └──────────────────┘
                     └───────────────┘
```

All mutations (create, update, delete) on Fact Sheets and Relations emit events through an internal event bus. Events are:

1. **Persisted** to an `events` table for audit trail
2. **Broadcast** to connected clients via Server-Sent Events (SSE)
3. **Dispatched** to registered webhook endpoints (configurable)
4. **Used** to trigger side effects (completion recalculation, lifecycle updates, etc.)

### Event Types

| Event | Trigger |
|-------|---------|
| `fact_sheet.created` | New fact sheet created |
| `fact_sheet.updated` | Fact sheet fields modified |
| `fact_sheet.archived` | Fact sheet archived |
| `fact_sheet.deleted` | Fact sheet permanently removed |
| `relation.created` | New relation between fact sheets |
| `relation.updated` | Relation attributes modified |
| `relation.deleted` | Relation removed |
| `tag.created` | New tag created |
| `tag.assigned` | Tag assigned to fact sheet |
| `tag.removed` | Tag removed from fact sheet |
| `comment.created` | Comment added |

### API Design

- **REST API** for CRUD operations (FastAPI auto-generates OpenAPI docs)
- **SSE endpoint** (`/api/v1/events/stream`) for real-time UI updates
- **Webhook registration** (`/api/v1/webhooks`) for external integrations
- **Bulk import/export** endpoints for CSV/Excel data

---

## Data Model (Metamodel)

### Core Fact Sheet Types

Inspired by LeanIX Meta Model v4, organized into four architectural layers:

#### Business Architecture Layer
| Fact Sheet Type | Description | Hierarchy |
|----------------|-------------|-----------|
| **Business Capability** | What the business can do (stable, L1-L3) | Parent/Child |
| **Business Context** | Activities: products, processes, journeys, value streams | Parent/Child |
| **Organization** | Business units, regions, teams, legal entities | Parent/Child |
| **Objective** | Strategic goals driving initiatives | Flat |

#### Application Architecture Layer
| Fact Sheet Type | Description | Hierarchy |
|----------------|-------------|-----------|
| **Application** | Central entity - software systems (apps, microservices, deployments) | Parent/Child |
| **Interface** | Data exchange connections between applications | Flat |
| **Data Object** | Business data entities (customer, order, product data) | Parent/Child |

#### Technology Architecture Layer
| Fact Sheet Type | Description | Hierarchy |
|----------------|-------------|-----------|
| **IT Component** | Technology dependencies (SaaS, IaaS, DBMS, OS, hardware) | Parent/Child |
| **Tech Category** | Taxonomy grouping IT Components | Parent/Child |
| **Provider** | Vendors/suppliers of technology | Flat |

#### Transformation Architecture Layer
| Fact Sheet Type | Description | Hierarchy |
|----------------|-------------|-----------|
| **Initiative** | Transformation efforts (ideas, projects, programs) | Parent/Child |
| **Platform** | Strategic application/technology groupings | Flat |

### Common Fact Sheet Fields

Every fact sheet has:
- `id` (UUID)
- `name`, `display_name`, `description`
- `type` (enum of fact sheet types)
- `status` (ACTIVE, ARCHIVED)
- `lifecycle` (phases: plan, phase_in, active, phase_out, end_of_life with dates)
- `tags` (many-to-many with Tag Groups)
- `external_id` (for integrations)
- `quality_seal` (APPROVED, BROKEN, N/A)
- `completion` (calculated percentage)
- `created_at`, `updated_at`, `created_by`, `updated_by`

### Type-Specific Fields

**Application:**
- `business_criticality` (administrative_service | business_operational | business_critical | mission_critical)
- `technical_suitability` (unreasonable | insufficient | appropriate | perfect)
- `alias`, `software_product`

**IT Component:**
- `category` (SaaS | IaaS | PaaS | Hardware | Service | DBMS | OS)
- `vendor_lifecycle` (separate from internal lifecycle)
- `resource_classification` (standard | non_standard | phasing_out)

**Interface:**
- `frequency` (real_time | daily | weekly | monthly | on_demand)
- `data_format` (JSON | XML | CSV | binary | other)
- `transport_protocol` (REST | SOAP | GraphQL | gRPC | FTP | MQ)

**Initiative:**
- `initiative_type` (idea | project | program | epic)
- `budget`, `start_date`, `end_date`

### Relation Types

| From | To | Relation Attributes |
|------|----|-------------------|
| Application | Business Capability | `support_type`, `functional_suitability` |
| Application | IT Component | `technical_suitability`, `cost` |
| Application | Organization | `usage_type` (user / owner) |
| Application | Data Object | `usage` (CRUD flags) |
| Application (provider) | Interface | Provider role |
| Application (consumer) | Interface | Consumer role |
| IT Component | Provider | `cost`, `contract_info` |
| IT Component | Tech Category | Classification |
| Interface | Data Object | Data transferred |
| Initiative | Application | `transformation_type` |
| Objective | Initiative | Strategic alignment |
| Objective | Business Capability | Strategic alignment |
| Any | Same Type | `requires` / `required_by` (dependency) |

All relations carry:
- `active_from`, `active_until` (temporal validity)
- `description`

---

## Phased Implementation Plan

### Phase 1: Foundation & Core Data Model

**Goal:** Working backend API with core fact sheet CRUD, event system, database, and minimal React shell.

**Backend:**
- [ ] Project scaffolding: FastAPI app structure, config, logging
- [ ] PostgreSQL schema: migrations with Alembic
- [ ] Core models: `fact_sheets` table (polymorphic with `type` discriminator)
- [ ] Core models: `relations` table with typed edges
- [ ] Core models: `events` table for event sourcing / audit
- [ ] Core models: `tags`, `tag_groups` tables
- [ ] CRUD API: `/api/v1/fact-sheets` (create, read, update, archive, list with filtering/pagination)
- [ ] Bulk update API: `PATCH /api/v1/fact-sheets/bulk` (mass-edit multiple fact sheets in one request — used by AG Grid multi-row edit)
- [ ] CRUD API: `/api/v1/relations` (create, read, update, delete)
- [ ] CRUD API: `/api/v1/tags` (create, list, assign, remove)
- [ ] Event bus: Internal async event dispatcher
- [ ] Event persistence: All mutations logged to `events` table
- [ ] SSE endpoint: `/api/v1/events/stream` for real-time client updates
- [ ] Auth: Basic local user auth (JWT tokens)
- [ ] OpenAPI docs auto-generated at `/docs`

**Frontend:**
- [ ] React + Vite + TypeScript scaffolding
- [ ] Material Symbols Outlined integration
- [ ] App shell: sidebar navigation, top bar, routing
- [ ] **AG Grid inventory view** — the primary way to browse, fast-edit, and mass-edit fact sheets:
  - Sortable, filterable, groupable columns (name, type, status, lifecycle phase, business criticality, etc.)
  - **Inline cell editing** — click any cell to edit in-place, commits via PATCH on blur/enter
  - **Mass edit** — multi-row select + bulk attribute update (status, lifecycle, tags, custom attributes)
  - Column pinning, resizing, auto-size; persisted column state in localStorage
  - Server-side pagination with infinite row model
  - Row grouping by type, status, or any column
  - Custom cell renderers for lifecycle chips, suitability badges, tag pills
  - CSV / clipboard export from grid
  - Real-time row refresh via SSE (new/changed rows flash-highlight)
- [ ] Fact sheet detail view (read/edit form)
- [ ] Fact sheet creation dialog
- [ ] SSE client: Real-time update integration

**Infrastructure:**
- [ ] Docker Compose: FastAPI + PostgreSQL + Nginx
- [ ] Dockerfiles: Alpine-based for all services
- [ ] Nginx reverse proxy config (frontend + API)
- [ ] Environment variable configuration
- [ ] Unraid deployment instructions

### Phase 2: Business Capabilities & Application Portfolio

**Goal:** Business capability hierarchy, application-to-capability mapping, portfolio views.

**Backend:**
- [ ] Business Capability hierarchy API (parent/child, up to 3 levels)
- [ ] Application-specific fields and validation
- [ ] Application-to-Business Capability relations with `support_type` and `functional_suitability`
- [ ] Organization hierarchy API
- [ ] Application-to-Organization relations with `usage_type`
- [ ] Lifecycle management: phase transitions, date validation
- [ ] Completion calculation: auto-compute per fact sheet based on filled fields/relations
- [ ] Search and filtering: full-text search across fact sheets
- [ ] Bulk import: CSV upload for applications and capabilities

**Frontend:**
- [ ] Business Capability Map: Interactive hierarchical tree (L1 → L2 → L3)
- [ ] Capability map color-coding by: application count, functional suitability, business criticality
- [ ] Application Portfolio grid (AG Grid with type-specific columns for business criticality, technical suitability, lifecycle)
- [ ] Application detail page: tabs for Overview, Relations, Lifecycle, Tags, History
- [ ] Lifecycle timeline visualization per fact sheet
- [ ] Organization tree view
- [ ] Drag-and-drop application-to-capability assignment
- [ ] Quality seal workflow UI

### Phase 3: Technology Stack & Risk Management

**Goal:** IT Components, providers, tech categories, obsolescence tracking.

**Backend:**
- [ ] IT Component type-specific fields and subtypes
- [ ] Tech Category taxonomy API
- [ ] Provider CRUD with cost aggregation
- [ ] Application-to-IT Component relations with cost tracking
- [ ] Vendor lifecycle tracking (separate from internal lifecycle)
- [ ] Obsolescence risk calculation engine
- [ ] Technology risk scoring (aggregate lifecycle status across dependencies)
- [ ] Cost aggregation: per application, per capability, per provider

**Frontend:**
- [ ] IT Component catalog (AG Grid with category, vendor lifecycle, resource classification columns)
- [ ] Provider directory with cost summaries
- [ ] Tech Stack view: applications grouped by underlying technology
- [ ] Obsolescence risk dashboard: color-coded lifecycle status
- [ ] Technology radar / landscape visualization
- [ ] Cost breakdown charts (per provider, per capability, per application)
- [ ] Risk matrix: technical fitness vs. business criticality

### Phase 4: Integration Architecture & Data Flow

**Goal:** Interfaces, data objects, data flow visualization.

**Backend:**
- [ ] Interface CRUD with provider/consumer application relations
- [ ] Data Object CRUD with CRUD-usage tracking (which apps create/read/update/delete)
- [ ] Interface-to-Data Object relations
- [ ] Data flow graph query API (traverse interface graph)
- [ ] Integration point statistics

**Frontend:**
- [ ] Interface list and detail views
- [ ] Data Object catalog
- [ ] Interface Circle Map: interactive circular visualization of interface clusters
- [ ] Data Flow Diagram: visual data flow between applications via interfaces
- [ ] Application integration view: show all interfaces for a given application
- [ ] CRUD matrix: Data Objects × Applications

### Phase 5: Transformation & Strategic Planning

**Goal:** Initiatives, objectives, roadmaps, TIME model assessments.

**Backend:**
- [ ] Initiative CRUD with lifecycle and budget tracking
- [ ] Objective CRUD linked to capabilities and initiatives
- [ ] Initiative-to-Application relations with transformation type
- [ ] TIME model calculation (Tolerate / Invest / Migrate / Eliminate)
- [ ] Application rationalization scoring
- [ ] Roadmap query API (timeline of initiatives and lifecycle changes)
- [ ] Scenario planning: "what-if" snapshots

**Frontend:**
- [ ] Initiative/Project list and Kanban board
- [ ] Roadmap timeline visualization (Gantt-like)
- [ ] TIME model portfolio quadrant chart
- [ ] Application rationalization dashboard
- [ ] Objective → Initiative → Application traceability view
- [ ] Transformation impact analysis view

### Phase 6: Reporting, Dashboards & Advanced Features

**Goal:** Executive dashboards, matrix reports, webhooks, export.

**Backend:**
- [ ] Webhook registration and delivery system (outbound HTTP POST on events)
- [ ] Report query engine: aggregation queries for dashboard KPIs
- [ ] Export API: CSV, Excel, PDF generation
- [ ] Constraining relations (e.g., App supports Capability FOR Organization)
- [ ] Custom tag groups and configurable fields
- [ ] Audit trail API: query event history per fact sheet
- [ ] User management: roles (admin, editor, viewer)

**Frontend:**
- [ ] Executive dashboard: KPI cards, trend charts, health scores
- [ ] Landscape Report: one-dimensional grouped view with heat maps
- [ ] Matrix Report: two-dimensional (e.g., Applications × Capabilities × Organizations)
- [ ] Portfolio Report: configurable quadrant charts
- [ ] World Map: geographic distribution of applications/organizations
- [ ] Export dialogs: PDF, CSV, Excel
- [ ] Webhook management UI
- [ ] User/role management settings
- [ ] Presentation mode for stakeholder sharing

---

## Unraid Deployment Guide

### Prerequisites
- Unraid 6.12+ with Docker support enabled
- Community Applications plugin installed
- At least 2GB RAM allocated for Docker
- Persistent storage path on array or cache (e.g., `/mnt/user/appdata/ea-turbo/`)

### Option A: Docker Compose (Recommended)

1. **Install Docker Compose plugin** (if not already available):
   - Install "Docker Compose Manager" from Community Applications

2. **Create app directory:**
   ```bash
   mkdir -p /mnt/user/appdata/ea-turbo
   cd /mnt/user/appdata/ea-turbo
   ```

3. **Clone or copy files:**
   ```bash
   git clone https://github.com/vincentmakes/ea-turbo.git .
   ```

4. **Create environment file:**
   ```bash
   cp .env.example .env
   # Edit .env with your settings:
   # - POSTGRES_PASSWORD (change from default)
   # - SECRET_KEY (generate a random key)
   # - ALLOWED_HOSTS (your Unraid IP or domain)
   ```

5. **Start the stack:**
   ```bash
   docker compose up -d
   ```

6. **Access the application:**
   - Web UI: `http://<unraid-ip>:8920`
   - API docs: `http://<unraid-ip>:8920/api/docs`

### Option B: Manual Docker Containers via Unraid UI

1. **PostgreSQL Container:**
   - Image: `postgres:16-alpine`
   - Port: `5432` (or custom)
   - Env: `POSTGRES_DB=eaturbo`, `POSTGRES_USER=eaturbo`, `POSTGRES_PASSWORD=<secure>`
   - Volume: `/mnt/user/appdata/ea-turbo/pgdata:/var/lib/postgresql/data`
   - Network: Create custom bridge `ea-turbo-net`

2. **Backend Container:**
   - Image: `ghcr.io/vincentmakes/ea-turbo-backend:latest` (or build locally)
   - Port: `8000`
   - Env: `DATABASE_URL=postgresql://eaturbo:<pass>@ea-turbo-db:5432/eaturbo`
   - Network: `ea-turbo-net`

3. **Frontend + Nginx Container:**
   - Image: `ghcr.io/vincentmakes/ea-turbo-frontend:latest` (or build locally)
   - Port: `8920`
   - Network: `ea-turbo-net`

### Data Persistence

| Path on Unraid | Container Path | Purpose |
|----------------|---------------|---------|
| `/mnt/user/appdata/ea-turbo/pgdata` | `/var/lib/postgresql/data` | PostgreSQL data |
| `/mnt/user/appdata/ea-turbo/uploads` | `/app/uploads` | File uploads |
| `/mnt/user/appdata/ea-turbo/.env` | `/app/.env` | Environment config |

### Backup

```bash
# Database backup
docker exec ea-turbo-db pg_dump -U eaturbo eaturbo > /mnt/user/appdata/ea-turbo/backups/$(date +%Y%m%d).sql

# Restore
docker exec -i ea-turbo-db psql -U eaturbo eaturbo < /mnt/user/appdata/ea-turbo/backups/YYYYMMDD.sql
```

### Updating

```bash
cd /mnt/user/appdata/ea-turbo
git pull
docker compose build
docker compose up -d
```

---

## Project Structure

```
ea-turbo/
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/
│   │   └── versions/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                  # FastAPI app entry point
│   │   ├── config.py                # Settings / env config
│   │   ├── database.py              # SQLAlchemy engine & session
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   ├── base.py              # Base model with common fields
│   │   │   ├── fact_sheet.py        # Fact sheet model (polymorphic)
│   │   │   ├── relation.py          # Relation model
│   │   │   ├── event.py             # Event log model
│   │   │   ├── tag.py               # Tag & TagGroup models
│   │   │   └── user.py              # User model
│   │   ├── schemas/
│   │   │   ├── __init__.py
│   │   │   ├── fact_sheet.py        # Pydantic schemas
│   │   │   ├── relation.py
│   │   │   ├── event.py
│   │   │   └── tag.py
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── deps.py              # Dependency injection
│   │   │   └── v1/
│   │   │       ├── __init__.py
│   │   │       ├── router.py        # API router aggregation
│   │   │       ├── fact_sheets.py   # Fact sheet endpoints
│   │   │       ├── relations.py     # Relation endpoints
│   │   │       ├── events.py        # SSE + event query endpoints
│   │   │       ├── tags.py          # Tag endpoints
│   │   │       ├── auth.py          # Auth endpoints
│   │   │       └── webhooks.py      # Webhook management
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── fact_sheet_service.py
│   │   │   ├── relation_service.py
│   │   │   ├── event_bus.py         # Internal event dispatcher
│   │   │   ├── event_service.py     # Event persistence
│   │   │   └── webhook_service.py   # Outbound webhook delivery
│   │   └── core/
│   │       ├── __init__.py
│   │       ├── security.py          # JWT, password hashing
│   │       └── exceptions.py        # Custom exceptions
│   └── tests/
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── public/
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/                     # API client (fetch wrappers)
│       ├── components/              # Reusable UI components
│       ├── features/                # Feature modules
│       │   ├── fact-sheets/
│       │   ├── capabilities/
│       │   ├── applications/
│       │   └── dashboard/
│       ├── hooks/                   # Custom React hooks (SSE, etc.)
│       ├── layouts/                 # App shell, sidebar, etc.
│       ├── stores/                  # State management
│       ├── types/                   # TypeScript type definitions
│       └── utils/                   # Helpers
├── nginx/
│   ├── Dockerfile
│   └── nginx.conf
├── docker-compose.yml
├── .env.example
├── PLAN.md
└── LICENSE
```
