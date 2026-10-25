# Turbo EA architecture reference

> Reference material moved out of `CLAUDE.md`: not loaded into agent sessions. The code is the source of truth; when a table here disagrees with it, fix the table.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | `localhost` | PostgreSQL hostname |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DB` | `turboea` | Database name |
| `POSTGRES_USER` | `turboea` | Database user |
| `POSTGRES_PASSWORD` | `turboea` | Database password |
| `SECRET_KEY` | `change-me-in-production` | HMAC key for JWT signing. **Must** be changed in production (app refuses to start with default in non-development environments) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` (24h) | JWT token lifetime |
| `HOST_PORT` | `8920` | Public HTTP port exposed on the host for the bundled edge nginx. Set `80` for direct HTTPS deployments with redirect support. |
| `TLS_HOST_PORT` | `9443` | Public HTTPS port exposed on the host when direct TLS is enabled. Set `443` for standard HTTPS deployments. |
| `RESET_DB` | `false` | Drop all tables and re-create + re-seed on startup |
| `SEED_DEMO` | `false` | Populate NexaTech Industries demo data on startup |
| `SEED_BPM` | `false` | Populate demo BPM processes |
| `SEED_PPM` | `false` | Populate demo PPM data (status reports, WBS, tasks, budgets, costs, risks) |
| `TURBO_EA_TLS_ENABLED` | `false` | Enable direct TLS termination in the bundled edge nginx |
| `TLS_CERTS_DIR` | `./certs` | Host path mounted read-only at `/certs` inside the nginx container |
| `TURBO_EA_TLS_CERT_FILE` | `cert.pem` | Certificate filename inside `TLS_CERTS_DIR` |
| `TURBO_EA_TLS_KEY_FILE` | `key.pem` | Private-key filename inside `TLS_CERTS_DIR` |
| `ENVIRONMENT` | `development` | Runtime environment. Controls: API docs visibility, secret key validation |
| `ALLOWED_ORIGINS` | `http://localhost:8920` | CORS allowed origins (comma-separated) |
| `TURBO_EA_EMBED_ALLOWED_ORIGINS` | *(empty)* | Comma-separated origins allowed to embed a **published diagram** in an iframe (e.g. `https://acme.atlassian.net`). Empty ⇒ `frame-ancestors 'self'`, i.e. no other site may frame Turbo EA at all — published links still work when opened directly. Applies only to `/embed/`, `/api/v1/diagrams/public/` and `/drawio-embed/`; the app and its diagram editor stay un-framable. |
| `TRUST_PROXY_HEADERS` | `false` in code, `true` in the backend image | Read the client address from the `X-Real-IP` header the edge nginx overwrites on every proxied location (`core/request_context.py`). The Security & admin log records it and the slowapi rate limiter keys on it (`core/rate_limit.py`). Set `false` only when something other than the bundled nginx can reach the backend, or a client could choose its own recorded address. Compose and the Helm chart (`backend.trustProxyHeaders`) pass it through. |
| `NGINX_TRUSTED_PROXIES` | *(empty)* | (Edge nginx) Comma- or space-separated IPs / CIDR ranges of the load balancer, ingress or CDN in front of the edge nginx. Non-empty emits `set_real_ip_from` per entry plus `real_ip_header X-Forwarded-For; real_ip_recursive on;` into every server block, so `$remote_addr` (and therefore `X-Real-IP`) becomes the real client; anything that is not an address refuses to start. Empty emits nothing. Chart `nginx.trustedProxies`, Bicep `nginxTrustedProxies`, CloudFormation `NginxTrustedProxies`, Terraform `nginx_trusted_proxies`. Guard test: `tests/services/test_nginx_real_ip.py`. |
| `SMTP_HOST` | *(empty)* | SMTP server hostname (optional) |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | *(empty)* | SMTP username |
| `SMTP_PASSWORD` | *(empty)* | SMTP password |
| `SMTP_FROM` | `noreply@turboea.local` | Sender email address |
| `SMTP_TLS` | `true` | Use TLS for SMTP |
| `AI_PROVIDER_URL` | *(empty)* | Ollama-compatible LLM provider URL (e.g., `http://ollama:11434`) |
| `AI_MODEL` | *(empty)* | LLM model name (e.g., `mistral`, `gemma3:4b`, `llama3:8b`) |
| `AI_SEARCH_PROVIDER` | `duckduckgo` | Web search provider for AI context: `duckduckgo`, `google`, or `searxng` |
| `AI_SEARCH_URL` | *(empty)* | Search provider URL: SearXNG URL or `API_KEY:CX` for Google |
| `AI_AUTO_CONFIGURE` | `false` | Auto-enable AI on startup if provider is reachable |
| `OLLAMA_MEMORY_LIMIT` | `4G` | Memory limit for bundled Ollama container (Docker `--profile ai`) |
| `TURBO_EA_URL` | `http://localhost:8000` | (MCP server) Internal backend URL |
| `TURBO_EA_PUBLIC_URL` | `http://localhost:8920` | Public-facing Turbo EA URL for OAuth redirects and bundled nginx hostname/proto derivation |
| `MCP_PUBLIC_URL` | `http://localhost:8001` | (MCP server) Public URL for OAuth metadata |
| `MCP_PORT` | `8001` | (MCP server) Bind port |
| `MCP_WRITES_ENABLED` | `true` | (MCP server) Kill switch for all 19 write tools — set to `false` to put the MCP server into read-only mode without a code redeploy. Read tools keep working. |
| `MCP_MAX_CARDS_PER_CALL` | `200` | (MCP server) Per-call size cap for `create_cards_bulk`. The backend `/cards/bulk-create` endpoint still accepts up to 2000 for the legitimate Excel importer; the MCP wrapper enforces this lower cap so a dry-run preview stays reviewable. |
| `MCP_MAX_RELATIONS_PER_CALL` | `500` | (MCP server) Per-call size cap for `upsert_relations_bulk`. Backend accepts up to 5000 from the UI. |
| `MCP_MAX_LOGOS_PER_CALL` | `50` | (MCP server) Per-call cap for `set_card_logos`. Lower than the card cap because each logo is its own upload and carries image bytes. |
| `MCP_ALLOW_RELATION_DELETE` | `false` | (MCP server) When `false` (default), `upsert_relations_bulk` refuses `action: "delete"` ops — relations must be removed via the web UI for an explicit audit trail. Set `true` only when an operator opts in. |
| `MCP_LOGO_FETCH_ENABLED` | `true` | (MCP server) Allows `set_card_logos` to take an `image_url`, which the MCP server downloads and uploads through the ordinary route. `false` refuses the URL path; slugs and pasted bytes are unaffected. |
| `MCP_LOGO_FETCH_HOSTS` | *(built-in list)* | (MCP server) Comma-separated hosts a logo may be fetched from, **exact match**. Empty ⇒ `raw.githubusercontent.com`, `cdn.jsdelivr.net`, `cdn.simpleicons.org`, `upload.wikimedia.org`. |
| `EXTENSION_WRITES_ENABLED` | `true` | Kill switch for the extension data bridge's write surface — set `false` to pause all extension inventory writes instantly (no restart; reads keep working). |
| `EXTENSION_MAX_WRITES_PER_BATCH` | `500` | Per-batch cap on writes an extension may group into one audited mutation batch. |
| `EXTENSION_MAX_BATCHES_PER_MINUTE` | `60` | Per-extension sliding-window cap on mutation batches per minute (implicit single-write batches included). |

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
| `users` | `User` | Email, display_name, password_hash, role_key (FK to roles), is_active, SSO fields, password_reset_token / password_reset_expires_at (local-account forgot-password flow) |
| `card_types` | `CardType` | Metamodel: types with key, label, icon, color, category, subtypes (JSONB), fields_schema (JSONB), section_config (JSONB), stakeholder_roles (JSONB), has_hierarchy, built_in, is_hidden, sort_order |
| `relation_types` | `RelationType` | Metamodel: allowed relations between types with label, reverse_label, cardinality, attributes_schema (JSONB) |
| `cards` | `Card` | The core entity. Type, subtype, name, description, parent_id (hierarchy), lifecycle (JSONB), attributes (JSONB), status, approval_status, data_quality (float 0-100), archived_at |
| `relations` | `Relation` | Links between cards. Type key, source_id, target_id, attributes (JSONB) |

### RBAC Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `roles` | `Role` | App-level roles with key, label, color, permissions (JSONB), is_system, is_default, is_archived, sort_order |
| `stakeholder_role_definitions` | `StakeholderRoleDefinition` | Per-card-type stakeholder role definitions with permissions, is_archived |
| `stakeholders` | `Stakeholder` | User role assignments on specific cards |

### BPM Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `process_diagrams` | `ProcessDiagram` | BPMN 2.0 XML storage linked to BusinessProcess cards |
| `process_elements` | `ProcessElement` | Extracted BPMN elements (tasks, events, gateways, lanes, data objects/stores), incl. `event_definition_type` + `definition_name` |
| `process_message_flows` | `ProcessMessageFlow` | Messages exchanged between pools, with an optional `interface_id` link to an Interface card |
| `process_flow_versions` | `ProcessFlowVersion` | Version history with approval workflow (draft/pending/published/archived) |
| `process_assessments` | `ProcessAssessment` | Process scores: efficiency, effectiveness, compliance |

### PPM Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `ppm_status_reports` | `PpmStatusReport` | Initiative health reports: schedule/cost/scope health, summary, accomplishments, next steps |
| `ppm_cost_lines` | `PpmCostLine` | Actual cost transactions: description, category (capex/opex), planned, actual, date |
| `ppm_budget_lines` | `PpmBudgetLine` | Planned budget per fiscal year: category (capex/opex), amount, optional description; several lines per fiscal year + category are allowed by design (no uniqueness check anywhere) |
| `ppm_risks` | `PpmRisk` | Initiative risks: probability (1-5), impact (1-5), auto-computed risk_score, mitigation, status |
| `ppm_tasks` | `PpmTask` | Work items: status (todo/in_progress/done/blocked), priority, assignee, tags (JSONB), WBS link |
| `ppm_task_comments` | `PpmTaskComment` | Comments on PPM tasks |
| `ppm_wbs` | `PpmWbs` | Work Breakdown Structure: self-referential hierarchy, completion (auto-rolled up), milestones |
| `ppm_dependencies` | `PpmDependency` | Finish-to-start schedule dependency between two PPM rows (task and/or WBS item), used by the Gantt view |

### Calculation Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `calculations` | `Calculation` | Admin-defined formulas: name, formula, target_type_key, target_field_key, is_active, execution_order |

### Supporting Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `tag_groups` | `TagGroup` | Tag categories with mode (single/multi), mandatory flag, restrict_to_types. Mandatory groups that apply to a card type must be satisfied before the card can be approved and also contribute to the data-quality score |
| `tags` | `Tag` | Individual tags within groups, with optional color |
| `card_tags` | (association) | M:N join table |
| `comments` | `Comment` | Threaded comments on cards (self-referential parent_id) |
| `todos` | `Todo` | Tasks linked to cards, assignable to users, with due dates |
| `documents` | `Document` | URL/link attachments on cards |
| `bookmarks` | `Bookmark` | Saved inventory filter/column/sort views per user |
| `events` | `Event` | Audit trail: event_type + JSONB data, linked to card and user |
| `diagrams` | `Diagram` | DrawIO diagram storage: name, type, data (JSONB with XML + thumbnail) |
| `diagram_initiatives` | (association) | M:N between diagrams and initiative cards |
| `diagram_groups` | `DiagramGroup` | Named folders that organise diagrams in the gallery |
| `diagram_favorites` | `DiagramFavorite` | Per-user favorited diagrams (M:N user × diagram) |
| `resource_types` | `ResourceType` | Admin-managed resource-type catalogue used by the metamodel |
| `statement_of_architecture_works` | `SoAW` | TOGAF SoAW documents linked to initiatives |
| `app_settings` | `AppSettings` | Singleton row: email_settings, general_settings (incl. AI config), custom_logo, custom_favicon |
| `surveys` | `Survey` | Data-maintenance surveys with target_type, filters, actions |
| `survey_responses` | `SurveyResponse` | Per card + user responses |
| `notifications` | `Notification` | Per-user notifications |
| `web_portals` | `WebPortal` | Public portals with slug-based URLs |
| `saved_reports` | `SavedReport` | Persisted report configurations with thumbnails |
| `sso_invitations` | `SsoInvitation` | Pre-assigned SSO invitations |
| `architecture_decisions` | `ArchitectureDecision` | ADR records (status, context, decision, alternatives, consequences) |
| `architecture_decision_cards` | `ArchitectureDecisionCard` | M:N junction between ADRs and cards |
| `ea_principles` | `EAPrinciple` | EA principles (statement, rationale, implications, sort_order, optional `catalogue_id` linking back to the bundled Principles Catalogue) — exposed via `/metamodel/principles`; the curated reference set is browsable at `/principles-catalogue` |
| `kpi_snapshots` | `KpiSnapshot` | Daily KPI snapshots powering the dashboard trend charts |
| `user_favorites` | `UserFavorite` | Per-user favorited cards (M:N user × card) |
| `risks` | `Risk` | EA Risk Register entries (TOGAF Phase G) — see Risk Register section |
| `risk_cards` | `RiskCard` | M:N junction between risks and affected cards |
| `risk_mitigation_tasks` / `risk_mitigation_task_occurrences` | `RiskMitigationTask` / `RiskMitigationTaskOccurrence` | Task-driven mitigation with recurring occurrences — see Risk Register section |
| `compliance_regulations` | `ComplianceRegulation` | Admin-managed regulation catalogue driving the GRC Compliance scanner |
| `turbolens_*` | TurboLens models | Vendor analysis, duplicates, modernizations, analysis runs, compliance findings — see TurboLens section |
| `mutation_batches` | `MutationBatch` | MCP write ledger — every MCP write call opens a batch; each emitted row in the `events` table is stamped with its `batch_id` (see MCP section) |
| `workspace_transfers` | `WorkspaceTransfer` | Async preview/apply lifecycle of an uploaded full-workspace export bundle (`uploaded → parsing → previewed → applying → applied`/`failed`). Bundle binary stored on disk under `data/workspace_transfers/{id}.bin` (see Workspace Transfer Conventions) |

### Migration (Platform Import) Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `migrations` | `Migration` | One row per uploaded third-party EA export (LeanIX, …), with `source_type` discriminator |
| `staged_records` | `StagedRecord` | Source-neutral staged entities/relations/etc. awaiting apply |
| `migration_identity_map` | `IdentityMap` | External-id → TEA-id map, keyed `(source_id, entity_kind, source_type)` |

### ServiceNow Integration Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `snow_connections` | `SnowConnection` | ServiceNow instance connection details |
| `snow_mappings` | `SnowMapping` | Card type ↔ ServiceNow table mappings (with skip_staging flag) |
| `snow_field_mappings` | `SnowFieldMapping` | Field-level mapping rules |
| `snow_sync_runs` | `SnowSyncRun` | Sync execution history |
| `snow_staged_records` | `SnowStagedRecord` | Staged records for review before apply |
| `snow_identity_map` | `SnowIdentityMap` | Persistent ID mapping between systems |

### Migrations

Located in `backend/alembic/versions/` (116 migration files, sequentially numbered `001_` through `116_`). The app auto-runs Alembic on startup:
- Fresh DB: `create_all` + stamp head
- Existing DB without Alembic: stamp head
- Normal: `upgrade head` (run pending migrations)
- `RESET_DB=true`: drop all + recreate + stamp head

### Key Patterns

**API Client** (`src/api/client.ts`): Thin fetch wrapper that sends `credentials: "same-origin"` so the httpOnly auth cookie rides along, and stamps `X-Turbo-EA-Origin: web` for the audit log. Methods: `api.get()`, `api.post()`, `api.patch()`, `api.put()`, `api.delete()`, `api.upload()`, `api.getRaw()`. Handles 204 empty responses and formats validation errors. Custom `ApiError` class with `status` and `detail` fields.

**Authentication** (`hooks/useAuth.ts`): The JWT lives only in the backend-set httpOnly cookie; the hook keeps an in-memory signed-in flag (`setAuthenticated`) and, on load, validates via `GET /auth/me`. SSO callback support via `/auth/callback`. Password setup for invited users via `/auth/set-password`.

**Metamodel Cache** (`hooks/useMetamodel.ts`): Module-level singleton cache. Fetches types + relation types once, shared across all components. `invalidateCache()` forces re-fetch.

**Permissions** (`hooks/usePermissions.ts`): Fetches effective permissions for a card by combining app-level role + stakeholder roles. Used by CardDetail to enable/disable edit controls.

**Calculated Fields** (`hooks/useCalculatedFields.ts`): Fetches `type_key → field_keys[]` map. CardDetail uses this to show "calc" badges and prevent manual editing of computed fields.

**Real-time Updates** (`hooks/useEventStream.ts`): SSE connection to `/events/stream`. Auto-reconnects on error. Badge count refresh debounced at 500ms via `AppLayout.tsx`.

**Currency** (`hooks/useCurrency.ts`): Module-level singleton cache. Provides `fmt()`, `fmtShort()`, and `symbol` for consistent cost display.

**Data Quality Scoring**: Backend auto-computes `data_quality` (0-100%) based on `fields_schema` weights. Approval status auto-breaks to `BROKEN` when approved items are edited.

**Card Detail Sections**: Each section is an independent component in `features/cards/sections/`, wrapped in `ErrorBoundary`. Section ordering is controlled by `section_config.__order` in the metamodel. Custom sections are rendered via `AttributeSection` (fully data-driven from `fields_schema`).

**Report Architecture**: Reports share `ReportShell` for consistent layout, `MetricCard` for KPI display, `ReportLegend` for legends, and `SaveReportDialog`/`EditReportDialog` for save/edit workflows.

**MUI Dialog Nesting**: When dialogs are nested (e.g., TypeDetailDrawer contains FieldEditorDialog), inner dialogs use `disableRestoreFocus` to prevent `aria-hidden` focus warnings.

## Metamodel

The default metamodel seeds 13 card types across 4 layers and 30+ relation types. Created on first startup by `backend/app/services/seed.py`.

### Card Types

| Key | Label | Icon | Color | Layer | Hierarchy | Subtypes |
|-----|-------|------|-------|-------|-----------|----------|
| `Objective` | Objective | flag | #c7527d | Strategy & Transformation | No | - |
| `Platform` | Platform | layers | #027446 | Strategy & Transformation | No | Digital, Technical |
| `Initiative` | Initiative | rocket_launch | #33cc58 | Strategy & Transformation | Yes | Idea, Program, Project, Epic |
| `Organization` | Organization | corporate_fare | #2889ff | Business Architecture | Yes | Business Unit, Region, Legal Entity, Team, Customer |
| `BusinessCapability` | Business Capability | account_tree | #003399 | Business Architecture | Yes | - |
| `BusinessContext` | Business Context | swap_horiz | #fe6690 | Business Architecture | Yes | Process, Value Stream, Customer Journey, Business Product, ESG Capability |
| `BusinessProcess` | Business Process | route | #028f00 | Business Architecture | Yes | Core, Support, Management |
| `Application` | Application | apps | #0f7eb5 | Application & Data | Yes | Business Application, Microservice, AI Agent, Deployment |
| `Interface` | Interface | sync_alt | #02afa4 | Application & Data | No | Logical Interface, API, MCP Server |
| `DataObject` | Data Object | database | #774fcc | Application & Data | Yes | - |
| `ITComponent` | IT Component | memory | #d29270 | Technical Architecture | Yes | Software, Hardware, SaaS, PaaS, IaaS, Service, AI Model |
| `TechCategory` | Tech Category | category | #a6566d | Technical Architecture | Yes | - |
| `Provider` | Provider | storefront | #ffa31f | Technical Architecture | No | - |

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
| `multiline_text` | Multi-line text | Multiline TextField |
| `number` | Numeric | NumberField |
| `cost` | Numeric with currency formatting | NumberField + currency symbol |
| `percentage` | Number 0–100, validated server-side (`_validate_percentage_attributes`) | `PercentBar` (progress bar + `NN%`); edited with `PercentageInput` (5%-step slider + free number box) |
| `boolean` | Toggle | Switch |
| `date` | ISO date | DatePicker |
| `url` | Validated URL (http/https/mailto) | Clickable link input |
| `single_select` | Single choice from options | Select dropdown |
| `multiple_select` | Multiple choices from options | Multi-select chips |

## Calculations (Computed Fields)

Admin-defined formulas that automatically compute field values when cards are saved.

### Engine (`calculation_engine.py`)
- Safe sandboxed evaluation using `simpleeval`
- **Built-in functions**: IF, SUM, AVG, MIN, MAX, COUNT, ROUND, ABS, LN, COALESCE, LOWER, UPPER, CONCAT, CONTAINS, PLUCK, FILTER, MAP_SCORE
- **Context variables**: Card attributes, relations data, lifecycle info
- Automatic execution on card save via `run_calculations_for_card()`
- Dependency ordering via `execution_order` field

### Example Formulas
```
SUM(PLUCK(related_applications, "costTotalAnnual"))
IF(riskLevel == "critical", 100, IF(riskLevel == "high", 75, 25))
COUNT(FILTER(related_interfaces, "status", "ACTIVE"))
```

### API Routes (`/turbolens`)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/status` | authenticated | AI config status |
| GET | `/overview` | `turbolens.view` | Dashboard KPIs |
| POST | `/vendors/analyse` | `turbolens.manage` | Trigger vendor categorization (background) |
| GET | `/vendors` | `turbolens.view` | Get vendor analysis results |
| POST | `/vendors/resolve` | `turbolens.manage` | Trigger vendor resolution (background) |
| GET | `/vendors/hierarchy` | `turbolens.view` | Get vendor hierarchy |
| POST | `/duplicates/analyse` | `turbolens.manage` | Trigger duplicate detection (background) |
| GET | `/duplicates` | `turbolens.view` | Get duplicate clusters |
| PATCH | `/duplicates/{id}/status` | `turbolens.manage` | Update cluster status |
| POST | `/duplicates/modernize` | `turbolens.manage` | Trigger modernization assessment (background) |
| GET | `/duplicates/modernizations` | `turbolens.view` | Get modernization results |
| GET | `/architect/objectives` | `turbolens.manage` | Search Objective cards for autocomplete |
| GET | `/architect/capabilities` | `turbolens.manage` | Search BusinessCapability cards |
| GET | `/architect/objective-dependencies` | `turbolens.manage` | BFS depth-1 dependency subgraph for objectives |
| POST | `/architect/phase1` | `turbolens.manage` | Business clarification questions |
| POST | `/architect/phase2` | `turbolens.manage` | Technical deep-dive questions |
| POST | `/architect/phase3/options` | `turbolens.manage` | Generate solution options |
| POST | `/architect/phase3/gaps` | `turbolens.manage` | Gap analysis for selected option |
| POST | `/architect/phase3/deps` | `turbolens.manage` | Dependency analysis for selected products |
| POST | `/architect/phase3` | `turbolens.manage` | Capability mapping (full target architecture) |
| POST | `/architect/commit` | `turbolens.manage` | Commit initiative from assessment (creates cards + relations + ADR) |
| POST | `/assessments` | `turbolens.manage` | Save assessment |
| GET | `/assessments` | `turbolens.view` | List saved assessments |
| GET | `/assessments/{id}` | `turbolens.view` | Get assessment details |
| GET | `/analysis-runs` | `turbolens.view` | Analysis run history |
| GET | `/analysis-runs/{run_id}` | `turbolens.view` | Get specific run with results (or progress while still running) |
| POST | `/compliance/compliance-scan` | `compliance.manage` | Trigger compliance scan with optional `regulations[]` filter (background task) |
| GET | `/compliance/active-runs` | `compliance.view` | Return the currently-running compliance scan so the UI can reattach polling after a refresh |
| GET | `/compliance/overview` | `compliance.view` | KPIs: compliance scores + per-regulation status matrix, last-run metadata |
| GET | `/compliance/compliance` | `compliance.view` | Compliance findings grouped by regulation with per-regulation scores |
| POST | `/compliance/compliance-findings` | `compliance.manage` | Create / upsert a compliance finding |
| PATCH | `/compliance/compliance-findings/{id}` | `compliance.manage` | Update a finding (status, severity, evidence, remediation, …) |
| PATCH | `/compliance/compliance-findings/bulk` | `compliance.manage` | Bulk-update findings |
| DELETE | `/compliance/compliance-findings/{id}` | `compliance.manage` | Delete a single finding |
| DELETE | `/compliance/compliance-findings/bulk` | `compliance.manage` | Bulk-delete findings |
| POST | `/compliance/compliance-findings/{id}/ai-verdict` | `compliance.manage` | Request an AI verdict on a single finding (helper for the human reviewer) |

### Risk Register API (`/risks` + `/cards/{id}/risks`)

TOGAF-aligned Risk Register mounted at `/api/v1/risks`, plus a card sub-route for the Card Detail → Risks tab.

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/risks` | `risks.view` | Paginated, filterable risk list (status, category, level, owner, card_id, source_type, search, overdue) |
| GET | `/risks/metrics` | `risks.view` | KPIs + initial and residual 4×4 matrices |
| GET | `/risks/{id}` | `risks.view` | Single risk + linked cards + owner display name |
| POST | `/risks` | `risks.manage` | Manual risk creation (auto-assigns `R-000123` reference) |
| PATCH | `/risks/{id}` | `risks.manage` | Update fields; recomputes derived levels; enforces status transitions; requires `acceptance_rationale` to move to `accepted` |
| DELETE | `/risks/{id}` | `risks.manage` | Delete risk + clean up the owner's system Todo |
| POST | `/risks/{id}/cards` | `risks.manage` | Link one or more cards (idempotent) |
| DELETE | `/risks/{id}/cards/{card_id}` | `risks.manage` | Unlink a single card |
| POST | `/risks/promote/compliance/{finding_id}` | `risks.manage` + `compliance.view` | Promote a compliance finding to a risk (idempotent — returns existing one if already promoted). Seeds title, description, category, probability/impact, links the finding's card, and **spawns a one-shot mitigation task from the finding's remediation text**. |
| GET | `/cards/{id}/risks` | `risks.view` | All risks linked to a card (used by CardDetail → Risks tab) |
| GET | `/risks/{id}/mitigation-tasks` | `risks.view` | List mitigation tasks for a risk (with full per-task occurrence history). |
| POST | `/risks/{id}/mitigation-tasks` | `risks.manage` | Create a mitigation task. Auto-creates occurrence #1 and a system Todo on the assignee. |
| PATCH | `/mitigation-tasks/{id}` | `risks.manage` | Update title / description / owner / recurrence / due date / is_active. Owner changes propagate to the current open occurrence (and its Todo); past completed occurrences stay frozen. |
| DELETE | `/mitigation-tasks/{id}` | `risks.manage` | Delete a task. Cascades to occurrences and removes the linked system Todos. |
| POST | `/mitigation-tasks/{id}/occurrences/{occ_id}/complete` | `risks.manage` **or** assignee of the occurrence | Mark an occurrence done. Snapshots `owner_at_completion`. For recurring tasks, opens the next occurrence with `due_date = previous_due_date + interval` (calendar-correct) and lands it as `scheduled` or `open` per the lead-time gate. For one-shot tasks, flips `is_active = false`. Returns 409 when called on a `scheduled` cycle ("activate it first"). |
| POST | `/mitigation-tasks/{id}/occurrences/{occ_id}/skip` | `risks.manage` | Skip a cycle (recurring tasks roll forward as usual, subject to the lead-time gate). |
| POST | `/mitigation-tasks/{id}/occurrences/{occ_id}/promote` | `risks.manage` | Manually promote a `scheduled` cycle to `open` immediately — short-circuits the daily promotion loop for the "I want to do the review early" case. Idempotent on already-open cycles. |
| GET | `/mitigation-tasks/{id}/occurrences` | `risks.view` | Full audit history for one task, including `owner_at_completion` snapshots and `activated_at` timestamps. |
| GET | `/risks/mitigation-tasks/export` | `risks.view` | Flat list of every mitigation task on every risk matching the same filter shape as `GET /risks` (status / category / level / owner / source_type / search / overdue / card_id). Used by the Risk Register's two-sheet `.xlsx` export so sheet 2 always matches what the user has on screen. |

Owner assignment on create / patch / promote auto-creates a single `is_system` Todo on the owner's Todos page (description `[Risk R-xxxxxx] title`, link back to the risk, due-date mirrors `target_resolution_date`, auto-done when the risk reaches mitigated / monitoring / accepted / closed) and fires a `risk_assigned` in-app + email-capable notification whenever the owner actually changes (including self-assignment — `risk_assigned` is whitelisted in `notification_service.allow_self_types`).

## Security

This section covers the **runtime** security model of a deployed Turbo EA instance. For the **CI / supply-chain** side — what scanners cover what, Trivy/Scout/CodeQL/gitleaks/ZAP/Dependabot wiring, allowlist procedures, image signing/verification — see [`.github/SECURITY_PIPELINE.md`](.github/SECURITY_PIPELINE.md). Four things there are gates, not observers, since 2.154.0: the two dependency audits (`pip-audit`, `audit-ci`) fail a PR; the Secret Scan (gitleaks, config in `/.gitleaks.toml`, allowlists by exact value only, mirrored by a pre-commit hook) fails a PR; the Trivy CRITICAL gate fails a publish; and the weekly DAST (`dast-scan.yml`, OWASP ZAP baseline against the published `:latest` stack booted with `SEED_DEMO`, anonymous + signed in as the demo admin, accepted alerts in `.github/zap-rules.tsv`) fails its run. Every image `docker-compose.yml` pulls from GHCR is in the publish/sign/scan matrices, pinned by `backend/tests/services/test_publish_image_matrix.py`; the optional Ollama container is upstream's own pinned image and deliberately outside them (see *GHCR Image Publishing*).

### Startup Security
- App **refuses to start** with default `SECRET_KEY` in non-development environments
- In development mode, logs a warning about default key usage
- OpenAPI/Swagger docs are **disabled in production** (`ENVIRONMENT != "development"`)

### Encryption
- **Fernet symmetric encryption** (`core/encryption.py`) for database-stored secrets (SSO client secrets, SMTP passwords)
- Key derived from `SECRET_KEY` via SHA-256
- Values prefixed with `enc:` to distinguish encrypted from legacy plaintext
- `encrypt_value()` / `decrypt_value()` / `is_encrypted()` utilities

### Rate Limiting
- `slowapi` rate limiter in `core/rate_limit.py`
- Applied to auth-sensitive endpoints (login, register)

### Docker Hardening
- Non-root users: frontend runs as `nginx`, backend as `appuser`
- `cap_drop: ALL` + `no-new-privileges: true`
- Memory limits: backend 2G, frontend 256M (compose defaults; `BACKEND_MEMORY_LIMIT` / `FRONTEND_MEMORY_LIMIT`)
- Backend only exposed via internal Docker network (not to host)

### Nginx Security Headers
- Content-Security-Policy (strict, self-only with font/DrawIO exceptions; every policy names `frame-ancestors` — `'self'` on the app and `/api`, the operator's embed allowlist on the three embed paths — because CSP supersedes `X-Frame-Options` in current browsers and ZAP flags a policy without it)
- `server_tokens off` in every server block (edge and frontend), so the `Server` header carries no nginx version
- The generated edge config is written through an **unquoted** heredoc so `${NGINX_*}` expands — a backtick anywhere in it, a comment included, is a command substitution at container start (`add_header: not found` in the boot log). `tests/services/test_nginx_headers.py` pins all three of these; the weekly DAST is what found them.
- X-Frame-Options: SAMEORIGIN
- X-Content-Type-Options: nosniff
- Strict-Transport-Security: max-age=31536000
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: camera/microphone/geolocation disabled
- Request body limit: 21 MB globally — one megabyte above the backend's own 20 MB attachment cap, so the app's readable 400 wins over nginx's bare 413 — and 2 GB, unbuffered (`proxy_request_buffering off`), on `/api/v1/admin/workspace/import`

### JWT Implementation
- PyJWT with HS256 algorithm in `core/security.py`
- Payload: `{sub: user_id, role: role_key, iat, exp, iss: "turbo-ea", aud: "turbo-ea"}`
- Issuer and audience validation on decode
- Passwords hashed with bcrypt
- Read from `Authorization: Bearer <token>` when present, else from the httpOnly `access_token` cookie (`get_current_user`, `api/deps.py`)
- **The browser is never given the token.** `/auth/login` sets it as an `httponly` + `samesite=lax` cookie scoped to `path=/api`, `secure` when the original request was HTTPS, expiring with `ACCESS_TOKEN_EXPIRE_MINUTES`. It is unreachable from JavaScript, so an XSS cannot exfiltrate it, and the `EventSource` SSE stream — which cannot set headers — authenticates by it. `samesite=lax` is the current CSRF control

### Background Processes
- **Archived card auto-purge**: Background task runs hourly, permanently deletes cards archived for 30+ days (including their relations)
- **Ollama model pull**: On startup (if `AI_AUTO_CONFIGURE=true`), a background task checks if the configured LLM model exists and pulls it if missing (non-blocking, 10-minute timeout)
