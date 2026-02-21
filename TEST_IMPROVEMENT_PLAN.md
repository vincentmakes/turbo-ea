# Test Improvement Plan

## Current State

### Backend
- `backend/tests/` contains only `__init__.py` — no test files exist
- `pyproject.toml` has test dependencies (`pytest`, `pytest-asyncio`, `httpx`) but no tests use them
- No `conftest.py`, no fixtures, no test factories
- 30 API route files, 12 service modules, and 5 core utility modules are untested

### Frontend
- No test framework installed (no vitest, jest, @testing-library, etc.)
- No test files exist (no `.test.ts`, `.test.tsx`, `.spec.ts`)
- No test script in `package.json`
- No test configuration files

### CI/CD
- No GitHub Actions workflows (`.github/` has only `FUNDING.yml` and PR template)
- No Makefile or test automation scripts
- PR template references `pytest` but there are no tests to run

---

## Phase 1 — Critical: Backend Core & Security Tests

### 1a. Test Infrastructure

Create `backend/tests/conftest.py` with:
- Async SQLAlchemy session fixture using test transactions (rollback after each test)
- Factory functions: `create_test_user(role=...)`, `create_test_card(type=...)`, `create_test_card_type(...)`
- Auth helper to generate JWT tokens for test users
- `httpx.AsyncClient` with FastAPI's `TestClient` for integration tests

### 1b. `core/security.py` — JWT + Password Hashing

- Token creation with correct payload (sub, role, iat, exp, iss, aud)
- Token validation (expired, bad signature, missing claims)
- Password hashing and verification round-trip

### 1c. `core/encryption.py` — Fernet Encryption

- Encrypt/decrypt round-trip
- `enc:` prefix detection
- Graceful handling of legacy plaintext values
- Invalid token error handling

### 1d. `services/permission_service.py` — RBAC

- Admin wildcard `{"*": true}` grants all permissions
- Member role grants expected permissions, denies admin
- Viewer role denies write operations
- Stakeholder role union with app-level role
- Cache invalidation behavior

### 1e. `api/v1/auth.py` — Authentication Endpoints

- Register (first user gets admin, subsequent get default role)
- Login with correct/wrong credentials
- Token refresh
- `/me` endpoint returns current user
- Rate limiting on login/register

### 1f. `api/v1/cards.py` — Core CRUD

- Create card, verify data quality auto-computed
- Update card, verify approval status breaks on substantive change
- Archive (soft-delete), verify `archived_at` set
- Hierarchy (parent-child) queries
- Permission checks on all operations
- Bulk update

---

## Phase 2 — High: Business Logic & Metamodel

### 2a. `services/calculation_engine.py` — Formula Evaluation

- Each built-in function (IF, SUM, AVG, MIN, MAX, COUNT, ROUND, ABS, COALESCE, PLUCK, FILTER, MAP_SCORE)
- Relation data access in formulas
- Error handling for malformed formulas
- Execution ordering

### 2b. `api/v1/metamodel.py` — Type/Relation Management

- CRUD for card types and relation types
- Field schema validation
- Soft-delete built-in vs hard-delete custom types
- Field/section/option usage queries

### 2c. `services/bpmn_parser.py` — BPMN XML Parsing

- Element extraction from sample BPMN XML (tasks, events, gateways, lanes)
- Verify safe parsing via `defusedxml`
- Edge cases: empty XML, malformed XML

### 2d. `api/v1/roles.py` + `api/v1/stakeholder_roles.py` — Role Management

- CRUD with permission enforcement
- Cannot delete system roles
- Stakeholder role definitions per card type

---

## Phase 3 — High: Frontend Test Foundation

### 3a. Install Vitest + Testing Library

Add to `devDependencies`:
- `vitest`
- `@testing-library/react`
- `@testing-library/jest-dom`
- `@testing-library/user-event`
- `jsdom`

Create `vitest.config.ts` with jsdom environment. Add scripts:
```json
{
  "test": "vitest",
  "test:coverage": "vitest --coverage"
}
```

### 3b. API Client Tests (`src/api/client.ts`)

- Mock `fetch` to verify JWT injection from sessionStorage
- Verify error handling (401 redirect, validation error formatting)
- Verify 204 empty response handling

### 3c. Custom Hook Tests

- `useAuth` — login/logout/token management
- `useMetamodel` — caching, invalidation
- `usePermissions` — effective permission computation
- `useCalculatedFields` — field map fetching
- `useCurrency` — formatting

### 3d. Critical Component Tests

- `CreateCardDialog` — form validation, submission
- `LifecycleBadge` / `ApprovalStatusBadge` — correct rendering per status
- `InventoryPage` — AG Grid column config, filter sidebar interaction
- `CardDetail` — section rendering based on metamodel, permission-based edit controls

---

## Phase 4 — Medium: CI/CD Automation

### 4a. GitHub Actions Workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  backend-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install ruff
      - run: ruff check backend/
      - run: ruff format --check backend/

  backend-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: turboea_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -e ".[dev]"
        working-directory: backend
      - run: pytest --cov=app --cov-report=term-missing
        working-directory: backend
        env:
          POSTGRES_HOST: localhost
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: turboea_test

  frontend-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
        working-directory: frontend
      - run: npm run lint
        working-directory: frontend

  frontend-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
        working-directory: frontend
      - run: npm run build
        working-directory: frontend

  frontend-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
        working-directory: frontend
      - run: npm run test -- --run
        working-directory: frontend
```

### 4b. Pre-commit Hooks (Optional)

- `ruff check` + `ruff format` for backend
- `eslint` + `tsc --noEmit` for frontend

### 4c. Coverage Thresholds

- Start at 50% and increase over time
- Consider Codecov for PR annotations

---

## Phase 5 — Medium: Integration & E2E

### 5a. Backend Integration Tests for Remaining Routes

- Reports endpoints (dashboard, portfolio, matrix, etc.)
- BPM workflow (version lifecycle: draft → pending → published → archived)
- ServiceNow sync (mock external API with `httpx` respx or similar)
- Surveys, SoAW, diagrams, tags, comments, todos, documents
- Event streaming (SSE)

### 5b. Frontend E2E with Playwright

- Login flow
- Create/edit/archive a card
- Navigate inventory with filters
- BPMN editor basic interaction
- Report rendering
- Admin metamodel configuration

---

## Phase 6 — Lower Priority

- Seed data tests — verify `seed.py` and `seed_demo.py` produce valid metamodel/data
- Email service tests — mock SMTP, verify email construction
- Performance tests — load test critical endpoints
- Accessibility tests — axe-core integration for frontend components
- Visual regression — screenshot comparisons for reports/diagrams

---

## Quick Wins (Highest ROI)

| Test | Why | Effort |
|------|-----|--------|
| `calculation_engine.py` unit tests | Pure logic, no DB, many edge cases | Low |
| `encryption.py` unit tests | Security-critical, pure functions | Low |
| `security.py` unit tests | JWT + bcrypt, pure functions | Low |
| `bpmn_parser.py` unit tests | Pure XML parsing, easy with samples | Low |
| `permission_service.py` tests | Core RBAC, prevents auth regressions | Medium |
| Auth endpoint integration tests | Covers registration + login | Medium |
| Frontend Vitest setup + API client tests | Foundation for all future tests | Medium |
| GitHub Actions CI pipeline | Automates lint + build on every PR | Medium |

---

## Structural Recommendations

### Backend Test Organization
```
backend/tests/
├── conftest.py              # DB engine, session, app client, factories
├── core/
│   ├── test_security.py
│   ├── test_encryption.py
│   └── test_permissions.py
├── services/
│   ├── test_calculation_engine.py
│   ├── test_permission_service.py
│   └── test_bpmn_parser.py
└── api/
    ├── conftest.py          # Authenticated client fixtures per role
    ├── test_auth.py
    ├── test_cards.py
    ├── test_metamodel.py
    ├── test_roles.py
    └── test_reports.py
```

### Frontend Test Co-location
Place tests next to source files:
```
src/
├── api/
│   ├── client.ts
│   └── client.test.ts
├── hooks/
│   ├── useAuth.ts
│   └── useAuth.test.ts
└── features/cards/
    ├── CardDetail.tsx
    └── CardDetail.test.tsx
```

### PR Template Updates
Replace aspirational `pytest` checkbox with CI-enforced checks. Add frontend test requirement.

### CLAUDE.md Updates
Add a Testing section documenting conventions, how to run tests, and expected patterns.
