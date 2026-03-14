# Plan: Absorb ArchLens into Turbo EA

## Goal

Eliminate the separate ArchLens Node.js/Express/SQLite container. All ArchLens functionality becomes native Turbo EA — FastAPI backend, PostgreSQL, React/MUI 6 frontend, full i18n, RBAC, and async patterns. No more proxy layer, no more `archlens_service.py` HTTP client, no more `ArchLensClient`.

---

## Current State

### What exists in standalone ArchLens (Node.js + SQLite)
- **7 SQLite tables**: `fact_sheets`, `vendor_analysis`, `vendor_hierarchy`, `duplicate_clusters`, `modernization_assessments`, `sync_jobs`, `cron_schedules`, `settings`, `workspaces`
- **3 AI services**: Vendor categorisation (`ai.js`), Vendor resolution (`resolution.js`), Architecture AI 3-phase (`architect.js`)
- **4 AI providers**: Claude, OpenAI, DeepSeek, Gemini — via direct HTTP calls to provider APIs
- **9 frontend pages**: Connect, Overview, FSI, Vendors, Resolution, Duplicates, Architect, Settings, Support
- **SSE streaming**: Real-time progress for sync, vendor analysis, resolution, duplicate detection

### What exists in Turbo EA integration today
- **2 PostgreSQL tables**: `archlens_connections`, `archlens_analysis_runs` (proxy metadata only)
- **Backend proxy**: `archlens.py` routes -> `ArchLensClient` HTTP calls -> standalone ArchLens container
- **Frontend**: Single `ArchLensPage.tsx` with 4 tabs (Vendors, Duplicates, Architect, History)
- **Permissions**: `archlens.view`, `archlens.manage`

---

## Architecture Decision

**ArchLens's `fact_sheets` table is unnecessary.** Turbo EA already has the `cards` table with the same data (name, type, description, lifecycle, owner, cost, etc.). All ArchLens AI services should query `cards` directly via SQLAlchemy — no data copy, no sync step.

**ArchLens's AI provider logic duplicates Turbo EA's.** Turbo EA already has `ai_service.py` that calls external LLMs. The new ArchLens services should reuse the same AI infrastructure (read provider/key from `app_settings`, call via httpx).

**ArchLens's "workspace" concept maps to "the entire Turbo EA instance."** There is only one landscape — no need for workspace routing.

---

## Phase 1: Backend — New PostgreSQL Tables + Alembic Migration

### New tables (replace all SQLite tables)

```
archlens_vendor_analysis        — AI-categorised vendors
archlens_vendor_hierarchy       — Canonical vendor tree (vendor -> product -> module)
archlens_duplicate_clusters     — Duplicate detection results
archlens_modernization_assessments — Modernization recommendations
```

Keep existing `archlens_analysis_runs` (remove FK to connections, make standalone).
Drop `archlens_connections` (no longer needed — no external container).

**Migration**: `058_archlens_native.py`
- Create 4 new tables
- Alter `archlens_analysis_runs`: drop FK to connections, add nullable columns
- Drop `archlens_connections` table

### New SQLAlchemy models

`backend/app/models/archlens.py` — replace current proxy models:

| Model | Key Columns |
|-------|-------------|
| `ArchLensVendorAnalysis` | vendor_name (unique), category, sub_category, reasoning, app_count, total_cost, app_list (JSONB), analysed_at |
| `ArchLensVendorHierarchy` | canonical_name (unique), vendor_type (vendor/product/platform/module), parent_id (self-ref), aliases (JSONB), category, sub_category, app_count, itc_count, total_cost, linked_fs (JSONB), confidence, analysed_at |
| `ArchLensDuplicateCluster` | cluster_name, card_type, functional_domain, card_ids (JSONB), card_names (JSONB), evidence, recommendation, status (pending/confirmed/investigating/dismissed), analysed_at |
| `ArchLensModernization` | target_type, cluster_id (FK), card_id (FK nullable), card_name, current_tech, modernization_type, recommendation, effort, priority, status, analysed_at |
| `ArchLensAnalysisRun` | (keep existing, remove connection_id FK) analysis_type, status, started_at, completed_at, results (JSONB), error_message, created_by |

---

## Phase 2: Backend — AI Services (Python rewrite)

### New service files

#### `backend/app/services/archlens_ai.py` — Shared AI caller

Reuse Turbo EA's existing AI config from `app_settings.general_settings.ai`:
- Read `providerType` (anthropic/openai) and `apiKey` from DB
- Support Claude, OpenAI, DeepSeek, Gemini (same 4 providers as current ArchLens)
- Return `{text, truncated}` with truncation detection
- `parse_json(raw)` utility with truncated JSON repair

This replaces ArchLens's `callAI()` function from `architect.js`.

#### `backend/app/services/archlens_vendors.py` — Vendor Analysis

Port `ai.js` -> `analyse_vendors()`:
1. Query all cards with Provider relations from `cards` table (replaces `fact_sheets` query)
2. Extract distinct vendor names from provider relation names
3. Call AI to categorise vendors into 40+ categories (same prompt as current)
4. Upsert results into `archlens_vendor_analysis`
5. Return categorised vendors

Port `resolution.js` -> `resolve_vendors()`:
1. Load vendor analysis results + card data
2. Call AI to build canonical vendor hierarchy (vendor -> product -> platform -> module)
3. Upsert into `archlens_vendor_hierarchy`
4. Return hierarchy tree

#### `backend/app/services/archlens_duplicates.py` — Duplicate Detection

Port duplicate detection logic:
1. Query cards by type from `cards` table
2. Group by type (Application, ITComponent, Interface)
3. Call AI with card names + descriptions for semantic clustering
4. Store clusters in `archlens_duplicate_clusters`
5. Return clusters with evidence + recommendations

Port modernization assessment:
1. For selected duplicate clusters, call AI for modernization recommendations
2. Store in `archlens_modernization_assessments`

#### `backend/app/services/archlens_architect.py` — Architecture AI

Port the 3-phase architect from `architect.js`:

**`load_landscape()`**: Query cards from `cards` table with vendor/provider relations (replaces `fact_sheets` + `vendor_analysis` queries). Group by category for landscape context.

**`phase1_questions(requirement)`**: Same prompt structure — detect architecture patterns, generate 6-8 business clarification questions.

**`phase2_questions(requirement, phase1_qa)`**: Same prompt — refine requirement, identify missing capabilities, generate NFR + technical questions.

**`phase3_architecture(requirement, all_qa)`**: Two-call pattern (already implemented in current fix):
- Call 1: Structure (layers, gaps, integrations, risks, nextSteps) — 8K tokens
- Call 2: Mermaid diagram — 4K tokens
- Truncation detection + retry for missing sections
- Cross-reference components against landscape

---

## Phase 3: Backend — API Routes

### Replace `backend/app/api/v1/archlens.py`

Remove all proxy logic and `ArchLensClient`. New direct endpoints:

**Status & Overview**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/archlens/status` | Check if AI is configured (read `app_settings`) |
| `GET` | `/archlens/overview` | Dashboard KPIs: card counts by type, quality distribution, cost summary, top issues |

**Vendor Analysis**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/archlens/vendors/analyse` | Trigger vendor categorisation (background task) |
| `GET` | `/archlens/vendors` | Get categorised vendors |
| `POST` | `/archlens/vendors/resolve` | Trigger vendor resolution (background task) |
| `GET` | `/archlens/vendors/hierarchy` | Get vendor hierarchy tree |

**Duplicate Detection**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/archlens/duplicates/analyse` | Trigger duplicate detection (background task) |
| `GET` | `/archlens/duplicates` | Get duplicate clusters |
| `PATCH` | `/archlens/duplicates/{id}/status` | Update cluster status (confirm/dismiss/investigate) |
| `POST` | `/archlens/duplicates/modernize` | Trigger modernization assessment |
| `GET` | `/archlens/duplicates/modernizations` | Get modernization results |

**Architecture AI**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/archlens/architect/phase1` | Phase 1 questions |
| `POST` | `/archlens/architect/phase2` | Phase 2 questions |
| `POST` | `/archlens/architect/phase3` | Phase 3 architecture generation |

**Analysis History**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/archlens/analysis-runs` | List analysis runs |

### Long-running operations

For AI operations (vendor analysis, resolution, duplicate detection): use **background tasks + polling** via `archlens_analysis_runs` status. The frontend polls the run status until complete. This is simpler than SSE and matches the existing pattern.

### Permissions

Keep existing keys: `archlens.view`, `archlens.manage`. No changes needed.

### Pydantic Schemas

Update `backend/app/schemas/archlens.py`:
- Remove `ArchLensConnectionCreate/Update/Out` (no more connections)
- Remove `ArchLensSyncRequest` (no more sync)
- Add `VendorAnalysisOut`, `VendorHierarchyOut`, `DuplicateClusterOut`, `ModernizationOut`
- Keep `ArchLensArchitectRequest` (phases 1-3)
- Add `ArchLensOverviewOut`

---

## Phase 4: Frontend — Multi-Page ArchLens Feature

### Route Structure

Replace single `ArchLensPage.tsx` with multiple route-level pages:

| Route | Component | Description |
|-------|-----------|-------------|
| `/archlens` | `ArchLensDashboard` | Overview dashboard (KPIs, quality distribution, top issues) |
| `/archlens/vendors` | `ArchLensVendors` | Vendor analysis + categorisation with category cards |
| `/archlens/vendors/resolution` | `ArchLensResolution` | Vendor hierarchy / deduplication tree |
| `/archlens/duplicates` | `ArchLensDuplicates` | Duplicate detection + modernization wizard |
| `/archlens/architect` | `ArchLensArchitect` | Architecture AI (3-phase wizard) |
| `/archlens/history` | `ArchLensHistory` | Analysis run history |

All pages use `lazy()` imports in `App.tsx` for code splitting.

### Navigation

Add "ArchLens" as a top-level nav section with sub-items:
- Overview
- Vendor Analysis
- Vendor Resolution
- Duplicate Detection
- Architecture AI

Guard all links behind `archlens.view` permission check.

### Component Structure

```
frontend/src/features/archlens/
  ArchLensDashboard.tsx        — KPI tiles, quality distribution, top issues, type breakdown
  ArchLensVendors.tsx          — Category cards grid, vendor table, trigger analysis
  ArchLensResolution.tsx       — Vendor hierarchy tree, canonical names, aliases
  ArchLensDuplicates.tsx       — Cluster cards, status management, modernization wizard
  ArchLensArchitect.tsx        — 3-phase wizard (extracted from current ArchLensPage.tsx)
  ArchLensHistory.tsx          — Analysis runs table
  components/
    ArchitectureResultView.tsx  — Tabbed result display (extract from current)
    MermaidDiagram.tsx          — Mermaid renderer (extract from current)
    VendorCategoryCard.tsx      — Category card with icon, count, cost
    DuplicateClusterCard.tsx    — Expandable cluster with actions
    QualityDistribution.tsx     — Bronze/Silver/Gold locker tiles
    ModernizationWizard.tsx     — Modernization assessment dialog
  index.ts                      — Barrel exports
```

### What gets dropped (not ported)

| Standalone Feature | Decision | Reason |
|---|---|---|
| **ConnectPage** | Drop | No external container to connect to |
| **SettingsPage** | Drop | AI settings in Admin > Settings > AI; no separate DB config |
| **SupportPage / FAQ** | Drop | Can be added to docs if needed |
| **FSIPage (Fact Sheet Inventory)** | Drop | Turbo EA's Inventory page already provides this with AG Grid |
| **Cron scheduling** | Drop for now | Background scheduling is a separate feature; can be added later |
| **LeanIX-specific sync** | Drop | Turbo EA has its own card import mechanisms |

### What gets fully ported

| Feature | Source -> Target |
|---|---|
| **Overview Dashboard** | `OverviewPage.js` -> `ArchLensDashboard.tsx` |
| **Vendor Categorisation** | `VendorsPage.js` -> `ArchLensVendors.tsx` |
| **Vendor Resolution** | `ResolutionPage.js` -> `ArchLensResolution.tsx` |
| **Duplicate Detection + Modernization** | `DuplicatesPage.js` -> `ArchLensDuplicates.tsx` |
| **Architecture AI** | `ArchitectPage.js` -> `ArchLensArchitect.tsx` (mostly done already) |
| **Analysis History** | Existing tab -> `ArchLensHistory.tsx` |

---

## Phase 5: i18n

Add translation keys for all new pages across 8 locales (`en`, `de`, `fr`, `es`, `it`, `pt`, `zh`, `ru`). Use existing `admin` namespace (already has `archlens_*` keys).

New key groups:
- `archlens_dashboard_*` — Overview dashboard
- `archlens_vendor_*` — Vendor analysis (expand existing)
- `archlens_resolution_*` — Vendor resolution
- `archlens_duplicate_*` — Duplicate detection
- `archlens_modernization_*` — Modernization wizard

---

## Phase 6: Cleanup

1. **Remove `archlens_connections` table** (migration drops it)
2. **Remove `backend/app/services/archlens_service.py`** (HTTP client no longer needed)
3. **Remove proxy logic from `archlens.py`** (replaced with direct service calls)
4. **Remove `temp-archlens-changes/` directory** (no longer needed)
5. **Update `docker-compose.yml`** — remove any ArchLens container references
6. **Update `CLAUDE.md`** project structure docs
7. **Update `CHANGELOG.md`** + bump version

---

## Implementation Order

| Step | Scope | Dependencies |
|------|-------|-------------|
| 1 | Alembic migration (new tables, drop connections) | None |
| 2 | SQLAlchemy models | Step 1 |
| 3 | `archlens_ai.py` — shared AI caller | Step 2 |
| 4 | `archlens_vendors.py` — vendor analysis + resolution | Step 3 |
| 5 | `archlens_duplicates.py` — duplicate detection + modernization | Step 3 |
| 6 | `archlens_architect.py` — 3-phase architecture AI | Step 3 |
| 7 | Pydantic schemas | Step 2 |
| 8 | API routes (replace proxy with direct) | Steps 4-7 |
| 9 | Frontend: `ArchLensDashboard.tsx` | Step 8 |
| 10 | Frontend: `ArchLensVendors.tsx` + `VendorCategoryCard.tsx` | Step 8 |
| 11 | Frontend: `ArchLensResolution.tsx` | Step 8 |
| 12 | Frontend: `ArchLensDuplicates.tsx` + modernization wizard | Step 8 |
| 13 | Frontend: `ArchLensArchitect.tsx` (extract + polish existing) | Step 8 |
| 14 | Frontend: Routes in `App.tsx` + nav integration | Steps 9-13 |
| 15 | i18n: All 8 locales | Steps 9-13 |
| 16 | Cleanup: Remove old files, update docs | All |
| 17 | Backend tests | Steps 4-8 |
| 18 | Frontend tests | Steps 9-13 |

---

## Key Design Decisions

1. **No data copy** — ArchLens queries `cards` table directly, no intermediate `fact_sheets` table
2. **Reuse AI infrastructure** — Same AI config from `app_settings`, same provider patterns
3. **Background tasks + polling** — Not SSE streaming (simpler, existing pattern)
4. **Multi-page routing** — Each ArchLens feature is its own route, not tabs in one page
5. **Drop LeanIX-specific features** — ConnectPage, cron sync, FSI table all replaced by Turbo EA native
6. **Keep all AI features** — Vendor analysis, resolution, duplicates, modernization, architect
