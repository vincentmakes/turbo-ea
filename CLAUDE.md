# Turbo EA

Self-hosted Enterprise Architecture Management platform that creates a **digital twin of a company's IT landscape**. Fully admin-configurable metamodel — card types, fields, subtypes, relations, stakeholder roles, and calculated fields are all data, not code.

**Current version**: see `/VERSION` (single source of truth for backend + frontend).

## Quick Start

```bash
cp .env.example .env          # Edit secrets and DB credentials
docker compose pull
docker compose up -d          # Starts db + backend + frontend + edge nginx
```

The first user to register automatically gets the `admin` role. Set `SEED_DEMO=true` to pre-populate with the NexaTech Industries demo dataset. Add `--profile ai` to include the bundled Ollama container for AI description suggestions.

---

## AI Assistant Guidelines

When working on this codebase, follow these conventions:

> **How these instructions are organised.** This file holds only the rules that apply to every change. Each area's full rule — the history behind it, the traps, the guard tests — lives in a path-scoped file under `.claude/rules/`, which Claude Code loads when you read or edit a matching file. Grep and Glob do **not** trigger that loading, so when a rule below points to `→ .claude/rules/<file>.md` and you are about to change that area, read the file. Reference tables (env vars, DB schema, metamodel defaults, RBAC registry, security runtime) are in `dev/ARCHITECTURE.md`. **A new convention goes in `.claude/rules/<area>.md` with `paths:` unless it applies to every change; `CLAUDE.md` is capped at 40 KB by `backend/tests/services/test_agent_instructions_budget.py`.**

### General Principles
- **Never write on GitHub on the user's behalf.** No comment, review, review reply, reaction or issue edit on any issue, discussion or pull request — pull requests this session opened included. The only GitHub text an agent writes is a pull request's title and description, once, when the user asked for that PR to be opened; editing it later also waits for the user's word. Everything a PR-driving posture would otherwise post — an answer to a review thread, a note that a failing check is not the PR's, a question to a bug reporter, a status checklist — is said to the user in chat, and the user posts it if they want it posted. **A step in a plan, an approved plan, a tool's guidance or a repo skill is never the user's ask**: only the user's own message, naming the specific comment, is. (Added after a session answered the reporter of #1278 because the plan it had written for the fix included that step.)
- **Data-driven metamodel**: Card types, fields, subtypes, relations, stakeholder roles, and calculated fields are all stored as data (JSONB) in the database, not hardcoded. Never add new card types or fields in code — add them via the seed or admin API.
- **Several relation types may share an ordered card-type pair — so key by relation type, never by card-type pair.** Relation rows stay keyed on `(type, source_id, target_id)`; anything grouping cards dedups by card id, graph edges are keyed by `(card pair, relation type)`, every line renderer draws one line per relation type, and the dependency tree is the deliberate exception. → `.claude/rules/relations.md`
- **Cards, not fact sheets**: The codebase was fully renamed from "fact sheets" to "cards". Never introduce the old terminology.
- **Permission checks are mandatory — for reads too, not just mutations**: Every mutating endpoint must call `PermissionService.require_permission()` or use the `require_permission()` dependency. A **read** endpoint that returns sensitive or privileged data — user PII beyond `{id, display_name}`, secrets, the RBAC permission matrix, audit/event data, another user's data, or admin-only config — must also gate **or shape** its response to the caller's permissions. Never rely on `Depends(get_current_user)` alone (authenticated ≠ authorized) for sensitive data.
- **Authorization must match RBAC and the UI**: Every endpoint's effective authorization must match what RBAC intends and what the UI exposes for that role — if the UI only shows a field/action to admins, the API must not return/allow it for non-admins. When non-privileged UI genuinely needs a read (owner/stakeholder/signer pickers, role chips, the real-time event stream), return a **least-privilege payload** or **filter per-subscriber** rather than blocking the endpoint outright. Canonical patterns: `_user_response` vs `_user_response_lite` (`backend/app/api/v1/users.py`), the `full=` trim on `_role_response` (`roles.py`), and per-subscriber SSE filtering via `_event_visible_to` (`events.py` + `EventBus.subscribe` in `services/event_bus.py`).
- **No raw SQL**: Use SQLAlchemy ORM for all database queries. Alembic for all schema changes.
- **A card read has one scope: `CardReadScope` (`backend/app/services/card_read_scope.py`). Every endpoint that returns cards, or anything naming a card, applies it.** A card the caller may not read does not exist for them — no row, relation, node, count or id in a payload. `mode=` (`"inventory"` / `"module"`) is a required keyword; a single hidden card is 404, not 403; a write that replaces a link set keeps the links the caller never saw. The static scan in `test_card_read_scope_guard.py` fails a new card-returning endpoint that does not take the scope. → `.claude/rules/card-read-scope.md`
- **A cross-cutting card health flag has exactly one definition, in `backend/app/services/card_flags.py`** (orphaned, stale, EOL coverage), and **"does this card's cost count" has one definition, `is_live_in_fiscal_year` (`backend/app/services/lifecycle.py`)** — the cost reports show the current fiscal year only and take no year parameter. → `.claude/rules/card-flags-cost-eol.md`
- **Never hold a database session across work that is not database work.** The pool is 30 connections on one process. A streaming endpoint must not take `Depends(get_db)`; a background job does `read → commit() → slow work → fresh short session for the writes`; a helper never commits or rolls back a session it was handed; never assume 30 connections are available. → `.claude/rules/db-sessions-events-audit.md`

### Backend Conventions
- **A Security & admin log entry is written for a person to read**: `audit_log.record` takes exactly `reason` / `changes` / `items` / `context`, values are labels not keys, and a new item kind is a three-place change. → `.claude/rules/db-sessions-events-audit.md`
- All route handlers live in `backend/app/api/v1/`, one file per resource domain.
- New routes must be registered in `backend/app/api/v1/router.py`.
- Use `async def` for all route handlers and database operations.
- Permission checking: use `PermissionService.require_permission(db, user, "permission.key")` or the `require_permission("permission.key")` FastAPI dependency from `deps.py`.
- New permission keys must be added to `backend/app/core/permissions.py` (the single source of truth for all valid permission keys).
- New models go in `backend/app/models/` (one file per table) and must be imported in `backend/app/models/__init__.py`.
- Schema changes require a new Alembic migration in `backend/alembic/versions/` with sequential numbering (e.g., `036_description.py`).
- **Published, account-less resources (web portals, published diagrams) share one access layer, `app/services/public_access.py`**; a public read endpoint returns the artefact, not the model behind it; only the three published-diagram paths may be framed by another site. → `.claude/rules/public-access.md`
- **A demo seeder must never infer "have I already run?" from the data it created** — it checks a durable `seed_markers` marker. → `.claude/rules/settings-and-seed.md`
- **A write path that can move `cards.updated_at` must also persist a card event** (`event_bus.publish(..., db=db, card_id=...)`, with `changes` as `{field: {"old", "new"}}`), **or** run inside `derived_maintenance(db)` when it is pure derived-value maintenance. → `.claude/rules/db-sessions-events-audit.md`
- **Creating a relation is idempotent on `(type, source_id, target_id)`, and every relation is stored in its relation type's direction** — every writer turns a swapped pair through `app/services/relation_orientation.py` before any lookup, and `test_every_relation_writer_orients` fails a new `Relation(` writer that does not. → `.claude/rules/relations.md`
- **A built-in card type is only ever hidden; a custom one can be deleted for good, dependants included** (`card_type_delete.py`, 409 `cards_present` without `delete_cards=true`). → `.claude/rules/card-read-scope.md`
- **A card type's category is a registry key, not free text: the route validates, the importers adopt** (`card_type_categories`). → `.claude/rules/settings-and-seed.md`
- **Built-in metamodel default changes need a migration too** — a guarded `UPDATE` that only rewrites rows still carrying the drifted-from value (`072_restore_business_process_color.py`). **A migration that creates a `created_at` / `updated_at` column must declare `server_default=sa.func.now()`.** → `.claude/rules/settings-and-seed.md`
- **An upload is what its bytes say, not what the client calls it** (`attachment_validation.py`; the 20 MB cap is mirrored in three other places). → `.claude/rules/uploads.md`
- Sensitive values (SSO secrets, SMTP passwords) must use `encrypt_value()`/`decrypt_value()` from `backend/app/core/encryption.py`.
- Ruff linting: line length 100, rules E/F/I/N/W. Run `ruff check .` and `ruff format .`.
- **Before every commit**, run `cd backend && ruff format . && ruff check .` to ensure CI won't fail on formatting or lint errors. This is mandatory — do not skip it.
- **Public API surface is auto-documented**: `docs/api/openapi.json` is generated from `app.main:app` by `scripts/dump_openapi.py` and rendered in the user manual at `/admin/api/` via Swagger UI (loaded from the `swagger-ui-dist` CDN, same UI as FastAPI's `/api/docs`). Do not hand-edit it. The committed spec is **version-agnostic** — `dump_openapi.py` normalises `info.version` to the constant `"latest"` before writing, so VERSION bumps never produce drift. Handling:
  - **VERSION bumps**: nothing to do. The committed spec is version-agnostic, so a VERSION-only diff cannot cause CI drift. The live runtime spec served by the backend at `/api/openapi.json` keeps the real version (it's `app.openapi()` direct).
  - **Route or request/response schema changes**: run `python scripts/dump_openapi.py` and commit the result. There is intentionally no pre-commit hook for this — the script imports the whole backend app and we don't want every `backend/**` commit to pay that cost.
  - CI fails PRs whose spec has drifted; pushes to `main` auto-regenerate it via the `openapi-spec` workflow job, so it's recoverable if you forget.
- **Boot-time public settings belong in `/api/v1/settings/bootstrap`.** When you add a new small public setting that the frontend reads at boot (a feature toggle, a display preference, an enabled-list, etc.), add it to the response of `GET /settings/bootstrap` in `backend/app/api/v1/settings.py` instead of (or in addition to) creating a per-setting `GET` endpoint. The frontend calls bootstrap once after auth and primes hook caches from the result, so anything that lands here costs zero round-trips on subsequent navigations. Per-endpoint reads remain the right choice for selective refresh after admin edits.
- **`app_settings.general_settings` is a settings row, not a cache — and every write to it is key-scoped.** A cache gets its own table (`catalogue_cache`); nothing multi-megabyte belongs in the blob. **Static-asset redirects carry `Cache-Control`. Macro Capabilities are an additive tier above L1.** → `.claude/rules/settings-and-seed.md`

### Area conventions (path-scoped)
Each of these loads automatically when you touch its files; read it first when you plan a change there.
- MCP server, write-tool guardrails, mutation batches, confirm tokens → `.claude/rules/mcp-server.md`
- Platform migration importer / exporter (LeanIX adapter pattern) → `.claude/rules/platform-migration.md`
- **Workspace transfer — any DB schema change is potentially a workspace-transfer change** (the checklist is mandatory on every model or migration edit) → `.claude/rules/workspace-transfer.md`
- Extension Store: signing, licensing, content packs, field contributions → `.claude/rules/extensions-backend.md`; the backend SDK and its bridges → `.claude/rules/extensions-sdk-bridges.md`; UI plugins and the `window.TurboEA.sdk` reuse boundary → `.claude/rules/extensions-ui.md`
- BPM → `.claude/rules/bpm.md` · PPM → `.claude/rules/ppm.md` · TurboLens + compliance → `.claude/rules/turbolens-grc.md` · Risk Register → `.claude/rules/risk-register.md` · AI suggestions + ServiceNow → `.claude/rules/ai-and-integrations.md`
- Helm, managed containers, Terraform, Docker images, signing → `.claude/rules/deploy.md`
- Homepage dashboards: widget registry parity, no ids in widget config, trends → `.claude/rules/dashboards.md`

### Frontend Conventions
- Route-level pages use `lazy()` imports in `App.tsx` for code splitting.
- **A route's permission is declared once, in `ROUTE_PERMISSIONS` (`frontend/src/lib/routePermissions.ts`) — never on the `<Route>` and never a second time in the nav.** Every new route goes there or into `INTENTIONALLY_UNGATED`. Where a user lands after signing in is a security decision (`lib/returnPath.ts`). → `.claude/rules/public-access.md`
- Shared hooks in `src/hooks/`, shared components in `src/components/`.
- Feature-specific components go in `src/features/{feature}/`.
- Use `api.get()`, `api.post()`, `api.patch()`, `api.delete()` from `src/api/client.ts` for all API calls.
- **The browser never holds the JWT** — auth is an httpOnly cookie; `api.*` sends no `Authorization` header. → `.claude/rules/public-access.md`
- **Filter-driven GETs go through the request hooks** (`useApiQuery`, `useAbortableEffect`, `useLatestRequest`) — never a bare `api.get` in a `useEffect`; guard every `setState` with `isCurrent()`. **Boot-time singleton hooks use the inflight-promise pattern**, and a new boot-time setting goes into `/settings/bootstrap` + `primeBootstrap()`. → `.claude/rules/frontend-patterns.md`
- All TypeScript interfaces live in `src/types/index.ts`.
- Use MUI 6 components — do not introduce other UI libraries.
- **Field labels are static — the theme owns label placement**; never pin `shrink` / `notched` on a field (`staticLabels.test.tsx`). → `.claude/rules/frontend-patterns.md`
- Icons use Google Material Symbols via the `MaterialSymbol` component.
- **Free text is rendered through `LinkifiedText`; stored HTML through `sanitizeRichHtml`.** → `.claude/rules/frontend-patterns.md`
- When nesting MUI Dialogs, use `disableRestoreFocus` on inner dialogs.
- **Picking an existing card — always `CardPicker`; several cards — `CardMultiPicker`.** Never hand-roll an `Autocomplete` + `/cards?search=` effect, and never hold a bare id `Set` resolved against `useCardSearch`'s `items`. → `.claude/rules/frontend-patterns.md`
- **Search boxes: debounce what goes to the server, never a filter over a list the client already holds — and rank with `searchRank` / `compareByRank`** (mirrors the backend's `_search_rank`). → `.claude/rules/frontend-patterns.md`
- **Design tokens**: All colors, spacing aliases, icon sizes, and typography defaults live in `frontend/src/theme/tokens.ts` (re-exported from `frontend/src/theme/index.ts`). Never hardcode hex codes — import the named token (`STATUS_COLORS.success`, `SEVERITY_COLORS.high`, `LAYER_COLORS["Application & Data"]`, etc.). See [`frontend/UI_GUIDELINES.md`](frontend/UI_GUIDELINES.md) for the full design system, layout patterns, and do's/don'ts.
- **Every AG Grid offers column freeze through `useColumnFreeze`; drag-fill goes through `useDragFill` and never through a bulk endpoint; grid filter sidebars match the Inventory sidebar.** → `.claude/rules/frontend-grids.md`
- **Dependency diagrams use the Layered Dependency View (LDV)** — never describe it as "C4". A diagram view never clobbers formatting the user applied; every relation edge is built by `relationEdgeStyle`; cards by id list go through `fetchCardsByIds` (`frontend/src/api/cardsByIds.ts`), never a hand-built `/cards?ids=` URL. → `.claude/rules/diagrams.md`
- Grids, sidebars, layout patterns and the full design system: `frontend/UI_GUIDELINES.md`.

### Internationalization (i18n)
- **All user-facing strings must use translation keys**, never hardcoded English text. Use `useTranslation()` from `react-i18next` with the appropriate namespace.
- **14 namespaces**: `common`, `auth`, `nav`, `inventory`, `cards`, `reports`, `admin`, `bpm`, `ppm`, `diagrams`, `delivery`, `grc`, `notifications`, `validation`. Use the namespace that matches the feature area.
- **10 supported locales**: `en` (English, baseline), `de` (German), `fr` (French), `es` (Spanish), `it` (Italian), `pt` (Portuguese), `zh` (Chinese Simplified), `ru` (Russian), `da` (Danish), `ar` (Arabic — **right-to-left**; see `RTL_LOCALES` / `isRtlLocale` in `frontend/src/i18n/index.ts`). Components built on third-party widgets that don't inherit the document `dir` (AG Grid, ECharts) must opt into RTL themselves via the `useIsRtl()` hook (`frontend/src/hooks/useIsRtl.ts`).
- **English is the source of truth**. All keys must exist in `frontend/src/i18n/locales/en/{namespace}.json` first. The i18n config uses `fallbackLng: "en"` and `returnEmptyString: false`, so missing or empty translations gracefully fall back to English.
- **Interpolation**: Use `{{variable}}` syntax for dynamic values (e.g., `"Selected {{count}} cards"`). Preserve these placeholders exactly when translating.
- **Plurals**: i18next uses `_one` / `_other` suffixes (e.g., `"count_one": "{{count}} item"`, `"count_other": "{{count}} items"`). All locales need both forms.
- **JSON safety**: Never use unescaped ASCII double quotes `"` inside JSON string values. For Chinese use corner brackets `「」`, for other languages use `«»` or escaped `\"`.
- **In French a card is « fiche », never « carte »** (except a map: *carte des capacités*, *carte thermique*, …). → `.claude/rules/i18n-locales.md`
- **A relation type is named by its VERB wherever it sits among other relation types**, via `useRelationLabel()` / `relationLabel(rt, locale, reverse)`; the Predecessors / Successors nouns belong to the Lineage section alone. → `.claude/rules/relations.md`
- **Metamodel labels — always resolve with the entity-aware resolvers (`useTypeLabel`, `useRelationLabel`, `useFieldLabel`, `useOptionLabel`, `useSubtypeLabel`); NEVER pass `.key` as the fallback.** → `.claude/rules/i18n-locales.md`
- Adding a new language, and the translation checklist → `.claude/rules/i18n-locales.md`

#### Translations are never written in the implementation session
Author **English only**: `frontend/src/i18n/locales/en/*.json`, the English `label`s in `seed.py` (leave `translations` to be filled), `docs/**/*.md` without a locale suffix, and the `en` filenames in `scripts/screenshots/pages.ts`. Do not open a non-English locale file in the main session (`admin.json` alone is ~200 KB, times nine). Before the PR is opened, run **`/translate`**: it forks a Sonnet translator (`.claude/agents/translator.md`) that finds every gap from the diff against `origin/main` with `scripts/i18n/check_locales.py`, fills all nine locales (UI JSON, seed `translations`, doc siblings, screenshot filenames) and runs the parity tests. The PR checklist item "translations in all 10 locales" is satisfied by `/translate` reporting clean. A trivially small change (one or two keys) may still be translated inline, but the default is the skill.

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
- **Test Plan**: Describe how you verified the changes work. Always include the four CI checkboxes (all CI checks pass, manually tested, added/updated tests, mutation gate). Check the boxes that apply. For the mutation gate, give the score on changed lines and list every surviving mutant and every new suppression pragma with its reason.
- **Checklist**: Review every item and check all that apply. These enforce the project's core conventions (permission checks, Alembic migrations, async handlers, data-driven metamodel, no exposed secrets). Do not remove unchecked items — leave them unchecked so reviewers can see what was considered.
- PR titles should be concise (under 72 characters) and describe the change, not the implementation.
- **No comments on the PR, ever** — see *Never write on GitHub on the user's behalf* above. Review threads, CI explanations and reviewer questions are answered to the user in chat; the PR body is written at creation and left alone unless the user asks for an edit.

### Changelog & Versioning Conventions
- **Update `CHANGELOG.md`** for every user-facing change. Add entries under the current version heading (e.g., `## [0.6.0] - 2026-02-22`). Do **not** use an `[Unreleased]` section — this project ships continuously and every change belongs to a concrete version.
- The changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Use these categories: **Added**, **Changed**, **Deprecated**, **Removed**, **Fixed**, **Security**. Only include categories that apply.
- Each entry should be a single concise line describing the change from the user's perspective, not implementation details.
- **A change with no effect on the running product takes no version bump and no changelog entry.** CI workflows, the security-scan and publish pipelines, Dependabot config, repo tooling under `scripts/`, guard tests and contributor docs are hardening *around* the app, not changes *to* it: an end user reading the changelog cannot act on them, and a patch release that ships byte-identical images is noise. `.github/SECURITY_PIPELINE.md` is the record for pipeline changes. The version check only runs when a PR touches `VERSION`, so such a PR simply leaves both files alone (Dependabot's PRs already do).
- **Bump the version once per PR** (not per commit). All commits in a feature branch share one version. Follow [Semantic Versioning](https://semver.org/): bump **patch** (e.g., `0.6.0` → `0.6.1`) for bug fixes, **minor** (e.g., `0.6.0` → `0.7.0`) for new features, **major** for breaking changes.
- The single source of truth for the version is `/VERSION`. When bumping, only update `VERSION` (the backend reads it at runtime via `config.py`, the frontend injects it at build time via `vite.config.ts`). Do **not** edit `backend/pyproject.toml` or `frontend/package.json` — they use a static `"0.0.0"` placeholder to avoid triggering unnecessary CI jobs on version bumps.
- When bumping, add a new heading in `CHANGELOG.md` with the new version and today's date (e.g., `## [0.6.1] - 2026-02-22`), and place new entries under it.
- CI enforces this via `.github/workflows/version-check.yml`: any PR that touches `VERSION` is failed unless `CHANGELOG.md` has a matching `## [<version>]` heading. This prevents the Publish-GitHub-Release workflow from breaking later at tag time.

### Testing Conventions
- **Every new feature and every bug fix must include tests. This is a requirement, not a preference.** A change without tests is not finished: do not call it done and do not open a PR for it. What that means for each kind of change:
  - **Bug fix**: a regression test that fails on the code before the fix and passes after it. Reproduce the bug in a test first, then fix it.
  - **New or changed backend endpoint**: an API test under `backend/tests/api/` covering the success path, the permission denial (403, or 404 where `CardReadScope` hides the card) and at least one rejected input.
  - **New or changed backend service logic**: unit tests under `backend/tests/services/` (or `tests/core/`).
  - **New or changed frontend component, hook or `lib` helper**: a Vitest test next to the source file covering what it renders and how it responds to its main interaction. A new page component is no exception: untested page components are where most of the frontend's uncovered code sits.
  - **New or changed MCP tool**: a test under `mcp-server/tests/`.
  - **Refactor with no behaviour change**: the existing tests must still pass unchanged. Say so in the PR's Test Plan.
  - **No runtime effect at all** (docs, CI config, translations only): no test required. Say so in the PR's Test Plan.
  - **Every kind of change above also owes a mutation score**: the tests you add must *kill* the mutants on the lines you wrote, not merely run them (gate 3 below). A test with no assertion covers a line and kills nothing; a bug-fix regression test that still passes when the fix is mutated away is not a regression test. Put the score from the PR's mutation jobs — and every surviving mutant you kept, with the reason — in the Test Plan. **An AI agent does not run mutation testing locally** (`make mutation-diff`, `mutation-backend`, `mutation-frontend`, `mutmut`, `stryker`): without CI's cached stats it spends a long time and the whole machine's compute, delaying everything else, and GitHub has to run the same process anyway — the CI jobs are the result that must pass. Push, read the `Backend` / `Frontend` / `MCP Mutation Tests` results on the PR, and answer their survivors there; `make mutation-diff` remains a local tool for a human who wants it.
- CI gate mechanics — diff coverage, suite floors, shards, the mutation gate, the nightly, the browser suite, and the backend fixture traps (`func.now()` is transaction-constant, greenlet coverage) → `.claude/rules/testing-ci.md` and `CONTRIBUTING.md`.
- **Every test job blocks a merge.** `Backend Integration Tests` is the only job that runs `tests/api/` — most of the backend suite — and it ran as informational (`continue-on-error`) until 2026-10, so a red API suite could not stop a merge on its own. It, `MCP Server Tests` and the three mutation jobs (`Backend Mutation Tests`, `Frontend Mutation Tests`, `MCP Mutation Tests`) are required checks (`CONTRIBUTING.md`, branch protection table). Do not reintroduce `continue-on-error` on a test job.
- **Backend tests** live in `backend/tests/` mirroring the source structure (`core/`, `services/`, `api/`).
- **Frontend tests** live next to source files (e.g., `client.ts` → `client.test.ts`).
- Use the factory helpers in `backend/tests/conftest.py` (`create_user`, `create_card`, `create_card_type`, etc.) rather than inserting raw models. Note: `create_card_type` defaults to `built_in=False`; pass `built_in=True` explicitly when testing built-in type behavior.
- Frontend tests use Vitest + Testing Library. Mock the API client with `vi.mock("@/api/client")`, not the global fetch.
- Pure logic (calculation engine, BPMN parser, encryption, JWT) should have unit tests that need no database.
- **Seed demo data must stay compatible with the metamodel** (`test_seed_demo.py`, `test_seed_demo_security.py`). → `.claude/rules/testing-ci.md`

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

### User Documentation
Every feature or UI change updates the user manual (`docs/`, MkDocs Material, English authored here, the nine siblings via `/translate`). Screenshots and docs are a **two-way contract**: an entry added to `scripts/screenshots/pages.ts` must be referenced as `![…](../assets/img/{locale}/{file}.png)` in the matching doc page, and an image referenced in a doc must have a `pages.ts` entry. Run `mkdocs build --strict`. → `.claude/rules/docs.md`

---

## Architecture Overview

```
┌───────────────────────────────────────────────────────────┐
│  Browser                                                  │
│  React 19 + MUI 6 + React Router 8 + ECharts + AG Grid    │
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
│  Bundled `db` service in    │  │  profile) or external LLM   │
│  the compose network        │  │  provider on port 11434     │
└─────────────────────────────┘  └─────────────────────────────┘
```

**DrawIO** is self-hosted inside the frontend Docker image (cloned at build time from `jgraph/drawio` v31.5.3) and served under `/drawio/` by Nginx.

---

## Terminology

The codebase uses **"cards"** throughout (models, routes, UI). Earlier documentation may reference "fact sheets" — this has been fully renamed. The core entity table is `cards`, the API route is `/api/v1/cards`, and the frontend route is `/cards/:id`.

---

## Version Management

Single source of truth: `/VERSION` file at project root.

- **Backend**: `config.py` reads VERSION → exports `APP_VERSION` → exposed in `/api/health`
- **Frontend**: `vite.config.ts` reads VERSION → injects `__APP_VERSION__` global → displayed in user menu (AppLayout)
- **Docker**: Both Dockerfiles `COPY VERSION ./VERSION` before building
- **Local dev**: Frontend checks `../VERSION` (from frontend dir) then `./VERSION` (Docker)
- **Packaging metadata**: `backend/pyproject.toml` and `frontend/package.json` use a static `"0.0.0"` placeholder — do not bump them. This avoids triggering CI path filters on version-only changes.

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

