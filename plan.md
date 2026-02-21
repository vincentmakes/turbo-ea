# DevOps Improvement Plan — Additional Findings

Status: Tracks remaining work beyond the P0/P1/P2 changes already merged.

---

## Completed (this PR)

### P0
- [x] Coverage threshold — backend set to 40% ratchet (`fail_under=40`)
- [x] Security scanning — pip-audit + npm audit in CI (continue-on-error)
- [x] Python lockfile — `scripts/lock-deps.sh` + pip-tools in dev deps

### P1
- [x] Dependabot — `.github/dependabot.yml` for pip, npm, GitHub Actions
- [x] Branch protection — documented in CONTRIBUTING.md
- [x] Structured logging — JSON in production, human-readable in dev
- [x] CHANGELOG — created following Keep a Changelog format

### P2
- [x] Pre-commit hooks — added pre-commit-hooks repo (yaml/json/merge checks, no-commit-to-branch)
- [x] Makefile — unified dev task runner
- [x] Docker image pinning — `alpine/git:v2.47.2` (was `:latest`)
- [x] Backend health check — compose + Dockerfile HEALTHCHECK
- [x] Dockerfile layer caching — deps installed before source copy
- [x] Frontend depends_on — `condition: service_healthy`

---

## Remaining Work

### 1. Frontend Test Coverage (High Priority) ✅

**Current state**: 378 tests across 34 files. All three phases complete.

**Phase 1 — Critical paths** ✅
- [x] Add tests for `LoginPage.tsx` (8 tests — auth flow, SSO, validation)
- [x] Add tests for `CardDetail.tsx` (17 tests — tabs, fields, relations, loading)
- [x] Add tests for `InventoryPage.tsx` (8 tests — grid, filters, type selector)
- [x] Add tests for `CreateCardDialog.tsx` (12 tests — form, validation, type selection)
- [x] Add tests for `AppLayout.tsx` (14 tests — navigation, badges, drawer)

**Phase 2 — Reports & admin** ✅
- [x] Add tests for `ReportShell.tsx` (18 tests — layout, toggles, save/print)
- [x] Add tests for `PortfolioReport.tsx` (10 tests — chart data, empty state)
- [x] Add tests for `LifecycleReport.tsx` (9 tests — roadmap, EOL warnings)
- [x] Add tests for `MetamodelAdmin.tsx` (15 tests — types, relations, tabs)
- [x] Add tests for `RolesAdmin.tsx` (16 tests — role CRUD, permissions)

**Phase 3 — Specialized features** ✅
- [x] Add tests for BPM components (BpmDashboard 12, BpmReportPage 11, ProcessFlowTab 18, ProcessAssessmentPanel 12)
- [x] Add tests for `DiagramsPage.tsx` (13 tests — gallery, CRUD dialogs)
- [x] Add tests for `EADeliveryPage.tsx` (14 tests — initiatives, SoAW creation)

**Approach used**: Vitest + Testing Library with `vi.mock("@/api/client")` for
API mocking and stub components for complex sub-components (bpmn-js, DrawIO,
recharts). No MSW needed.

**Remaining**: Consider setting a coverage threshold ratchet in `vitest.config.ts`
now that baseline is established.

---

### 2. TypeScript Strictness — Eliminate `any` Types

**Current state**: `@typescript-eslint/no-explicit-any` is `"off"`.

**Plan** (incremental, not big-bang):
1. [ ] Set `no-explicit-any` to `"warn"` first — see the scale of the problem
2. [ ] Fix `any` types in shared code first: `src/api/client.ts`, `src/hooks/`, `src/types/`
3. [ ] Fix feature code file-by-file, prioritizing type-sensitive areas (API responses, form state)
4. [ ] Once all warnings are resolved, promote to `"error"`

**Expected scope**: Likely 50-100 occurrences. Many will be API response types
that should be typed via interfaces in `types/index.ts`.

---

### 3. Python Type Checking (mypy)

**Current state**: No static type checking. Python 3.12 type hints are used
inconsistently but never validated.

**Plan**:
1. [ ] Add `mypy>=1.11.0` to dev dependencies in `pyproject.toml`
2. [ ] Add `[tool.mypy]` config: start with `--ignore-missing-imports`
       and `--disallow-untyped-defs=false`
3. [ ] Add mypy to CI as a `continue-on-error` job (informational)
4. [ ] Fix type errors module-by-module, starting with `core/` and `services/`
5. [ ] Gradually tighten: enable `--disallow-untyped-defs` per-module
6. [ ] Once clean, promote to required CI check

**Config sketch**:
```toml
[tool.mypy]
python_version = "3.12"
warn_return_any = true
warn_unused_configs = true
ignore_missing_imports = true

[mypy-alembic.*]
ignore_errors = true
```

---

### 4. CSP Hardening — Remove `unsafe-inline`

**Current state**: Nginx CSP header uses `'unsafe-inline'` for styles
(required by MUI/Emotion's runtime CSS injection).

**Plan**:
- [ ] Investigate Emotion's `nonce` support — MUI 6 supports CSP nonces
      via `<CacheProvider>` with `prepend: true` and a nonce attribute
- [ ] Add nonce generation middleware to nginx (or backend)
- [ ] Update CSP to use `'nonce-<value>'` instead of `'unsafe-inline'`
- [ ] Test that all MUI styles still apply correctly

**Complexity**: Medium. Requires both nginx and frontend changes. MUI's Emotion
integration has documented CSP nonce support.

---

### 5. Backend Test Gaps (6 Untested API Modules)

**Current state**: The following API modules have no tests:
- `stakeholders.py` — RBAC user-card assignments ← **critical**
- `bpm_workflow.py` — process flow version approval
- `bpm_assessments.py` — process scoring
- `bpm_reports.py` — BPM aggregations
- `eol.py` — End-of-Life proxy
- `servicenow.py` — CMDB sync

**Update**: Some of these now have test files (test_stakeholders.py,
test_bpm_workflow.py, test_servicenow.py, test_eol.py). Verify coverage
and add missing cases.

**Priority order**:
1. [ ] Verify + extend `test_stakeholders.py` — RBAC is security-critical
2. [ ] Verify + extend `test_bpm_workflow.py` — approval state machine
3. [ ] Verify + extend `test_servicenow.py` — external integration
4. [ ] Add `test_bpm_assessments.py`
5. [ ] Add `test_bpm_reports.py`
6. [ ] Extend report tests beyond dashboard (9+ report types untested)

After filling these gaps, bump `fail_under` from 40 → 55.

---

### 6. E2E Test Suite

**Current state**: No end-to-end tests.

**Plan**:
1. [ ] Add Playwright as a frontend dev dependency
2. [ ] Create `frontend/e2e/` directory with test structure
3. [ ] Write critical path tests:
   - Login → Dashboard → Inventory → Card detail → Logout
   - Create card → Edit fields → Add relation → Delete card
   - Admin: metamodel → add field → verify on card
4. [ ] Add `playwright.config.ts` pointing at docker compose dev
5. [ ] Add E2E job to CI (runs against docker compose, continue-on-error initially)

**Complexity**: High. Requires a running backend + frontend + database. Best
run as a separate CI workflow that spins up docker compose.

---

### 7. Observability Stack ✅ (Phase 1 & 2)

**Current state**: Prometheus metrics + Grafana dashboards implemented.

**Phase 1 — Prometheus metrics** ✅:
- [x] Add `prometheus-client>=0.21.0` to backend dependencies
- [x] Create `app/core/metrics.py` — metric definitions (counters, histograms, gauges, info)
- [x] Create `app/middleware/prometheus.py` — ASGI middleware for request instrumentation
- [x] Add `/metrics` endpoint in `main.py` (Prometheus-compatible exposition)
- [x] Track: request latency (histogram with p50/p95/p99 buckets), request count by
      method/endpoint/status, active connections gauge, DB pool metrics
      (size/idle/in-use/overflow via SQLAlchemy event listeners), background task health
- [x] UUID path normalisation to prevent label cardinality explosion
- [x] 27 backend tests (metric types, labels, path normalisation, middleware, endpoint)

**Phase 2 — Grafana dashboards** ✅:
- [x] Add `docker-compose.observability.yml` with Prometheus v2.51 + Grafana 10.4
- [x] Create `observability/prometheus.yml` config (15s scrape interval)
- [x] Create Grafana provisioning (datasource + dashboard provider)
- [x] Create `turboea-overview` dashboard (10 panels: request rate, latency p50/p95/p99,
      error rate, in-progress requests, by-endpoint breakdown, by-status-code,
      DB connection pool, slowest endpoints, background tasks)

**Phase 3 — Tracing** (future):
- [ ] Add OpenTelemetry SDK
- [ ] Instrument FastAPI, SQLAlchemy, httpx
- [ ] Export to Jaeger or OTLP-compatible backend

---

### 8. Miscellaneous

- [ ] **Commit message validation**: Add commitlint or similar to pre-commit
      (conventional commits format)
- [ ] **ADR (Architecture Decision Records)**: Create `docs/adr/` directory,
      document key decisions (data-driven metamodel, card vs fact sheet rename,
      RBAC model, DrawIO embedding approach)
- [ ] **Docker image scanning**: Add Trivy to CI for container vulnerability scanning
- [ ] **Backup automation**: Add `scripts/backup-db.sh` for PostgreSQL pg_dump
- [ ] **Migration rollback testing**: Add CI step that runs `alembic downgrade`
      to verify migrations are reversible
