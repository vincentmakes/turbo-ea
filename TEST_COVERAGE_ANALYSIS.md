# Test Coverage Analysis

**Date**: 2026-02-21
**Scope**: Full backend and frontend test suites

---

## Current State Summary

| Area | Test Files | Test Cases | Module Coverage |
|------|-----------|------------|-----------------|
| Backend — Core | 2 | 30 | 2/4 modules (50%) |
| Backend — API | 23 | 301 | 23/29 endpoints (79%) |
| Backend — Services | 7 | 154 | 7/11 services (64%) |
| **Backend Total** | **32** | **485** | **32/44 modules (73%)** |
| Frontend — API | 1 | 18 | 1/1 (100%) |
| Frontend — Hooks | 7 | 40 | 7/10 (70%) |
| Frontend — Components | 4 | 35 | 4/14 (29%) |
| Frontend — Features | 0 | 0 | 0/89 (0%) |
| **Frontend Total** | **12** | **93** | **12/114 files (10.5%)** |

---

## Priority 1 — Critical Gaps (High Impact, Missing Entirely)

### 1.1 Backend: Untested API Endpoints

Six endpoint files have **zero test coverage**:

| File | Lines | Why It Matters |
|------|-------|----------------|
| `api/v1/stakeholders.py` | Stakeholder assignment CRUD | Core RBAC feature — user↔card role assignments drive card-level permissions |
| `api/v1/bpm_workflow.py` | Process flow version approval | Multi-state workflow (draft→pending→published→archived) with approval gates |
| `api/v1/bpm_assessments.py` | Process assessment endpoints | Maturity/risk/compliance scoring |
| `api/v1/bpm_reports.py` | BPM dashboard/risk/automation reports | Aggregation logic across process data |
| `api/v1/eol.py` | End-of-Life proxy + mass linking | External API proxy to endoflife.date with fuzzy matching |
| `api/v1/servicenow.py` | ServiceNow CMDB sync | Bi-directional sync with staging, identity mapping, field mapping |

**Recommended tests:**
- `stakeholders.py`: CRUD for stakeholder assignments, permission inheritance verification, duplicate assignment prevention, role archival behavior
- `bpm_workflow.py`: Full state machine (draft→pending→published), approval with/without permission, reject with comment, concurrent version handling
- `bpm_assessments.py`: Score range validation, assessment CRUD per process, date handling
- `bpm_reports.py`: Empty data, aggregation accuracy, permission gates
- `eol.py`: Mock external API responses, fuzzy search matching, mass-link batch behavior, error handling on API timeout
- `servicenow.py`: Connection CRUD + test endpoint, mapping configuration, pull/push with mocked responses, staged record review/apply, identity map persistence

### 1.2 Backend: Untested Services

| Service | Why It Matters |
|---------|----------------|
| `element_relation_sync.py` | Links BPMN diagram elements to EA cards — complex join logic |
| `servicenow_service.py` | ServiceNow API client with credential management and sync orchestration |

**Recommended tests:**
- `element_relation_sync.py`: Element-to-card linking, unlinking, sync after diagram edit, handling deleted cards
- `servicenow_service.py`: Mock httpx calls, test credential encryption/decryption, sync run recording, staged record creation, identity map updates

### 1.3 Frontend: Zero Feature-Level Tests

All 89 feature component files lack tests. The highest-impact gaps:

| Component | Why It Matters |
|-----------|----------------|
| `CardDetail.tsx` + all sections | The central UI for viewing/editing cards — renders dynamically from metamodel |
| `InventoryPage.tsx` | Primary data table with complex AG Grid configuration |
| `Dashboard.tsx` | Landing page with KPI aggregation |
| `LoginPage.tsx` | Auth entry point |
| `MetamodelAdmin.tsx` + subcomponents | Admin configuration UI for the entire metamodel |

**Recommended approach:** Start with render/smoke tests for each page component, then add interaction tests for critical workflows (card editing, inventory filtering, login flow).

---

## Priority 2 — Shallow Coverage (Tests Exist but Miss Key Scenarios)

### 2.1 Stakeholder-Level Permissions (Cross-Cutting)

**No test anywhere validates card-level permissions via stakeholder roles.** All existing permission tests only check app-level roles (admin/member/viewer). The RBAC system is dual-level (app role + stakeholder role = effective permissions), but the stakeholder half is untested.

**Recommended tests:**
- Assign a user as "Technical Application Owner" on a card, verify they gain `card.edit` on that card
- Verify a viewer with a stakeholder role can edit a card they're assigned to
- Verify removing a stakeholder role revokes card-level permissions
- Test the `/cards/{id}/effective-permissions` endpoint with mixed app + stakeholder roles

### 2.2 Reports Endpoints (Only Dashboard Tested)

`test_reports.py` has 6 tests covering only the dashboard endpoint. The other 9+ report endpoints have no coverage:

| Endpoint | Complexity |
|----------|------------|
| `GET /reports/portfolio` | Multi-axis query (X, Y, size, color) with type filtering |
| `GET /reports/matrix` | Cross-reference grid between two types |
| `GET /reports/dependencies` | BFS graph traversal with depth limiting |
| `GET /reports/capability-heatmap` | Hierarchical aggregation |
| `GET /reports/roadmap` | Lifecycle timeline data extraction |
| `GET /reports/cost` | Cost aggregation with optional grouping |
| `GET /reports/cost-treemap` | Treemap with nested grouping |
| `GET /reports/landscape` | Cards grouped by related type |
| `GET /reports/data-quality` | Completeness scoring across all cards |

**Recommended tests:** At minimum, test each endpoint with empty data, one card, and with permission checks. For portfolio and matrix, test invalid axis parameters.

### 2.3 Cards — Missing CRUD Edge Cases

`test_cards.py` (26 tests) covers the happy path well but misses:

- **Bulk update** (`PATCH /cards/bulk`) — not tested at all
- **Hierarchy** (`GET /cards/{id}/hierarchy`) — not tested at all
- **History** (`GET /cards/{id}/history`) — not tested at all
- **CSV export** (`GET /cards/export/csv`) — not tested at all
- **Field validation**: No tests for type mismatches (string in number field, invalid select option, bad date format)
- **Calculation triggers**: No test verifying card save runs calculations
- **Archive cascade**: No test for archiving a card with active relations
- **Data quality edge cases**: All fields empty (0%), all fields filled (100%), mixed weights

### 2.4 Relations — Missing Constraint Validation

`test_relations.py` (11 tests) misses:

- **Type constraints**: Creating a relation between incompatible card types (should be rejected based on relation type definition)
- **Cardinality enforcement**: 1:1 relation types should reject a second relation
- **Nonexistent source/target cards**: Only tests nonexistent relation ID, not bad card references
- **Duplicate relations**: Same source + target + type should likely be rejected

### 2.5 Surveys — Only CRUD, No Workflow

`test_surveys.py` (9 tests) covers create/list/get/update/delete but misses the core workflow:

- **Send** (`/surveys/{id}/send`) — distributing survey to users/cards
- **Respond** (`/surveys/{id}/respond/{card_id}`) — submitting responses
- **Results** — viewing and applying responses
- **Status transitions** — draft → active → closed

### 2.6 BPM — Only Assessments and Templates

`test_bpm.py` (9 tests) misses the core BPM functionality:

- **BPMN diagram CRUD** (`GET/PUT /bpm/processes/{id}/diagram`)
- **Element extraction** (automatic parsing of BPMN XML into elements)
- **Flow versions** (create draft, submit, approve, reject)
- **Element listing** (`GET /bpm/processes/{id}/elements`)

### 2.7 Auth — Missing SSO and Invitation Flows

`test_auth.py` (14 tests) is strong on basic auth but misses:

- **SSO callback** (`/auth/sso/callback`) — OAuth flow completion
- **SSO config** (`/auth/sso/config`) — Configuration retrieval
- **Set password** (`/auth/set-password`) — Invited user password setup
- **Token expiration** — Using an expired token should return 401

---

## Priority 3 — Input Validation and Security Testing

### 3.1 Pydantic Schema Validation

Very few tests verify that Pydantic schemas reject bad input. For each endpoint that accepts a request body, there should be at least one test with malformed input:

- Missing required fields → 422
- Wrong field types (string where number expected) → 422
- Values exceeding length limits → 422
- Invalid enum values → 422

### 3.2 SQL Injection / XSS via Search Parameters

The `search` query parameter on list endpoints should be tested with:
- SQL-like strings (`'; DROP TABLE cards; --`)
- Very long strings (10,000+ characters)
- Unicode edge cases

Since the codebase uses SQLAlchemy ORM (not raw SQL), these should be safe, but a test confirms it.

### 3.3 Permission Bypass Attempts

- Accessing another user's resources by guessing UUIDs
- Using a viewer's token to hit admin-only endpoints
- Accessing archived/soft-deleted resources

---

## Priority 4 — Frontend Testing Strategy

### 4.1 Untested Hooks (3 remaining)

| Hook | Recommended Tests |
|------|-------------------|
| `useSavedReport.ts` | Fetch, cache, invalidation |
| `useTimeline.ts` | Data transformation, empty data handling |
| `useThumbnailCapture.ts` | SVG-to-PNG conversion mock, error handling |

### 4.2 Untested Shared Components (10 remaining)

| Component | Recommended Tests |
|-----------|-------------------|
| `CreateCardDialog.tsx` | Render, type selection, form validation, submit |
| `NotificationBell.tsx` | Badge count, click to open, mark read |
| `NotificationPreferencesDialog.tsx` | Toggle preferences, save |
| `ColorPicker.tsx` | Color selection, hex validation |
| `KeyInput.tsx` | Key format validation, auto-generation |
| `TimelineSlider.tsx` | Range selection, value display |
| `VendorField.tsx` | Autocomplete, selection |
| `EolLinkSection.tsx` | EOL data display, link/unlink |

### 4.3 Feature Components — Suggested Phased Approach

**Phase 1 — Smoke/Render Tests** (highest value per effort):
- Verify each page component renders without crashing when given minimal props/mocks
- Covers: Dashboard, InventoryPage, CardDetail, LoginPage, all admin pages

**Phase 2 — Interaction Tests** (core user workflows):
- Card creation via `CreateCardDialog`
- Card editing in `CardDetail` sections (AttributeSection, DescriptionSection)
- Inventory filtering and sorting
- Login/logout flow
- Report parameter selection

**Phase 3 — Integration Tests** (complex multi-component flows):
- Full card lifecycle: create → edit → approve → archive
- BPMN diagram editing flow
- DrawIO diagram sync
- Survey send → respond → apply results

### 4.4 Pure Logic Extraction

Several feature files contain business logic mixed with UI that could be extracted and unit-tested independently:

| File | Extractable Logic |
|------|-------------------|
| `excelImport.ts` / `excelExport.ts` | Spreadsheet parsing/generation |
| `soawExport.ts` / `soawTemplate.ts` | DOCX generation, template structure |
| `matrixHierarchy.ts` | Matrix hierarchy computation |
| `drawio-shapes.ts` | mxGraph cell manipulation (already pure logic) |
| `cardDetailUtils.tsx` | Data quality ring calculation, field rendering logic |

These are low-hanging fruit — pure functions that can be tested without React rendering or API mocking.

---

## Summary of Recommendations (Ordered by Impact)

| # | Area | Effort | Impact | Description |
|---|------|--------|--------|-------------|
| 1 | Backend: Stakeholder endpoint tests | Medium | **Critical** | Core RBAC feature with zero coverage |
| 2 | Backend: Stakeholder permission integration | Medium | **Critical** | Card-level permissions are completely untested across all endpoints |
| 3 | Backend: BPM workflow + diagram tests | Medium | **High** | Multi-state approval workflow and BPMN parsing untested |
| 4 | Backend: Report endpoint tests | Medium | **High** | 9 of 10 report endpoints have no tests |
| 5 | Backend: Card bulk/hierarchy/export tests | Low | **High** | Several card sub-endpoints have no coverage |
| 6 | Backend: Survey workflow tests | Medium | **High** | Send/respond/results workflow untested |
| 7 | Backend: Relation constraint validation | Low | **Medium** | Type compatibility and cardinality not validated in tests |
| 8 | Backend: Input validation tests | Low | **Medium** | Pydantic rejection of bad input not tested |
| 9 | Backend: ServiceNow + EOL tests | High | **Medium** | External integrations need mocked tests |
| 10 | Frontend: Pure logic unit tests | Low | **Medium** | Excel, DOCX, matrix, shapes — easy wins |
| 11 | Frontend: Hook tests (3 remaining) | Low | **Low** | Small gap to close |
| 12 | Frontend: Component smoke tests | Medium | **Medium** | Catch rendering regressions |
| 13 | Frontend: Page-level interaction tests | High | **Medium** | Full workflow coverage |
| 14 | Backend: Auth SSO/invitation tests | Low | **Low** | SSO callback, set-password flows |
