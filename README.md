# Turbo EA


[![CI](https://github.com/vincentmakes/turbo-ea/actions/workflows/ci.yml/badge.svg)](https://github.com/vincentmakes/turbo-ea/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.12](https://img.shields.io/badge/python-3.12-3776AB.svg)](https://www.python.org/)
[![React 18](https://img.shields.io/badge/react-18-61DAFB.svg)](https://react.dev/)
[![GitHub Sponsors Badge](https://img.shields.io/badge/GitHub%20Sponsors-FF009D?logo=githubsponsors&logoColor=fff&style=flat-square)](https://github.com/sponsors/vincentmakes)


[Website](https://www.turbo-ea.org) | [User Guide](https://docs.turbo-ea.org) | [Blog](https://www.turbo-ea.org/blog) | [Business Case / Pitch](https://github.com/vincentmakes/turbo-ea/blob/main/business%20case/turbo%20ea%20pitch%20business%20case.pdf)  

<img width="3508" height="731" alt="banner_turboea" src="https://github.com/user-attachments/assets/0d87314b-4e46-4011-b39b-1e5765700f13" />



  


Self-hosted Enterprise Architecture Management platform that creates a **digital twin of your IT landscape**. Inspired by LeanIX, with a fully admin-configurable metamodel — card types, fields, subtypes, and relations are all data, not code.

> **Docker runtime note:** The bundled Docker stack uses custom non-root images for all services and defaults to running as uid:gid `1000:1000`, including PostgreSQL, edge nginx, Ollama, and the MCP server.





## Try the Demo

No install needed — run a fully loaded demo in your browser using GitHub Codespaces:

1. Click the button below (requires a free GitHub account):

   [![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/vincentmakes/turbo-ea?quickstart=1)

2. Wait for the build to complete (~5–10 minutes on first launch). The setup script will automatically start PostgreSQL, the backend, and the frontend with demo data pre-loaded.

3. When the build finishes, Codespaces will open port **8920** in your browser. Go to the Port tab and click on the globe to access it :
<img width="840" height="217" alt="Screenshot 2026-03-26 at 12 13 16" src="https://github.com/user-attachments/assets/532c1c1d-a9fb-496e-9c8c-d0786af49d8b" />  

Log in with:

   | | |
   |---|---|
   | **Email** | `admin@turboea.demo` |
   | **Password** | `TurboEA!2025` |

The demo comes pre-populated with the NexaTech Industries dataset — 150+ cards across all architecture layers, business processes, strategic initiatives, and 60+ relations.

> **Cost**: Codespaces runs on **your** GitHub free tier (120 core-hours/month). A 4-core machine gives ~30 hours of demo time. Codespaces auto-stop after 30 minutes of inactivity and auto-delete after 30 days.

## Features

### Core EA Management

- **Configurable Metamodel** — 13 built-in card types across 4 architecture layers (Strategy, Business, Application, Technical). Add custom types, fields, subtypes, and relation types from the admin UI. Interactive metamodel graph visualization with hover highlighting.
- **Inventory Management** — AG Grid-powered data table with search, dynamic multi-select filtering for all columns (subtype, lifecycle, data quality, attributes), column customization, Excel import/export, mass archive/delete, and select-all across filtered rows.
- **Card Detail Pages** — Full detail view with fields, lifecycle, hierarchy, relations, stakeholders, comments, todos, documents, and event history. Approval workflow (Draft/Approved/Rejected/Broken) with auto-breaking on substantive edits. Auto-computed data quality scoring (0–100%) based on field weights.
- **Hierarchy Support** — Parent-child trees for hierarchical card types. Business Capabilities enforce max 5-level depth with auto-computed capability levels.
- **Inline Title Editing** — Rename cards directly from the title in the detail page header (no dialog needed) with permission-gated controls.
- **Favorites** — Per-user favorited cards for quick access from the dashboard.
- **Capability Catalogue** — Browsable industry capability catalogue (`/capabilities`) grouped by industry, with sticky filter bars, quick-filter chips, and a back-to-top button. Use as a reference when designing your own capability map.

![Dashboard](marketing-site/assets/screenshots/dashboard.png)

### Reporting & Analytics

- **Interactive Reports** — Portfolio bubble chart, capability heatmap, lifecycle roadmap, dependency graph, cost treemap, matrix cross-reference, data quality dashboard, EOL risk report, and process map. All report filters, colors, and grouping are dynamically generated from card type field schemas with auto-persist to localStorage.
- **Dashboard with Trend Charts** — Daily KPI snapshots feed trend charts on the home dashboard (cards by type, average data quality, approvals over time) alongside a redesigned Recent Activity panel.
- **Time-Travel** — View any report as it appeared at a historical date using a timeline slider with year-level granularity.
- **Saved Reports** — Save report configurations (filters, axes, colors, grouping), share with other users (edit/view permissions), and generate OData feeds for programmatic access.
- **Print-to-PDF** — Native browser print for all reports with optimized compact layout, white background, and time-travel date display.
- **Matrix Hierarchical Headers** — Matrix report supports hierarchical grouped headers with collapsible row/column depth controls.

### Business Process Management (BPM)

- **BPMN 2.0 Editor** — Full process flow modeling with a built-in BPMN editor and viewer, template chooser, and process navigator.
- **Process Flow Versioning** — Draft, published, and archived states for process diagrams with approval workflows and stakeholder sign-offs.
- **Element Linking** — Link BPMN process elements to EA cards (applications, IT components, etc.) for traceability between processes and the IT landscape.
- **Process Assessments** — Record maturity assessments (efficiency, effectiveness, compliance, automation) with 1–5 scoring, action items, and historical tracking.
- **BPM Reports** — Process map, capability-process matrix, process-application matrix, process dependencies, and element-application map.

### Project Portfolio Management (PPM)

- **Portfolio Dashboard** — Gantt chart overview of all initiatives with quarter headers, cost aggregations, health status indicators, and grouping by related card types (e.g., group by Organization or Platform).
- **Status Reports** — Periodic health snapshots for initiatives tracking schedule, cost, and scope health (on track / at risk / off track) with summary, accomplishments, and next steps.
- **Work Breakdown Structure** — Hierarchical WBS with parent-child nesting, milestones, date ranges, and auto-computed completion that rolls up from task progress through parent WBS items.
- **Task Board** — Kanban board (todo, in progress, done, blocked) with drag-and-drop, priority levels, assignees, due dates, tags, WBS linking, and threaded comments. Tasks auto-sync to the system todo list.
- **Budget & Cost Tracking** — Budget lines (capex/opex by fiscal year) and cost lines (actual expenditures with dates). Budget and cost totals auto-sync to the initiative card's costBudget and costActual fields.
- **Risk Management** — Risk register with probability/impact scoring (1-5), auto-computed risk score, status tracking (open/mitigating/mitigated/closed/accepted), mitigation plans, and risk matrix visualization.
- **PPM Reports** — Portfolio-level dashboard with KPIs (total budget, actual spend, health distribution) and Gantt timeline with optional grouping.

### Diagrams

- **Diagram Editor** — Self-hosted DrawIO integration for creating architecture diagrams linked to your cards. Shapes are colored by card type with synced/pending states.

### AI-Powered Assistance

- **AI Description Suggestions** — Generate card descriptions with a single click using a two-step pipeline: web search (DuckDuckGo, Google Custom Search, or SearXNG) followed by LLM extraction. Supports self-hosted Ollama (optionally bundled via Docker Compose `--profile ai`) and commercial providers (OpenAI, Google Gemini, Azure OpenAI, OpenRouter, Anthropic Claude) with encrypted API key storage. Suggestions are type-aware — the prompt contextualizes each card based on its type (e.g., "software application", "technology vendor", "business process"). Results include a confidence score, editable text, and clickable source links. Admins control which card types get suggestions, the search provider, and the LLM model.

### TurboLens AI Intelligence

AI-powered EA analysis module — originally ported from [ArchLens](https://github.com/vinod-ea/archlens) by [Vinod](https://github.com/vinod-ea) (MIT License). Runs natively in Turbo EA using the same AI provider configuration.

- **Vendor Analysis** — AI categorizes technology vendors from your portfolio into 45+ industry categories, counting associated applications and costs. Results displayed with category breakdowns and detailed reasoning.
- **Vendor Resolution** — Builds a canonical vendor hierarchy by resolving aliases, parent-child relationships, and product groupings. Displays confidence scores for each resolution.
- **Duplicate Detection** — Identifies functional duplicate cards using AI clustering across Application, IT Component, and Interface types. Union-find algorithm merges overlapping clusters across batches. Each cluster includes evidence and retirement recommendations.
- **Modernization Assessment** — Evaluates cards for modernization opportunities based on current technology trends, providing effort estimates, priority levels, and specific recommendations.
- **Architecture AI** — 5-step guided wizard: (1) Requirements (objective + capability selection), (2) Business Fit clarification questions, (3) Technical Fit deep-dive, (4) Solution (options → gap analysis → dependency analysis), (5) Target Architecture with capability mapping and an interactive **Layered Dependency View** (React Flow) — Turbo EA's house notation for layered EA dependency diagrams. Commits to a real Initiative card with proposed cards, relations, and a draft ADR.
- **Security & Compliance** — On-demand CVE scans (NIST NVD-backed with deterministic probability scoring) and compliance scans across EU AI Act, GDPR, NIS2, DORA, SOC 2, and ISO 27001. Findings show severity, business impact, and remediation. A clickable risk matrix drills through to filtered findings; any finding can be promoted to a Risk Register entry in one click.

### EA Delivery (TOGAF)

- **Architecture Decision Records (ADR)** — Capture decisions, context, alternatives considered, consequences, and links to affected cards. Sign-off workflow with audit trail.
- **EA Risk Register (TOGAF Phase G)** — Landscape-level register separate from initiative risks. Auto-generated `R-000123` references, initial vs residual 4×4 probability×impact matrices, sequential status workflow (analysis → mitigation → monitoring → closed) with explicit Accept / Reopen side actions, owner→Todo→notification loop, and idempotent promote-from-finding for CVE and compliance findings.
- **EA Principles** — Admin-curated list of architecture principles (statement, rationale, implications) referenced from SoAW and ADR documents.
- **Statement of Architecture Work** — TOGAF-compliant SoAW editor with rich text editing (TipTap), version history, sign-off requests, and DOCX export.

### Data Governance

- **Data Maintenance Surveys** — Admin-driven workflows for keeping card data accurate at scale. Target by card type with tag/relation/attribute filters. Users maintain or confirm field values; admins review and apply changes in bulk.
- **Calculated Fields** — Admin-configurable formula engine for computed fields. Supports IF, SUM, AVG, MIN, MAX, COUNT, ROUND, COALESCE, FILTER, MAP_SCORE with syntax-highlighted editor, inline autocomplete, and cycle detection.
- **End-of-Life Tracking** — Integration with endoflife.date for monitoring technology lifecycle status. Fuzzy product search, mass search/link for IT components, and dedicated EOL report.
- **Data Quality Scoring** — Auto-calculated completeness percentage based on field schema weights. Data quality report shows by-type stats, orphaned/stale counts, and worst items.

### Collaboration

- **Notifications & Events** — Real-time SSE updates, in-app notification bell with unread counts, and optional SMTP email alerts. Notification types: todo assigned, card updated, comment added, approval status changed, SoAW sign requested/signed, stakeholder updates.
- **Threaded Comments** — Full threaded comment system on cards with edit and delete.
- **Todos** — Task management linked to cards with assignment, due dates, and status tracking. Badge counts for open todos shown in navigation.
- **Stakeholders** — Per-card stakeholder roles (responsible, observer, technical/business application owner) with configurable custom roles per card type.
- **Documents** — URL/link attachments on cards.
- **Tags** — Tag groups with single/multi-select modes, mandatory flags, and per-card-type restrictions. Filter-by-tag across inventory and reports.

### Integrations

> [!IMPORTANT]
> The ServiceNow integration is implemented but looking for volunteer testers with access to a ServiceNow instance.
> If you are interested, please check the discussions or raise an issue.

- **SSO / Single Sign-On** — Support for multiple identity providers: **Microsoft Entra ID**, **Google Workspace**, **Okta**, and any **Generic OIDC** provider with automatic discovery document support. Provider-specific branded login buttons, Google hosted domain restriction, Okta domain configuration, manual OIDC endpoint configuration as fallback, and admin ability to link existing local accounts to SSO. Dedicated Authentication tab in admin settings.
- **MCP Server (AI Tool Access)** — Built-in [Model Context Protocol](https://modelcontextprotocol.io/) server that lets AI tools (Claude Desktop, GitHub Copilot, Cursor, VS Code) query your EA data with per-user RBAC. Users authenticate via SSO — no shared service accounts. The MCP server is read-only (8 tools for searching cards, exploring relations, browsing the metamodel, and viewing dashboards). Activate with `docker compose --profile mcp up -d` and toggle on in admin settings. Also supports a local stdio mode for testing without SSO.
- **ServiceNow Integration** — Bidirectional sync with ServiceNow CMDB. Connection management, field mapping with transform rules, direction control (Turbo EA → SNOW, SNOW → Turbo EA, or bidirectional), staged record review before applying, and encrypted credential storage.
- **Web Portals** — Public, slug-based views of your EA landscape (no login required). Configurable card type display, field selection, card layout, per-portal logo toggle, and relation-based filtering.
- **OData Feeds** — Generate OData-compatible feeds from saved views and saved reports for consumption by external tools (Excel, Power BI, etc.).



### Administration

- **Custom RBAC Roles** — Admin-configurable roles beyond the 3 built-in roles (admin/member/viewer) with 50+ granular permissions for both app-level and card-level actions.
- **Card Layout Editor** — Drag-and-drop visual editor for customizing card detail page layouts with section ordering, field grouping, 2-column support, and collapsible sections.
- **Saved Views with Sharing** — Save inventory filter/column/sort configurations with private, public, or shared visibility. Share with specific users with edit/view permissions.
- **Custom Branding** — Upload a custom logo (max 2 MB; PNG, JPEG, SVG, WebP, GIF) and favicon. Per-portal logo visibility toggle.
- **Currency Settings** — Global display currency for all cost values with compact formatting.
- **SMTP Email Configuration** — Configure SMTP settings from the admin UI with test email support.
- **Design Tokens & UI Guidelines** — Centralized colors, spacing, typography, status/severity/layer palettes and icon sizes (`frontend/src/theme/tokens.ts`). See [`frontend/UI_GUIDELINES.md`](frontend/UI_GUIDELINES.md) for the full design system.

## Screenshots

<details>
<summary>Click to expand screenshots</summary>

| | |
|---|---|
| ![Inventory](marketing-site/assets/screenshots/inventory.png) | ![Card Detail](marketing-site/assets/screenshots/card-detail.png) |
| ![Portfolio Report](marketing-site/assets/screenshots/portfolio-report.png) | ![Capability Heatmap](marketing-site/assets/screenshots/capability-heatmap.png) |
| ![Lifecycle Roadmap](marketing-site/assets/screenshots/lifecycle-roadmap.png) | ![Dependency Graph](marketing-site/assets/screenshots/dependency-graph.png) |
| ![Cost Treemap](marketing-site/assets/screenshots/cost-treemap.png) | ![Matrix Report](marketing-site/assets/screenshots/matrix-report.png) |
| ![Data Quality](marketing-site/assets/screenshots/data-quality.png) | ![End of Life](marketing-site/assets/screenshots/end-of-life.png) |
| ![Diagram Editor](marketing-site/assets/screenshots/diagram-editor.png) | ![Web Portal](marketing-site/assets/screenshots/web-portal.png) |
| ![BPMN Editor](marketing-site/assets/screenshots/bpmn-editor.png) | ![BPMN Viewer](marketing-site/assets/screenshots/bpmn-viewer.png) |
| ![BPM Process Navigator](marketing-site/assets/screenshots/bpm-process-navigator.png) | ![BPM Capability Heatmap](marketing-site/assets/screenshots/bpm-capability-heatmap.png) |
| ![Process Assessment](marketing-site/assets/screenshots/process-assessment.png) | ![Process Element Linker](marketing-site/assets/screenshots/process-element-linker.png) |

</details>

---

## Quick Start

The quickest way to get Turbo EA running. This starts PostgreSQL, the backend, the frontend, and the public edge nginx in Docker with a single command.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

### 1. Clone the repository

```bash
git clone https://github.com/vincentmakes/turbo-ea.git
cd turbo-ea
```

### 2. Create your environment file

```bash
cp .env.example .env
```

Edit `.env` and configure:

```dotenv
# PostgreSQL credentials
POSTGRES_PASSWORD=<choose-a-strong-password>

# JWT signing key — generate one with:
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY=<your-generated-secret>

# Port the app will be available on (default: 8920)
HOST_PORT=8920
```

### 3. Start the app

```bash
docker compose pull
docker compose up -d
```

This uses the single `docker-compose.yml` stack, which includes PostgreSQL and the public nginx edge. Data is persisted in the `postgres_data` Docker volume.

That's it. Open **http://localhost:8920** in your browser.

The **first user to register** automatically gets the **admin** role.

The production stack supports optional profiles:

| Profile | Command flag | What it adds |
|---------|-------------|-------------|
| `ai` | `--profile ai` | Bundled Ollama container for AI description suggestions |
| `mcp` | `--profile mcp` | MCP server for AI tool integration (Claude Desktop, Cursor, etc.) |

Example combining everything:

```bash
docker compose --profile ai --profile mcp pull
docker compose --profile ai --profile mcp up -d
```

### Run from pre-built images (GHCR)

Every push to `main` and every `v*.*.*` tag automatically publishes multi-arch (`amd64` + `arm64`) images to the [GitHub Container Registry](https://ghcr.io):

- `ghcr.io/vincentmakes/turbo-ea/db`
- `ghcr.io/vincentmakes/turbo-ea/backend`
- `ghcr.io/vincentmakes/turbo-ea/frontend`
- `ghcr.io/vincentmakes/turbo-ea/nginx`
- `ghcr.io/vincentmakes/turbo-ea/ollama`
- `ghcr.io/vincentmakes/turbo-ea/mcp-server`

The root compose file is production-only and pulls published images from GHCR:

```bash
docker compose pull
docker compose up -d
```

Pin a specific version with `TURBO_EA_TAG` (defaults to `latest`):

```bash
TURBO_EA_TAG=0.70.0 docker compose up -d
```

> **Breaking change:** The non-root Docker release uses new persistent volume names for PostgreSQL and Ollama so the stack does not try to reuse older root-owned volumes automatically. If you are upgrading from a pre-`0.70.0` release and need to keep your existing database, dump it before upgrading and restore it into the new stack after startup.

### Development from source

Local source builds are intentionally separate from production. Use the dev file to add `build:` for the stack services you want to run from source:

```bash
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml up -d --build
```

The repository Makefile wraps that as:

```bash
make up-dev
```

### Use an existing PostgreSQL server

If you already run a managed or shared PostgreSQL instance, you can skip the bundled `db` service and point the backend at your existing server:

1. Create a database and user for Turbo EA:

   ```sql
   CREATE USER turboea WITH PASSWORD 'your-password';
   CREATE DATABASE turboea OWNER turboea;
   ```

2. In `.env`, point `POSTGRES_HOST` at your server (and update credentials):

   ```dotenv
   POSTGRES_HOST=your-postgres-host
   POSTGRES_PORT=5432
   POSTGRES_DB=turboea
   POSTGRES_USER=turboea
   POSTGRES_PASSWORD=your-password
   ```

3. Start everything except the bundled database:

   ```bash
   docker compose up -d backend frontend nginx
   ```

   (Add `mcp-server` / `ollama` to the list, or use `--profile mcp --profile ai`, as needed.)

The backend can reach external hosts via the host's network. If your PostgreSQL is in another container on the same Docker host, attach it to the same network or use `host.docker.internal`.

### Load demo data (optional)

To start with a fully populated demo dataset (NexaTech Industries), add seed variables to your `.env` before the first startup:

```dotenv
SEED_DEMO=true    # Full demo: NexaTech Industries (~150 cards, BPM processes, PPM projects)
```

Setting `SEED_DEMO=true` includes **everything** — the NexaTech organizational structure, applications, IT components, interfaces, business capabilities, processes, initiatives, tags, relations, BPM process flows with BPMN diagrams, and PPM project data (status reports, WBS, tasks, budgets, costs, risks).

You can also seed BPM or PPM data independently:

```dotenv
SEED_BPM=true     # Only BPM demo data (requires SEED_DEMO to have run first)
SEED_PPM=true     # Only PPM demo data (requires SEED_DEMO to have run first)
```

A demo admin account is created automatically:

| Field | Value |
|-------|-------|
| Email | `admin@turboea.demo` |
| Password | `TurboEA!2025` |
| Role | Admin |

> **Tip:** To start fresh with AI features included, combine seed data with the bundled Ollama container:
>
> ```bash
> # Add to .env:
> SEED_DEMO=true
> AI_PROVIDER_URL=http://ollama:11434
> AI_MODEL=gemma3:4b
> AI_AUTO_CONFIGURE=true
>
> # Start with AI profile:
> docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml --profile ai up -d --build
> ```

#### What the demo data includes

| Category | Content |
|----------|---------|
| **Organizations** | NexaTech Industries corporate hierarchy (business units, regions, teams) |
| **Business Capabilities** | 20+ capabilities in a multi-level hierarchy |
| **Business Contexts** | Processes, value streams, customer journeys, business products |
| **Applications** | 15+ apps (NexaCore ERP, IoT Platform, Salesforce CRM, etc.) with lifecycle and cost data |
| **IT Components** | 20+ infrastructure items (databases, servers, SaaS, AI models) |
| **Interfaces & Data Objects** | API definitions and data flows |
| **Platforms** | Cloud and IoT platforms |
| **Objectives & Initiatives** | 6 strategic initiatives with approval statuses |
| **Tags** | 5 tag groups (Business Value, Technology Stack, Lifecycle Status, Risk Level, Regulatory Scope) |
| **Relations** | 60+ relations linking cards across all layers |
| **BPM** (via `SEED_DEMO` or `SEED_BPM`) | ~30 business processes in a 4-level hierarchy, BPMN 2.0 diagrams, element-to-card links, process assessments |
| **PPM** (via `SEED_DEMO` or `SEED_PPM`) | Status reports, WBS hierarchies, tasks, budget/cost lines, and risks for 6 initiatives |
| **EA Delivery** | Architecture Decision Records and Statements of Architecture Work |

#### Resetting the database

To wipe everything and re-seed from scratch:

```dotenv
RESET_DB=true
SEED_DEMO=true
```

Then restart: `docker compose pull && docker compose up -d`. Remove `RESET_DB` from `.env` afterward to avoid resetting on every restart.

---

## Local Development (Without Docker)

For active development with hot-reload on both frontend and backend.

### Prerequisites

- Python 3.12+
- Node.js 20+
- PostgreSQL (running and accessible)

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -e ".[dev]"

# Set environment variables
export POSTGRES_HOST=localhost
export POSTGRES_DB=turboea
export POSTGRES_USER=turboea
export POSTGRES_PASSWORD=your-db-password
export SECRET_KEY=dev-secret-key

uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`. Swagger docs at `http://localhost:8000/api/docs`.

### Frontend

```bash
cd frontend
npm install

# For local dev, DrawIO is loaded from the public CDN instead of self-hosted
echo 'VITE_DRAWIO_URL=https://embed.diagrams.net' > .env.development

npm run dev
```

The dev server starts at `http://localhost:5173` and proxies `/api` requests to the backend on port 8000.

### Linting & Testing

```bash
# Backend
cd backend
ruff check .          # Lint
ruff format .         # Auto-format
pytest                # Run tests

# Frontend
cd frontend
npm run lint          # ESLint
npm run build         # TypeScript check + production build
```

---

## Architecture

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
│  PostgreSQL 18 (asyncpg driver)                           │
└───────────────────────────────────────────────────────────┘
```

**DrawIO** is self-hosted inside the frontend Docker image (cloned at build time from `jgraph/drawio` v26.0.9) and served under `/drawio/` by Nginx.

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
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | JWT token lifetime (24h default) |
| `HOST_PORT` | `8920` | Port exposed on the host |
| `ALLOWED_ORIGINS` | `http://localhost:8920` | CORS allowed origins (comma-separated) |
| `RESET_DB` | `false` | Drop all tables and re-seed on startup |
| `SEED_DEMO` | `false` | Populate demo dataset on first startup |
| `SEED_BPM` | `false` | Populate demo BPM processes |
| `SEED_PPM` | `false` | Populate demo PPM data |
| `ENVIRONMENT` | `production` | Runtime environment (`development` enables API docs) |
| `SMTP_HOST` | *(empty)* | SMTP server hostname (optional) |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | *(empty)* | SMTP username |
| `SMTP_PASSWORD` | *(empty)* | SMTP password |
| `SMTP_FROM` | `noreply@turboea.local` | Sender email address |
| `SMTP_TLS` | `true` | Use TLS for SMTP |
| `AI_PROVIDER_URL` | *(empty)* | Ollama-compatible LLM provider URL |
| `AI_MODEL` | *(empty)* | LLM model name (e.g., `gemma3:4b`) |
| `AI_SEARCH_PROVIDER` | `duckduckgo` | Web search provider: `duckduckgo`, `google`, or `searxng` |
| `AI_SEARCH_URL` | *(empty)* | Search provider URL (SearXNG URL or `API_KEY:CX` for Google) |
| `AI_AUTO_CONFIGURE` | `false` | Auto-enable AI on startup if provider is reachable |
| `OLLAMA_MEMORY_LIMIT` | `4G` | Memory limit for bundled Ollama container |
| `MCP_PUBLIC_URL` | `http://localhost:8920/mcp` | (MCP server) Public URL for OAuth metadata |
| `TURBO_EA_PUBLIC_URL` | `http://localhost:8920` | (MCP server) Public-facing Turbo EA URL |

> **API Documentation**: Swagger UI is available at `/api/docs` when running in development mode (`ENVIRONMENT=development`).

---

## Database Management

### Migrations

Alembic migrations run automatically on startup:

- **Fresh database** — Tables are created and stamped at the latest migration.
- **Existing database** — Pending migrations are applied automatically.
- **Reset** — Set `RESET_DB=true` to drop all tables and re-create from scratch.

### Backups

The bundled PostgreSQL container stores data in the `postgres_data` Docker volume.

```bash
# Backup
docker compose exec db \
  pg_dump -U turboea turboea > backup.sql

# Restore
docker compose exec -T db \
  psql -U turboea turboea < backup.sql
```

---

## Deployment Notes

### TLS / HTTPS

Turbo EA does not terminate TLS itself. Deploy behind a TLS-terminating reverse proxy such as:

- [Caddy](https://caddyserver.com/) (automatic HTTPS)
- [Traefik](https://traefik.io/)
- Nginx with [Let's Encrypt](https://letsencrypt.org/)
- Cloudflare Tunnel

Update `ALLOWED_ORIGINS` to match your domain:

```dotenv
ALLOWED_ORIGINS=https://ea.yourdomain.com
```

### Updating

```bash
git pull
docker compose up --build -d
```

Migrations run automatically on startup, so the database schema is updated as needed.

---

## Project Structure

```
turbo-ea/
├── backend/
│   ├── app/
│   │   ├── api/v1/          # All API route handlers
│   │   ├── core/            # JWT, password hashing, permissions, calculation engine
│   │   ├── models/          # SQLAlchemy ORM models
│   │   ├── schemas/         # Pydantic request/response models
│   │   ├── services/        # Business logic, seeding, events, notifications, email
│   │   ├── config.py        # Settings from env vars
│   │   ├── database.py      # Async engine + session factory
│   │   └── main.py          # FastAPI app entrypoint
│   ├── alembic/             # Database migrations
│   ├── tests/
│   ├── pyproject.toml
│   └── Dockerfile
│
├── frontend/
│   ├── src/
│   │   ├── api/             # Fetch wrapper with JWT
│   │   ├── hooks/           # Auth, metamodel, SSE, currency, timeline hooks
│   │   ├── components/      # Shared UI components
│   │   ├── features/
│   │   │   ├── admin/       # Metamodel, users & roles, settings, surveys,
│   │   │   │                # EOL, web portals, ServiceNow, card layout,
│   │   │   │                # calculations, tags
│   │   │   ├── auth/        # Login, SSO callback, password setup
│   │   │   ├── bpm/         # BPMN editor, viewer, process navigator,
│   │   │   │                # assessments, element linker, BPM reports
│   │   │   ├── ppm/         # Portfolio dashboard, initiative detail,
│   │   │   │                # task board, risk matrix, cost tracking, WBS
│   │   │   ├── cards/       # Card detail page
│   │   │   ├── dashboard/   # KPI cards + recent activity
│   │   │   ├── diagrams/    # DrawIO editor + shape system
│   │   │   ├── ea-delivery/ # SoAW + ADR editor, EA Risk Register, DOCX export
│   │   │   ├── inventory/   # AG Grid table + Excel import/export
│   │   │   ├── reports/     # 10 report types + saved reports
│   │   │   ├── turbolens/   # AI-powered EA intelligence (vendors, duplicates,
│   │   │   │                # modernization, architecture AI, security & compliance)
│   │   │   ├── capability-catalogue/ # Industry capability catalogue browser
│   │   │   ├── surveys/     # Survey response page
│   │   │   ├── todos/       # Todos + surveys combined page
│   │   │   └── web-portals/ # Public portal viewer
│   │   ├── types/           # TypeScript interfaces
│   │   └── App.tsx          # Routes + MUI theme
│   ├── drawio-config/       # DrawIO customization
│   ├── nginx.conf           # Production reverse proxy config
│   ├── package.json
│   └── Dockerfile           # Multi-stage: node build → drawio clone → nginx
│
├── mcp-server/              # MCP server for AI tool integration
│   ├── turbo_ea_mcp/        # Server implementation (FastMCP + OAuth 2.1)
│   ├── tests/
│   ├── pyproject.toml
│   └── Dockerfile
│
├── Dockerfile               # Multi-target root build (backend, frontend, mcp-server)
├── docker-compose.yml       # Production stack; pulls images from GHCR
├── dev/
│   ├── docker-compose.dev.yml        # Dev-only build file for local source builds
│   └── README.md                     # Explains how dev compose is meant to be used
├── test/
│   ├── docker-compose.test.yml       # Test-only Postgres harness used by scripts/test.sh
│   └── README.md                     # Explains the test compose workflow
├── .env.example             # Template for environment variables
└── CLAUDE.md                # AI assistant context file
```

---

## Credits

- **TurboLens AI Intelligence** — The AI-powered vendor analysis, duplicate detection, and architecture recommendation features are based on [ArchLens](https://github.com/vinod-ea/archlens) by [Vinod](https://github.com/vinod-ea), originally released under the MIT License. The analysis logic has been ported from Node.js/Express/SQLite to Python/FastAPI/PostgreSQL and integrated natively into Turbo EA.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
