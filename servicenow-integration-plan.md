# ServiceNow Integration Plan for Turbo EA

## Background & Research Summary

### How LeanIX Does It

LeanIX's ServiceNow integration is a mature, bidirectional connector with these core architectural components:

1. **ServiceNow Store App** - A scoped app installed on the ServiceNow instance that provides auth endpoints and access configuration.
2. **Cloud Integration Engine** - Integration logic runs in LeanIX cloud, connecting to ServiceNow via REST APIs (Basic Auth or OAuth 2.0).
3. **Mirror Tables** - LeanIX replicates relevant ServiceNow tables into its own DB before syncing to fact sheets. This improves performance for large ServiceNow instances.
4. **Per-field Source of Truth** - Each mapped field has a designated "leading system" (LeanIX or ServiceNow), eliminating conflicts by design.
5. **Three Sync Modes** - Additive (no deletes), Conservative (delete orphans created by integration), Strict (delete all unlinked items). A `maximumDeletionRatio` threshold (default 50%) prevents accidental mass deletion.
6. **CSDM 4.0 Alignment** - Default mappings align with ServiceNow's Common Service Data Model.

### Default LeanIX-to-ServiceNow Mappings

| LeanIX Fact Sheet | ServiceNow Table | Notes |
|---|---|---|
| Application | `cmdb_ci_business_app` | Business Application in CSDM |
| IT Component (Software) | `cmdb_sam_sw_product_model` | Software Product Model |
| IT Component (Hardware) | `cmdb_ci_product_model` | Product Model |
| Relations | `cmdb_rel_ci` | CI Relationships |
| Organization | `business_unit` (via dot-walking) | Optional |
| Business Capability | No default mapping | LeanIX leads |

### Key Lessons From LeanIX's Approach

**What works well:**
- Per-field directionality control avoids conflicts
- Mirror/staging tables decouple sync from live data
- Conservative sync mode as the safe default
- Deletion ratio threshold prevents catastrophic data loss

**Known challenges (from community feedback):**
- "Chicken-and-egg" problem: which system creates entities first?
- Integration scope creeps as more data types are added
- Mapping CMDB discovery data to EA-curated objects is hard
- Product Models are templates, not live CIs (no service map support)

---

## Turbo EA Integration Design

### Design Principles

1. **Self-hosted first** - Unlike LeanIX's cloud engine, Turbo EA is self-hosted. The integration runs as a backend service within the existing FastAPI app.
2. **Configuration-driven** - All mappings, sync direction, and schedules are admin-configurable via the UI. No code changes needed to adjust mappings.
3. **Staged sync with audit trail** - Data flows through a staging area before applying to cards. Every sync run is logged.
4. **Start simple, expand later** - Phase 1 covers the most common use case (Application + IT Component sync). Additional types added in later phases.
5. **Follow existing patterns** - Reuse the EOL integration's proxy/cache/bulk pattern and the settings system's admin configuration pattern.

---

## Data Model

### New Tables

#### `servicenow_connections` - ServiceNow Instance Configuration

```
id              UUID PK
name            VARCHAR(255)        -- Display name (e.g., "Production SNOW")
instance_url    VARCHAR(500)        -- https://company.service-now.com
auth_type       VARCHAR(20)         -- "basic" | "oauth2"
credentials     JSONB (encrypted)   -- {username, password} or {client_id, client_secret, token_url}
is_active       BOOLEAN DEFAULT true
last_tested_at  TIMESTAMP NULL
test_status     VARCHAR(20) NULL    -- "success" | "failed"
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

#### `servicenow_mappings` - Type-Level Mapping Configuration

```
id                  UUID PK
connection_id       UUID FK -> servicenow_connections
card_type_key       VARCHAR(100)        -- e.g., "Application", "ITComponent"
snow_table          VARCHAR(200)        -- e.g., "cmdb_ci_business_app"
sync_direction      VARCHAR(20)         -- "snow_to_turbo" | "turbo_to_snow" | "bidirectional"
sync_mode           VARCHAR(20)         -- "additive" | "conservative" | "strict"
max_deletion_ratio  FLOAT DEFAULT 0.5   -- Safety threshold (0.0-1.0)
filter_query        TEXT NULL           -- ServiceNow encoded query filter (e.g., "active=true")
is_active           BOOLEAN DEFAULT true
created_at          TIMESTAMP
updated_at          TIMESTAMP
```

#### `servicenow_field_mappings` - Field-Level Mapping Configuration

```
id                  UUID PK
mapping_id          UUID FK -> servicenow_mappings
turbo_field         VARCHAR(200)        -- Card field path: "name", "attributes.businessCriticality", "lifecycle.active", etc.
snow_field          VARCHAR(200)        -- ServiceNow field: "name", "u_business_criticality", "install_date", etc.
direction           VARCHAR(20)         -- "snow_leads" | "turbo_leads"
transform_type      VARCHAR(50) NULL    -- "direct" | "value_map" | "date_format" | "concatenate"
transform_config    JSONB NULL          -- Transformation rules (e.g., value mappings)
is_identity         BOOLEAN DEFAULT false -- Used for matching/dedup (at least one per mapping)
created_at          TIMESTAMP
updated_at          TIMESTAMP
```

#### `servicenow_sync_runs` - Sync Execution Log

```
id              UUID PK
connection_id   UUID FK -> servicenow_connections
mapping_id      UUID FK -> servicenow_mappings (NULL for full-connection runs)
status          VARCHAR(20)     -- "running" | "completed" | "failed" | "cancelled"
direction       VARCHAR(20)     -- "pull" | "push"
started_at      TIMESTAMP
completed_at    TIMESTAMP NULL
stats           JSONB           -- {fetched, created, updated, deleted, skipped, errors}
error_message   TEXT NULL
created_by      UUID FK -> users
```

#### `servicenow_staged_records` - Staging Area

```
id              UUID PK
sync_run_id     UUID FK -> servicenow_sync_runs
mapping_id      UUID FK -> servicenow_mappings
snow_sys_id     VARCHAR(32)     -- ServiceNow sys_id
snow_data       JSONB           -- Raw ServiceNow record
card_id         UUID NULL       -- Matched Turbo EA card (NULL if new)
action          VARCHAR(20)     -- "create" | "update" | "delete" | "skip"
diff            JSONB NULL      -- {field: {old, new}} for updates
status          VARCHAR(20)     -- "pending" | "applied" | "rejected" | "error"
error_message   TEXT NULL
created_at      TIMESTAMP
```

#### `servicenow_identity_map` - Persistent Cross-Reference

```
id              UUID PK
connection_id   UUID FK -> servicenow_connections
mapping_id      UUID FK -> servicenow_mappings
card_id         UUID FK -> cards
snow_sys_id     VARCHAR(32)
snow_table      VARCHAR(200)
created_by_sync BOOLEAN DEFAULT true  -- true = created by integration
last_synced_at  TIMESTAMP
created_at      TIMESTAMP
updated_at      TIMESTAMP

UNIQUE(connection_id, snow_sys_id, snow_table)
UNIQUE(connection_id, card_id, snow_table)
```

---

## Architecture

### Component Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Frontend - Admin: ServiceNow Integration                    │
│  /admin/servicenow                                           │
│  ┌────────────┐ ┌──────────────┐ ┌────────────────────────┐  │
│  │ Connection  │ │   Mapping    │ │   Sync Dashboard       │  │
│  │ Settings    │ │   Editor     │ │   (runs, logs, staged) │  │
│  └────────────┘ └──────────────┘ └────────────────────────┘  │
└──────────────────────────┬───────────────────────────────────┘
                           │ /api/v1/servicenow/*
┌──────────────────────────▼───────────────────────────────────┐
│  Backend - ServiceNow Module                                 │
│  ┌──────────────────┐  ┌──────────────────────────────────┐  │
│  │ servicenow.py    │  │ servicenow_service.py             │  │
│  │ (API router)     │  │ - ServiceNowClient (REST)         │  │
│  │                  │  │ - SyncEngine (pull/push/reconcile) │  │
│  │                  │  │ - FieldTransformer (mapping)       │  │
│  └──────────────────┘  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Models: SnowConnection, SnowMapping, SnowFieldMapping,  │ │
│  │         SnowSyncRun, SnowStagedRecord, SnowIdentityMap  │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTPS (Table API)
┌──────────────────────────▼───────────────────────────────────┐
│  ServiceNow Instance                                         │
│  Tables: cmdb_ci_business_app, cmdb_ci_product_model, etc.   │
└──────────────────────────────────────────────────────────────┘
```

### Sync Flow (Pull: ServiceNow -> Turbo EA)

```
1. Admin triggers sync (manual or scheduled)
2. Create sync_run record (status=running)
3. ServiceNowClient fetches records from SNOW table
   - Uses Table API: GET /api/now/table/{table}
   - Applies filter_query, pagination (sysparm_limit, sysparm_offset)
   - Stores raw records in servicenow_staged_records
4. SyncEngine processes staged records:
   a. Match: Look up snow_sys_id in identity_map -> find card_id
   b. If no match: try identity fields (is_identity=true) to fuzzy-match existing cards
   c. Transform: Apply field mappings + transforms to build card data
   d. Diff: Compare transformed data with existing card (if matched)
   e. Classify: Mark as create/update/delete/skip
5. Admin reviews staged changes (optional - configurable)
6. Apply:
   - Create new cards (+ identity_map entry)
   - Update existing cards (respecting field direction)
   - Handle deletes per sync_mode
   - Emit events for each change
7. Update sync_run stats, set status=completed
```

### Sync Flow (Push: Turbo EA -> ServiceNow)

```
1. Admin triggers push (manual or scheduled)
2. Create sync_run record (status=running, direction=push)
3. Query cards of mapped type with turbo_leads fields
4. For each card:
   a. Look up identity_map for existing SNOW sys_id
   b. Transform card fields -> SNOW fields (reverse mapping)
   c. If sys_id exists: PATCH /api/now/table/{table}/{sys_id}
   d. If new: POST /api/now/table/{table} -> store sys_id in identity_map
5. Update sync_run stats
```

---

## API Endpoints

### Connections (`/api/v1/servicenow/connections`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/connections` | List all connections |
| POST | `/connections` | Create connection |
| GET | `/connections/{id}` | Get connection detail |
| PATCH | `/connections/{id}` | Update connection |
| DELETE | `/connections/{id}` | Delete connection (cascade mappings) |
| POST | `/connections/{id}/test` | Test connectivity |
| GET | `/connections/{id}/tables` | List available ServiceNow tables |
| GET | `/connections/{id}/tables/{table}/fields` | List fields for a table |

### Mappings (`/api/v1/servicenow/mappings`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/mappings?connection_id=X` | List mappings |
| POST | `/mappings` | Create mapping with field mappings |
| GET | `/mappings/{id}` | Get mapping with field mappings |
| PATCH | `/mappings/{id}` | Update mapping |
| DELETE | `/mappings/{id}` | Delete mapping |
| POST | `/mappings/{id}/preview` | Dry-run: fetch sample records + show transformed output |

### Sync (`/api/v1/servicenow/sync`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/sync/pull/{mapping_id}` | Trigger pull sync |
| POST | `/sync/push/{mapping_id}` | Trigger push sync |
| GET | `/sync/runs?connection_id=X` | List sync runs |
| GET | `/sync/runs/{id}` | Get sync run detail with stats |
| GET | `/sync/runs/{id}/staged` | List staged records for a run |
| POST | `/sync/runs/{id}/apply` | Apply staged changes (if review mode) |
| POST | `/sync/runs/{id}/cancel` | Cancel a running sync |

---

## Implementation Phases

### Phase 1: Core Infrastructure + Pull Sync (Applications)

**Goal**: Pull ServiceNow Business Applications into Turbo EA as Application cards.

**Backend:**
1. Create SQLAlchemy models for all 6 new tables
2. Create Alembic migration
3. Implement `ServiceNowClient` service class:
   - Connection management (Basic Auth + OAuth 2.0)
   - Table API wrapper: list records, get record, create, update
   - Table/field discovery endpoints
   - Credential encryption at rest (using Fernet with SECRET_KEY derivative)
4. Implement `FieldTransformer`:
   - Direct mapping (field-to-field copy)
   - Value mapping (e.g., SNOW "1-Critical" -> Turbo EA "missionCritical")
   - Date format conversion
   - Concatenation (combine multiple SNOW fields)
5. Implement `SyncEngine`:
   - Pull flow: fetch -> stage -> match -> transform -> diff -> apply
   - Identity matching (sys_id lookup + identity field fuzzy match)
   - Staged record management
   - Sync run lifecycle and stats tracking
6. Create API router (`/api/v1/servicenow/`) with connection, mapping, and sync endpoints
7. Add `servicenow` permission group to permission registry
8. Emit events on card creation/update from sync

**Frontend:**
1. New admin page: `/admin/servicenow`
2. **Connection Manager** tab:
   - Add/edit/delete ServiceNow connections
   - Test connectivity button with status indicator
   - Auth type selector (Basic / OAuth 2.0)
3. **Mapping Editor** tab:
   - Select connection + card type + SNOW table
   - Field mapping table: Turbo EA field <-> SNOW field, direction toggle, transform config
   - Identity field checkboxes
   - Sync mode + direction selector
   - Preview button (dry-run with sample data)
4. **Sync Dashboard** tab:
   - Trigger sync button
   - Sync run history table (status, stats, duration)
   - Staged record review view (for review-mode syncs)
   - Apply/reject staged changes

**Default Mapping Template** (shipped as a helper, not auto-applied):
```
Application <-> cmdb_ci_business_app
  name           <-> name             (bidirectional)
  description    <-> short_description (snow_leads)
  attributes.businessCriticality <-> busines_criticality (value_map)
  lifecycle.active <-> install_date   (snow_leads, date_format)
  lifecycle.endOfLife <-> end_of_life  (snow_leads, date_format)
```

### Phase 2: IT Component Sync + Relation Sync

**Goal**: Add IT Component mapping and sync CI relationships as Turbo EA relations.

**Backend:**
1. Add relation mapping support to `servicenow_mappings`:
   - New mapping type: `relation` (in addition to `card`)
   - Maps `cmdb_rel_ci` entries to Turbo EA relations
   - Configurable relation type mapping (SNOW rel_type -> Turbo EA relation_type key)
2. Extend `SyncEngine` with relationship processing:
   - After card sync, process `cmdb_rel_ci` for mapped tables
   - Resolve both ends (parent/child sys_id -> card_id via identity_map)
   - Create/delete relations accordingly
3. Ship default IT Component mapping template:
   ```
   ITComponent <-> cmdb_ci_product_model
     name        <-> name              (bidirectional)
     subtype     <-> sys_class_name    (value_map: cmdb_ci_appl->Software, etc.)
     attributes.vendorName <-> manufacturer.name (snow_leads, dot-walk)
   ```

**Frontend:**
1. Extend mapping editor with "Relation Mapping" section
2. Relation type selector for SNOW relationship types
3. Visual indicator on sync dashboard showing card + relation counts

### Phase 3: Push Sync + Scheduling

**Goal**: Enable pushing Turbo EA data to ServiceNow and automated sync schedules.

**Backend:**
1. Implement push flow in `SyncEngine`:
   - Query cards with `turbo_leads` field mappings
   - Reverse-transform to SNOW field format
   - Create/update via Table API
   - Update identity_map with new sys_ids
2. Add scheduling support:
   - `schedule` field on `servicenow_mappings` (cron expression or interval)
   - Background task runner using FastAPI lifespan + asyncio
   - Schedule persistence in DB (survives restarts)
3. Add sync conflict detection for bidirectional mappings:
   - Compare `updated_at` timestamps on both sides
   - Flag conflicts in staged records for manual resolution

**Frontend:**
1. Push sync trigger button on sync dashboard
2. Schedule configuration UI (interval picker or cron builder)
3. Conflict resolution view for bidirectional syncs
4. Notification integration: alert admins on sync failures

### Phase 4: Advanced Features

**Goal**: Enterprise-grade additions based on user feedback.

Potential items (not committed):
- **Bulk relation sync** from `cmdb_rel_ci` with configurable depth
- **Organization mapping** from `business_unit`
- **Webhook-based incremental sync** (ServiceNow Business Rules trigger outbound REST to Turbo EA)
- **Sync profiles** (pre-built mapping templates for common CSDM patterns)
- **Data quality dashboard** showing sync coverage and freshness metrics
- **Multi-connection support** (e.g., prod SNOW + dev SNOW)

---

## Security Considerations

1. **Credential Storage**: ServiceNow credentials encrypted at rest using Fernet symmetric encryption derived from `SECRET_KEY`. Never returned in plaintext via API (masked like SMTP password in settings).
2. **SSRF Prevention**: Validate `instance_url` against `*.service-now.com` or `*.servicenowservices.com` patterns. Allow admin override for on-prem instances with explicit opt-in.
3. **Rate Limiting**: Respect ServiceNow API rate limits. Implement backoff on 429 responses. Configurable batch size for pagination.
4. **Audit Trail**: All sync operations logged in `servicenow_sync_runs`. Card changes from sync emit standard events (visible in card history).
5. **Permission Gating**: All ServiceNow endpoints require `servicenow.manage` app-level permission (admin-only by default).
6. **Deletion Safety**: `max_deletion_ratio` threshold per mapping. Sync halts if exceeded. Default 50%.

---

## File Changes Summary

### New Files

**Backend:**
- `backend/app/models/servicenow.py` - 6 SQLAlchemy models
- `backend/app/schemas/servicenow.py` - Pydantic request/response schemas
- `backend/app/services/servicenow_service.py` - ServiceNowClient, SyncEngine, FieldTransformer
- `backend/app/api/v1/servicenow.py` - API router
- `backend/alembic/versions/xxxx_add_servicenow_tables.py` - Migration

**Frontend:**
- `frontend/src/features/admin/ServiceNowAdmin.tsx` - Main admin page (tabs)
- `frontend/src/features/admin/ServiceNowConnectionManager.tsx` - Connection CRUD
- `frontend/src/features/admin/ServiceNowMappingEditor.tsx` - Mapping configuration
- `frontend/src/features/admin/ServiceNowSyncDashboard.tsx` - Sync runs + staging

### Modified Files

**Backend:**
- `backend/app/api/v1/router.py` - Mount servicenow router
- `backend/app/models/__init__.py` - Import new models
- `backend/app/core/permissions.py` - Add `servicenow` permission group

**Frontend:**
- `frontend/src/types/index.ts` - Add ServiceNow TypeScript interfaces
- `frontend/src/App.tsx` - Add `/admin/servicenow` route
- `frontend/src/layouts/AppLayout.tsx` - Add ServiceNow nav item under Admin
