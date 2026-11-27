---
title: "The mutation nightly kept failing on frontend tests that read the page too early, and a re-run re-tests the old commit"
author: Claude
date: 2026-11-27
branch: claude/inspiring-goodall-3v0u2p
cost: { minutes: 31, tokens: 440602 }
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
The mutation nightly was red on runs 60, 61 and 68 because a frontend test failed on unmutated code. Only run 68 was the "read too early" kind: a `waitFor` that is already true on its first check (`expect(api.get).toHaveBeenCalled()`, so the request was only SENT), then a synchronous query for what the RESPONSE renders. That was `RelationsSection.lifecycle.test.tsx` from #1443, fixed by 1407ad7 an hour after the nightly's snapshot.

Mechanism, verified in node_modules: React 19's scheduler takes `setImmediate` at module load (`localSetImmediate`; MessageChannel is only a fallback) and yields after 5 ms. Testing Library's `asyncWrapper` lets exactly one `setTimeout(0)` pass after a `waitFor` resolves. Stryker's slow runs lose that race about one time in twenty, and the nightly runs the suite about 130 times.

The owner decided on 27 November 2026 to catch these on the pull request: a race probe (`src/test/raceProbe.ts`, `vitest.race.config.ts`, `npm run test:race`, CI job `Frontend Race Probe`), a sweep of existing tests, and a sentence in the nightly report saying a re-run re-tests the old commit. The owner also chose to start a fresh nightly on main straight away rather than wait for Sunday's scheduled run.

The probe defers each `setImmediate` callback 2 ms on the real `setTimeout`. It is merged as the BASE of a first `mergeConfig` so it loads before `setup.ts`. Under it, 5ad9c27's lifecycle test fails 5 of 5 (plain: passes 5 of 5), and the whole suite passes in about plain time. Run 60's test (DocumentSidePanel before f67254f: a callback asserted unwaited after the commit whose passive effect calls it) fails only 3 of 5 under the probe. Run 61's (TipTap focusing a frame late, through `requestAnimationFrame`) is not touched by it.

## Tried and ruled out
- Only sweeping the existing tests: the nightly would stay the only place a new race shows up, after merge.
- Only confirming the fix on main: nothing changes, and the same class of failure returns with the next new test.
- Re-running a failed scheduled run: it re-tests the commit the run snapshotted, so it cannot pick up a fix merged since. Run 68's re-run failed the same way.
- A delay above `waitFor`'s 50 ms poll for the CI job. It does catch waits that turn true later (an `onError` before a `finally`), but not every run: at 60 ms the failing set varied between runs, the suite took twice as long, and 33 files failed. It stays a sweep tool, `RACE_PROBE_DELAY_MS=60`.
- The mutation sandbox's 5 s wait in the race config: `mutationSandbox.test.ts` pins the 1 s default and rightly fails under it.
- Asserting the probe's ordering against a real zero-delay timer in its own test: Node stamps a timer's start with the current time, so a 50 ms stall between two calls reordered them. The test injects a recording timer instead.

## Watch out
- An empty diff in the race job means "could not tell" (no merge commit, or a failed `git diff`). `pr-test-scope.mjs` then writes no `--changed-tests` file, and the job runs the whole suite. It must never run nothing.
- Seeing the DOM is not seeing the effects. `MentionPopup` tells its store "nothing found" in a `useEffect` after "No matches" paints, so wait on what the next step reads (`endsOnTyping` in RichTextEditor.test.tsx).
- `ProcessFlowTab.tsx` clears `editingCell` after a save returns, whatever cell is open by then. That is a product race, left unfixed.
- The container's npm 10 rejects the lockfile; `npx -y npm@11 ci` installs it unchanged.

In the code:
- frontend/src/test/raceProbe.ts: installRaceProbe, probeDelay
- frontend/scripts/pr-test-scope.mjs: changedTests, main's `changes.length > 0`
- .github/workflows/ci.yml: frontend-race
- scripts/mutation/harness.py: rerun_note
- cd frontend && npm run test:race -- <file>
