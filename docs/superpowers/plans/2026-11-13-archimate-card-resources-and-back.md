# ArchiMate in card Resources, editor Back, link-endpoint hardening: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A card's Resources tab lists and opens its ArchiMate diagrams, the editor's Back returns to where the user came from, the Settings "Open Architecture Studio" button is gone, and the card-link endpoints stop accepting ArchiMate diagrams and hidden cards.

**Architecture:** One backend change in `diagrams.py` (the two card-link handlers reuse the existing `_diagram_for` loader and the existing `_readable_card_ids` helper) and three independent frontend changes (`ResourcesTab`, `ArchimateEditorPage`, `SettingsAdmin`). No schema, no new permission key, no new route.

**Tech Stack:** FastAPI + SQLAlchemy async + pytest (real Postgres via `./scripts/test.sh`); React 19 + MUI 6 + react-router 8 + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-13-archimate-card-resources-and-back-design.md` (read it: it holds the reasons and the "Agent's calls").

**Who does what (this plan is also the trial of the project's agents):** Task 1 → `backend-dev`. Tasks 2, 3, 4 → `frontend-dev` (independent files, may run in parallel; only one agent at a time may use the test Postgres, and tasks 2-4 do not). Task 5 and 6 → the session. Agents never commit: the session commits after each task. Every agent brief ends with: *also say which skills and rule files you had at start, whether you saw the `ponytail` mode, and roughly how much context you used* (trial notes, kept in the final summary).

## Global Constraints

- English only in code, keys and docs written here; the nine other locales come from `/translate` (Task 5). Never open a non-English locale file.
- No hex colour; MUI 6 only; request hooks for filter-driven GETs.
- Agents run `ruff format . && ruff check .` (backend) and `npx eslint <files>` + `npx tsc --noEmit -p .` (frontend) before reporting. **Nobody runs mutation testing locally.**
- Version `2.204.1` → `2.204.2` (patch); `CHANGELOG.md` lines under Fixed / Removed / Security.
- A card the caller cannot read is 404 with the same body as a missing card, never 403.

## Review Focus

1. A hidden card and a non-existent card must be indistinguishable on `POST` and `DELETE /diagrams/{id}/cards` (Task 1).
2. An ArchiMate row on a layer the caller has no key on must not appear in `GET /diagrams?card_id=…&kind=all` (Task 1).
3. Back after an SSO login or on a deep link (`history.state.idx` 0, key possibly not `"default"`) must land on `/diagrams`, never leave the app; a reload keeps `idx` and Back still goes `-1` (Task 3).
4. Back while `useUnsavedChangesGuard`'s sentinel entry is on the stack (`history.state === null`) must not throw and must land on `/diagrams` (Task 3).
5. A card linked to one DrawIO and one ArchiMate diagram shows both, each opening its own viewer (Task 2).

---

### Task 1: Card-link endpoints refuse ArchiMate and hidden cards (`backend-dev`)

**Files:**
- Modify: `backend/app/api/v1/diagrams.py` (`link_card_to_diagram` ~1231, `unlink_card_from_diagram` ~1269)
- Test: `backend/tests/api/test_diagrams_archimate_kind.py` (it already has `env`, `cards_env`, `_create`, `AM`, hidden-card patterns around lines 225-290)

**Interfaces:**
- Consumes: `_diagram_for(db, user, diagram_id: str, action: str) -> Diagram` (loader: DrawIO behind `diagrams.<action>`, ArchiMate behind its layer key, 404 when missing, keeps the `DIAGRAM_KINDS` filter) and `require_card_readable(db, user, card_id: uuid.UUID, mode="module")` from `app.services.card_read_scope` (raises `HTTPException(404, "Card not found")` for a missing **or** hidden card, for any caller, admin included: read its signature first). **Do not use `_readable_card_ids`**: for an unrestricted caller it returns its input unchanged, so a non-existent id would pass and reach the FK error.
- Produces: both handlers load the diagram with `_diagram_for(..., "manage")`; `d.kind == "archimate"` → `HTTPException(409, "An ArchiMate diagram's card links come from its model")`; then `await require_card_readable(...)`; the rest (409 "already linked", 404 "Link not found", insert/delete) is unchanged. A missing `card_id` on `POST` keeps its 400 only for a DrawIO diagram (an ArchiMate one answers 409 first: accepted).

- [ ] **Step 1: Write the failing tests** in `test_diagrams_archimate_kind.py`. Names and assertions:
  - `test_link_an_archimate_diagram_is_refused` / `test_unlink_an_archimate_diagram_is_refused`: admin creates an ArchiMate diagram with `_create(..., kind="archimate", data=AM)`, then `POST`/`DELETE /api/v1/diagrams/{id}/cards[/{card}]` → `409`.
  - `test_link_an_archimate_diagram_needs_the_layer_key`: a user holding `diagrams.manage` only (custom role via `create_role`) → `403`, not `409`, for both verbs.
  - `test_link_a_hidden_card_and_a_missing_card_answer_the_same`: on a DrawIO diagram, `POST` with a card hidden from the caller (`member` in `cards_env`, who has a deny) and with `uuid.uuid4()` → both `404`, `r1.json() == r2.json()`; same for `DELETE`.
  - `test_an_unrestricted_caller_gets_404_for_a_missing_card`: **admin** + `uuid.uuid4()` on `POST` and on `DELETE` → `404` (this is the case `_readable_card_ids` would let through).
  - `test_link_and_unlink_a_readable_card_still_work`: `201` then `204`; linking twice → `409`; unlinking an unlinked readable card → `404` with `"Link not found"`.
  - Characterisation (should already pass), in `backend/tests/api/test_archimate_diagram_permissions.py` (its `vp-business` / `vp-technology` fixture has real per-layer keys, which `env` here does not): `test_card_listing_with_kind_all_hides_an_archimate_layer_the_caller_cannot_view`: an ArchiMate diagram on the technology layer linked to a card; a caller with the business key only → `GET /api/v1/diagrams?card_id=<id>&kind=all` omits it, a caller with the technology key → includes it. `kind=archimate` listing tests already exist there (~lines 104, 201): add nothing for it.
- [ ] **Step 2: Run and confirm the new tests fail for the right reason**
  Run: `./scripts/test.sh backend/tests/api/test_diagrams_archimate_kind.py -k "link"` (the characterisation test lives in the other file: run it with `backend/tests/api/test_archimate_diagram_permissions.py -k kind_all`)
  Expected: the refusal and hidden/missing-card tests FAIL (201/204/500 or 409 instead of the asserted status); the characterisation test passes.
- [ ] **Step 3: Implement** in the two handlers as described under Produces. Keep `test_diagrams.py` green: a `boRelationship` diagram on unlink stays 404 (`_diagram_for` filters `DIAGRAM_KINDS`).
- [ ] **Step 4: Run the file and the neighbours**
  Run: `./scripts/test.sh backend/tests/api/test_diagrams_archimate_kind.py backend/tests/api/test_diagrams.py backend/tests/api/test_archimate_diagram_permissions.py`
  Expected: all pass. Then `cd backend && ruff format . && ruff check .` clean.
- [ ] **Step 5: Report, then the session commits** (`fix(diagrams): card links refuse ArchiMate diagrams and hidden cards`).

---

### Task 2: Resources tab lists and opens ArchiMate diagrams (`frontend-dev`)

**Files:**
- Modify: `frontend/src/features/cards/sections/ResourcesTab.tsx` (load at ~165, row at ~738-750), `frontend/src/i18n/locales/en/<the namespace ResourcesTab already uses>.json`
- Test: `frontend/src/features/cards/sections/ResourcesTab.test.tsx`

**Interfaces:**
- Consumes: `DiagramSummary.kind?: "drawio" | "archimate"` (`frontend/src/types/index.ts`); the backend now answers `GET /diagrams?card_id=<id>&kind=all` per row.
- Produces: load URL is exactly `` `/diagrams?card_id=${fsId}&kind=all` ``; row click → `navigate(d.kind === "archimate" ? `/admin/architectureStudio/${d.id}` : `/diagrams/${d.id}`)`; the unlink `IconButton` renders only when `canManageDiagramLinks && d.kind !== "archimate"`; an ArchiMate row shows a small `Chip` with a new English key. The "link a diagram" picker (`/diagrams`, DrawIO only) is **not** changed.

- [ ] **Step 1: Write the failing tests**; first update the mock URL (`beforeEach` ~line 95) and the assertion at ~147 to the `&kind=all` form, then add: `lists an ArchiMate diagram next to a DrawIO one` (both names visible), `opens an ArchiMate row in the Architecture Studio` (`navigateMock` called with `/admin/architectureStudio/diag-2`), `keeps opening a DrawIO row in the viewer` (existing test ~474), `shows no unlink button on an ArchiMate row` (unlink buttons count equals the DrawIO rows only, with `canManageDiagramLinks` true), `marks an ArchiMate row` (chip text).
- [ ] **Step 2: Run, see them fail**
  Run: `cd frontend && npx vitest run src/features/cards/sections/ResourcesTab.test.tsx`
  Expected: FAIL (URL mismatch, wrong route, unlink button present).
- [ ] **Step 3: Implement** as under Produces; one line on the view-only question from the spec ("Constraints and traps"): the builder checks `ROUTE_PERMISSIONS` for `/admin/architectureStudio/:id` and decides whether an ArchiMate row is clickable for a user without the manage-any-layer key, records the call in its report, and covers it with a test.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `npx eslint src/features/cards/sections/ResourcesTab.tsx src/features/cards/sections/ResourcesTab.test.tsx` and `npx tsc --noEmit -p .` clean.
- [ ] **Step 5: Report, then the session commits** (`fix(cards): list ArchiMate diagrams in a card's Resources`).

---

### Task 3: Editor Back returns to where the user came from (`frontend-dev`)

**Files:**
- Modify: `frontend/src/features/archimate/ArchimateEditorPage.tsx`
- Test: `frontend/src/features/archimate/ArchimateEditorPage.test.tsx`

**Interfaces:**
- Produces: `onBack` computes `const inApp = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;` and calls `navigate(inApp ? -1 : fallback)`, where `fallback` is `/diagrams` when the user may open it (`ROUTE_PERMISSIONS` gives it `diagrams.view`: use `canAccessPath` from `frontend/src/lib/routePermissions.ts`, confirm its name and how components call it), else `/admin/architectureStudio` (a role with only `archimatediagrams.*` keys can open the editor but not `/diagrams`). It must **not** test `location.key` (an SSO login replaces the entry, so the key is not `"default"` while the previous entry is the identity provider). A reload keeps `history.state`, so `idx` survives it and Back still goes `-1` inside the app: correct, and the e2e `frontend/e2e/archimate-editor.spec.ts` (~lines 84-89, reload then Back then `waitForURL(/\/admin\/architectureStudio$/)`) must still pass: re-check it by reading, and run it only if the session has the browser suite available.

- [ ] **Step 1: Write the failing tests** (replace `goes back to the sandbox list`). `renderWithProviders` takes a single `route`: start on a prior path, push to the editor with a button like `Where`'s `go-d2`, and list `/diagrams`, the prior path and `/admin/architectureStudio` in `routes` so the landing page renders. `MemoryRouter` never touches `window.history`: `idx` is driven only by `window.history.replaceState` in the test (say so in a comment). Tests: `goes back to the previous page when the app navigated here` (`replaceState({ idx: 1 }, "")`, assert the prior path); `falls back to /diagrams on a deep link` (`{ idx: 0 }`); `falls back to /diagrams when the entry key is not "default" but idx is 0` (the SSO case: reach the page with `navigate(..., { replace: true })`); `falls back to /diagrams while the unsaved-changes sentinel is on the stack` (`replaceState(null, "")`, no throw); `falls back to /admin/architectureStudio for a role without diagrams.view` (mock the permission helper). Reset `window.history.replaceState(null, "")` in `afterEach`.
- [ ] **Step 2: Run, see them fail**
  Run: `cd frontend && npx vitest run src/features/archimate/ArchimateEditorPage.test.tsx`
  Expected: FAIL (the page still navigates to `/admin/architectureStudio`).
- [ ] **Step 3: Implement** the one-line `onBack` above (the route `/diagrams` exists in `App.tsx`).
- [ ] **Step 4: Run** the same command, then eslint and `tsc` on the two files. Expected: PASS, clean.
- [ ] **Step 5: Report, then the session commits** (`fix(archimate): Back returns to the page the editor was opened from`).

---

### Task 4: Remove the Settings "Open Architecture Studio" button (`frontend-dev`)

**Files:**
- Modify: `frontend/src/features/admin/SettingsAdmin.tsx` (~1740-1749), `frontend/src/i18n/locales/en/admin.json` (key `settings.archimate.openSandbox`, line ~741)
- Test: `frontend/src/features/admin/SettingsAdmin.test.tsx` (the two tests at ~630-660 assert the button)

**Interfaces:** removes the `archimateEnabled && (<Box>…<Button>…openSandbox…)` block, the now unused `const navigate = useNavigate()` (~line 219) and `useNavigate` in the react-router import at line 3 (keep `useSearchParams`); `MaterialSymbol` stays used. The `settings.archimate.*` toggle texts stay.

- [ ] **Step 1: Rewrite the tests first**: replace the two sandbox tests with one, `does not offer an Architecture Studio button, enabled or not`: with the module switched on, the ArchiMate card contains **no `button` role at all** (only the checkbox) and `queryByText("Open Architecture Studio")` is null. **Do not assert through `t("settings.archimate.openSandbox")`**: once the key leaves `en/admin.json` that call returns the key itself and the test passes even with the button present. It fails now because the button renders when enabled.
- [ ] **Step 2: Run, see it fail**
  Run: `cd frontend && npx vitest run src/features/admin/SettingsAdmin.test.tsx -t "Architecture Studio"`
  Expected: FAIL (button present).
- [ ] **Step 3: Remove** the block and the English key.
- [ ] **Step 4: Run** the whole file; eslint and `tsc` on the touched files. Expected: PASS, clean (the locale-parity tests fail until Task 5 removes the key from the other nine: say so, do not touch them).
- [ ] **Step 5: Report, then the session commits** (`chore(settings): drop the Open Architecture Studio button`).

---

### Task 5: Version, changelog, docs, translations (session)

**Files:** `VERSION`, `CHANGELOG.md`, `docs/guide/card-details.md` (section "Resources Tab", ~line 189), `docs/guide/diagrams.md`, `docs/guide/archimate.md` (the "Open the sandbox" section ~16-24 and ~197 "reach them from the sandbox"), `docs/admin/settings.md` (~195-198); the stale comments `frontend/src/lib/routePermissions.ts:147-149`, `frontend/src/lib/pageTitle.ts:103` and the docstring of `test_card_linked_listing_hides_archimate_diagrams_by_default`; the nine locale siblings and the nine other locales' `admin.json` via `/translate`.

- [ ] **Step 1:** `VERSION` → `2.204.2`; `CHANGELOG.md` heading `## [2.204.2] - 2026-11-13` with **Fixed** (ArchiMate diagrams now appear in a card's Resources and open in the Architecture Studio; the editor's Back returns to the previous page), **Removed** (the Settings "Open Architecture Studio" button), **Security** (linking or unlinking cards on an ArchiMate diagram is refused; a hidden card on a diagram link answers 404 like a missing one).
- [ ] **Step 2:** English docs: the Resources-tab section says ArchiMate diagrams are listed (open-only, links come from the model); `docs/guide/diagrams.md` likewise; `docs/guide/archimate.md` and `docs/admin/settings.md` stop describing the Settings button (say where ArchiMate diagrams are opened now: Diagrams page, a card's Resources). Check whether the screenshots `95_admin_settings_modules` and `28_admin_settings_general` show the button (look at the PNGs and their `pages.ts` entries); if they do, the screenshot job regenerates them and the plan notes it, otherwise no screenshot change. Fix the three stale comments listed above.
- [ ] **Step 3:** run `/translate`; expect it to report clean (it removes `settings.archimate.openSandbox` from the nine locales, adds the new `resources` chip key, creates the nine doc siblings).
- [ ] **Step 4:** `mkdocs build --strict` passes; `python scripts/dump_openapi.py` leaves `docs/api/openapi.json` unchanged (the routes did not change shape; if it differs, include the regenerated file).
- [ ] **Step 5:** commit (`docs: 2.204.2 changelog, manual and translations`).

---

### Task 6: Verification, review chain, VAPT (session, fresh agents)

- [ ] **Step 1:** `/graphify . --update --mode deep`, then the full suites: `./scripts/test.sh` and `cd frontend && npm run test:run`, plus `ruff`, `eslint`, `tsc`. Expected: all green, counts recorded.
- [ ] **Step 2:** `simplify` by a fresh agent (it edits code); re-run the tests of the files it touched.
- [ ] **Step 3:** the `reviewer` agent on `git diff origin/main...HEAD` (it runs `ponytail-review`, `security-review`, `python-anti-patterns`); every "must fix" gets a test first. The session itself then runs `security-review` for the PR hook.
- [ ] **Step 4:** VAPT per `.claude/rules/vapt.md` against the local instance (card-link endpoints; the 403/409/404 ladder; the Resources listing for a user without the layer key). Report where `vapt.md` says.
- [ ] **Step 5:** with the user's OK only: push and open the PR with `.github/pull_request_template.md` (Test Plan: refactor/no-op lines stated, mutation answered from CI, trial notes of the three agents in the PR body or in chat).
