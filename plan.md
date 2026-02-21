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

### 1. Frontend Test Coverage (High Priority)

**Current state**: ~10.5% coverage, 0% feature/page coverage.

**Phase 1 — Critical paths** (target: 30% coverage)
- [ ] Add tests for `LoginPage.tsx` (auth flow)
- [ ] Add tests for `CardDetail.tsx` (core card CRUD view)
- [ ] Add tests for `InventoryPage.tsx` (AG Grid data table)
- [ ] Add tests for `CreateCardDialog.tsx`
- [ ] Add tests for `AppLayout.tsx` (navigation, notifications)

**Phase 2 — Reports & admin** (target: 50% coverage)
- [ ] Add tests for report pages (PortfolioReport, LifecycleReport, etc.)
- [ ] Add tests for `MetamodelAdmin.tsx`
- [ ] Add tests for `RolesAdmin.tsx`

**Phase 3 — Specialized features** (target: 60%+)
- [ ] Add tests for BPM components
- [ ] Add tests for diagram editor components
- [ ] Add tests for SoAW editor

**Approach**: Use Testing Library + MSW (Mock Service Worker) for API mocking
instead of vi.mock. This lets tests exercise the full component lifecycle
including data fetching. Add MSW as a dev dependency.

**When to set threshold**: After Phase 1, set `thresholds.statements` in
`vitest.config.ts` to ~25% as a ratchet.

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

### 7. Observability Stack

**Current state**: Minimal — stdout logs, `/api/health` endpoint, no metrics.

**Phase 1 — Prometheus metrics**:
- [ ] Add `prometheus-client` to backend dependencies
- [ ] Create `/metrics` endpoint (or use `starlette-prometheus` middleware)
- [ ] Track: request latency, request count by endpoint, active connections,
      DB query duration, background task health

**Phase 2 — Grafana dashboards**:
- [ ] Add `docker-compose.observability.yml` with Prometheus + Grafana
- [ ] Create dashboard JSON for key metrics
- [ ] Document setup in README

**Phase 3 — Tracing**:
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
