---
title: "The mutation nightly kept failing on frontend tests that read the page too early, and a re-run re-tests the old commit"
author: Claude
date: 2026-11-27
branch: claude/inspiring-goodall-3v0u2p
cost: { minutes: 84, tokens: 1231965 }
id: l-8a9a225d
scope: repo
status: active
src: agent
touches:
  - ".github/workflows/ci.yml"
  - ".github/workflows/mutation-nightly.yml"
  - CONTRIBUTING.md
  - backend/tests/core/test_ci_verdicts.py
  - backend/tests/core/test_mutation_scripts.py
  - backend/tests/services/test_ci_workflow_mutation.py
  - backend/tests/services/test_ci_workflow_sharding.py
  - frontend/package.json
  - frontend/scripts/pr-test-scope.mjs
  - frontend/scripts/pr-test-scope.test.ts
---

## Decided
Nightly runs 60, 61, 68 and 69 were red on frontend tests that failed on unmutated code. Run 68 was a test that read too early: a `waitFor` already true on its first check (the request was SENT), then a synchronous query for what the answer renders. Run 69 was a product race in `MentionPopup`.

Mechanism, verified in node_modules: React 19's scheduler takes `setImmediate` at module load (`localSetImmediate`). Testing Library lets one `setTimeout(0)` pass after a `waitFor` resolves.

The race probe holds back only React's scheduler. `probeReactScheduler` installs the wrapper, loads react-dom, then puts the real `setImmediate` back. At 2 ms (CI's `Frontend Race Probe`), 5ad9c27's lifecycle test fails 5 of 5; plain `vitest run` passes it 5 of 5. Sweep mode (`npm run test:race:sweep -- <file>`) is 60 ms plus the nightly's 5 s wait. It is a local diagnosis tool, not a CI gate.

Owner, 27 November 2026, before run 69:
- Catch these races on the pull request, sweep the existing tests, and say in the nightly report that a re-run re-tests the old commit.
- Start a fresh nightly on main at once.

Owner, after run 69:
- Fix the whole 60 ms list on this branch.
- Fix the MentionPopup and ProcessFlowTab races in the product, with a patch bump and changelog lines.
- Open one pull request once the review is clean.

Later the same day: heavy verification goes to GitHub CI, not local runs. The whole-suite sweeps were stopped, so the job's sweep step (step 8) was not added.

A 60 ms run of the whole suite (old probe, 1 s wait) failed 83 tests in 35 files. Re-run in sweep mode, that was 71 tests in 29 files. Each failure was classified:
- **Early read:** fixed in the test.
- **Product race:** fixed with a regression test that fails on the old code at any speed. A `MutationObserver` callback runs between a commit and its passive effects, which is where these races lose. Four were fixed:
  - `MentionPopup`: the scroll is tied to the highlight the key asked for.
  - `ProcessFlowTab`: a save closes only the cell it came from, in both tables.
  - `useColumnOrder`: the fold is published in a layout effect.
  - `StakeholderRolePanel`: reads the parent's inline `onError` through a ref.
- **Artifact:** the probe itself, which slowed every `setImmediate` user. That was a probe bug.

The list then passed 3 of 3 runs in sweep mode, file by file. The whole suite was never swept clean in one run.

## Tried and ruled out
- Only sweeping the existing tests: new races would still show up only in the nightly, after merge.
- Only confirming the fix on main: the same class of failure returns with the next new test.
- Re-running a failed scheduled run: it re-tests the snapshotted commit.
- Fixing only the MentionPopup test: the rest of the list could still turn a night red.
- Leaving the branch as pushed: run 69's test and the list stay unfixed.
- Making only the two tests wait: the product keeps both small defects.
- Pushing without a pull request.
- A fixed delay above 50 ms for CI: not deterministic, and twice as slow.
- Asserting the probe's order against a real zero-delay timer: a stall between the two calls reorders them. The test injects a recording timer instead.

## Watch out
- An empty diff in `frontend-race` means "could not tell". No `--changed-tests` file is written and the whole suite runs.
- `findAllByRole("alert")` and `findByRole("dialog")` resolve on what is there now, not on what the answer adds.
- The container's npm 10 rejects the lockfile; use `npx -y npm@11 ci`.

In the code:
- frontend/src/test/raceProbe.ts: probeReactScheduler, installRaceProbe
- frontend/vitest.race-sweep.config.ts
- frontend/scripts/pr-test-scope.mjs: changedTests
- frontend/src/features/ea-delivery/mentions/MentionPopup.tsx: scrollRequest
- frontend/src/features/bpm/ProcessFlowTab.tsx: closeCellAfterSave
- frontend/src/components/grid/useColumnOrder.ts
- frontend/src/features/admin/metamodel/StakeholderRolePanel.tsx: onErrorRef
- scripts/mutation/harness.py: rerun_note
- cd frontend && npm run test:race:sweep -- <file>
