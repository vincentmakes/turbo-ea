# Turbo EA


[![CI](https://github.com/vincentmakes/turbo-ea/actions/workflows/ci.yml/badge.svg)](https://github.com/vincentmakes/turbo-ea/actions/workflows/ci.yml)
[![License: FSL-1.1-MIT](https://img.shields.io/badge/license-FSL--1.1--MIT-blue)](LICENSE)
[![Python 3.12](https://img.shields.io/badge/python-3.12-3776AB.svg)](https://www.python.org/)
[![React 19](https://img.shields.io/badge/react-19-61DAFB.svg)](https://react.dev/)
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

- **Configurable Metamodel** — 13 built-in card types across 4 architecture layers (Strategy, Business, Application, Technical). Add custom types, fields, subtypes, and relation types from the admin UI, including several relation types between the same two card types. Interactive metamodel graph visualization with hover highlighting, and per-locale translations for every label.
- **Inventory Management** — AG Grid-powered data table with search, dynamic multi-select filtering for all columns (subtype, lifecycle, data quality, attributes, relations), column customization with freeze and reorder, group-by with sticky headers, a right-click cell menu (filter by value, copy, preview), Excel-style drag-fill in edit mode, Excel import/export, mass edit, mass archive/delete, and select-all across filtered rows.
- **Card Detail Pages** — Full detail view with fields, lifecycle, hierarchy, relations, stakeholders, comments, todos, documents, file attachments, risks, decisions, and event history. Approval workflow (Draft/Approved/Rejected/Broken) with auto-breaking on substantive edits. Mandatory fields hold data quality at 0 until they are filled. Auto-computed data quality scoring (0–100%) based on field weights.
- **Card Logos** — Give any card a brand logo: pick one of 5,563 marks from the bundled brand-icon pack, upload your own, or let an AI assistant fetch one over MCP. Logos render in the inventory grid, on card detail, in diagrams, on the Layered Dependency View, and on public portals.
- **Hierarchy Support** — Parent-child trees for hierarchical card types. Business Capabilities enforce a 5-level depth (6 with a Macro tier) with auto-computed capability levels; hierarchy trees appear in relation pickers so you always know which level you are linking.
- **Inline Title Editing** — Rename cards directly from the title in the detail page header (no dialog needed) with permission-gated controls.
- **Favorites** — Per-user favorited cards for quick access from the dashboard.
- **Reference Catalogues** — Four browsable, industry-grouped reference sets to seed your own model: the [Capability Catalogue](https://docs.turbo-ea.org/guide/capability-catalogue/) (with a Macro tier above L1), the Process Catalogue (APQC-PCF style), the Value Stream Catalogue, and the Principles Catalogue. Import selected entries as cards or principles in one click.

![Dashboard](marketing-site/assets/screenshots/dashboard.png)

### Reporting & Analytics

- **Interactive Reports** — Portfolio bubble chart, flexible multi-axis portfolio, capability heatmap, lifecycle roadmap, dependency graph, cost treemap, matrix cross-reference, data quality dashboard, EOL risk report, process map, and EA delivery rollup. All report filters, colors, and grouping are dynamically generated from card type field schemas with auto-persist to localStorage, card scope pickers, and a 1/2/3 column layout switch.
- **Layered Dependency View** — Turbo EA's house notation for dependency diagrams: cards grouped into the four EA layers as swim lanes, colored by type, with edges that follow metamodel relation direction. Used by the Dependencies report, the card detail dependency section, and TurboLens, and exportable straight into a DrawIO diagram.
- **Dashboard with Trend Charts** — Daily KPI snapshots feed trend charts on the home dashboard (cards by type, average data quality, approvals over time) alongside a Recent Activity panel and a personal My Workspace tab.
- **Time-Travel** — Replay any report at a historical or future date with a timeline slider. Dependencies, Portfolio, and Capability Map add transition markers between two dates: arriving and retiring cards, severed dependencies, and a preview of planned cards.
- **Saved Reports** — Save report configurations (filters, axes, colors, grouping), share with other users (edit/view permissions), and generate OData feeds for programmatic access.
- **Export** — Print-to-PDF with a compact layout, one-click PowerPoint decks paginated per block, and Excel workbooks from any report, including the PPM portfolio.
- **Matrix Hierarchical Headers** — Matrix report supports hierarchical grouped headers, relation-type semantics, gap highlighting, and collapsible row/column depth controls.

### Diagrams

- **Diagram Editor** — Self-hosted DrawIO integration for creating architecture diagrams linked to your cards. Shapes carry the card-type icon and logo, are colored by one or several card types at once, and can show attributes, type, and subtype on the card.
- **Card Sync** — Drag cards from the inventory sidebar, expand a card into its related cards with relation edges drawn per relation type, create cards and relations from shapes and edges, and let the editor detect inventory changes when a diagram is opened.
- **Published Diagrams** — Share a diagram by public link or embed it in Confluence or an intranet page via iframe. The public payload is a picture: card ids and the relation graph are stripped, and embedding stays off until an operator allowlists origins.
- **Diagram Groups & Favorites** — Organise the gallery into folders with thumbnails and per-user favorites.

### Business Process Management (BPM)

- **BPMN 2.0 Editor** — Full process flow modeling with a built-in BPMN editor and viewer, template chooser, and process navigator.
- **Process Flow Versioning** — Draft, published, and archived states for process diagrams with approval workflows, withdraw, stakeholder sign-offs, and an optional segregation-of-duties rule.
- **Element Linking** — Link BPMN process elements to EA cards (applications, IT components, etc.) for traceability between processes and the IT landscape.
- **Process Assessments** — Record maturity assessments (efficiency, effectiveness, compliance, automation) with 1–5 scoring, action items, and historical tracking.
- **BPM Reports** — Process map, capability-process matrix, process-application matrix, process dependencies, and element-application map.
- **Process Navigator Portal** — Publish the process navigator as a read-only public portal so the wider organisation can browse processes without an account.

### Project Portfolio Management (PPM)

- **Portfolio Dashboard** — Gantt chart overview of all initiatives with quarter headers, cost aggregations, health status indicators, finish-to-start dependency arrows, and grouping by related card types (e.g., group by Organization or Platform). Exportable to PowerPoint and Excel.
- **Status Reports** — Periodic health snapshots for initiatives tracking schedule, cost, and scope health (on track / at risk / off track) with summary, accomplishments, and next steps.
- **Work Breakdown Structure** — Hierarchical WBS with parent-child nesting, milestones, date ranges, and auto-computed completion that rolls up from task progress through parent WBS items.
- **Task Board** — Kanban board (todo, in progress, done, blocked) with drag-and-drop, priority levels, assignees, due dates, tags, WBS linking, and threaded comments. Tasks auto-sync to the system todo list.
- **Budget & Cost Tracking** — Budget lines (capex/opex by fiscal year) and cost lines (actual expenditures with dates). Budget and cost totals auto-sync to the initiative card's costBudget and costActual fields and are available as calculation variables.
- **Initiative Risks** — Initiative-scoped risks with probability/impact scoring (1-5), auto-computed risk score, status tracking, mitigation plans, and a risk matrix. Landscape-level risks live in the GRC Risk Register below.
- **Portfolio Board Portal** — Publish the portfolio Gantt as a public portal type for sponsors and steering committees.

### Governance, Risk & Compliance (GRC)

A dedicated `/grc` module with three tabs, separate from initiative-level PPM risks.

- **EA Risk Register (TOGAF Phase G)** — Landscape-level register with auto-generated `R-000123` references, initial vs residual 4×4 probability×impact matrices, a sequential status workflow (analysis → mitigation → monitoring → closed) with explicit Accept / Reopen side actions, owner→Todo→notification loop, filtering by affected card, and grouping. Mitigation is task-driven: one-shot or recurring controls ("review access rights every 6 months") with lead-time gating and a per-occurrence audit trail of who signed off.
- **Compliance Scanner** — On-demand AI scans across EU AI Act, GDPR, NIS2, DORA, SOC 2, and ISO 27001 with a phase-aware progress bar, per-regulation heatmap, and a findings grid. Findings show severity, business impact, and remediation, and any finding can be promoted to a Risk Register entry in one click. The admin-managed regulation catalogue drives which rules run.
- **Governance** — Architecture principles and the decisions grid side by side, so a review board reads principles, ADRs, and risks in one place. Every card gets a Risks tab and a Decisions tab.

![GRC Risk Register](docs/assets/img/en/53_grc_risk_register.png)

### EA Delivery (TOGAF)

- **Architecture Decision Records (ADR)** — Capture decisions, context, alternatives considered, consequences, and links to affected cards. Sign-off workflow with audit trail, revisions and duplicates, DOCX export, and an extension-attribute bag so add-ons can enrich decisions.
- **EA Principles** — Admin-curated list of architecture principles (statement, rationale, implications) referenced from SoAW and ADR documents, seedable from the Principles Catalogue.
- **Statement of Architecture Work** — TOGAF-compliant SoAW editor with rich text editing (TipTap), version history, sign-off requests, and DOCX export.
- **EA Delivery Report** — Rollup of SoAWs and ADRs by status and initiative.

### AI-Powered Assistance

- **AI Description Suggestions** — Generate card descriptions with a single click using a two-step pipeline: web search (DuckDuckGo, Google Custom Search, or SearXNG) followed by LLM extraction. Supports self-hosted Ollama (optionally bundled via Docker Compose `--profile ai`) and commercial providers (OpenAI, Google Gemini, Azure OpenAI, OpenRouter, Anthropic Claude) with encrypted API key storage. Suggestions are type-aware — the prompt contextualizes each card based on its type (e.g., "software application", "technology vendor", "business process"). Results include a confidence score, editable text, and clickable source links. Admins control which card types get suggestions, the search provider, and the LLM model.

### TurboLens AI Intelligence

AI-powered EA analysis module that runs natively in Turbo EA using the same AI provider configuration.

- **Vendor Analysis** — AI categorizes technology vendors from your portfolio into 45+ industry categories, counting associated applications and costs. Results displayed with category breakdowns and detailed reasoning.
- **Vendor Resolution** — Builds a canonical vendor hierarchy by resolving aliases, parent-child relationships, and product groupings. Displays confidence scores for each resolution.
- **Duplicate Detection** — Identifies functional duplicate cards using AI clustering across Application, IT Component, and Interface types. Union-find algorithm merges overlapping clusters across batches. Each cluster includes evidence and retirement recommendations.
- **Modernization Assessment** — Evaluates cards for modernization opportunities based on current technology trends, providing effort estimates, priority levels, and specific recommendations.
- **Architecture AI** — 5-step guided wizard: (1) Requirements (objective + capability selection), (2) Business Fit clarification questions, (3) Technical Fit deep-dive, (4) Solution (options → gap analysis → dependency analysis), (5) Target Architecture with capability mapping rendered as a Layered Dependency View. Commits to a real Initiative card with proposed cards, relations, and a draft ADR. Saved assessments are reviewable later from the Assessments tab.

![TurboLens dashboard](docs/assets/img/en/75_turbolens_dashboard.png)

### Data Governance

- **Data Maintenance Surveys** — Admin-driven workflows for keeping card data accurate at scale. Target by card type with tag/relation/attribute filters or a "not updated since" rule. Users maintain or confirm field values; admins review and apply changes in bulk.
- **Calculated Fields** — Admin-configurable formula engine for computed fields. Supports IF, SUM, AVG, MIN, MAX, COUNT, ROUND, COALESCE, FILTER, MAP_SCORE with syntax-highlighted editor, inline autocomplete, cycle detection, and PPM budget/cost variables.
- **End-of-Life Tracking** — Integration with endoflife.date for monitoring technology lifecycle status. Fuzzy product search, mass search/link for IT components, and dedicated EOL report.
- **Data Quality Scoring** — Auto-calculated completeness percentage based on field schema weights. Data quality report shows by-type stats, orphaned/stale counts, and worst items, each drilling down to the inventory.
- **Audit Log & Rollback** — Every write made by an AI assistant over MCP or by an extension lands in a mutation batch with a per-event diff. Admins browse the ledger by origin (web, API, MCP, extension), inspect exactly what changed, and roll back a whole batch in one click.
- **Workspace Transfer** — Export the entire workspace (metamodel, settings, users, cards, relations, and ~30 module tables) as one `.zip` and import it into another Turbo EA instance with a dry-run diff first. Secrets never leave the source instance. See the [workspace transfer guide](https://docs.turbo-ea.org/admin/workspace-transfer/).
- **Platform Migration** — Upload a LeanIX workspace export, map its types and fields onto your metamodel (including existing fields and lifecycle phases), preview the staged records, and apply. Built on an adapter pattern so further source platforms can be added without touching the pipeline. See the [migration guide](https://docs.turbo-ea.org/admin/migration/).

![Workspace transfer](docs/assets/img/en/58_workspace_transfer.png)

### Collaboration

- **Notifications & Events** — Real-time SSE updates, an in-app notification bell with unread counts, and optional SMTP email alerts. Close to 30 notification types (todos, tasks, surveys, card and comment activity, approvals, sign-offs, risk and stakeholder changes, release announcements), each switchable per user and per channel; extensions can add channels such as Slack.
- **Release Notifications** — Admins are told in-app when a new Turbo EA release is available and see the release notes after an upgrade.
- **Threaded Comments** — Full threaded comment system on cards with edit and delete.
- **Todos** — Task management linked to cards with assignment, due dates, deep links, and status tracking. Badge counts for open todos shown in navigation.
- **Stakeholders** — Per-card stakeholder roles (responsible, observer, technical/business application owner) with configurable custom roles per card type.
- **Documents & Attachments** — Typed links and file attachments on cards, with admin-configurable link types and file categories, and a repository-wide Resources view.
- **Tags** — Tag groups with single/multi-select modes, mandatory flags, and per-card-type restrictions. Filter-by-tag across inventory and reports.

### Integrations

> [!IMPORTANT]
> SSO (Entra / Google / Okta / Generic OIDC) and the ServiceNow CMDB integration are implemented and shipping, but the maintainer has limited access to real-world identity providers and ServiceNow instances. Volunteer testers welcome — file an [integration-tester issue](https://github.com/vincentmakes/turbo-ea/issues/new?template=integration-tester.yml) or start a discussion.

- **SSO / Single Sign-On** — Support for multiple identity providers: **Microsoft Entra ID**, **Google Workspace**, **Okta**, and any **Generic OIDC** provider with automatic discovery document support. Provider-specific branded login buttons, Google hosted domain restriction, Okta domain configuration, manual OIDC endpoint configuration as fallback, and admin ability to link existing local accounts to SSO. Reverse-proxy header authentication (Azure App Service, oauth2-proxy, Authelia, Cloudflare Access) with directory-group-to-role mapping. SSO deep links survive the round trip.
- **MCP Server (AI Tool Access)** — Built-in [Model Context Protocol](https://modelcontextprotocol.io/) server that lets AI tools (Claude, GitHub Copilot, Cursor, VS Code) work with your EA data under per-user RBAC. Users authenticate via SSO — no shared service accounts. 51 tools: 32 read tools (search, relations, hierarchy, dashboards, reports, GRC, decisions, diagrams) and 19 write tools that create cards, relations, diagrams, risks, decisions, and logos, import BPMN, or archive cards. Every write defaults to a dry-run preview, lands in an auditable mutation batch, needs a confirmation token above a size threshold, and can be switched off with one environment variable. Activate with `docker compose --profile mcp up -d`; a local stdio mode works without SSO.
- **ServiceNow Integration** — Bidirectional sync with ServiceNow CMDB. Connection management, field mapping with transform rules, direction control (Turbo EA → SNOW, SNOW → Turbo EA, or bidirectional), staged record review before applying, and encrypted credential storage.
- **Web Portals** — Public, slug-based views of your EA landscape (no login required): a card portal with configurable type, fields, layout, and relation filters; a PPM portfolio board portal; and a Process Navigator portal. Each can be gated behind SSO with a domain allowlist, and card logos render on all of them.
- **OData Feeds** — Generate OData-compatible feeds from saved views and saved reports for consumption by external tools (Excel, Power BI, etc.).
- **REST API** — Every screen is backed by a documented OpenAPI spec, rendered in the [user manual](https://docs.turbo-ea.org/admin/api/).

### Extensions

Turbo EA ships an **Extension Store** (Admin → Extensions). Extensions are vendor-signed `.teax` bundles that install in seconds from the in-product store or from a file on an air-gapped instance, are licensed per instance, keep working across core upgrades, and never delete your data when a licence lapses or the extension is removed. Published extensions today:

| Extension | What it adds |
|---|---|
| [**Roadmap Studio**](https://store.turbo-ea.org) | What-if scenarios over the live landscape: planned cards, dated retirements and replacements, transition architectures at named plateaus, a comparison of scenarios on run cost, transition spend, and end-of-life exposure, a present mode, and PowerPoint export. Approving a scenario files a draft ADR and applying it creates the Initiative. |
| [**EA Value Tracker**](https://store.turbo-ea.org) | Claim categorized savings on Architecture Decision Records, record what was realized, approve realizations four-eyes, and report the claimed-to-realized funnel per fiscal year. |
| [**DORA Register of Information**](https://store.turbo-ea.org) | Maintain the EU DORA Art. 28 Register of Information from your Provider and Application cards, validate it against the EBA rules, and export the xBRL-CSV submission package plus an Excel review workbook. |
| [**EU AI Act Register**](https://store.turbo-ea.org) | Classify every AI system with an article-cited wizard, track provider/deployer and GPAI obligations against the staged deadlines, and export the register with Annex IV and FRIA document skeletons. |
| [**Digital Autonomy Assessment**](https://store.turbo-ea.org) (free) | Score applications with Utrecht University's DAAF framework: 22 weighted indicators, an autonomy score, and an autonomy-quadrant report. |
| [**Jira Todo Sync**](https://store.turbo-ea.org) | Two-way sync between Turbo EA todos and Jira Cloud issues, with status, due dates, and assignees aligned both ways. |
| [**SAP Signavio Sync**](https://store.turbo-ea.org) | Publish Applications, Organizations, Data Objects, and IT Components into the Signavio dictionary and mirror the Signavio process directory into Business Process cards. |
| [**Slack Notifications**](https://store.turbo-ea.org) | Deliver Turbo EA notifications as Slack direct messages, opt-in per user and per notification type. |

| | |
|---|---|
| ![Roadmap Studio scenario roadmap](marketing-site/assets/screenshots/ext-roadmap-studio-roadmap.png) | ![Roadmap Studio scenario comparison](marketing-site/assets/screenshots/ext-roadmap-studio-compare.png) |

Build your own: extensions can ship content packs, backend plugins, and UI plugins against a stable SDK (backend SDK 1.8, UI SDK 1.27) that exposes core's own components, data bridges, events, cron jobs, and encrypted secrets. Core also gates two authoring capabilities behind extension grants: per-field help text and custom field types. The `teax` CLI in [`scripts/extension-tools/`](scripts/extension-tools/) builds and verifies bundles; the customer-facing guide is the [Extension Store page](https://docs.turbo-ea.org/admin/extensions/) of the user manual, and the store itself lives at [store.turbo-ea.org](https://store.turbo-ea.org).

### Administration

- **Custom RBAC Roles** — Admin-configurable roles beyond the 3 built-in roles (admin/member/viewer) with 70+ granular permissions for both app-level and card-level actions. Typed URLs are gated exactly like the navigation.
- **Role Impersonation** — "View as role…" lets an admin temporarily act as another role to verify what non-admin users see; every action taken while impersonating is stamped with the real user.
- **Card Layout Editor** — Drag-and-drop visual editor for customizing card detail page layouts with section ordering, field grouping, 2-column support, and collapsible sections.
- **Saved Views with Sharing** — Save inventory filter/column/sort configurations with private, public, or shared visibility. Share with specific users with edit/view permissions.
- **Resources** — Repository-wide view of every file attachment and link with stats, filters, and bulk delete.
- **Custom Branding** — Upload a custom logo (max 2 MB; PNG, JPEG, SVG, WebP, GIF) and favicon. Per-portal logo visibility toggle.
- **Currency & Date Settings** — Global display currency for all cost values with compact formatting, and a workspace-wide date format.
- **SMTP Email Configuration** — Configure SMTP settings from the admin UI with test email support.
- **Design Tokens & UI Guidelines** — Centralized colors, spacing, typography, status/severity/layer palettes and icon sizes (`frontend/src/theme/tokens.ts`). See [`frontend/UI_GUIDELINES.md`](frontend/UI_GUIDELINES.md) for the full design system.

### Localization

- **10 UI languages** — English, German, French, Spanish, Italian, Portuguese, Chinese (Simplified), Russian, Danish, and Arabic with full right-to-left layout, including grids and charts. Admins choose which locales users can pick.
- **Translatable metamodel** — Card types, subtypes, fields, options, and relation verbs carry per-locale labels editable in the admin UI.
- **User manual in 9 languages** — [docs.turbo-ea.org](https://docs.turbo-ea.org) with screenshots retaken per language.

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
| ![GRC Compliance](docs/assets/img/en/54_grc_compliance.png) | ![Risk Matrix](docs/assets/img/en/78_risk_matrix.png) |
| ![Roadmap Studio present mode](marketing-site/assets/screenshots/ext-roadmap-studio-present.png) | ![DORA Register extension](docs/assets/img/en/72_ext_dora_dashboard.png) |

</details>

---

## Quick Start

The recommended way to deploy Turbo EA. The bundled `docker-compose.yml` stack starts PostgreSQL, the backend, the frontend, and the public edge nginx, and it can terminate HTTPS directly when you provide certificate files.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

### 1. Create a deployment directory and fetch the compose file

```bash
mkdir turbo-ea && cd turbo-ea
curl -O https://raw.githubusercontent.com/vincentmakes/turbo-ea/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/vincentmakes/turbo-ea/main/.env.example
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

# Port the app will be available on over HTTP (default: 8920)
HOST_PORT=8920
```

For direct HTTPS from the bundled docker stack, also set:

> The Turbo EA compose file does **not** include a certbot container. You must provide the certificate and private key yourself, either by placing them in a local `./certs` directory or by pointing `TLS_CERTS_DIR` at a sibling certbot / letsencrypt folder that another process manages.

```dotenv
HOST_PORT=80
TLS_HOST_PORT=443
TURBO_EA_PUBLIC_URL=https://ea.yourdomain.com
ALLOWED_ORIGINS=https://ea.yourdomain.com
TURBO_EA_TLS_ENABLED=true

# If you use a companion certbot repo or sibling letsencrypt folder:
TLS_CERTS_DIR=../certbot/certs
TURBO_EA_TLS_CERT_FILE=cert.pem
TURBO_EA_TLS_KEY_FILE=key.pem
```

### 3. Start the app

```bash
docker compose pull
docker compose up -d
```

This uses the single `docker-compose.yml` stack, which includes PostgreSQL and the public nginx edge. Data is persisted in the `postgres_data` Docker volume.

That's it. Open **http://localhost:8920** in your browser, or `https://your-domain` if you enabled direct TLS. When TLS is enabled, the bundled nginx serves both HTTP and HTTPS and redirects HTTP traffic to HTTPS automatically.

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
- `ghcr.io/vincentmakes/turbo-ea/mcp-server`
- `ghcr.io/vincentmakes/turbo-ea/ollama` *(rebuilt manually when upstream Ollama changes; not part of the regular CI matrix)*

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

### Verifying images

From `1.0.0` onwards, every published image is signed with [cosign](https://github.com/sigstore/cosign) using GitHub's keyless OIDC flow — no shared signing key, the certificate is bound to the publish workflow identity. Verification before pulling into production is one command:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend:1.0.0
```

The same command works for `db`, `frontend`, `nginx`, and `mcp-server`. A buildkit-generated SPDX SBOM is attached to each image as an OCI referrer; pull it with `docker buildx imagetools inspect --format '{{ json .SBOM }}' <image>:<tag>`. See [`docs/admin/supply-chain.md`](docs/admin/supply-chain.md) for details.

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
- Node.js 24+ (LTS)
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
│  React 19 + MUI 6 + React Router 8 + Recharts + AG Grid   │
│  Vite dev server (port 5173) / Nginx in production        │
└──────────────────────────┬────────────────────────────────┘
                           │  /api/* (proxy)
┌──────────────────────────▼────────────────────────────────┐
│  FastAPI Backend (Python 3.12, uvicorn, port 8000)        │
│  SQLAlchemy 2 (async) + Alembic migrations                │
│  JWT auth (HMAC-SHA256, bcrypt passwords) + RBAC          │
│  SSE event stream for real-time updates                   │
│  Fernet field encryption + signed extension loader        │
└──────────────────────────┬────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────┐
│  PostgreSQL 18 (asyncpg driver)                           │
└───────────────────────────────────────────────────────────┘
```

**DrawIO** is self-hosted inside the frontend Docker image (cloned at build time from `jgraph/drawio` v31.4.1) and served under `/drawio/` by Nginx.

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
| `HOST_PORT` | `8920` | Public HTTP port exposed on the host by the bundled edge nginx. Set `80` for direct HTTPS deployments with redirect support. |
| `TLS_HOST_PORT` | `9443` | Public HTTPS port exposed on the host when direct TLS is enabled. Set `443` for standard HTTPS deployments. |
| `ALLOWED_ORIGINS` | `http://localhost:8920` | CORS allowed origins (comma-separated) |
| `TURBO_EA_TLS_ENABLED` | `false` | Enable direct TLS termination in the bundled edge nginx. Turbo EA does not bundle certbot; you must provide certificate files yourself. |
| `TLS_CERTS_DIR` | `./certs` | Host path mounted read-only at `/certs` inside the nginx container. Point this at your own certbot / letsencrypt output directory if another process manages renewal. |
| `TURBO_EA_TLS_CERT_FILE` | `cert.pem` | Certificate filename inside `TLS_CERTS_DIR` |
| `TURBO_EA_TLS_KEY_FILE` | `key.pem` | Private-key filename inside `TLS_CERTS_DIR` |
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
| `MCP_PUBLIC_URL` | `http://localhost:8920/mcp` (docker compose; code default `http://localhost:8001`) | (MCP server) Public URL for OAuth metadata |
| `TURBO_EA_PUBLIC_URL` | `http://localhost:8920` | Public-facing Turbo EA URL (also drives bundled nginx hostname/proto) |

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

### Stability

From `1.0.0` onwards, Turbo EA commits to documented backwards compatibility within the `1.x` line — the database schema, REST API surface under `/api/v1/`, permission keys, and built-in metamodel are stable, with a deprecation cycle for any covered change.

- **[Compatibility policy →](https://docs.turbo-ea.org/reference/compatibility/)** — what's covered, what isn't, how deprecations work.
- **[Releases and pre-release channel →](https://docs.turbo-ea.org/reference/releases/)** — how versions are tagged, how RCs work, the maintainer's release checklist.

Pin a specific version in production rather than `:latest`:

```bash
TURBO_EA_TAG=1.0.0 docker compose up -d
```

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
│   │   │   │                # EOL, web portals, integrations, card layout,
│   │   │   │                # calculations, tags, extension store, audit log,
│   │   │   │                # resources, platform migration, workspace transfer
│   │   │   ├── auth/        # Login, SSO callback, password setup
│   │   │   ├── bpm/         # BPMN editor, viewer, process navigator,
│   │   │   │                # assessments, element linker, BPM reports
│   │   │   ├── ppm/         # Portfolio dashboard, initiative detail,
│   │   │   │                # task board, risk matrix, cost tracking, WBS
│   │   │   ├── cards/       # Card detail page
│   │   │   ├── dashboard/   # KPI cards + recent activity
│   │   │   ├── diagrams/    # DrawIO editor, shape system, published diagrams
│   │   │   ├── ea-delivery/ # SoAW + ADR editors, DOCX export
│   │   │   ├── grc/         # Risk Register, compliance scanner, governance
│   │   │   ├── inventory/   # AG Grid table + Excel import/export
│   │   │   ├── reports/     # 11 report types + saved reports + LDV renderer
│   │   │   ├── turbolens/   # AI-powered EA intelligence (vendors, duplicates,
│   │   │   │                # modernization, architecture AI)
│   │   │   ├── capability-catalogue/   # Industry capability catalogue browser
│   │   │   ├── process-catalogue/      # Business process reference set
│   │   │   ├── value-stream-catalogue/ # Value stream reference set
│   │   │   ├── principles-catalogue/   # EA principles reference set
│   │   │   ├── reference-catalogue/    # Shared catalogue shell
│   │   │   ├── surveys/     # Survey response page
│   │   │   ├── todos/       # Todos + surveys combined page
│   │   │   └── web-portals/ # Public portal viewer
│   │   ├── lib/             # Extension host (window.TurboEA.sdk), route permissions
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

## License

Turbo EA is licensed under the [Functional Source License 1.1 with MIT Future License (FSL-1.1-MIT)](LICENSE).

**What this means in practice:**

- ✅ **Use it freely.** Self-host Turbo EA in your company, for any internal purpose, commercial or not. No fees, no seat limits, no strings.
- ✅ **Modify it.** Fork it, adapt it, build on it for your own use.
- ✅ **Consult with it.** Professional services helping organizations adopt and run Turbo EA are explicitly permitted.
- ✅ **It becomes MIT.** Each release automatically converts to the MIT license two years after publication. The code always returns to fully permissive open source.
- ❌ **Don't resell it.** You may not offer Turbo EA (or a derivative) to third parties as a competing commercial product, or as a hosted/managed service.

Versions up to and including v1.66.x remain under the MIT license.

Third-party components incorporated into Turbo EA keep their own licenses — see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

If you want to build a commercial offering on Turbo EA, get in touch at **vincent at turbo-ea.org** — I'm open to partnerships.
