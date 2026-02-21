# Test Improvement Plan

## Current State

Phases 1–4 are complete. The project has a working CI pipeline with 5 jobs, backend integration + unit tests, frontend unit tests, and a local test runner script.

### Backend
- **10 test files** across `backend/tests/` covering core utilities, services, and API endpoints
- `conftest.py` provides a full fixture suite: async DB sessions (savepoint-rollback), factory helpers, HTTP test client, and autouse fixtures for permission cache and rate limiter
- Test engine uses `NullPool` + sync session-scoped fixture to avoid pytest-asyncio event loop mismatches
- Rate limiting is auto-disabled in tests via the `_disable_rate_limiter` autouse fixture

### Frontend
- **6 test files** co-located with source: API client, 3 components, 2 hooks
- Vitest + Testing Library + jsdom, configured in `vitest.config.ts`
- Scripts: `npm test` (watch), `npm run test:run` (CI), `npm run test:coverage`

### CI/CD
- `.github/workflows/ci.yml` with 5 jobs: `backend-lint`, `backend-test`, `frontend-lint`, `frontend-build`, `frontend-test`
- Backend tests run against PostgreSQL 16 service container
- `scripts/test.sh` for local development (auto-provisions ephemeral Postgres via Docker)
- Concurrency cancellation enabled on PRs

---

## Completed Phases

### Phase 1 — Backend Core & Security Tests ✓

| Item | Test File | Status |
|------|-----------|--------|
| Test infrastructure (conftest, fixtures, factories) | `tests/conftest.py` | Done |
| JWT + password hashing | `tests/core/test_security.py` | Done |
| Fernet encryption | `tests/core/test_encryption.py` | Done |
| Permission service (RBAC) | `tests/services/test_permission_service.py` | Done |
| Auth endpoints (register, login, me, refresh) | `tests/api/test_auth.py` | Done |
| Cards CRUD (create, update, archive, hierarchy, permissions) | `tests/api/test_cards.py` | Done |

### Phase 2 — Business Logic & Metamodel ✓

| Item | Test File | Status |
|------|-----------|--------|
| Calculation engine (all built-in functions) | `tests/services/test_calculation_engine.py` | Done |
| Metamodel types (CRUD, soft/hard delete, field schema) | `tests/api/test_metamodel.py` | Done |
| BPMN parser (element extraction, safe XML) | `tests/services/test_bpmn_parser.py` | Done |
| Roles (CRUD, system role protection, permissions schema) | `tests/api/test_roles.py` | Done |
| Stakeholder roles (CRUD, definitions, card permissions) | `tests/api/test_stakeholder_roles.py` | Done |

### Phase 3 — Frontend Test Foundation ✓

| Item | Test File | Status |
|------|-----------|--------|
| Vitest + Testing Library setup | `vitest.config.ts`, `src/test/setup.ts` | Done |
| API client (JWT injection, error handling, 204) | `src/api/client.test.ts` | Done |
| `useMetamodel` hook | `src/hooks/useMetamodel.test.ts` | Done |
| `useCurrency` hook | `src/hooks/useCurrency.test.ts` | Done |
| `LifecycleBadge` component | `src/components/LifecycleBadge.test.tsx` | Done |
| `ApprovalStatusBadge` component | `src/components/ApprovalStatusBadge.test.tsx` | Done |
| `MaterialSymbol` component | `src/components/MaterialSymbol.test.tsx` | Done |

### Phase 4 — CI/CD Automation ✓

| Item | Status |
|------|--------|
| GitHub Actions workflow (5 jobs) | Done |
| Local test script (`scripts/test.sh`) | Done |
| Coverage reporting (term-missing) | Done |

---

## Remaining Phases

### Phase 5 — Medium: Integration & E2E

#### 5a. Backend Integration Tests for Remaining Routes

Priority endpoints not yet covered:

- Relations CRUD (`api/v1/relations.py`)
- Reports endpoints (dashboard, portfolio, matrix, cost, lifecycle, dependencies, data quality)
- BPM workflow (version lifecycle: draft → pending → published → archived)
- BPM assessments and reports
- Calculations CRUD + execution
- Tags, comments, todos, documents
- Diagrams CRUD
- SoAW CRUD
- Surveys (create, send, respond, results)
- Bookmarks and saved reports
- Users admin CRUD
- Settings (SMTP, logo, favicon)
- Notifications
- Event streaming (SSE)
- ServiceNow sync (mock external API with `httpx` respx or similar)
- EOL proxy
- Web portals (public + admin)

#### 5b. Frontend Tests for Remaining Hooks and Components

Priority items not yet covered:

**Hooks:**
- `useAuth` — login/logout/token management
- `usePermissions` — effective permission computation
- `useCalculatedFields` — field map fetching
- `useEventStream` — SSE connection + reconnect
- `useBpmEnabled` — feature flag

**Components:**
- `CreateCardDialog` — form validation, submission
- `InventoryPage` — AG Grid column config, filter sidebar
- `CardDetail` — section rendering, permission-based edit controls
- `NotificationBell` — badge count, mark-read
- `ErrorBoundary` — error state rendering

#### 5c. Frontend E2E with Playwright

- Login flow
- Create/edit/archive a card
- Navigate inventory with filters
- BPMN editor basic interaction
- Report rendering
- Admin metamodel configuration

---

### Phase 6 — Lower Priority

- Seed data tests — verify `seed.py` and `seed_demo.py` produce valid metamodel/data
- Email service tests — mock SMTP, verify email construction
- Performance tests — load test critical endpoints
- Accessibility tests — axe-core integration for frontend components
- Visual regression — screenshot comparisons for reports/diagrams

---

## Test Infrastructure Reference

### Backend Test Architecture

```
backend/tests/
├── conftest.py                        # DB engine, session, app client, factories
├── core/
│   ├── test_security.py               # JWT + bcrypt
│   └── test_encryption.py             # Fernet encrypt/decrypt
├── services/
│   ├── test_calculation_engine.py     # Formula evaluation
│   ├── test_permission_service.py     # RBAC logic
│   └── test_bpmn_parser.py           # BPMN XML parsing
└── api/
    ├── test_auth.py                   # Register, login, me, refresh
    ├── test_cards.py                  # CRUD, hierarchy, permissions
    ├── test_metamodel.py              # Types, relation types, delete
    ├── test_roles.py                  # Role CRUD, permissions schema
    └── test_stakeholder_roles.py      # Stakeholder role definitions
```

### Key Test Fixtures (`conftest.py`)

| Fixture | Scope | Purpose |
|---------|-------|---------|
| `test_engine` | session (sync) | Creates async engine with `NullPool`. Uses `asyncio.run()` for table setup/teardown. Must stay sync to avoid event loop mismatches. |
| `db` | function (async) | Per-test transactional session with savepoint-rollback pattern. Each test gets a clean slate. |
| `app` | function (async) | Minimal FastAPI app with `get_db` overridden to use the test session. |
| `client` | function (async) | `httpx.AsyncClient` bound to the test app via `ASGITransport`. |
| `_clear_permission_cache` | function (autouse) | Clears `PermissionService` caches before and after each test. |
| `_disable_rate_limiter` | function (autouse) | Disables slowapi rate limiting so tests assert business logic, not rate limits. |

### Factory Helpers

| Helper | Default | Notes |
|--------|---------|-------|
| `create_role(db, key, label, permissions)` | admin with `{"*": True}` | |
| `create_user(db, email, role, password)` | Random email, admin role | |
| `create_card_type(db, key, label, fields_schema)` | Application | Defaults to `built_in=False`; pass `built_in=True` explicitly for built-in type tests |
| `create_card(db, card_type, name, user_id)` | Application, "Test Card" | |
| `create_relation_type(db, key, source_type_key, target_type_key)` | app_to_itc | |
| `create_relation(db, type_key, source_id, target_id)` | app_to_itc | |
| `create_stakeholder_role_def(db, card_type_key, key, label)` | Application, responsible | |
| `auth_headers(user)` | — | Returns `{"Authorization": "Bearer <token>"}` |

### Frontend Test Architecture

```
frontend/src/
├── test/
│   └── setup.ts                       # @testing-library/jest-dom matchers
├── api/
│   └── client.test.ts                 # Fetch wrapper, JWT, error handling
├── hooks/
│   ├── useMetamodel.test.ts           # Cache, invalidation
│   └── useCurrency.test.ts            # Formatting
└── components/
    ├── LifecycleBadge.test.tsx         # Status rendering
    ├── ApprovalStatusBadge.test.tsx    # Approval status rendering
    └── MaterialSymbol.test.tsx         # Icon rendering
```

### Running Tests

```bash
# Backend — unit tests only (no database needed)
cd backend && python -m pytest tests/core/ tests/services/ -q

# Backend — all tests (auto-provisions ephemeral Postgres via Docker)
./scripts/test.sh

# Backend — all tests with coverage
./scripts/test.sh --cov

# Frontend — watch mode
cd frontend && npm test

# Frontend — single run (CI mode)
cd frontend && npm run test:run
```
