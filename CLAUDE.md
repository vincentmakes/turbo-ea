# Turbo EA

Self-hosted Enterprise Architecture Management platform that creates a **digital twin of a company's IT landscape**. Fully admin-configurable metamodel — card types, fields, subtypes, relations, stakeholder roles, and calculated fields are all data, not code.

**Current version**: see `/VERSION` (single source of truth for backend + frontend).

## Quick Start

```bash
cp .env.example .env          # Edit secrets and DB credentials
docker compose up --build -d  # Starts backend (port 8000) + frontend (port 8920)
```

The first user to register automatically gets the `admin` role. Set `SEED_DEMO=true` to pre-populate with the NexaTech Industries demo dataset. Add `--profile ai` to include the bundled Ollama container for AI description suggestions.

---

## AI Assistant Guidelines

When working on this codebase, follow these conventions:

### General Principles
- **Data-driven metamodel**: Card types, fields, subtypes, relations, stakeholder roles, and calculated fields are all stored as data (JSONB) in the database, not hardcoded. Never add new card types or fields in code — add them via the seed or admin API.
- **Cards, not fact sheets**: The codebase was fully renamed from "fact sheets" to "cards". Never introduce the old terminology.
- **Permission checks are mandatory**: Every mutating endpoint must call `PermissionService.require_permission()` or use the `require_permission()` dependency. Never bypass permission checks.
- **No raw SQL**: Use SQLAlchemy ORM for all database queries. Alembic for all schema changes.

### Backend Conventions
- All route handlers live in `backend/app/api/v1/`, one file per resource domain.
- New routes must be registered in `backend/app/api/v1/router.py`.
- Use `async def` for all route handlers and database operations.
- Permission checking: use `PermissionService.require_permission(db, user, "permission.key")` or the `require_permission("permission.key")` FastAPI dependency from `deps.py`.
- New permission keys must be added to `backend/app/core/permissions.py` (the single source of truth for all valid permission keys).
- New models go in `backend/app/models/` (one file per table) and must be imported in `backend/app/models/__init__.py`.
- Schema changes require a new Alembic migration in `backend/alembic/versions/` with sequential numbering (e.g., `036_description.py`).
- Sensitive values (SSO secrets, SMTP passwords) must use `encrypt_value()`/`decrypt_value()` from `backend/app/core/encryption.py`.
- Ruff linting: line length 100, rules E/F/I/N/W. Run `ruff check .` and `ruff format .`.
- **Before every commit**, run `cd backend && ruff format . && ruff check .` to ensure CI won't fail on formatting or lint errors. This is mandatory — do not skip it.

### MCP Server Conventions
- The MCP server lives in `mcp-server/` — a separate Python package (`turbo-ea-mcp`) with its own `pyproject.toml` and Dockerfile.
- It provides **read-only** AI tool access to EA data via the [Model Context Protocol](https://modelcontextprotocol.io/) (FastMCP library).
- **Two transport modes**: HTTP/SSE (production, via Docker `--profile mcp`) and stdio (local testing with Claude Desktop).
- **Authentication**: In HTTP mode, users authenticate via OAuth 2.1 delegated to the Turbo EA SSO provider. The MCP server resolves OAuth tokens to Turbo EA JWTs. In stdio mode, `TURBO_EA_EMAIL`/`TURBO_EA_PASSWORD` env vars are used for direct login.
- **Tools are read-only**: `search_cards`, `get_card`, `get_card_relations`, `get_card_hierarchy`, `list_card_types`, `get_relation_types`, `get_dashboard`, `get_landscape`. Do not add mutating tools without careful security review.
- **All data access respects RBAC**: The user's JWT is passed through to the backend API, so permission checks are enforced server-side.
- **Config** is in `mcp-server/turbo_ea_mcp/config.py` — reads from env vars (`TURBO_EA_URL`, `TURBO_EA_PUBLIC_URL`, `MCP_PUBLIC_URL`, `MCP_PORT`).
- **Tests** live in `mcp-server/tests/` and use `pytest` + `pytest-asyncio`. Run with `cd mcp-server && pip install -e ".[dev]" && pytest`.
- The MCP server shares the `/VERSION` file with backend/frontend for version consistency.

### Frontend Conventions
- Route-level pages use `lazy()` imports in `App.tsx` for code splitting.
- Shared hooks in `src/hooks/`, shared components in `src/components/`.
- Feature-specific components go in `src/features/{feature}/`.
- Use `api.get()`, `api.post()`, `api.patch()`, `api.delete()` from `src/api/client.ts` for all API calls.
- JWT token is in `sessionStorage` (not localStorage). Use `setToken()`/`clearToken()` from `client.ts`.
- All TypeScript interfaces live in `src/types/index.ts`.
- Use MUI 6 components — do not introduce other UI libraries.
- Icons use Google Material Symbols via the `MaterialSymbol` component.
- When nesting MUI Dialogs, use `disableRestoreFocus` on inner dialogs.

### Internationalization (i18n)
- **All user-facing strings must use translation keys**, never hardcoded English text. Use `useTranslation()` from `react-i18next` with the appropriate namespace.
- **12 namespaces**: `common`, `auth`, `nav`, `inventory`, `cards`, `reports`, `admin`, `bpm`, `diagrams`, `delivery`, `notifications`, `validation`. Use the namespace that matches the feature area.
- **8 supported locales**: `en` (English, baseline), `de` (German), `fr` (French), `es` (Spanish), `it` (Italian), `pt` (Portuguese), `zh` (Chinese Simplified), `ru` (Russian).
- **English is the source of truth**. All keys must exist in `frontend/src/i18n/locales/en/{namespace}.json` first. The i18n config uses `fallbackLng: "en"` and `returnEmptyString: false`, so missing or empty translations gracefully fall back to English.
- **Interpolation**: Use `{{variable}}` syntax for dynamic values (e.g., `"Selected {{count}} cards"`). Preserve these placeholders exactly when translating.
- **Plurals**: i18next uses `_one` / `_other` suffixes (e.g., `"count_one": "{{count}} item"`, `"count_other": "{{count}} items"`). All locales need both forms.
- **JSON safety**: Never use unescaped ASCII double quotes `"` inside JSON string values. For Chinese use corner brackets `「」`, for other languages use `«»` or escaped `\"`.
- **Metamodel labels** (card type names, field labels, relation labels) are translated separately via the `translations` JSONB column on `card_types` and `relation_types`. Use `useResolveLabel()` / `useResolveMetaLabel()` from `src/hooks/useResolveLabel.ts` to resolve these at render time.

#### Adding a New Language

1. **Create locale files**: Copy `frontend/src/i18n/locales/en/` to `frontend/src/i18n/locales/{code}/` (use ISO 639-1 code). Translate all values; leave keys unchanged.
2. **Register in i18n config** (`frontend/src/i18n/index.ts`):
   - Add imports for all 12 namespace files
   - Add the locale to the `resources` object in `i18n.init()`
   - Add the code to `SUPPORTED_LOCALES` array
   - Add a display label to `LOCALE_LABELS`
3. **Add metamodel translations**: In `backend/app/services/seed.py`, add entries for the new locale in the `translations` dict of each card type and relation type definition.
4. **Backend locale column** (`users.locale`): The Alembic migration already stores locale as a free-form string, so no migration is needed.
5. **Validate**: Run `python3 -c "import json, glob; [json.load(open(f)) for f in glob.glob('src/i18n/locales/{code}/*.json')]"` to check JSON validity. Then run `npm run build` and `npm run test:run`.

#### Translation Checklist for Code Changes

Every change that introduces user-visible content must include translations. Before marking a task as complete, verify:

- [ ] **New UI strings**: Added translation keys to `frontend/src/i18n/locales/en/{namespace}.json` and all 7 non-English locale files (`de`, `fr`, `es`, `it`, `pt`, `zh`, `ru`). Never hardcode English text in components.
- [ ] **New metamodel content** (card types, subtypes, fields, options, sections, relation types): Added `"translations"` dicts with all 7 non-English locales in `backend/app/services/seed.py`.
- [ ] **New select options** (in seed data or reusable option arrays): Each option object includes a `"translations"` dict.
- [ ] **New field labels**: Each field in `fields_schema` includes a `"translations"` dict.
- [ ] **New section names**: Each section in `fields_schema` includes a `"translations"` dict.
- [ ] **New subtypes**: Each subtype includes a `"translations"` dict.
- [ ] **Interpolation preserved**: `{{variable}}` placeholders are identical across all locales.
- [ ] **Plurals**: Keys using counts include both `_one` and `_other` variants in all locales.
- [ ] **JSON valid**: No unescaped double quotes in JSON values. Chinese uses `「」`, others use `«»` or `\"`.

### Security Requirements
- Never store plaintext secrets in the database — use `encrypt_value()`.
- Never expose sensitive fields (password hashes, encrypted secrets) in API responses.
- Always validate user input via Pydantic schemas on the backend.
- Use parameterized queries (SQLAlchemy ORM) — never construct SQL strings.
- New endpoints must use `Depends(get_current_user)` or `Depends(require_permission(...))`.
- Rate limiting is applied via `slowapi` — apply `@limiter.limit()` to auth-sensitive endpoints.

### Pull Request Conventions
- **Always use the PR template** at `.github/pull_request_template.md` when creating pull requests. Do not use a custom format — fill in the template sections exactly as defined.
- The PR template has four required sections: **Summary**, **Changes**, **Test Plan**, and **Checklist**. All must be completed.
- **Summary**: 1-3 sentences explaining what the PR does and why.
- **Changes**: Bulleted list of the key changes made.
- **Test Plan**: Describe how you verified the changes work. Always include the three CI checkboxes (all CI checks pass, manually tested, added/updated tests). Check the boxes that apply.
- **Checklist**: Review every item and check all that apply. These enforce the project's core conventions (permission checks, Alembic migrations, async handlers, data-driven metamodel, no exposed secrets). Do not remove unchecked items — leave them unchecked so reviewers can see what was considered.
- PR titles should be concise (under 72 characters) and describe the change, not the implementation.

### Changelog & Versioning Conventions
- **Update `CHANGELOG.md`** for every user-facing change. Add entries under the current version heading (e.g., `## [0.6.0] - 2026-02-22`). Do **not** use an `[Unreleased]` section — this project ships continuously and every change belongs to a concrete version.
- The changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Use these categories: **Added**, **Changed**, **Deprecated**, **Removed**, **Fixed**, **Security**. Only include categories that apply.
- Each entry should be a single concise line describing the change from the user's perspective, not implementation details.
- **Bump the version once per PR** (not per commit). All commits in a feature branch share one version. Follow [Semantic Versioning](https://semver.org/): bump **patch** (e.g., `0.6.0` → `0.6.1`) for bug fixes, **minor** (e.g., `0.6.0` → `0.7.0`) for new features, **major** for breaking changes.
- The single source of truth for the version is `/VERSION`. When bumping, only update `VERSION` (the backend reads it at runtime via `config.py`, the frontend injects it at build time via `vite.config.ts`). Do **not** edit `backend/pyproject.toml` or `frontend/package.json` — they use a static `"0.0.0"` placeholder to avoid triggering unnecessary CI jobs on version bumps.
- When bumping, add a new heading in `CHANGELOG.md` with the new version and today's date (e.g., `## [0.6.1] - 2026-02-22`), and place new entries under it.

### Testing Conventions
- **Every new feature or bug fix should include tests.** CI will block PRs that fail lint or tests.
- **Backend tests** live in `backend/tests/` mirroring the source structure (`core/`, `services/`, `api/`).
- **Frontend tests** live next to source files (e.g., `client.ts` → `client.test.ts`).
- Backend integration tests use the savepoint-rollback pattern — each test runs in a transaction that rolls back automatically, so tests never pollute each other.
- The test database engine (`test_engine` in `conftest.py`) is a **sync** session-scoped fixture using `NullPool`. This avoids pytest-asyncio event loop mismatches — each test gets a fresh asyncpg connection on its own loop. Do not convert it to an async fixture.
- **Rate limiting is auto-disabled** in tests via an autouse fixture (`_disable_rate_limiter`). Tests should assert actual business logic status codes, not 429.
- Use the factory helpers in `backend/tests/conftest.py` (`create_user`, `create_card`, `create_card_type`, etc.) rather than inserting raw models. Note: `create_card_type` defaults to `built_in=False`; pass `built_in=True` explicitly when testing built-in type behavior.
- Frontend tests use Vitest + Testing Library. Mock the API client with `vi.mock("@/api/client")`, not the global fetch.
- Pure logic (calculation engine, BPMN parser, encryption, JWT) should have unit tests that need no database.
- **Seed demo data must stay compatible with the metamodel.** `test_seed_demo.py` validates that every card type, subtype, attribute key, select option, and relation type used in `seed_demo.py` and `seed_demo_bpm.py` matches the definitions in `seed.py`. When changing the metamodel, update the demo data or these tests will fail.

**Running tests locally:**
```bash
# Backend — unit tests only (no database needed)
cd backend && python -m pytest tests/core/ tests/services/ -q

# Backend — all tests (auto-provisions ephemeral Postgres via Docker)
./scripts/test.sh

# Frontend
cd frontend && npm test          # watch mode
cd frontend && npm run test:run  # single run (CI mode)
```

### User Documentation (User Manual)

Every feature or UI change **must** include updates to the user manual. The user manual lives in `docs/` and is built with **MkDocs Material** + **mkdocs-static-i18n**. It deploys automatically to Cloudflare Pages on every push to `main`. See `CONTRIBUTING.md` for the full documentation guide — the rules below are the mandatory checklist for every change.

#### Documentation Structure

```
docs/
├── index.md / index.{locale}.md          ← Homepage
├── assets/img/{en,es,de,...}/            ← Per-language screenshots
├── getting-started/                      ← Onboarding pages
├── guide/                                ← Feature documentation
├── admin/                                ← Administration guides
└── reference/glossary.md / .{locale}.md  ← Glossary
```

Files use **suffix-based** i18n: `page.md` is English (default), `page.es.md` is Spanish, `page.de.md` is German, etc. Untranslated pages fall back to English automatically.

#### When to Update Docs

| Change Type | Required Doc Update |
|-------------|-------------------|
| **New feature** | Add or update the relevant guide/admin page in **all supported languages** (currently `en` + locale suffixes for `es`, `de`, `fr`, `it`, `pt`, `zh`, `ru`). |
| **UI change** | Replace affected screenshots in **all locale folders** under `docs/assets/img/`. |
| **New admin setting** | Update the appropriate admin page (e.g., `docs/admin/settings.md`). |
| **New API endpoint** | Document in the relevant guide page if user-facing. |
| **Terminology change** | Update the glossary (`docs/reference/glossary.md` + all locale variants). |
| **New page** | Create `docs/path/page.md` (English) + all locale variants. Add to `nav:` in `mkdocs.yml` including locale-specific nav labels. |

#### Documentation Checklist for Code Changes

Before marking a feature task as complete, verify:

- [ ] **Guide page updated**: The relevant page under `docs/guide/` or `docs/admin/` describes the new/changed behavior in all supported languages.
- [ ] **Screenshots updated**: Any new or changed UI is captured in `docs/assets/img/{locale}/` for all locales. Follow the `NN_short_description.png` naming convention. **Every screenshot added to `scripts/screenshots/pages.ts` MUST also be referenced in the corresponding documentation page** (`docs/guide/` or `docs/admin/`) in ALL 8 locale files — otherwise the screenshot is captured but never displayed.
- [ ] **Screenshot script updated**: New pages/screens are added to `scripts/screenshots/pages.ts` (see section below). **Never add a screenshot to the script without also adding the `![Alt Text](../assets/img/{locale}/{filename}.png)` reference to the matching doc page in all locales.**
- [ ] **Navigation updated**: New pages are added to `nav:` in `mkdocs.yml` with translated labels for all locales.
- [ ] **Glossary updated**: New terms are added to `docs/reference/glossary.md` and all locale variants.
- [ ] **Grammar checked**: All documentation text has correct grammar, spelling, and diacritical marks (accents, umlauts, cedillas, tildes) in every supported language. Do not strip or omit diacritics — use proper characters (e.g., `ä ö ü ß` for German, `é è ê ç à` for French, `á é í ó ú ñ` for Spanish, `è é à ù ò` for Italian, `á â ã ç é ê í ó ô õ ú` for Portuguese).
- [ ] **Docs build passes**: Run `mkdocs build --strict` to verify no broken links or missing files.

#### Previewing Docs Locally

```bash
pip install -r requirements-docs.txt
mkdocs serve
# → http://127.0.0.1:8000
```

### Screenshot Automation

The project includes a **Playwright-based screenshot capture script** at `scripts/screenshots/` that automatically generates all documentation and marketing screenshots. When you add a new page, UI feature, or change existing UI, you **must** update the screenshot definitions so that automated captures stay in sync.

**IMPORTANT**: Screenshots and documentation are a **two-way contract**. Adding a screenshot to `pages.ts` without referencing it in the docs means it will be captured but never displayed. Adding an image reference in a doc without a `pages.ts` entry means it will never be auto-captured. Always update both together:
1. Add/update the entry in `scripts/screenshots/pages.ts` (with `filenames` for all 8 locales)
2. Add the `![Alt Text](../assets/img/{locale}/{filename}.png)` reference in the corresponding doc page in **all 8 locale files** (`.md`, `.de.md`, `.fr.md`, `.es.md`, `.it.md`, `.pt.md`, `.zh.md`, `.ru.md`)

#### How It Works

1. Launches headless Chromium via Playwright at 2x device scale (Retina quality).
2. Authenticates via `POST /api/v1/auth/login` and injects the JWT into `sessionStorage`.
3. Resolves card UUIDs from demo data (e.g., `{{cardId:sampleApp}}` → NexaCore ERP UUID).
4. Switches locale per capture run (EN, ES, etc.) via API + localStorage.
5. Navigates to each configured route, executes pre-capture actions (scroll, click, hover, wait), and saves screenshots to `docs/assets/img/{locale}/`.

#### Configuration

All screenshot definitions live in **`scripts/screenshots/pages.ts`**:

- **`DOC_PAGES`** array: Documentation screenshots (saved to `docs/assets/img/{locale}/`). Each entry has an `id`, `route`, optional `waitFor`/`actions`, and `filenames` per locale.
- **`MARKETING_PAGES`** array: Marketing site screenshots (saved to `marketing-site/assets/screenshots/`).
- **`CARD_LOOKUPS`**: Maps card names to search queries for UUID resolution from demo data.

Example entry:
```typescript
{
  id: "26_admin_settings_ai",
  route: "/admin/settings?tab=ai",
  waitFor: ".MuiPaper-root",
  actions: [{ type: "wait", ms: 600 }],
  filenames: {
    en: "26_admin_settings_ai",
    es: "26_admin_config_ia",
  },
},
```

#### When to Update the Screenshot Script

| Change Type | What to Update in `scripts/screenshots/pages.ts` |
|-------------|--------------------------------------------------|
| **New page/route** | Add a new entry to `DOC_PAGES` with the next sequential `id` number. Include `filenames` for all supported locales (`en`, `es` at minimum). |
| **Changed route path** | Update the `route` field on the affected entry. |
| **New UI section requiring interaction** | Add `actions` (click tab, scroll, wait) to capture the specific state. |
| **New card type in demo data** | Add a `CARD_LOOKUPS` entry if the screenshot needs to navigate to a specific card. |
| **Removed page** | Remove the corresponding entry from `DOC_PAGES` or `MARKETING_PAGES`. |

#### Running the Screenshot Script

```bash
cd scripts/screenshots
npm install && npm run install-browsers

# Prerequisites: Turbo EA running with demo data
# SEED_DEMO=true docker compose up --build -d

npm run capture              # All docs + marketing, all locales
npm run capture:en           # English only
npm run capture:marketing    # Marketing screenshots only
npx tsx capture.ts --only 26 # Specific screenshot by ID prefix
npx tsx capture.ts --dry-run # Preview without saving files
```

---

## Architecture Overview

```
┌───────────────────────────────────────────────────────────┐
│  Browser                                                  │
│  React 18 + MUI 6 + React Router 7 + Recharts + AG Grid  │
│  Vite dev server (port 5173) / Nginx in production        │
└──────────────────────────┬────────────────────────────────┘
                           │  /api/* (proxy)
┌──────────────────────────▼────────────────────────────────┐
│  FastAPI Backend (Python 3.12, uvicorn, port 8000)        │
│  SQLAlchemy 2 (async) + Alembic migrations                │
│  RBAC permissions + JWT auth (HS256, bcrypt, PyJWT)       │
│  SSE event stream for real-time updates                   │
│  Rate limiting (slowapi) + field encryption (Fernet)      │
│  AI suggestions via Ollama-compatible LLM + web search    │
└──────────────┬───────────────────────┬────────────────────┘
               │                       │  /api/chat, /api/tags
┌──────────────▼──────────────┐  ┌─────▼──────────────────────┐
│  PostgreSQL (asyncpg driver)│  │  Ollama (optional, ai       │
│  External container on      │  │  profile) or external LLM   │
│  `guac-net` Docker network  │  │  provider on port 11434     │
└─────────────────────────────┘  └─────────────────────────────┘
```

**DrawIO** is self-hosted inside the frontend Docker image (cloned at build time from `jgraph/drawio` v26.0.9) and served under `/drawio/` by Nginx.

---

## Terminology

The codebase uses **"cards"** throughout (models, routes, UI). Earlier documentation may reference "fact sheets" — this has been fully renamed. The core entity table is `cards`, the API route is `/api/v1/cards`, and the frontend route is `/cards/:id`.

---

## Project Structure

```
turbo-ea/
├── VERSION                            # SemVer "0.5.0" (single source of truth)
├── .dockerignore                      # Root-level (both services use root context)
├── docker-compose.yml                 # Backend + frontend services
├── docker-compose.db.yml              # PostgreSQL for local development
├── .env.example
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── deps.py                # Auth dependencies (get_current_user, require_permission)
│   │   │   └── v1/
│   │   │       ├── router.py          # Mounts all 34 API routers
│   │   │       ├── auth.py            # /auth (login, register, me, SSO, set-password)
│   │   │       ├── cards.py           # /cards CRUD + hierarchy + approval status + CSV export
│   │   │       ├── metamodel.py       # /metamodel (types + relation types + field/section usage)
│   │   │       ├── relations.py       # /relations CRUD
│   │   │       ├── stakeholders.py    # /cards/{id}/stakeholders (role assignments)
│   │   │       ├── stakeholder_roles.py # /stakeholder-roles (per-type role definitions)
│   │   │       ├── roles.py           # /roles (app-level RBAC management)
│   │   │       ├── calculations.py    # /calculations (computed field formulas)
│   │   │       ├── bpm.py             # /bpm (BPMN diagram CRUD + templates)
│   │   │       ├── bpm_assessments.py # /bpm (process assessments)
│   │   │       ├── bpm_reports.py     # /bpm/reports (maturity, risk, automation)
│   │   │       ├── bpm_workflow.py    # /bpm (process flow version approval)
│   │   │       ├── ppm.py             # /ppm (status reports, costs, budgets, risks, tasks, WBS)
│   │   │       ├── ppm_reports.py     # /reports/ppm (dashboard, gantt, group-options)
│   │   │       ├── diagrams.py        # /diagrams CRUD (DrawIO XML storage)
│   │   │       ├── soaw.py            # /soaw (Statement of Architecture Work)
│   │   │       ├── reports.py         # /reports (dashboard, portfolio, matrix, etc.)
│   │   │       ├── saved_reports.py   # /saved-reports (persisted report configs)
│   │   │       ├── tags.py            # /tag-groups + /cards/{id}/tags
│   │   │       ├── comments.py        # /cards/{id}/comments (threaded)
│   │   │       ├── todos.py           # /todos + /cards/{id}/todos
│   │   │       ├── documents.py       # /cards/{id}/documents (link storage)
│   │   │       ├── bookmarks.py       # /bookmarks (saved inventory views)
│   │   │       ├── events.py          # /events + /events/stream (SSE)
│   │   │       ├── users.py           # /users CRUD (admin only)
│   │   │       ├── ai_suggest.py       # /ai (AI description suggestions + status)
│   │   │       ├── settings.py        # /settings (logo, currency, SMTP, favicon, AI)
│   │   │       ├── surveys.py         # /surveys (data-maintenance surveys)
│   │   │       ├── eol.py             # /eol (End-of-Life proxy for endoflife.date)
│   │   │       ├── web_portals.py     # /web-portals (public portal management)
│   │   │       ├── notifications.py   # /notifications (user notifications)
│   │   │       ├── servicenow.py      # /servicenow (CMDB sync integration)
│   │   │       ├── adr.py             # /adr (Architecture Decision Records)
│   │   │       └── file_attachments.py # /cards/{id}/attachments (file uploads)
│   │   ├── core/
│   │   │   ├── security.py            # JWT creation/validation (PyJWT HS256), bcrypt
│   │   │   ├── permissions.py         # Permission key registry (single source of truth)
│   │   │   ├── encryption.py          # Fernet symmetric encryption for DB secrets
│   │   │   └── rate_limit.py          # slowapi rate limiter instance
│   │   ├── models/                    # SQLAlchemy ORM models (30 files, see Database section)
│   │   ├── schemas/                   # Pydantic request/response models
│   │   │   ├── auth.py                # Auth schemas
│   │   │   ├── card.py                # Card schemas
│   │   │   ├── common.py              # Shared schemas (pagination, sorting)
│   │   │   ├── relation.py            # Relation schemas
│   │   │   ├── bpm.py                 # BPM schemas
│   │   │   ├── ppm.py                 # PPM schemas
│   │   │   └── ai_suggest.py          # AI suggestion request/response schemas
│   │   ├── services/
│   │   │   ├── event_bus.py           # In-memory pub/sub + SSE streaming
│   │   │   ├── permission_service.py  # RBAC permission checks (5-min cache)
│   │   │   ├── calculation_engine.py  # Safe formula eval (simpleeval sandbox)
│   │   │   ├── ai_service.py          # AI description suggestions (web search + LLM)
│   │   │   ├── bpmn_parser.py         # BPMN 2.0 XML → element extraction
│   │   │   ├── element_relation_sync.py # Link BPMN elements to EA cards
│   │   │   ├── servicenow_service.py  # ServiceNow API client + sync
│   │   │   ├── seed.py                # Default metamodel (14 types, 30+ relations)
│   │   │   ├── seed_demo.py           # NexaTech Industries demo dataset
│   │   │   ├── seed_demo_bpm.py       # Demo BPM processes
│   │   │   ├── seed_demo_ppm.py       # Demo PPM data (status reports, WBS, tasks, budgets, costs, risks)
│   │   │   ├── notification_service.py # In-memory + DB notification management
│   │   │   └── email_service.py       # SMTP-based email sending
│   │   ├── config.py                  # Settings from env vars + APP_VERSION
│   │   ├── database.py                # Async engine + session factory
│   │   └── main.py                    # FastAPI app, lifespan (migrations + seed + purge loop + AI auto-config)
│   ├── alembic/                       # Database migrations (41 versions)
│   ├── tests/
│   ├── pyproject.toml
│   └── Dockerfile                     # Python 3.12-alpine + uvicorn (root context)
│
├── frontend/
│   ├── src/
│   │   ├── api/client.ts              # Fetch wrapper with JWT (sessionStorage) + error handling
│   │   ├── types/index.ts             # All TypeScript interfaces
│   │   ├── globals.d.ts               # __APP_VERSION__ type declaration
│   │   ├── print.css                  # Print stylesheet
│   │   ├── hooks/
│   │   │   ├── useAuth.ts             # Login/register/logout + token in sessionStorage
│   │   │   ├── useMetamodel.ts        # Cached metamodel types + relation types
│   │   │   ├── useEventStream.ts      # SSE subscription hook
│   │   │   ├── useCurrency.ts         # Global currency format + symbol cache
│   │   │   ├── usePermissions.ts      # Effective permissions for current card
│   │   │   ├── useCalculatedFields.ts # Track calculated fields per type
│   │   │   ├── useBpmEnabled.ts       # BPM feature flag
│   │   │   ├── usePpmEnabled.ts       # PPM feature flag
│   │   │   ├── useSavedReport.ts      # Saved report caching
│   │   │   ├── useThumbnailCapture.ts # SVG → PNG for report thumbnails
│   │   │   └── useTimeline.ts         # Process timeline data
│   │   ├── layouts/AppLayout.tsx       # Top nav bar + mobile drawer + badge debounce
│   │   ├── components/
│   │   │   ├── CreateCardDialog.tsx
│   │   │   ├── LifecycleBadge.tsx
│   │   │   ├── ApprovalStatusBadge.tsx
│   │   │   ├── MaterialSymbol.tsx
│   │   │   ├── NotificationBell.tsx
│   │   │   ├── NotificationPreferencesDialog.tsx
│   │   │   ├── EolLinkSection.tsx
│   │   │   ├── VendorField.tsx
│   │   │   ├── AiSuggestPanel.tsx
│   │   │   ├── ErrorBoundary.tsx
│   │   │   ├── ColorPicker.tsx
│   │   │   ├── KeyInput.tsx
│   │   │   └── TimelineSlider.tsx
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   │   ├── LoginPage.tsx       # Email/password + SSO login
│   │   │   │   ├── SetPasswordPage.tsx # Invited user password setup
│   │   │   │   └── SsoCallback.tsx     # SSO OAuth callback handler
│   │   │   ├── dashboard/Dashboard.tsx
│   │   │   ├── inventory/
│   │   │   │   ├── InventoryPage.tsx        # AG Grid + memoized configs
│   │   │   │   ├── InventoryFilterSidebar.tsx # Filter panel
│   │   │   │   ├── ImportDialog.tsx          # Excel/CSV import
│   │   │   │   ├── RelationCellPopover.tsx   # Relation column popover
│   │   │   │   ├── excelExport.ts            # Excel export logic
│   │   │   │   └── excelImport.ts            # Excel import logic
│   │   │   ├── cards/
│   │   │   │   ├── CardDetail.tsx           # Main container + tab navigation
│   │   │   │   └── sections/               # Modular section components
│   │   │   │       ├── index.ts             # Barrel export
│   │   │   │       ├── cardDetailUtils.tsx   # Shared utilities (DataQualityRing, FieldEditor)
│   │   │   │       ├── DescriptionSection.tsx
│   │   │   │       ├── LifecycleSection.tsx
│   │   │   │       ├── AttributeSection.tsx  # Custom fields per section
│   │   │   │       ├── HierarchySection.tsx
│   │   │   │       ├── RelationsSection.tsx
│   │   │   │       ├── StakeholdersTab.tsx
│   │   │   │       ├── CommentsTab.tsx
│   │   │   │       ├── TodosTab.tsx
│   │   │   │       └── HistoryTab.tsx
│   │   │   ├── bpm/                         # Business Process Management
│   │   │   │   ├── BpmDashboard.tsx
│   │   │   │   ├── ProcessFlowEditorPage.tsx
│   │   │   │   ├── BpmnModeler.tsx          # bpmn-js integration
│   │   │   │   ├── BpmnViewer.tsx
│   │   │   │   ├── BpmnTemplateChooser.tsx
│   │   │   │   ├── ProcessFlowTab.tsx       # Embedded in card detail
│   │   │   │   ├── ProcessAssessmentPanel.tsx
│   │   │   │   ├── ProcessNavigator.tsx
│   │   │   │   ├── ElementLinker.tsx
│   │   │   │   └── BpmReportPage.tsx
│   │   │   ├── ppm/                          # Project Portfolio Management
│   │   │   │   ├── PpmPortfolio.tsx          # Portfolio dashboard with Gantt chart
│   │   │   │   ├── PpmProjectDetail.tsx      # Initiative detail (tabbed)
│   │   │   │   ├── PpmOverviewTab.tsx        # Initiative snapshot
│   │   │   │   ├── PpmReportsTab.tsx         # Status reports with health badges
│   │   │   │   ├── PpmCostTab.tsx            # Budget + cost lines
│   │   │   │   ├── PpmRiskTab.tsx            # Risk matrix + list
│   │   │   │   ├── PpmTaskBoard.tsx          # Kanban board (dnd-kit)
│   │   │   │   ├── PpmTaskCard.tsx           # Task card component
│   │   │   │   ├── PpmTaskDialog.tsx         # Create/edit task dialog
│   │   │   │   ├── PpmGanttTab.tsx           # Timeline view with milestones
│   │   │   │   ├── PpmWbsDialog.tsx          # Create/edit WBS item dialog
│   │   │   │   └── StatusReportDialog.tsx    # Create/edit status report dialog
│   │   │   ├── diagrams/
│   │   │   │   ├── DiagramsPage.tsx         # Gallery with thumbnails
│   │   │   │   ├── DiagramEditor.tsx        # DrawIO iframe editor
│   │   │   │   ├── DiagramSyncPanel.tsx     # Card ↔ diagram sync
│   │   │   │   ├── CardSidebar.tsx          # Card picker sidebar
│   │   │   │   ├── CardPickerDialog.tsx     # Search & select cards
│   │   │   │   ├── CreateOnDiagramDialog.tsx # Create card from diagram
│   │   │   │   ├── RelationPickerDialog.tsx # Relation management
│   │   │   │   └── drawio-shapes.ts         # mxGraph cell helpers
│   │   │   ├── reports/
│   │   │   │   ├── PortfolioReport.tsx      # Bubble/scatter chart
│   │   │   │   ├── CapabilityMapReport.tsx  # Heatmap
│   │   │   │   ├── LifecycleReport.tsx      # Timeline visualization
│   │   │   │   ├── DependencyReport.tsx     # Network graph
│   │   │   │   ├── CostReport.tsx           # Treemap + bar chart
│   │   │   │   ├── MatrixReport.tsx         # Cross-reference grid
│   │   │   │   ├── DataQualityReport.tsx    # Completeness dashboard
│   │   │   │   ├── EolReport.tsx            # End-of-Life status
│   │   │   │   ├── ProcessMapReport.tsx     # Process map visualization
│   │   │   │   ├── SavedReportsPage.tsx     # Saved report gallery
│   │   │   │   ├── ReportShell.tsx          # Shared report layout wrapper
│   │   │   │   ├── MetricCard.tsx           # Reusable KPI card
│   │   │   │   ├── ReportLegend.tsx         # Shared legend component
│   │   │   │   ├── SaveReportDialog.tsx     # Save report config dialog
│   │   │   │   ├── EditReportDialog.tsx     # Edit saved report dialog
│   │   │   │   └── matrixHierarchy.ts       # Matrix hierarchy helpers
│   │   │   ├── ea-delivery/
│   │   │   │   ├── EADeliveryPage.tsx       # SoAW document list
│   │   │   │   ├── SoAWEditor.tsx           # Create/edit SoAW
│   │   │   │   ├── SoAWPreview.tsx          # Read-only preview
│   │   │   │   ├── RichTextEditor.tsx       # TipTap rich text editor
│   │   │   │   ├── EditableTable.tsx        # Inline-editable table
│   │   │   │   ├── soawExport.ts            # DOCX export logic
│   │   │   │   └── soawTemplate.ts          # SoAW section templates
│   │   │   ├── todos/TodosPage.tsx          # Todos + surveys (tabbed)
│   │   │   ├── surveys/
│   │   │   │   ├── SurveyRespond.tsx        # Survey response form
│   │   │   │   └── MySurveys.tsx            # User's pending surveys
│   │   │   ├── web-portals/PortalViewer.tsx # Public portal (no auth)
│   │   │   └── admin/
│   │   │       ├── MetamodelAdmin.tsx       # Type list + relation graph orchestrator
│   │   │       ├── metamodel/               # Modular metamodel admin components
│   │   │       │   ├── index.ts
│   │   │       │   ├── constants.ts         # FIELD_TYPE_OPTIONS, icons, colors
│   │   │       │   ├── helpers.ts           # Validation, defaults
│   │   │       │   ├── TypeDetailDrawer.tsx  # Type editor + field/section CRUD
│   │   │       │   ├── FieldEditorDialog.tsx # Field config (type, options, weight)
│   │   │       │   ├── StakeholderRolePanel.tsx # Per-type role definitions
│   │   │       │   └── MetamodelGraph.tsx   # Relation type SVG visualization
│   │   │       ├── CardLayoutEditor.tsx      # Section ordering, DnD fields, columns, groups
│   │   │       ├── RolesAdmin.tsx            # App-level role + permission management
│   │   │       ├── CalculationsAdmin.tsx     # Calculated field formula management
│   │   │       ├── TagsAdmin.tsx
│   │   │       ├── UsersAdmin.tsx
│   │   │       ├── SettingsAdmin.tsx
│   │   │       ├── EolAdmin.tsx
│   │   │       ├── SurveysAdmin.tsx
│   │   │       ├── SurveyBuilder.tsx
│   │   │       ├── SurveyResults.tsx
│   │   │       ├── WebPortalsAdmin.tsx
│   │   │       ├── ServiceNowAdmin.tsx
│   │   │       └── AiAdmin.tsx            # AI suggestion settings (provider, model, search)
│   │   ├── App.tsx                          # Routes + MUI theme (lazy imports)
│   │   └── main.tsx                         # React entry point
│   ├── drawio-config/                       # PreConfig.js, PostConfig.js
│   ├── nginx.conf                           # API proxy + DrawIO + security headers
│   ├── package.json
│   ├── vite.config.ts                       # __APP_VERSION__ injection from VERSION file
│   └── Dockerfile                           # Multi-stage: node → drawio → nginx (root context)
│
├── mcp-server/
│   ├── turbo_ea_mcp/
│   │   ├── server.py              # FastMCP tools, resources, prompts + ASGI app
│   │   ├── api_client.py          # HTTP client for Turbo EA backend API
│   │   ├── oauth.py               # OAuth 2.1 authorization server (SSO-delegated)
│   │   ├── config.py              # Environment-based config (TURBO_EA_URL, MCP_PORT, etc.)
│   │   └── __main__.py            # CLI entry point
│   ├── tests/
│   │   ├── test_server.py         # MCP tool tests
│   │   └── test_oauth.py          # OAuth flow tests
│   ├── pyproject.toml
│   └── Dockerfile                 # Python 3.12-alpine + uvicorn
│
├── plan.md
└── Statement_of_Architecture_Work_Template.md
```

---

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
| `HOST_PORT` | `8920` | Port exposed on the host for the frontend |
| `RESET_DB` | `false` | Drop all tables and re-create + re-seed on startup |
| `SEED_DEMO` | `false` | Populate NexaTech Industries demo data on startup |
| `SEED_BPM` | `false` | Populate demo BPM processes |
| `SEED_PPM` | `false` | Populate demo PPM data (status reports, WBS, tasks, budgets, costs, risks) |
| `ENVIRONMENT` | `development` | Runtime environment. Controls: API docs visibility, secret key validation |
| `ALLOWED_ORIGINS` | `http://localhost:8920` | CORS allowed origins (comma-separated) |
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
| `TURBO_EA_PUBLIC_URL` | `http://localhost:8920` | (MCP server) Public-facing Turbo EA URL for OAuth redirects |
| `MCP_PUBLIC_URL` | `http://localhost:8001` | (MCP server) Public URL for OAuth metadata |
| `MCP_PORT` | `8001` | (MCP server) Bind port |

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
| `users` | `User` | Email, display_name, password_hash, role_key (FK to roles), is_active, SSO fields |
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
| `process_elements` | `ProcessElement` | Extracted BPMN elements (tasks, events, gateways, lanes) |
| `process_flow_versions` | `ProcessFlowVersion` | Version history with approval workflow (draft/pending/published/archived) |
| `process_assessments` | `ProcessAssessment` | Process scores: efficiency, effectiveness, compliance |

### PPM Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `ppm_status_reports` | `PpmStatusReport` | Initiative health reports: schedule/cost/scope health, summary, accomplishments, next steps |
| `ppm_cost_lines` | `PpmCostLine` | Actual cost transactions: description, category (capex/opex), planned, actual, date |
| `ppm_budget_lines` | `PpmBudgetLine` | Planned budget per fiscal year: category (capex/opex), amount |
| `ppm_risks` | `PpmRisk` | Initiative risks: probability (1-5), impact (1-5), auto-computed risk_score, mitigation, status |
| `ppm_tasks` | `PpmTask` | Work items: status (todo/in_progress/done/blocked), priority, assignee, tags (JSONB), WBS link |
| `ppm_task_comments` | `PpmTaskComment` | Comments on PPM tasks |
| `ppm_wbs` | `PpmWbs` | Work Breakdown Structure: self-referential hierarchy, completion (auto-rolled up), milestones |

### Calculation Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `calculations` | `Calculation` | Admin-defined formulas: name, formula, target_type_key, target_field_key, is_active, execution_order |

### Supporting Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `tag_groups` | `TagGroup` | Tag categories with mode (single/multi), create_mode, restrict_to_types |
| `tags` | `Tag` | Individual tags within groups, with optional color |
| `card_tags` | (association) | M:N join table |
| `comments` | `Comment` | Threaded comments on cards (self-referential parent_id) |
| `todos` | `Todo` | Tasks linked to cards, assignable to users, with due dates |
| `documents` | `Document` | URL/link attachments on cards |
| `bookmarks` | `Bookmark` | Saved inventory filter/column/sort views per user |
| `events` | `Event` | Audit trail: event_type + JSONB data, linked to card and user |
| `diagrams` | `Diagram` | DrawIO diagram storage: name, type, data (JSONB with XML + thumbnail) |
| `diagram_initiatives` | (association) | M:N between diagrams and initiative cards |
| `statement_of_architecture_works` | `SoAW` | TOGAF SoAW documents linked to initiatives |
| `app_settings` | `AppSettings` | Singleton row: email_settings, general_settings (incl. AI config), custom_logo, custom_favicon |
| `surveys` | `Survey` | Data-maintenance surveys with target_type, filters, actions |
| `survey_responses` | `SurveyResponse` | Per card + user responses |
| `notifications` | `Notification` | Per-user notifications |
| `web_portals` | `WebPortal` | Public portals with slug-based URLs |
| `saved_reports` | `SavedReport` | Persisted report configurations with thumbnails |
| `sso_invitations` | `SsoInvitation` | Pre-assigned SSO invitations |

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

Located in `backend/alembic/versions/` (41 migration files, sequentially numbered `001_` through `041_`). The app auto-runs Alembic on startup:
- Fresh DB: `create_all` + stamp head
- Existing DB without Alembic: stamp head
- Normal: `upgrade head` (run pending migrations)
- `RESET_DB=true`: drop all + recreate + stamp head

---

## API Reference

Base path: `/api/v1`. All endpoints except auth and public portals require `Authorization: Bearer <token>`.

**API docs**: Available at `/api/docs` (Swagger UI) and `/api/openapi.json` in **development mode only** (`ENVIRONMENT=development`). Disabled in production.

### Authentication (`/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | No | Register (first user gets admin) |
| POST | `/auth/login` | No | Login, returns `{access_token}` |
| GET | `/auth/me` | Yes | Current user info + permissions |
| POST | `/auth/refresh` | Yes | Refresh token |
| GET | `/auth/sso/config` | No | SSO configuration |
| POST | `/auth/sso/callback` | No | SSO OAuth callback |
| POST | `/auth/set-password` | No | Set password via invitation token |

### Metamodel (`/metamodel`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/metamodel/types` | List types. `?include_hidden=true` for soft-deleted |
| GET | `/metamodel/types/{key}` | Get single type |
| POST | `/metamodel/types` | Create custom type |
| PATCH | `/metamodel/types/{key}` | Update type (fields_schema, section_config, stakeholder_roles, etc.) |
| DELETE | `/metamodel/types/{key}` | Soft-delete built-in, hard-delete custom |
| GET | `/metamodel/types/{key}/field-usage` | Count cards using a specific field |
| GET | `/metamodel/types/{key}/section-usage` | Count cards using any field in a section |
| GET | `/metamodel/types/{key}/option-usage` | Count cards using a specific select option |
| GET | `/metamodel/relation-types` | List relation types. `?type_key=X` to filter |
| POST | `/metamodel/relation-types` | Create relation type |
| PATCH | `/metamodel/relation-types/{key}` | Update relation type |
| DELETE | `/metamodel/relation-types/{key}` | Soft-delete / hard-delete |

### Cards (`/cards`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cards` | Paginated list. Query: `type`, `status`, `search`, `parent_id`, `approval_status`, `page`, `page_size`, `sort_by`, `sort_dir` |
| POST | `/cards` | Create card. Auto-computes data quality, runs calculations |
| GET | `/cards/{id}` | Get card with tags + stakeholders |
| PATCH | `/cards/{id}` | Update. Breaks approval on substantive changes, recalculates quality |
| DELETE | `/cards/{id}` | Archives (soft-delete: status=ARCHIVED, sets archived_at). Auto-purged after 30 days |
| PATCH | `/cards/bulk` | Bulk update multiple cards |
| GET | `/cards/{id}/hierarchy` | Ancestors, children, computed level |
| GET | `/cards/{id}/history` | Paginated event history |
| POST | `/cards/{id}/approval-status` | `?action=approve\|reject\|reset` |
| GET | `/cards/export/csv` | Export as CSV. `?type=X` |

### RBAC (`/roles`, `/stakeholder-roles`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/roles` | List app-level roles |
| POST | `/roles` | Create role with permissions |
| PATCH | `/roles/{id}` | Update role permissions |
| DELETE | `/roles/{id}` | Delete non-system role |
| GET | `/stakeholder-roles` | List per-type stakeholder role definitions |
| GET | `/cards/{id}/effective-permissions` | Get effective permissions for current user on a card |

### Calculations (`/calculations`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/calculations` | List all calculations |
| GET | `/calculations/calculated-fields` | Map of type_key → calculated field_keys |
| POST | `/calculations` | Create calculation formula |
| PATCH | `/calculations/{id}` | Update formula |
| DELETE | `/calculations/{id}` | Delete calculation |
| POST | `/calculations/{id}/run` | Execute calculation on all matching cards |

### BPM (`/bpm`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/bpm/processes/{id}/diagram` | Get BPMN XML for a process |
| PUT | `/bpm/processes/{id}/diagram` | Save BPMN XML (auto-extracts elements) |
| GET | `/bpm/processes/{id}/elements` | List extracted BPMN elements |
| GET | `/bpm/templates` | List BPMN starter templates |
| GET | `/bpm/process-flow-versions` | List versions for a process |
| POST | `/bpm/process-flow-versions` | Create draft version |
| POST | `/bpm/process-flow-versions/{id}/submit` | Submit for approval |
| POST | `/bpm/process-flow-versions/{id}/approve` | Approve and publish |
| POST | `/bpm/process-flow-versions/{id}/reject` | Reject with comment |
| GET | `/bpm/reports/dashboard` | Process maturity KPIs |
| GET | `/bpm/reports/risk` | Risk assessment overview |
| GET | `/bpm/reports/automation` | Automation levels |

### PPM (`/ppm`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/ppm/initiatives/{id}/reports` | List status reports for an initiative |
| POST | `/ppm/initiatives/{id}/reports` | Create status report |
| PATCH | `/ppm/reports/{id}` | Update status report |
| DELETE | `/ppm/reports/{id}` | Delete status report |
| GET | `/ppm/initiatives/{id}/costs` | List cost lines |
| POST | `/ppm/initiatives/{id}/costs` | Create cost line (auto-syncs initiative costActual) |
| PATCH | `/ppm/costs/{id}` | Update cost line |
| DELETE | `/ppm/costs/{id}` | Delete cost line |
| GET | `/ppm/initiatives/{id}/budgets` | List budget lines |
| POST | `/ppm/initiatives/{id}/budgets` | Create budget line (auto-syncs initiative costBudget) |
| PATCH | `/ppm/budgets/{id}` | Update budget line |
| DELETE | `/ppm/budgets/{id}` | Delete budget line |
| GET | `/ppm/initiatives/{id}/has-costs` | Check if initiative has budget/cost lines |
| GET | `/ppm/initiatives/{id}/risks` | List risks (ordered by risk_score desc) |
| POST | `/ppm/initiatives/{id}/risks` | Create risk (auto-computes risk_score) |
| PATCH | `/ppm/risks/{id}` | Update risk |
| DELETE | `/ppm/risks/{id}` | Delete risk |
| GET | `/ppm/initiatives/{id}/tasks` | List tasks |
| POST | `/ppm/initiatives/{id}/tasks` | Create task (auto-syncs to system Todo) |
| PATCH | `/ppm/tasks/{id}` | Update task |
| DELETE | `/ppm/tasks/{id}` | Delete task |
| GET | `/ppm/tasks/{id}/comments` | List task comments |
| POST | `/ppm/tasks/{id}/comments` | Create task comment |
| PATCH | `/ppm/task-comments/{id}` | Update comment (author or ppm.manage) |
| DELETE | `/ppm/task-comments/{id}` | Delete comment |
| GET | `/ppm/initiatives/{id}/wbs` | List WBS items with progress |
| POST | `/ppm/initiatives/{id}/wbs` | Create WBS item |
| PATCH | `/ppm/wbs/{id}` | Update WBS (auto-rollup completion) |
| DELETE | `/ppm/wbs/{id}` | Delete WBS item |
| GET | `/ppm/initiatives/{id}/completion` | Overall initiative completion % |
| GET | `/reports/ppm/dashboard` | PPM dashboard KPIs |
| GET | `/reports/ppm/gantt` | Gantt chart data. `?group_by={type_key}` for grouping |
| GET | `/reports/ppm/group-options` | Available card types for Gantt grouping |
| GET | `/settings/ppm-enabled` | Check if PPM module is enabled (public) |
| PATCH | `/settings/ppm-enabled` | Toggle PPM module (admin only) |

### Reports (`/reports`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/reports/dashboard` | KPIs: counts by type, avg data quality, approvals, events |
| GET | `/reports/landscape` | Cards grouped by a related type |
| GET | `/reports/portfolio` | Bubble chart data: configurable X/Y/size/color axes |
| GET | `/reports/matrix` | Cross-reference grid between two types |
| GET | `/reports/roadmap` | Lifecycle timeline data |
| GET | `/reports/cost` | Cost aggregation (simple bar) |
| GET | `/reports/cost-treemap` | Treemap with optional grouping |
| GET | `/reports/capability-heatmap` | Business capability hierarchy with app counts |
| GET | `/reports/dependencies` | Network graph: nodes + edges with BFS depth limiting |
| GET | `/reports/data-quality` | Completeness dashboard |

### Saved Reports (`/saved-reports`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/saved-reports` | List saved report configs |
| POST | `/saved-reports` | Save report configuration with thumbnail |
| PATCH | `/saved-reports/{id}` | Update saved report |
| DELETE | `/saved-reports/{id}` | Delete saved report |

### ServiceNow (`/servicenow`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/servicenow/connections` | List ServiceNow connections |
| POST | `/servicenow/connections` | Create connection |
| POST | `/servicenow/connections/{id}/test` | Test connectivity |
| GET | `/servicenow/mappings` | List type/field mappings |
| POST | `/servicenow/sync/pull` | Pull records from ServiceNow |
| POST | `/servicenow/sync/push` | Push records to ServiceNow |
| GET | `/servicenow/staged` | List staged records for review |
| POST | `/servicenow/staged/apply` | Apply staged records |

### AI Suggestions (`/ai`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/ai/suggest` | Generate AI description suggestion for a card (requires `ai.suggest` permission) |
| GET | `/ai/status` | Check if AI is enabled, configured, and which types are supported |

### AI Settings (`/settings/ai`) — Admin only

| Method | Path | Description |
|--------|------|-------------|
| GET | `/settings/ai` | Get AI configuration (provider URL, model, search provider, enabled types) |
| PATCH | `/settings/ai` | Update AI settings |
| POST | `/settings/ai/test` | Test LLM provider connectivity, returns available models |

### Other Endpoints

| Category | Key Endpoints |
|----------|--------------|
| **Relations** | `GET/POST /relations`, `PATCH/DELETE /relations/{id}` |
| **Stakeholders** | `GET/POST /cards/{id}/stakeholders`, `PATCH/DELETE /stakeholders/{id}` |
| **Tags** | `GET/POST /tag-groups`, `POST /cards/{id}/tags` |
| **Comments** | `GET/POST /cards/{id}/comments`, `PATCH/DELETE /comments/{id}` |
| **Todos** | `GET/POST /todos`, `GET/POST /cards/{id}/todos` |
| **Documents** | `GET/POST /cards/{id}/documents`, `DELETE /documents/{id}` |
| **Bookmarks** | `GET/POST /bookmarks`, `PATCH/DELETE /bookmarks/{id}` |
| **Diagrams** | `GET/POST /diagrams`, `GET/PATCH/DELETE /diagrams/{id}` |
| **SoAW** | `GET/POST /soaw`, `GET/PATCH/DELETE /soaw/{id}` |
| **Surveys** | Full CRUD + `/surveys/{id}/send`, `/surveys/{id}/respond/{card_id}` |
| **EOL** | `/eol/products`, `/eol/products/fuzzy`, `/eol/mass-search`, `/eol/mass-link` |
| **Web Portals** | CRUD + `/web-portals/public/{slug}` (no auth) |
| **Notifications** | `GET /notifications`, badge counts, mark read |
| **Settings** | Email SMTP, currency, logo upload, favicon upload, AI config |
| **Users** | CRUD (admin only), self-update |
| **Events** | `GET /events`, `GET /events/stream` (SSE) |
| **ADR** | `GET/POST /adr`, `GET/PATCH/DELETE /adr/{id}`, `/adr/{id}/cards`, `/adr/{id}/sign` |
| **File Attachments** | `POST /cards/{id}/attachments`, `GET/DELETE /attachments/{id}` |
| **OData Feeds** | `GET /bookmarks/{id}/odata` (OData-style JSON feed for saved views) |
| **Health** | `GET /api/health` (no auth, includes version) |

---

## Frontend Architecture

### Tech Stack
- **React 18** with TypeScript
- **MUI 6** (Material UI) for component library
- **React Router 7** for client-side routing
- **AG Grid** for data tables (inventory page)
- **Recharts** for charts (portfolio, cost, lifecycle reports)
- **bpmn-js** for BPMN 2.0 diagram editing
- **TipTap** for rich text editing (SoAW sections)
- **@dnd-kit** for drag-and-drop (card layout editor)
- **docx** + **file-saver** for DOCX export (SoAW)
- **xlsx** (vendored v0.20.3) for Excel import/export
- **Vite** for build tooling with `@` path alias to `./src`

### Routing (`App.tsx`)

All route-level pages use `lazy()` imports for code splitting. Auth pages (Login, SsoCallback, SetPasswordPage) are eagerly loaded.

| Path | Component | Description |
|------|-----------|-------------|
| `/` | `Dashboard` | KPI cards, type breakdown, recent activity |
| `/inventory` | `InventoryPage` | AG Grid table with memoized configs |
| `/cards/:id` | `CardDetail` | Modular detail: sections + tabs |
| `/reports/portfolio` | `PortfolioReport` | Bubble/scatter chart |
| `/reports/capability-map` | `CapabilityMapReport` | Heatmap of business capabilities |
| `/reports/lifecycle` | `LifecycleReport` | Timeline visualization |
| `/reports/dependencies` | `DependencyReport` | Network graph |
| `/reports/cost` | `CostReport` | Treemap + bar chart |
| `/reports/matrix` | `MatrixReport` | Cross-reference grid |
| `/reports/data-quality` | `DataQualityReport` | Completeness dashboard |
| `/reports/eol` | `EolReport` | End-of-Life status |
| `/reports/saved` | `SavedReportsPage` | Saved report gallery |
| `/ppm` | `PpmPortfolio` | PPM portfolio dashboard with Gantt chart |
| `/ppm/:id` | `PpmProjectDetail` | Initiative detail (overview, reports, cost, risks, tasks, gantt) |
| `/bpm` | `BpmDashboard` | BPM maturity overview |
| `/bpm/processes/:id/flow` | `ProcessFlowEditorPage` | BPMN editor with approval workflow |
| `/diagrams` | `DiagramsPage` | Diagram gallery with thumbnails |
| `/diagrams/:id` | `DiagramEditor` | DrawIO iframe editor |
| `/ea-delivery` | `EADeliveryPage` | SoAW document list |
| `/ea-delivery/soaw/new` | `SoAWEditor` | Create new SoAW |
| `/ea-delivery/soaw/:id` | `SoAWEditor` | Edit SoAW |
| `/ea-delivery/soaw/:id/preview` | `SoAWPreview` | Read-only preview |
| `/todos` | `TodosPage` | Todos + Surveys (tabbed) |
| `/surveys/:surveyId/respond/:cardId` | `SurveyRespond` | Respond to survey |
| `/portal/:slug` | `PortalViewer` | Public portal (no auth) |
| `/auth/callback` | `SsoCallback` | SSO OAuth callback |
| `/auth/set-password` | `SetPasswordPage` | Invited user password setup |
| `/admin/metamodel` | `MetamodelAdmin` | Card types + relations |
| `/admin/users` | `UsersAdmin` | User management |
| `/admin/settings` | `SettingsAdmin` | Logo, currency, SMTP, AI |
| `/admin/eol` | `EolAdmin` | Mass EOL linking |
| `/admin/surveys` | `SurveysAdmin` | Survey management |
| `/admin/surveys/new` | `SurveyBuilder` | Create survey |
| `/admin/surveys/:id` | `SurveyBuilder` | Edit survey |
| `/admin/surveys/:id/results` | `SurveyResults` | View/apply responses |
| `/admin/web-portals` | `WebPortalsAdmin` | Portal management |
| `/admin/servicenow` | `ServiceNowAdmin` | ServiceNow sync config |

### Key Patterns

**API Client** (`src/api/client.ts`): Thin fetch wrapper that auto-injects the JWT from `sessionStorage`. Methods: `api.get()`, `api.post()`, `api.patch()`, `api.put()`, `api.delete()`, `api.upload()`, `api.getRaw()`. Handles 204 empty responses and formats validation errors. Custom `ApiError` class with `status` and `detail` fields.

**Authentication** (`hooks/useAuth.ts`): Token stored in `sessionStorage.token` (cleared on tab close). On load, validates via `GET /auth/me`. SSO callback support via `/auth/callback`. Password setup for invited users via `/auth/set-password`.

**Metamodel Cache** (`hooks/useMetamodel.ts`): Module-level singleton cache. Fetches types + relation types once, shared across all components. `invalidateCache()` forces re-fetch.

**Permissions** (`hooks/usePermissions.ts`): Fetches effective permissions for a card by combining app-level role + stakeholder roles. Used by CardDetail to enable/disable edit controls.

**Calculated Fields** (`hooks/useCalculatedFields.ts`): Fetches `type_key → field_keys[]` map. CardDetail uses this to show "calc" badges and prevent manual editing of computed fields.

**Real-time Updates** (`hooks/useEventStream.ts`): SSE connection to `/events/stream`. Auto-reconnects on error. Badge count refresh debounced at 500ms via `AppLayout.tsx`.

**Currency** (`hooks/useCurrency.ts`): Module-level singleton cache. Provides `fmt()`, `fmtShort()`, and `symbol` for consistent cost display.

**Data Quality Scoring**: Backend auto-computes `data_quality` (0-100%) based on `fields_schema` weights. Approval status auto-breaks to `BROKEN` when approved items are edited.

**Card Detail Sections**: Each section is an independent component in `features/cards/sections/`, wrapped in `ErrorBoundary`. Section ordering is controlled by `section_config.__order` in the metamodel. Custom sections are rendered via `AttributeSection` (fully data-driven from `fields_schema`).

**Report Architecture**: Reports share `ReportShell` for consistent layout, `MetricCard` for KPI display, `ReportLegend` for legends, and `SaveReportDialog`/`EditReportDialog` for save/edit workflows.

**MUI Dialog Nesting**: When dialogs are nested (e.g., TypeDetailDrawer contains FieldEditorDialog), inner dialogs use `disableRestoreFocus` to prevent `aria-hidden` focus warnings.

---

## Metamodel

The default metamodel seeds 14 card types across 4 layers and 30+ relation types. Created on first startup by `backend/app/services/seed.py`.

### Card Types

| Key | Label | Icon | Color | Layer | Hierarchy | Subtypes |
|-----|-------|------|-------|-------|-----------|----------|
| `Objective` | Objective | flag | #c7527d | Strategy & Transformation | No | - |
| `Platform` | Platform | layers | #027446 | Strategy & Transformation | No | Digital, Technical |
| `Initiative` | Initiative | rocket_launch | #33cc58 | Strategy & Transformation | Yes | Idea, Program, Project, Epic |
| `Organization` | Organization | corporate_fare | #2889ff | Business Architecture | Yes | Business Unit, Region, Legal Entity, Team, Customer |
| `BusinessCapability` | Business Capability | account_tree | #003399 | Business Architecture | Yes | - |
| `BusinessContext` | Business Context | swap_horiz | #fe6690 | Business Architecture | Yes | Process, Value Stream, Customer Journey, Business Product, ESG Capability |
| `BusinessProcess` | Business Process | schema | #8e24aa | Business Architecture | Yes | Core, Support, Management |
| `Application` | Application | apps | #0f7eb5 | Application & Data | Yes | Business Application, Microservice, AI Agent, Deployment |
| `Interface` | Interface | sync_alt | #02afa4 | Application & Data | No | Logical Interface, API, MCP Server |
| `DataObject` | Data Object | database | #774fcc | Application & Data | Yes | - |
| `ITComponent` | IT Component | memory | #d29270 | Technical Architecture | Yes | Software, Hardware, SaaS, PaaS, IaaS, Service, AI Model |
| `TechCategory` | Tech Category | category | #a6566d | Technical Architecture | Yes | - |
| `Provider` | Provider | storefront | #ffa31f | Technical Architecture | No | - |
| `System` | System | dns | #5B738B | Technical Architecture | No | - |

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
| `number` | Numeric | NumberField |
| `cost` | Numeric with currency formatting | NumberField + currency symbol |
| `boolean` | Toggle | Switch |
| `date` | ISO date | DatePicker |
| `url` | Validated URL (http/https/mailto) | Clickable link input |
| `single_select` | Single choice from options | Select dropdown |
| `multiple_select` | Multiple choices from options | Multi-select chips |

---

## RBAC (Role-Based Access Control)

### Multi-level Permission System

1. **App-level Roles** (`roles` table): System-wide roles like admin, member, viewer, bpm_admin. Each role has a JSONB `permissions` field with granular capability flags. Cached with 5-minute TTL by `PermissionService`. Admin role uses `{"*": true}` wildcard.

2. **Stakeholder Roles** (`stakeholder_role_definitions`): Per-card-type role definitions. Each card type can define custom roles (e.g., Application → "technical_application_owner"). Roles carry per-type permissions.

3. **Stakeholders** (`stakeholders` table): User ↔ card assignments with a specific role. A user can hold multiple stakeholder roles on different cards.

4. **Effective Permissions**: For any user + card combination, the system computes the union of:
   - App-level role permissions (with app→card permission mapping from `core/permissions.py`)
   - All stakeholder role permissions the user holds on that card
   - Result exposed via `GET /cards/{id}/effective-permissions`

### Permission Key Registry (`core/permissions.py`)

Single source of truth for all valid permission keys. Two categories:

**App-level permissions** (19 groups, 40+ keys): `inventory.*`, `relations.*`, `stakeholders.*`, `comments.*`, `documents.*`, `diagrams.*`, `bpm.*`, `ppm.*`, `reports.*`, `surveys.*`, `soaw.*`, `tags.*`, `bookmarks.*`, `saved_reports.*`, `eol.*`, `web_portals.*`, `notifications.*`, `servicenow.*`, `ai.*`, `admin.*`

**Card-level permissions** (13 keys): `card.view`, `card.edit`, `card.archive`, `card.delete`, `card.approval_status`, `card.manage_stakeholders`, `card.manage_relations`, `card.manage_documents`, `card.manage_comments`, `card.create_comments`, `card.bpm_edit`, `card.bpm_manage_drafts`, `card.bpm_approve`

### Permission Checking (Backend)
```python
# App-level check (raises 403 if denied)
await PermissionService.require_permission(db, user, "admin.metamodel")

# Combined app + card-level check
await PermissionService.require_permission(db, user, "inventory.edit", card_id=card_id, card_permission="card.edit")

# FastAPI dependency (in route decorator)
@router.post("/...", dependencies=[Depends(require_permission("inventory.create"))])

# Check without raising
has_access = await PermissionService.check_permission(db, user, "bpm.edit")
```

### Default Seeded Roles

| Role | Key | Wildcard | Notable Restrictions |
|------|-----|----------|---------------------|
| Admin | `admin` | `{"*": true}` | Full access to everything |
| BPM Admin | `bpm_admin` | No | All BPM permissions + full inventory, no admin.* |
| Member | `member` | No | Full inventory + BPM edit (no approve), no admin.* |
| Viewer | `viewer` | No | View-only across all domains, can respond to surveys |

---

## Calculations (Computed Fields)

Admin-defined formulas that automatically compute field values when cards are saved.

### Engine (`calculation_engine.py`)
- Safe sandboxed evaluation using `simpleeval`
- **Built-in functions**: IF, SUM, AVG, MIN, MAX, COUNT, ROUND, ABS, COALESCE, LOWER, UPPER, CONCAT, CONTAINS, PLUCK, FILTER, MAP_SCORE
- **Context variables**: Card attributes, relations data, lifecycle info
- Automatic execution on card save via `run_calculations_for_card()`
- Dependency ordering via `execution_order` field

### Example Formulas
```
SUM(PLUCK(related_applications, "costTotalAnnual"))
IF(riskLevel == "critical", 100, IF(riskLevel == "high", 75, 25))
COUNT(FILTER(related_interfaces, "status", "ACTIVE"))
```

---

## BPM (Business Process Management)

### Architecture
- **BusinessProcess** card type with fields: process type, maturity level, automation level, risk level, frequency
- **BPMN 2.0 Editor**: bpmn-js integration with 6 starter templates
- **Element Extraction**: `bpmn_parser.py` extracts tasks, events, gateways, lanes from BPMN XML
- **Element Linking**: `ElementLinker.tsx` connects BPMN elements to Application/DataObject/ITComponent cards
- **Approval Workflow**: Process flows go through draft → pending → published → archived states

### BPM Reports
- Process maturity dashboard
- Risk assessment overview
- Automation level analysis

### Card Detail Integration
BusinessProcess cards show extra tabs in CardDetail:
- **Process Flow** tab: Embedded BPMN viewer/editor
- **Assessments** tab: Process assessment scores

---

## PPM (Project Portfolio Management)

Optional module (toggled via admin settings) for managing Initiative cards as full projects.

### Architecture
- **Scoped to Initiative cards** — All PPM data (reports, WBS, tasks, budgets, costs, risks) is linked to Initiative cards via `initiative_id` FK
- **Feature flag**: `usePpmEnabled()` hook (module-level singleton cache, fetches `GET /settings/ppm-enabled`)
- **Cost sync**: Creating/updating/deleting budget or cost lines auto-syncs the Initiative card's `costBudget` and `costActual` attributes and recalculates data quality
- **WBS rollup**: Task status changes trigger bottom-up completion recalculation through the WBS hierarchy
- **Task-Todo sync**: Assigning a PPM task auto-creates a system Todo (`is_system=true`); clearing assignee deletes it
- **Notifications**: Task assignment sends a `task_assigned` notification
- **Permissions**: `ppm.view` (read) and `ppm.manage` (write), granted to admin, bpm_admin, and member roles

### Frontend Components
- **`PpmPortfolio.tsx`** — Portfolio dashboard with Gantt visualization, KPI cards, grouping by related card type
- **`PpmProjectDetail.tsx`** — Tabbed initiative detail (overview, reports, cost, risks, tasks, gantt, details)
- **`PpmTaskBoard.tsx`** — Kanban board with @dnd-kit drag-drop (todo/in_progress/done/blocked columns)
- **`PpmRiskTab.tsx`** — Risk matrix visualization (probability x impact grid) and risk cards
- **`PpmCostTab.tsx`** — Budget lines (planned by fiscal year) and cost lines (actuals)
- **`PpmGanttTab.tsx`** — Timeline view of WBS items with milestones and completion bars

### Demo Data
`seed_demo_ppm.py` populates PPM data for 6 Initiative cards when `SEED_DEMO=true` or `SEED_PPM=true`. Includes status reports, WBS hierarchies, tasks, budget/cost lines, and risks with varied project health stories.

---

## ArchLens (AI-Powered EA Intelligence)

Native AI analysis module — originally ported from [ArchLens](https://github.com/vinod-ea/archlens) (MIT License, by [Vinod](https://github.com/vinod-ea)). Provides vendor analysis, duplicate detection, modernization assessment, and architecture AI recommendations using data directly from the `cards` table.

### Architecture
- **No separate container**: All logic runs natively in Turbo EA (FastAPI + PostgreSQL). No proxy layer, no SQLite.
- **AI infrastructure reuse**: Uses the same AI provider config from `app_settings.general_settings.ai` (supports Claude, OpenAI, DeepSeek, Gemini).
- **Background tasks + polling**: Long-running AI operations use FastAPI `BackgroundTasks` + `ArchLensAnalysisRun` status polling.
- **Direct data access**: Queries `cards`, `relations`, and `relation_types` tables via SQLAlchemy — no data copy or intermediate storage.
- **Session persistence**: The Architecture AI wizard saves progress to `sessionStorage` so users can navigate away and return without losing their place.

### Database Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `archlens_vendor_analysis` | `ArchLensVendorAnalysis` | AI-categorized vendors with category, sub-category, app counts, costs |
| `archlens_vendor_hierarchy` | `ArchLensVendorHierarchy` | Resolved canonical vendor tree (parent-child, aliases, confidence) |
| `archlens_duplicate_clusters` | `ArchLensDuplicateCluster` | Functional duplicate groups with evidence, recommendation, status |
| `archlens_modernization_assessments` | `ArchLensModernization` | Modernization opportunities with effort, priority, current tech |
| `archlens_analysis_runs` | `ArchLensAnalysisRun` | Analysis execution history (type, status, timestamps, errors) |

### Backend Services

| File | Purpose |
|------|---------|
| `services/archlens_ai.py` | Shared AI caller + JSON repair (truncation recovery, bracket balancing) |
| `services/archlens_vendors.py` | Vendor categorization (45+ categories, batch=15) + resolution (batch=60, hierarchy building) |
| `services/archlens_duplicates.py` | Duplicate detection (union-find merge, batch=40) + modernization assessment (batch=25) |
| `services/archlens_architect.py` | 5-step architecture AI: objective-driven capability mapping, solution options, gap analysis, dependency analysis, and target architecture with C4 diagram visualization |

### Architecture AI Flow

The Architecture AI follows a 5-step guided wizard:

1. **Requirements** (Phase 0) — User enters a business requirement, selects existing Objective cards (autocomplete), and optionally selects or creates Business Capabilities (free-text for new ones).
2. **Business Fit** (Phase 1) — AI generates business clarification questions with typed inputs (text, single-choice, multi-choice with NFR categories).
3. **Technical Fit** (Phase 2) — AI generates technical deep-dive questions.
4. **Solution** (Phase 3) — Three sub-phases:
   - **3a: Options** — AI generates solution option cards (buy/build/extend/reuse) with impact preview (new/modified/retired components, integrations), estimated cost, duration, and complexity.
   - **3b: Gap Analysis** — After selecting an option, AI identifies capability gaps with ranked market product recommendations (gold/silver/bronze). Users select products via checkboxes.
   - **3c: Dependencies** — After selecting products, AI identifies additional infrastructure/platform dependencies needed. Users select dependencies via checkboxes.
5. **Target Architecture** (Phase 5) — Capability mapping with matched capabilities (existing vs new), proposed new cards (typed per metamodel, including new BusinessCapabilities), proposed relations, and an interactive C4 dependency diagram rendered via `C4DiagramView` (React Flow). Proposed nodes appear with dashed borders and a green "NEW" badge. Backend guardrails automatically enforce: every new Application links to a BusinessCapability, every new BusinessCapability links to selected Objectives, and orphan cards (no relations) are removed.
6. **Commit** — Save assessment, then commit via `CommitInitiativeDialog`: creates Initiative card (name defaults to selected option title, editable), all selected new cards with AI-generated descriptions, relations, and a draft ADR capturing the decision context, selected products, and alternatives. Changing approach resets the assessment for re-saving.

### API Routes (`/archlens`)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/status` | authenticated | AI config status |
| GET | `/overview` | `archlens.view` | Dashboard KPIs |
| POST | `/vendors/analyse` | `archlens.manage` | Trigger vendor categorization (background) |
| GET | `/vendors` | `archlens.view` | Get vendor analysis results |
| POST | `/vendors/resolve` | `archlens.manage` | Trigger vendor resolution (background) |
| GET | `/vendors/hierarchy` | `archlens.view` | Get vendor hierarchy |
| POST | `/duplicates/analyse` | `archlens.manage` | Trigger duplicate detection (background) |
| GET | `/duplicates` | `archlens.view` | Get duplicate clusters |
| PATCH | `/duplicates/{id}/status` | `archlens.manage` | Update cluster status |
| POST | `/duplicates/modernize` | `archlens.manage` | Trigger modernization assessment (background) |
| GET | `/duplicates/modernizations` | `archlens.view` | Get modernization results |
| GET | `/architect/objectives` | `archlens.manage` | Search Objective cards for autocomplete |
| GET | `/architect/capabilities` | `archlens.manage` | Search BusinessCapability cards |
| GET | `/architect/objective-dependencies` | `archlens.manage` | BFS depth-1 dependency subgraph for objectives |
| POST | `/architect/phase1` | `archlens.manage` | Business clarification questions |
| POST | `/architect/phase2` | `archlens.manage` | Technical deep-dive questions |
| POST | `/architect/phase3/options` | `archlens.manage` | Generate solution options |
| POST | `/architect/phase3/gaps` | `archlens.manage` | Gap analysis for selected option |
| POST | `/architect/phase3/deps` | `archlens.manage` | Dependency analysis for selected products |
| POST | `/architect/phase3` | `archlens.manage` | Capability mapping (full target architecture) |
| POST | `/architect/commit` | `archlens.manage` | Commit initiative from assessment (creates cards + relations + ADR) |
| POST | `/assessments` | `archlens.manage` | Save assessment |
| GET | `/assessments` | `archlens.view` | List saved assessments |
| GET | `/assessments/{id}` | `archlens.view` | Get assessment details |
| GET | `/analysis-runs` | `archlens.view` | Analysis run history |
| GET | `/analysis-runs/{run_id}` | `archlens.view` | Get specific run with results |

### Frontend Pages

| Route | Component | Description |
|-------|-----------|-------------|
| `/archlens` | `ArchLensPage` | Tab container: Dashboard, Vendors, Resolution, Duplicates, Architect, History |
| `/archlens` (Dashboard tab) | `ArchLensDashboard` | KPI tiles, cards by type, quality tiers (Bronze/Silver/Gold), top issues |
| `/archlens` (Vendors tab) | `ArchLensVendors` | Vendor analysis with category breakdown, grid/table toggle |
| `/archlens` (Resolution tab) | `ArchLensResolution` | Canonical vendor hierarchy with confidence scores |
| `/archlens` (Duplicates tab) | `ArchLensDuplicates` | Duplicate clusters + modernization assessment (sub-tabs) |
| `/archlens` (Architect tab) | `ArchLensArchitect` | 5-step architecture AI wizard with C4 diagram visualization |
| `/archlens` (History tab) | `ArchLensHistory` | Analysis run history table |

### Key Frontend Components

| Component | Purpose |
|-----------|---------|
| `ArchLensArchitect.tsx` | 5-step wizard: requirement input → Q&A → options → gaps → deps → capability mapping |
| `CommitInitiativeDialog.tsx` | Initiative creation dialog with card/relation selection, renaming, and progress tracking |
| `AssessmentViewer.tsx` | Read-only assessment viewer with C4 diagram |
| `C4DiagramView.tsx` | React Flow-based C4 diagram with grouped swim lanes and mirrored handles for cross-layer edges |
| `c4Layout.ts` | Automatic layout engine for C4 diagrams (node positioning, edge routing, handle allocation) |
| `ArchitectureDiagram.tsx` | Mermaid diagram renderer for architecture visualizations |
| `useAnalysisPolling.ts` | Custom hook: polls analysis runs every 3s until completion/failure |
| `utils.ts` | Shared helpers: `formatCost()`, color mappers, `ARCHITECT_STEPS` stepper config |

### Permissions
- **`archlens.view`**: View analysis results. Granted to admin, bpm_admin, member roles.
- **`archlens.manage`**: Trigger analyses. Granted to admin role.

### Credits
ArchLens was originally created by [Vinod](https://github.com/vinod-ea/archlens) under the MIT License. The AI analysis logic has been ported to Python and integrated natively into Turbo EA.

---

## DrawIO Integration

### How It Works
1. **Build time**: Frontend Dockerfile clones `jgraph/drawio` v26.0.9
2. **Runtime**: Nginx serves DrawIO at `/drawio/` (same origin)
3. **Editor**: `DiagramEditor.tsx` loads DrawIO in a same-origin iframe
4. **Communication**: Direct DOM access to iframe's `mxGraph` API. Graph reference stored on `iframe.contentWindow.__turboGraph`

### Shape System (`src/features/diagrams/drawio-shapes.ts`)
Cards are represented as mxGraph cells with custom XML user objects:
```xml
<object label="App Name" factSheetId="uuid" factSheetType="Application" />
```

Key functions: `insertFactSheetIntoGraph()`, `insertPendingFactSheet()`, `markCellSynced()`, `expandFactSheetGroup()`, `scanDiagramItems()`, `stampEdgeAsRelation()`, `extractFactSheetIds()`

### Diagram Feature Components
- `DiagramSyncPanel.tsx` — Sync cards between diagram and EA inventory
- `CardSidebar.tsx` — Browse cards to drag onto diagram
- `CardPickerDialog.tsx` — Search and select cards
- `CreateOnDiagramDialog.tsx` — Create new cards directly from diagram shapes
- `RelationPickerDialog.tsx` — Create/manage relations from diagram edges

---

## ServiceNow Integration

Bi-directional sync between Turbo EA cards and ServiceNow CMDB.

- **Connections**: Multiple ServiceNow instances with credential management (encrypted)
- **Mappings**: Card type ↔ ServiceNow table mappings with field-level rules
- **Sync modes**: Pull (ServiceNow → Turbo), Push (Turbo → ServiceNow)
- **Staging**: Records staged for admin review before applying changes (skip_staging flag available)
- **Identity persistence**: `snow_identity_map` maintains ID mappings across syncs

---

## AI Description Suggestions

Optional feature that uses a local LLM (via Ollama or any Ollama-compatible provider) to generate card description suggestions. The pipeline combines web search context with LLM inference.

### Architecture
- **Two-step pipeline**: Web search (DuckDuckGo/Google/SearXNG) → LLM description generation
- **Description-only**: Suggestions are limited to the `description` field — not arbitrary metadata fields
- **Type-aware prompting**: Search queries and LLM system prompts are customized per card type (e.g., "Application" → "software application", "ITComponent" → "technology product")
- **Confidence scoring**: Each suggestion includes a 0–100% confidence score for user transparency
- **Source attribution**: Web search sources are displayed as clickable links alongside suggestions

### Backend Components
- **`services/ai_service.py`**: Core orchestration — web search dispatch, LLM prompt building, response validation
- **`api/v1/ai_suggest.py`**: FastAPI endpoints (`POST /ai/suggest`, `GET /ai/status`)
- **`schemas/ai_suggest.py`**: Pydantic request/response models
- **Settings stored in**: `app_settings.general_settings.ai` (JSONB) — provider URL, model, search provider, enabled types

### Frontend Components
- **`AiSuggestPanel.tsx`**: Reusable UI showing suggestion with confidence badge, editable description, source links, and apply/dismiss buttons. Used in both `CardDetail` and `CreateCardDialog`
- **`AiAdmin.tsx`**: Admin settings page — toggle, provider URL, model selector, search provider, per-type enablement

### Search Providers
- **DuckDuckGo** (default): Zero-dependency HTML scraping fallback
- **Google Custom Search**: Requires API key + search engine ID (`API_KEY:CX` format)
- **SearXNG**: Self-hosted meta-search engine, JSON API

### Docker Integration
Ollama is available as an opt-in Docker Compose profile:
```bash
docker compose --profile ai up -d   # Starts Ollama alongside backend + frontend
```
The `ollama` service uses a persistent volume (`turboea-ollama`) and is only accessible internally. Set `AI_AUTO_CONFIGURE=true` to auto-detect and configure on first startup.

### Startup Automation (`main.py`)
- **Auto-configuration**: If `AI_AUTO_CONFIGURE=true` and AI is not yet configured in DB, writes env var values to `app_settings`
- **Model pulling**: Background task checks if the configured model exists in Ollama and pulls it if missing (10-minute timeout, non-blocking)

### Permission
- **`ai.suggest`**: Controls access to AI suggestion functionality. Granted to admin, bpm_admin, and member roles by default. Not available to viewers.

---

## Version Management

Single source of truth: `/VERSION` file at project root.

- **Backend**: `config.py` reads VERSION → exports `APP_VERSION` → exposed in `/api/health`
- **Frontend**: `vite.config.ts` reads VERSION → injects `__APP_VERSION__` global → displayed in user menu (AppLayout)
- **Docker**: Both Dockerfiles `COPY VERSION ./VERSION` before building
- **Local dev**: Frontend checks `../VERSION` (from frontend dir) then `./VERSION` (Docker)
- **Packaging metadata**: `backend/pyproject.toml` and `frontend/package.json` use a static `"0.0.0"` placeholder — do not bump them. This avoids triggering CI path filters on version-only changes.

---

## Security

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
- Memory limits: backend 512M, frontend 256M
- Backend only exposed via internal Docker network (not to host)

### Nginx Security Headers
- Content-Security-Policy (strict, self-only with font/DrawIO exceptions)
- X-Frame-Options: SAMEORIGIN
- X-Content-Type-Options: nosniff
- Strict-Transport-Security: max-age=31536000
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: camera/microphone/geolocation disabled
- Request body limit: 5MB

### JWT Implementation
- PyJWT with HS256 algorithm in `core/security.py`
- Payload: `{sub: user_id, role: role_key, iat, exp, iss: "turbo-ea", aud: "turbo-ea"}`
- Issuer and audience validation on decode
- Passwords hashed with bcrypt
- Token sent as `Authorization: Bearer <token>`
- Frontend stores token in `sessionStorage` (not localStorage — cleared on tab close)

### Background Processes
- **Archived card auto-purge**: Background task runs hourly, permanently deletes cards archived for 30+ days (including their relations)
- **Ollama model pull**: On startup (if `AI_AUTO_CONFIGURE=true`), a background task checks if the configured LLM model exists and pulls it if missing (non-blocking, 10-minute timeout)

---

## Development

### Local Development (without Docker)

**Backend:**
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -e ".[dev]"
# Ensure PostgreSQL is running with correct credentials
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev    # Vite dev server on port 5173, proxies /api to :8000
```

### Linting & Testing

**Backend:**
```bash
cd backend
ruff check .          # Lint (rules: E, F, I, N, W; line-length: 100)
ruff format .         # Auto-format
pytest                # Run tests (asyncio_mode=auto)
```

**Frontend:**
```bash
cd frontend
npm run lint          # ESLint
npm run build         # TypeScript check + Vite build
```

### Database Reset
Set `RESET_DB=true` to drop all tables and re-seed on next startup.

### Key Libraries

**Backend:**
- FastAPI 0.115+ with Pydantic 2.10+
- SQLAlchemy 2.0+ (async via asyncpg)
- Alembic for migrations
- PyJWT 2.9+ for JWT tokens
- bcrypt for password hashing
- cryptography (Fernet) for field encryption
- simpleeval for safe formula evaluation
- sse-starlette for Server-Sent Events
- slowapi for rate limiting
- httpx for outbound HTTP (ServiceNow, EOL, AI search + LLM)
- defusedxml for safe XML parsing (BPMN)
- ruff for linting (target: Python 3.11+, line-length: 100)

**Frontend:**
- React 18 + TypeScript 5.6
- MUI 6 + Emotion for styling
- AG Grid for data tables
- Recharts for visualizations
- bpmn-js for BPMN editing
- TipTap for rich text editing
- @dnd-kit for drag-and-drop
- docx + file-saver for DOCX generation
- xlsx (vendored 0.20.3) for Excel import/export

---

## Docker Architecture

### docker-compose.yml
Both services use **root build context** (`context: .`) on the `guac-net` external network:
- **backend**: `dockerfile: backend/Dockerfile`, Python 3.12-alpine, uvicorn on port 8000 (internal only)
- **frontend**: `dockerfile: frontend/Dockerfile`, multi-stage build, port 80 mapped to `HOST_PORT`

PostgreSQL is external (not managed by this compose file). A separate `docker-compose.db.yml` is provided for local development.

### Ollama Service (opt-in)
- **Profile**: `ai` — started with `docker compose --profile ai up -d`
- **Image**: `ollama/ollama:latest`, exposes port 11434 internally only
- **Volume**: `turboea-ollama` for persistent model storage
- **Memory**: Configurable via `OLLAMA_MEMORY_LIMIT` (default 4G)
- **Health check**: Polls `/api/tags` endpoint

### Frontend Dockerfile (multi-stage, root context)
1. **build stage**: `node:20-alpine` — copies `frontend/package.json` + `VERSION`, npm ci, vite build
2. **drawio stage**: `alpine/git` — clone jgraph/drawio v26.0.9
3. **production stage**: `nginx:alpine` — serve built frontend + DrawIO + security configs, runs as non-root `nginx` user

### Backend Dockerfile (root context)
Single stage: `python:3.12-alpine` — copies `VERSION` + `backend/`, pip install, runs as non-root `appuser`

### Nginx Configuration
- `/api/*` → proxy to `backend:8000` (with SSE support headers)
- `/drawio/*` → static DrawIO assets (30-day cache, no-transform)
- `/*` → SPA fallback to `index.html`
- Security headers on all responses
- Static assets → 1-year cache with `immutable`
