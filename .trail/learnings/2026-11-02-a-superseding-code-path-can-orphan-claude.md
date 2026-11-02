---
title: "A superseding code path can orphan a documented feature while every test stays green; the mutation gate's NoCoverage is what exposed it"
author: Claude
date: 2026-11-02
branch: claude/diagram-group-memory-and-dead-code
id: l-b5534da1
scope: repo
status: active
src: agent
touches:
  - ".github/workflows/ci.yml"
  - CHANGELOG.md
  - VERSION
  - backend/app/api/v1/extensions.py
  - backend/app/models/extension.py
  - backend/app/services/ai_service.py
  - backend/app/services/extensions/license.py
  - backend/app/services/extensions/license_refresh.py
  - backend/app/services/extensions/registry.py
  - backend/app/services/servicenow_service.py
---

## Decided
- When a new interaction path replaces an old one, the old path's side-effects are a checklist, not dead weight: in the diagram editor the per-relation expand menu (May 2026) replaced the toggle that expanded everything, and the memory of deleted children, deleted relations and arranged layouts stayed only in the toggle path. Two later PRs extended that memory without noticing it was unreachable, and the user guide described a behaviour that did not run.
- The fix was to lift the memory into a pure module keyed by card and relation id (not a cached child list, because the menu expands per-type subsets), have the live path record what it drew and apply the memory before drawing, and delete the old chain afterwards. The orange "resync" overlay became "forget this memory".
- Dead-code tooling is now in CI: knip for the frontend (`--no-gitignore`, because the root `.gitignore`'s `frontend/reports/` otherwise hides `src/features/reports/`), vulture at 80 % confidence for the backend with a whitelist file, and an exact-baseline guard for unused translation keys. The purge of the 310 baseline keys is a follow-up.

## Tried and ruled out
- Deleting the unreachable chain as plain dead code: it would have made two silently lost, documented behaviours permanent. Read what an unreachable block *does* before deleting it.
- Trusting knip/vulture to find this class: they see "referenced but unreachable" code as used. Only a reachability read, or the mutation gate reporting NoCoverage on a line a test file names, surfaces it.
- Removing `@mui/icons-material`: zero imports, but the diagram icon generator script reads its files from node_modules; it moved to devDependencies instead.

## Watch out
- A `const x = useCallback(...)` that appears only in other hooks' dependency arrays is not called; grep for `name(` before believing a function is live.
- Cached-list designs go stale when the trigger changes granularity; key memory by stable ids.
- The extension licence text is now encrypted at rest, so rotating `SECRET_KEY` disables paid extensions until the licences are re-pasted; the ServiceNow credential envelope dual-reads the old bare-token form.

In the code:
- frontend/src/features/diagrams/groupMemory.ts (recordExpansion, recordCollapse, applyMemory, hasDeletions); DiagramEditor.tsx handleExpandPick / handleCollapseGroup / handleForgetGroupMemory.
- frontend/knip.jsonc; backend/pyproject.toml [tool.vulture] + backend/vulture_whitelist.py; frontend/src/i18n/unusedKeys.sourceScan.test.ts (UNUSED_KEY_BASELINE).
- backend/alembic/versions/162_encrypt_extension_license_text.py; app/services/extensions/license.py (seal_license_text / open_stored_license_text); app/services/servicenow_service.py.
