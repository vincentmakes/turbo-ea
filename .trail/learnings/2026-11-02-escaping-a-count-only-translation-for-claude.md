---
title: "Escaping a count-only translation for the rich-HTML guard leaves equivalent mutants; the mutation gate on a changed helper needs output assertions, not just a…"
author: Claude
date: 2026-11-02
branch: claude/charming-wozniak-jamr5e
cost: { minutes: 32, tokens: 199765 }
id: l-dc9c5629
scope: repo
status: active
src: agent
touches:
  - frontend/src/api/cardsByIds.test.ts
  - frontend/src/features/admin/RolesAdmin.test.tsx
  - frontend/src/features/admin/metamodel/StakeholderRolePanel.test.tsx
  - frontend/src/features/inventory/excelRelations.test.ts
  - CHANGELOG.md
  - VERSION
  - backend/app/api/v1/metamodel.py
  - backend/app/api/v1/stakeholders.py
  - backend/app/services/extensions/migrations.py
  - backend/tests/api/test_metamodel.py
---

## Decided
- Every `dangerouslySetInnerHTML` site that renders a translation passes `interpolation: { escapeValue: true }`, even when the only interpolated value is a number, so the rich-HTML guard needs no allowlist entry. The price is a pair of equivalent mutants per count-only site (`true→false`, `{…}→{}`): they are listed as survivors in the PR's Test Plan, not suppressed with pragmas and not "fixed" with a test, because no input can make a number render differently.
- A regression test for an escaping fix asserts two things: the hostile string is present as text inside the expected element (a `strong`), and no element with the hostile attribute exists in the document. A test that only checks "no img" lets the options-object mutant through, because an unrendered `{{label}}` placeholder also has no img.
- A helper rewritten onto a shared fetcher (the export's ancestor walk) is scored by the mutation gate on its own logic, not on the call site: tests must pin the number of lookups per level, the exact ids of each call, the depth bound and the dedup, through a spy that wraps the real fetcher (`vi.mock` with `{ ...actual, fn: vi.fn(actual.fn) }`), with the API mock answering only the ids it was asked for so each level is one call.

## Tried and ruled out
- Stryker pragmas on the count-only sites: allowed by the rules for equivalent mutants, but they would put eight comment lines into product code for a flag that exists only to satisfy a guard; the Test Plan listing is enough.
- Relying on the agents' "fails before / passes after" check as proof of mutation strength: it proves the boolean flag matters, not that the options object or the key string are observed. Hand-apply the exact mutant the report names before pushing.

## Watch out
- A `for` condition mutated to `true` hangs the test run; locally that looks like a stuck vitest, in CI Stryker records a timeout and counts it killed. Keep the default per-test timeout on such a test.
- In the export, a parent ref only appears in a cell when the target's name is ambiguous, so a parent-walk test needs two targets with the same name.
- `sx={{ mb: 2 }}` on the same line as a mutated `t()` call shows up as a surviving `ObjectLiteral` on that line; it is a style object, not the options object.

In the code:
- frontend/src/features/inventory/excelRelations.test.ts, describe "walking an off-sheet target's ancestors" (mockOffSheetGraph helper).
- frontend/src/api/cardsByIds.test.ts, describe "fetchCardsByIdsDetailed".
- frontend/src/features/admin/RolesAdmin.test.tsx, StakeholderRolePanel.test.tsx: the count and last-active-role assertions.
- Gate: scripts/mutation/floors.toml [diff] frontend = 60; scored by scripts/mutation/gate.py from the Frontend Mutation Tests job.
