# Turbo EA — Codebase Optimization Report

**Date:** 2026-02-20 (updated after security hardening PR #261)
**Scope:** Full-stack analysis of backend, frontend, database, Docker/deployment, and security

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Backend: API & Query Performance](#2-backend-api--query-performance)
3. [Database: Schema & Indexing](#3-database-schema--indexing)
4. [Frontend: Rendering & Bundle Performance](#4-frontend-rendering--bundle-performance)
5. [Docker & Deployment](#5-docker--deployment)
6. [Security](#6-security)
7. [Prioritized Action Plan](#7-prioritized-action-plan)

---

## 1. Executive Summary

The Turbo EA codebase is well-structured and functional, but has **significant performance bottlenecks** that will manifest at scale (1,000+ fact sheets, 50+ concurrent users).

PR #261 (security hardening) resolved 21 security findings. This updated report removes those items and focuses on **remaining performance and infrastructure issues**.

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Backend API | 3 | 4 | 5 | 2 |
| Database Schema | 1 | 3 | 2 | 1 |
| Frontend | 1 | 3 | 3 | 1 |
| Docker/Deployment | 0 | 1 | 2 | 2 |
| Security (remaining) | 0 | 1 | 2 | 2 |
| **Total** | **5** | **12** | **14** | **8** |

**Top 5 remaining issues by impact:**

1. **Report endpoints load entire tables into memory** — will OOM on large datasets
2. **Pervasive N+1 queries** from `lazy="selectin"` defaults on all model relationships
3. **No route-level code splitting** — initial JS bundle includes all 40+ pages
4. **37+ missing database indexes** on foreign keys and frequently-queried columns
5. **Single uvicorn worker** — production backend cannot utilize multiple CPU cores

---

## Already Addressed by PR #261

The following items from the original report were **resolved by the security hardening PR** and are no longer listed as open:

| Original ID | Issue | Resolution |
|-------------|-------|------------|
| 5.8 / 4.5 | Missing CSP header | CSP + HSTS headers added to `nginx.conf` |
| 6.6 | File upload MIME spoofing | *(Partially — URL scheme validation added to documents, logo upload unchanged)* |
| — | Unauthenticated SSE stream | Token-based auth added to `/events/stream` |
| — | Unauthenticated relations listing | `get_current_user` dependency added |
| — | Unauthenticated card todos listing | Auth dependency added |
| — | XXE in BPMN parser | Switched to `defusedxml` |
| — | No ownership check on todo update/delete | Owner/assignee/admin check added |
| — | Todo listing filter bypass | Permission check for viewing other users' todos |
| — | No URL validation on documents | Scheme whitelist (`http://`, `https://`, `mailto:`) added |
| — | No length limit on comments | `max_length=10000` added |
| — | SSO client_secret in plaintext | Fernet encryption via `core/encryption.py` |
| — | Unbounded JSONB dict fields | Depth/size/key-count validation added to `CardCreate`/`CardUpdate` |
| — | Search param no length limit | `max_length=200` added |
| — | Report params not whitelisted | `_SAFE_KEY_RE` + schema validation added to portfolio/treemap/heatmap |
| — | SMTP password in plaintext | Fernet encryption added |
| — | Default DB password in compose | Changed to `${POSTGRES_PASSWORD:?...}` (required) |
| — | Exception details leaked in email test | Replaced with generic error + server-side logging |
| — | Portal relation options returns all cards | Scoped to portal-visible cards via subquery |
| — | No Docker container security options | `cap_drop: ALL`, `no-new-privileges`, memory limits added |
| — | xlsx CVE vulnerability | Upgraded to xlsx 0.20.3 |
| — | Public portal exposes stakeholder info | *(Addressed in portal query scoping)* |

---

## 2. Backend: API & Query Performance

### 2.1 CRITICAL — Report Endpoints Load Entire Tables Into Memory

Several report endpoints fetch **all** rows without pagination or streaming, which will cause out-of-memory errors on large deployments.

| Endpoint | File:Line | Issue |
|----------|-----------|-------|
| `GET /reports/dependencies` | `reports.py:745-790` | Loads ALL active fact sheets + ALL relations into memory |
| `GET /reports/data-quality` | `reports.py:851-927` | Loads ALL active fact sheets, no pagination |
| `GET /reports/capability-heatmap` | `reports.py:614-732` | Loads ALL applications + ALL relations, nested O(n²) loops |
| `GET /reports/landscape` | `reports.py:143-150` | Loads ALL fact sheets of type + ALL relations |
| `GET /reports/app-portfolio` | `reports.py:235-251` | Loads ALL applications, loops through ALL relations |
| `GET /reports/dashboard` | `reports.py:80-119` | Loads all lifecycle/quality values into Python for bucketing instead of SQL GROUP BY |

**Recommendation:** Move aggregation to SQL (GROUP BY, window functions, CTEs). For graph-based reports (dependencies, heatmap), implement server-side pagination with BFS depth limiting or pre-computed materialized views.

### 2.2 CRITICAL — Pervasive N+1 Query Patterns

The codebase has widespread N+1 issues from both model-level defaults and missing eager loading in queries.

**Model-level `lazy="selectin"` causing automatic extra queries:**

| Model | File:Line | Relationships Auto-Loaded |
|-------|-----------|--------------------------|
| `Card` | `card.py:34-43` | parent, children, tags, stakeholders (4 extra queries per card) |
| `Relation` | `relation.py:25-26` | source + target (2 extra queries per relation) |
| `Tag` | `tag.py:24,37` | TagGroup.tags, Tag.group (cascading loads) |
| `Comment` | `comment.py:27` | replies with `join_depth=5` (loads entire comment trees) |
| `Todo` | `todo.py:30-32` | card, assignee, creator (3 extra queries per todo) |
| `Notification` | `notification.py:41-42` | user + actor (2 extra queries per notification) |

**Impact example:** Listing 100 cards triggers 400+ additional queries (4 relationships × 100 cards).

**Endpoint-level N+1 patterns:**

| Endpoint | File:Line | Issue |
|----------|-----------|-------|
| `GET /surveys` | `surveys.py:271-273` | Loops through surveys, calls `_get_response_stats()` (3 queries) per survey |
| `POST /surveys/{id}/apply` | `surveys.py:574-625` | Individual SELECT per response ID |
| `POST /fact-sheets/{id}/tags` | `tags.py:76-84` | SELECT per tag_id in loop |
| `GET /comments` | `comments.py:35-48` | Recursive `_comment_to_dict` without `selectinload(Comment.replies)` |
| `GET /notifications` | `notifications.py:33` | Accesses `n.actor.display_name` without eager loading |
| `GET /web-portals/public/{slug}` | `web_portals.py:267-278` | Query per tag group (N+1 on tags) |

**Recommendation:**
- Change model defaults from `lazy="selectin"` to `lazy="noload"` across all models
- Add explicit `selectinload()` / `joinedload()` in each query based on what the endpoint actually needs
- Batch operations: replace per-item loops with `WHERE id IN (...)` queries

### 2.3 HIGH — Missing Pagination on List Endpoints

| Endpoint | File:Line |
|----------|-----------|
| `GET /relations` | `relations.py:58` |
| `GET /comments` | `comments.py:35` |
| `GET /tag-groups` | `tags.py:21` |
| `GET /diagrams` | `diagrams.py:107` |
| `GET /metamodel/types` | `metamodel.py:169` |
| `GET /surveys/{id}/responses` | `surveys.py:552` |

**Recommendation:** Add `page` + `page_size` query parameters with sensible defaults (page_size=50, max=200).

### 2.4 HIGH — Python-Side Aggregation Instead of SQL

| Location | File:Line | Issue |
|----------|-----------|-------|
| Dashboard lifecycle counts | `reports.py:94-105` | Loads ALL lifecycle values, counts phases in Python |
| Dashboard quality buckets | `reports.py:80-91` | Loads all data_quality floats, buckets in Python |
| Heatmap relation mapping | `reports.py:653-665` | Builds dict from all relations in Python loop |
| Cost treemap grouping | `reports.py:298-320` | Loops through relation_types multiple times |

**Recommendation:** Use SQL `CASE/WHEN` for bucketing, `GROUP BY` for counting, and `JOIN` for relation mapping. This moves O(n) work to the database where it's indexed and optimized.

### 2.5 MEDIUM — Missing Caching

| Data | Access Pattern | Cache Strategy |
|------|---------------|----------------|
| Dashboard KPIs | Every page load | 30-second in-memory TTL cache |
| Currency setting | Every cost display | Already has module-level cache in frontend; backend should add Cache-Control headers |
| Logo image | Every page load | ETag + If-None-Match (304 responses) |
| Metamodel types | Every component render | Long-lived cache (invalidate on metamodel change events) |
| Portal metadata | Every public page view | 5-minute cache keyed by slug |

### 2.6 MEDIUM — Unnecessary Database Round-Trips

| Location | File:Line | Issue |
|----------|-----------|-------|
| User creation | `users.py:173-182` | 3 separate queries to check email + invitation existence |
| Metamodel deletion | `metamodel.py:380-392` | Fetches result twice |
| Survey target resolution | `surveys.py:111-188` | 6 separate filter queries instead of single JOIN |
| Portal fact sheet loading | `web_portals.py:483-523` | 2 separate queries for source/target relations |

---

## 3. Database: Schema & Indexing

### 3.1 CRITICAL — Missing Foreign Key Indexes

PostgreSQL does NOT auto-create indexes on foreign key columns. These columns are used in JOINs and WHERE clauses but lack indexes:

| Table | Column | File:Line | Used For |
|-------|--------|-----------|----------|
| `events` | `user_id` | `event.py:19-20` | Audit trail lookups by user |
| `events` | `event_type` | `event.py:22` | Dashboard event filtering |
| `comments` | `user_id` | `comment.py:19` | Comment author lookup |
| `comments` | `parent_id` | `comment.py:23` | Threaded comment traversal |
| `todos` | `assigned_to` | `todo.py:23` | "My todos" queries |
| `todos` | `created_by` | `todo.py:26` | Todo creator lookup |
| `todos` | `status` | `todo.py:19` | Open todos count (badges) |
| `tags` | `tag_group_id` | `tag.py:31` | Nested tag queries |
| `notifications` | `actor_id` | `notification.py:37` | Notification sender |
| `bookmarks` | `user_id` | `bookmark.py:31` | "My bookmarks" queries |
| `surveys` | `created_by` | `survey.py:34` | Survey creator lookup |

### 3.2 HIGH — Missing Composite Indexes

These query patterns involve multiple columns but have no composite index:

| Table | Columns | Query Pattern |
|-------|---------|---------------|
| `notifications` | `(user_id, is_read)` | "Get unread notifications for user X" — very frequent |
| `todos` | `(assigned_to, status)` | "My open todos" — used for badge counts |
| `cards` | `(type, status)` | Filtered fact sheet listings |
| `cards` | `(parent_id, type)` | Hierarchy queries with type filter |
| `survey_responses` | `(survey_id, card_id, user_id)` | Already has UniqueConstraint but should verify it creates a usable index |

### 3.3 HIGH — Missing JSONB GIN Indexes

These JSONB columns are queried with `?` or `->` operators but lack GIN indexes:

| Table | Column | File:Line | Query Pattern |
|-------|--------|-----------|---------------|
| `cards` | `attributes` | `card.py:23` | Attribute filtering in reports, surveys, inventory |
| `cards` | `lifecycle` | `card.py:24` | Lifecycle phase filtering, roadmap report |
| `surveys` | `target_filters` | `survey.py:25` | Survey target resolution |
| `web_portals` | `filters` | `web_portal.py:19` | Portal fact sheet filtering |
| `card_types` | `fields_schema` | `card_type.py:22` | Data quality computation |

**Note:** Not all JSONB columns need GIN indexes. Only index those actively queried with JSON operators. Columns like `diagram.data` (stores DrawIO XML) or `soaw.sections` (only read whole) don't benefit from GIN indexes.

### 3.4 HIGH — Connection Pool Configuration

**File:** `database.py:7-15`

```python
pool_size=10, max_overflow=20  # Total: 30 connections max
```

**Issues:**
- `pool_size=10` may be insufficient for 50+ concurrent users with SSE connections
- Missing `pool_pre_ping=True` — stale connections will cause "connection closed" errors
- Pool size should be configurable via environment variables

**Recommendation:**
```python
engine = create_async_engine(
    settings.database_url,
    pool_size=20,           # Increase base pool
    max_overflow=10,        # Reduce overflow (prefer stable pool)
    pool_pre_ping=True,     # Detect stale connections
    pool_recycle=1800,      # Keep existing 30-min recycle
)
```

### 3.5 MEDIUM — Relationship Cascade Concerns

Several tables use `ondelete="CASCADE"` which silently deletes related data:
- `Relation.source_id` / `Relation.target_id` → deleting a card silently removes all its relations
- This is likely intentional but should be documented; consider `ondelete="RESTRICT"` for critical relationships and handling deletion explicitly in code

---

## 4. Frontend: Rendering & Bundle Performance

### 4.1 CRITICAL — No Route-Level Code Splitting

**File:** `App.tsx:1-41`

All 40+ route components are eagerly imported at the top level. The initial bundle includes every page (reports, admin, BPM, diagrams, etc.) even if the user only visits the Dashboard.

**Largest components loaded eagerly:**

| File | Lines |
|------|-------|
| `MetamodelAdmin.tsx` | 3,064 |
| `CardDetail.tsx` | 2,554 |
| `ProcessNavigator.tsx` | 2,476 |
| `PortalViewer.tsx` | 1,521 |
| `PortfolioReport.tsx` | 1,495 |
| `CalculationsAdmin.tsx` | 1,373 |
| `InventoryFilterSidebar.tsx` | 1,351 |
| `CapabilityMapReport.tsx` | 1,329 |
| `DependencyReport.tsx` | 1,272 |
| `EADeliveryPage.tsx` | 1,229 |

**Expected savings:** 40-60% reduction in initial JS bundle size.

**Recommendation:**
```typescript
// BEFORE
import Dashboard from "@/features/dashboard/Dashboard";
import PortfolioReport from "@/features/reports/PortfolioReport";

// AFTER
const Dashboard = lazy(() => import("@/features/dashboard/Dashboard"));
const PortfolioReport = lazy(() => import("@/features/reports/PortfolioReport"));

// Wrap routes with Suspense
<Suspense fallback={<CircularProgress />}>
  <Route path="/" element={<Dashboard />} />
</Suspense>
```

### 4.2 HIGH — Monolithic Components Causing Full-Page Re-renders

`CardDetail.tsx` (2,554 lines) contains detail panel, history, comments, todos, subscriptions, approval flow, and BPM tabs in a single component with 60+ `useState` hooks. Any state change re-renders the entire page.

**Recommendation:** Break into composed sub-components:
```
CardDetail → CardDetailLayout
           ├── CardAttributes
           ├── CardRelations
           ├── CardComments
           ├── CardHistory
           ├── CardApprovalFlow
           └── CardTodos
```

Similarly for `MetamodelAdmin.tsx` (3,064 lines) — extract field editor, type CRUD, relation CRUD, and graph layout into separate components.

### 4.3 HIGH — Missing React.memo on Reusable Components

No usage of `React.memo` was found anywhere in the codebase. Combined with inline `sx={{}}` props creating new objects on every render, this causes unnecessary MUI re-renders.

**Key locations:**

| Component | File:Line | Issue |
|-----------|-----------|-------|
| `AppLayout` nav buttons | `AppLayout.tsx:266-277` | `navBtnSx()` creates new style object every render |
| Search results list | `AppLayout.tsx:338-387` | 40+ lines of JSX re-created on every state change |
| Navigation items | `AppLayout.tsx:391-449` | 60+ lines re-rendered on any navbar state change |

**Quick win:** Wrap `navBtnSx` in `useMemo`:
```typescript
const navBtnSx = useMemo(() => (active: boolean) => ({...}), [isCondensed]);
```

### 4.4 HIGH — Theme Not Memoized

**File:** `App.tsx:45-57`

```typescript
// CURRENT — new theme object on every render
<ThemeProvider theme={createTheme({...})}>

// FIX — memoize or extract to module level
const theme = useMemo(() => createTheme({...}), []);
```

### 4.5 MEDIUM — Badge Count API Call Flooding

**File:** `AppLayout.tsx:159-195`

Badge counts are fetched on 3 separate triggers (mount, SSE events, route changes) with no debouncing. In a busy scenario (5 notifications + 3 todo completions + 1 survey response), this fires 9 API calls in 2 seconds for the same 2 numbers.

**Recommendation:** Add 500ms debounce on badge count refetches.

### 4.6 MEDIUM — Inventory Page Loads 10,000 Rows Client-Side

**File:** `InventoryPage.tsx:236,291-366`

The inventory page fetches `page_size=10000` and applies all filtering in JavaScript. Multiple `.filter()` passes run on every filter change.

**Recommendation:** Reduce initial `page_size` to 200, implement server-side filtering and infinite scroll, or leverage AG Grid's built-in virtual scrolling.

### 4.7 MEDIUM — Chart Layout Re-computation

**File:** `DependencyReport.tsx:143-280`

Complex hierarchical layout algorithm (200+ lines) runs on every render without `useMemo`. Should be memoized on `[data, expandedState]`.

### 4.8 LOW — Missing Error Boundaries

Large page components (`PortfolioReport`, `CardDetail`, `DependencyReport`) have no error boundaries despite complex rendering logic. A rendering error in any sub-component crashes the entire page.

---

## 5. Docker & Deployment

### 5.1 HIGH — Single Uvicorn Worker in Production

**File:** `backend/Dockerfile:22`

Only 1 uvicorn process handles all requests. Under load, a single worker bottlenecks on CPU-bound operations (bcrypt hashing, JSON serialization). The 512MB memory limit added in PR #261 is appropriate but makes multi-worker even more important to maximize throughput within that budget.

**Recommendation:** Use Gunicorn with uvicorn workers:
```dockerfile
CMD ["gunicorn", "app.main:app", "-w", "4", "-k", "uvicorn.workers.UvicornWorker", "--bind", "0.0.0.0:8000"]
```

### 5.2 MEDIUM — Docker Build Layer Caching Suboptimal

**Frontend Dockerfile:** The security PR updated COPY to include `xlsx-0.20.3.tgz`, but the main issue persists — `COPY . .` (line 6) copies the entire frontend directory before `npm run build`, so any file change invalidates the `npm ci` layer.

**Fix:** Copy only source files needed for the build:
```dockerfile
COPY package.json package-lock.json xlsx-0.20.3.tgz ./
RUN npm ci
COPY src ./src
COPY tsconfig.json vite.config.ts index.html ./
COPY drawio-config ./drawio-config
RUN npm run build
```

**Backend Dockerfile:** Missing `.dockerignore` — copies `tests/`, `__pycache__/`, `.pytest_cache/` into the image unnecessarily.

### 5.3 MEDIUM — Nginx Missing Gzip Compression + Upstream Keepalive

**File:** `frontend/nginx.conf`

No gzip configuration for API responses or HTML. JSON API responses can be 50-70% smaller with gzip. No `keepalive` configured for the backend upstream — each API request opens a new TCP connection.

**Recommendation:**
```nginx
gzip on;
gzip_types application/json text/css application/javascript text/html;
gzip_min_length 256;

upstream backend {
    server backend:8000;
    keepalive 32;
}
```

### 5.4 LOW — DrawIO Git Stage Uses `:latest` Tag

**File:** `frontend/Dockerfile:13` — `alpine/git:latest` undermines build reproducibility. Pin to a specific version.

### 5.5 LOW — No Startup Timeout on Alembic Migrations

**File:** `backend/app/main.py:113-148` — If Alembic migrations hang, the container waits indefinitely. Wrap in `asyncio.wait_for(..., timeout=300)`.

---

## 6. Security (Remaining Items)

Most security findings were resolved in PR #261. The following remain open:

### 6.1 HIGH — 24-Hour JWT Tokens With No Revocation

**Files:** `config.py:24`, `security.py:20`

- Default `ACCESS_TOKEN_EXPIRE_MINUTES=1440` (24 hours) is excessive
- No logout endpoint or token blacklist exists
- Account deactivation (`users.py:335`) doesn't invalidate existing tokens

**Note:** PR #261 acknowledged this as L-4 (Low) but did not implement a fix.

**Recommendation:**
- Reduce access token TTL to 15-30 minutes
- Implement refresh token rotation
- Add token blacklist (Redis or DB table) checked in `get_current_user()`

### 6.2 MEDIUM — Rate Limiting Only on Auth Endpoints

**File:** `core/rate_limit.py`, `auth.py:75,117`

Auth endpoints have proper rate limits (5-10/minute), but all other endpoints (reports, metamodel, diagrams, etc.) have **no rate limiting**. An attacker can hammer expensive report endpoints without throttling.

**Recommendation:** Apply tiered global rate limits:
- Read endpoints: 100/minute
- Write endpoints: 30/minute
- Admin endpoints: 10/minute

### 6.3 MEDIUM — File Upload MIME Type Spoofing (Partial)

**File:** `settings.py:377-403`

PR #261 added URL scheme validation for document links, but the logo upload endpoint still checks only the Content-Type header without validating file magic numbers.

**Recommendation:** Add magic number validation using `python-magic`.

### 6.4 LOW — Database Password in Connection String

**File:** `config.py:42-46`

Password concatenated directly into URL string. If logged or printed, credentials are exposed. PR #261 made `POSTGRES_PASSWORD` required in compose, but the connection string issue remains.

**Recommendation:** Use `urllib.parse.quote()` to escape special characters and avoid accidental log exposure.

### 6.5 LOW — Public User List Without Pagination

**File:** `users.py:77-80`

`GET /users` returns all users without pagination. Email addresses are exposed to any authenticated user.

---

## 7. Prioritized Action Plan

### Phase 1 — Critical Performance Fixes

| # | Action | Files | Impact |
|---|--------|-------|--------|
| 1.1 | Change all model relationships from `lazy="selectin"` to `lazy="noload"`, add explicit eager loading in endpoints | All models + API endpoints | Eliminates 400+ extra queries per page |
| 1.2 | Add missing database indexes (FK columns + composite indexes) via Alembic migration | New migration file | 2-10x query speedup on filtered/joined queries |
| 1.3 | Refactor report endpoints to use SQL aggregation instead of Python loops | `reports.py` | Prevents OOM on large datasets |
| 1.4 | Add route-level code splitting with `React.lazy()` | `App.tsx` | 40-60% initial bundle reduction |
| 1.5 | Add pagination to all list endpoints | `relations.py`, `comments.py`, `tags.py`, `diagrams.py`, `metamodel.py` | Prevents unbounded response sizes |

### Phase 2 — High-Priority Improvements

| # | Action | Files | Impact |
|---|--------|-------|--------|
| 2.1 | Add GIN indexes on actively-queried JSONB columns | New migration file | Faster attribute/lifecycle filtering |
| 2.2 | Break `CardDetail.tsx` into sub-components | `CardDetail.tsx` → 5-6 files | Eliminates full-page re-renders |
| 2.3 | Memoize theme creation + add `React.memo` to key components | `App.tsx`, `AppLayout.tsx` | Reduced unnecessary re-renders |
| 2.4 | Increase connection pool size + add `pool_pre_ping` | `database.py` | Better concurrent request handling |
| 2.5 | Add multi-worker Gunicorn for production | `backend/Dockerfile` | Better production throughput |

### Phase 3 — Infrastructure & Remaining Security

| # | Action | Files | Impact |
|---|--------|-------|--------|
| 3.1 | Reduce JWT TTL to 30 min + implement refresh tokens | `security.py`, `auth.py`, `config.py` | Limits compromised token window |
| 3.2 | Add global rate limiting to all endpoints | All API routers | Prevents DoS on expensive endpoints |
| 3.3 | Add gzip compression + upstream keepalive to Nginx | `nginx.conf` | 30-50% payload reduction |
| 3.4 | Fix Docker layer caching (selective COPY, add backend .dockerignore) | Both Dockerfiles | Faster CI/CD builds |

### Phase 4 — Nice-to-Have Improvements

| # | Action | Files | Impact |
|---|--------|-------|--------|
| 4.1 | Add in-memory caching for dashboard KPIs (30s TTL) | `reports.py` | Reduces DB load on frequent page |
| 4.2 | Debounce badge count fetches (500ms) | `AppLayout.tsx` | Reduces redundant API calls |
| 4.3 | Add error boundaries around large page components | Report pages, CardDetail | Prevents full-page crashes |
| 4.4 | Implement server-side filtering for inventory | `fact_sheets.py`, `InventoryPage.tsx` | Handles 10K+ fact sheets |
| 4.5 | File upload magic number validation | `settings.py` | Prevents MIME spoofing |

---

*This report is for review only. No changes have been implemented. Awaiting approval before proceeding with any phase.*
