# ArchiMate diagrams in a card's Resources, the editor's Back button, and two diagram-link security fixes

**Status:** draft for approval, 2026-11-13. Also the trial run of the `backend-dev`, `frontend-dev` and
`reviewer` agents (branch `chore/specialised-agents`).

## Intent

Three small things around ArchiMate diagrams, done together because they touch the same screens and
endpoints:

1. **A card's Resources tab does not list the ArchiMate diagrams that reference it.** The link is already
   stored: the modeler saves `card_ids` and the backend writes `diagram_cards`. The Resources tab asks
   `GET /diagrams?card_id=<id>` with no `kind`, and the endpoint defaults to `kind=drawio`
   (`backend/app/api/v1/diagrams.py`), so every ArchiMate row is filtered out. The row click also always
   goes to `/diagrams/:id`, which is the DrawIO viewer.
2. **The editor's Back button always lands on `/admin/architectureStudio`**, a list page nobody needs any
   more, instead of where the user came from. The Settings page still has an "Open Architecture Studio"
   button into it.
3. **Two low-severity findings of the 2.204.0 security audit are still open** on the card-link endpoints
   `POST /diagrams/{id}/cards` and `DELETE /diagrams/{id}/cards/{card_id}`: they accept an ArchiMate
   diagram behind `diagrams.manage` alone (the DrawIO permission), and they never apply `CardReadScope`,
   so a hidden card answers 201 / 409 / 404 differently from a missing one (an existence oracle). The
   third audit finding on diagrams (the medium one, `GET /diagrams?kind=archimate` listing layers the
   caller may not view) was fixed in PR #66; this work adds a regression test for it if none exists.

Once point 1 lands, ArchiMate rows are visible in a card's Resources, and with them the unlink button, so
point 3 stops being theoretical.

## Goals

- A card's Resources tab lists the ArchiMate diagrams linked to it, each opening in the Architecture
  Studio editor (`/admin/architectureStudio/:id`).
- The editor's Back returns to the page the user came from; with no history (deep link, reload) it goes
  to `/diagrams`.
- The Settings "Open Architecture Studio" button is gone.
- `POST` / `DELETE /diagrams/{id}/cards` refuse an ArchiMate diagram with 409 and answer 404, never 201 /
  409 / 204, for a card the caller cannot read or that does not exist.

## Non-goals

- The `/admin/architectureStudio` list page and its route stay (the nav, `DiagramsPage` and the create
  dialog still reach the editor through `/admin/architectureStudio/:id`). Only the Settings button and the
  Back target change.
- The "link a diagram" picker in the Resources tab still offers DrawIO diagrams only: an ArchiMate
  diagram's links come from its model, so it cannot be linked by hand.
- No schema change, no new permission key, no change to DrawIO behaviour.

## Anti-goals

- A user must never see an ArchiMate diagram in a card's Resources that `GET /diagrams` would hide from
  them: the list stays filtered row by row by the existing per-layer permission.
- The unlink button must never appear on an ArchiMate row (the model would overwrite the change at the
  next save, and the backend now refuses it).

## Approaches

**Backend (the link endpoints).** (1) *Refuse link and unlink of an ArchiMate diagram with 409* and apply
`CardReadScope` for DrawIO. (2) Check the ArchiMate per-layer permission and keep manual linking: more
code, and the editor overwrites the result at the next save. (3) Hide the button in the frontend only:
leaves the API open. **Chosen: (1)**, by the user, on 2026-11-13.

**Back target.** (1) *Go back in history, fall back to `/diagrams`.* (2) Pass the origin in router
`state` from every entry point: more code and misses a deep link. (3) Always `/diagrams`: loses where the
user came from. **Chosen: (1)**, by the user, on 2026-11-13.

## Design

### Backend (`backend/app/api/v1/diagrams.py`)

- `link_card_to_diagram` and `unlink_card_from_diagram`: load the diagram first, through the existing
  loader that applies the ArchiMate per-layer key (`diagrams.py`, the helper around line 347), so a caller
  without a key on that layer gets the loader's 403 and never learns the UUID is an ArchiMate diagram. For
  a caller who passes it, `d.kind == "archimate"` raises 409 with a message that says an ArchiMate
  diagram's links come from its model. This also removes the permission gap (no write is possible on an
  ArchiMate diagram). `unlink` keeps its `Diagram.kind.in_(DIAGRAM_KINDS)` filter: a `boRelationship`
  diagram stays 404 (`test_diagrams.py` pins it).
- For a DrawIO diagram, resolve the card with `require_card_readable(..., mode="module")` (not
  `_readable_card_ids`, which lets a non-existent id through for an unrestricted caller) before any lookup
  of the link: a card that does not exist or is not readable is 404 (a single hidden card is 404, not 403).
  `unlink` answers the same 404 for such a card, before it looks at the link. Keep the existing 404
  "Diagram not found" and 409 "already linked" for the cases they already cover.
- Malformed UUIDs are out of scope: keep the current behaviour.
- `GET /diagrams?card_id=…&kind=all` already filters each ArchiMate row by its own permission: add a test
  that pins it for a card's listing (and the `kind=archimate` list fixed in #66 if not already covered).

### Frontend

- `frontend/src/features/cards/sections/ResourcesTab.tsx`: load linked diagrams with `kind=all`; row
  click goes to `/admin/architectureStudio/:id` when `d.kind === "archimate"`, else `/diagrams/:id`; the
  unlink button renders only for DrawIO rows. A small label or icon marks an ArchiMate row, through an
  existing `t()` key if one fits, otherwise a new English key in `en/cards.json`.
- `frontend/src/features/archimate/ArchimateEditorPage.tsx`: Back goes `navigate(-1)` when the user
  navigated inside the app, else `navigate("/diagrams")`. **"Inside the app" is `window.history.state?.idx
  > 0`** (react-router's own position counter: it is 0 on a deep link or a return from the identity
  provider, and a reload keeps it), not `location.key !== "default"`: after an SSO login `SsoCallback`
  replaces the entry, so the key is no longer `"default"` while the entry before it is the identity
  provider's page. The fallback is `/diagrams`, or `/admin/architectureStudio` for a role that cannot open
  `/diagrams` (it requires `diagrams.view`; a role with only `archimatediagrams.*` keys can open the editor).
- `frontend/src/features/admin/SettingsAdmin.tsx`: remove the "Open Architecture Studio" button and its
  `settings.archimate.openSandbox` key from `en/admin.json`; the nine other locales lose it through
  `/translate`. `SettingsAdmin.test.tsx` loses the tests that asserted the button.

## Constraints and traps (for the builder)

- Read `.claude/rules/card-read-scope.md` (the backend change), `.claude/rules/archimate.md` and
  `.claude/rules/frontend-patterns.md`. Filter-driven GETs go through the request hooks.
- `ROUTE_PERMISSIONS` gates `/admin/architectureStudio/:id` on `ARCHIMATE_MANAGE_ANY_LAYER`, while the
  list returns an ArchiMate row to anyone with its layer's *view* key. **A view-only user would see the
  row and land on a page they cannot open. Verify, and decide whether the row is shown without a click
  target for that user**; this is the one open design point, left to the builder (record the call).
- The change touches permission code: a VAPT pass is owed (`.claude/rules/vapt.md`), against the local
  instance only.
- The version is bumped once for the PR (patch: two fixes and a removal), `CHANGELOG.md` gets **Fixed**,
  **Removed** and **Security** lines, and the user manual is updated where it mentions the Settings
  button or the card Resources tab. Translations are not written here: `/translate` does them.

## Tests (every item owed)

- Backend, `backend/tests/api/`: link and unlink an ArchiMate diagram → 409; link and unlink a hidden card
  and a missing card on a DrawIO diagram → 404 (same body); the success path still works; the
  `card_id=…&kind=all` listing returns an ArchiMate diagram linked to the card and omits one on a layer the
  caller cannot view.
- Backend adds: link and unlink of an ArchiMate diagram by a caller with `diagrams.manage` but no key on
  that layer → 403 (not 409); a `boRelationship` diagram on unlink stays 404.
- Frontend, next to the source: Resources tab lists an ArchiMate row, opens the Architecture Studio route
  on click and shows no unlink button on it; Back goes to the previous page and falls back to `/diagrams`
  when `history.state.idx` is 0 **including an entry whose key is not `"default"`** (the SSO case); Back
  with a diagram holding unsaved changes (`useUnsavedChangesGuard` pushes a sentinel history entry, so the
  history count is not reliable); Settings no longer renders the button.
- Mutation score on the lines written is read from CI, never run locally.

## Left to the builder

The exact wording of the 409 message, the ArchiMate row's label, the view-only behaviour above, and how
Back behaves while the unsaved-changes guard's sentinel entry is on the stack (a test pins the outcome).

## Agent's calls (to check while reading)

1. **Back uses `history.state.idx`, not `location.key`** (the fresh reviewer's finding): after an SSO login
   the key is not `"default"` but the previous entry is the identity provider, so `navigate(-1)` would
   leave the app. Cost if wrong: Back lands on `/diagrams` instead of the origin in some edge case.
2. **`kind=all` keeps requiring `diagrams.view` for the whole list.** A role with an ArchiMate layer key
   but no `diagrams.view` already gets a 403 from today's `GET /diagrams?card_id=` (the default `drawio`
   branch needs the same key), so this is no regression; widening the gate would be a further permission
   change to test and to run a VAPT on. Cost if wrong: such a role sees no diagram in Resources.
3. **A 409 for ArchiMate only after the layer permission check**, reusing the existing loader's 403, so
   the 409 does not reveal that a UUID is an ArchiMate diagram to a caller who has no key on its layer.
4. **Back's fallback depends on the permission**: `/diagrams` when the user may open it, else
   `/admin/architectureStudio` (found by the plan's fresh review: `/diagrams` needs `diagrams.view`).
5. **Back while the unsaved-changes guard's sentinel entry is on the stack goes to the fallback, not to the
   origin** (the sentinel is `pushState(null)`, so `idx` reads 0): a short window (autosave is 3 s), no
   error. Cost if wrong: one Back lands on `/diagrams` instead of the origin.
6. The Settings button is removed together with its translation key; the list page stays (non-goals).
7. Version: a **patch** bump (two fixes and a removal), `CHANGELOG.md` under Fixed / Removed / Security.
