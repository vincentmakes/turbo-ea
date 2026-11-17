---
title: A test that waits for the screen and then checks a callback fired by an effect fails now and then in the mutation nightly; wait on the callback itself
author: Claude
date: 2026-11-17
branch: claude/sharp-knuth-8h33au
cost: { minutes: 14, tokens: 501691 }
id: l-7f5082ad
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/ea-delivery/collab/DocumentSidePanel.test.tsx
  - frontend/src/features/ea-delivery/collab/DocumentSidePanel.tsx
  - scripts/mutation/harness.py
  - ".github/workflows/mutation-nightly.yml"
  - backend/tests/api/test_deps.py
  - frontend/src/hooks/useLatestRequest.ts
  - scripts/mutation/gate.py
---

## Decided
The nightly mutation run of 16 November 2026 (run 60) was red for one reason: a frontend test failed on unmutated code in Stryker's initial test run, on two shards, with "expected vi.fn() to be called with arguments: [ 5 ] / Number of calls: 0". No floor was breached and nothing was lost: the failed chunk was measured in the second half of the night and the report job passed.

The cause is in the test, not the product. The test waits for the badge to read 5 and then asserts, with no wait, that the count callback was called. The badge is written in React's commit; the callback is called from a passive effect of the same commit, which React flushes in a later scheduler task. Testing Library's waitFor returns once the DOM matches and one zero-delay timer has fired, so the assertion can run before the effect. The fix is to wait on the callback: put the call assertion inside its own waitFor (the same file already does this in its "reads the discussion again" test).
When the nightly says a file's score fell and neither the file nor its tests changed, diff the per-mutant verdicts of the two runs before writing any test. On 16 November 2026 both such drops had mundane causes. In one file, mutants that were pending the night before (left out of the score) were finally tested and survived, after the file moved shard. In the other, a mutant that changes nothing had been counted killed only because Stryker timed out on it, and that night it ran to completion. The answers were one missing assertion and one reasoned pragma.

## Tried and ruled out
- Reading it as a slow render that needs a longer wait: the wait did not time out, the element was found. The message names a callback with zero calls, which is an ordering problem, and the sandbox's 5 s budget cannot help.
- Reproducing with a slow render alone (an 8 ms busy loop in the mocked panel): passes 5 of 5. What makes it fail is a stall of the event loop after waitFor's callback has passed: 3 ms there fails 5 of 5, with a fast or a slow render, and 1 run of 5 failed with no stall at all.
- Running Stryker to reproduce: not needed. A throwaway Vitest file with the stall shows the failure and shows the fixed assertion passing 5 of 5.
- Blaming the night's merges: neither file nor its tests had changed since October.

## Watch out
- The same file has the same shape a second time (a badge wait followed by a call-count assertion after a window focus event), so one fix should cover both.
- Vitest's setup swallows console output: a throwaway probe has to report through assertions or by appending to a file.
- A red nightly whose only failed job is a frontend shard's first half, with the report job green, is this kind of failure. The test is named in the shard's error annotation, in the mutation-harness-frontend-N artifact and at the top of the survivors issue; the 8 MB job log is not needed.
- A scheduled run that was re-run for one shard keeps the other failed shard red, so "attempt 2" can still show a failure that already recovered inside its own job.

In the code:
- frontend/src/features/ea-delivery/collab/DocumentSidePanel.test.tsx lines 148-149 and 289-290: the wait on the badge followed by the unwaited callback assertion
- frontend/src/features/ea-delivery/collab/DocumentSidePanel.tsx lines 111-113: the effect that calls onOpenCountChange
- scripts/mutation/harness.py and the "Tests that failed on unmutated code under the harness" section it writes
- Stall used in the probe, called once from inside the waitFor callback: chain 12 resolved promises, then busy-wait 3 ms
- Backend files are dealt to shards by size, so a large merge can move an untouched file to another shard, where it is measured from scratch and may run out of budget part-way.
- A Stryker Timeout counts as killed, and it is not stable from run to run. A score reaching 100% only through Timeouts can drop by one mutant without any change.
- Stryker mutant ids renumber when a chunk is re-tested, so match mutants by file, line and mutator, not by id.

- Every nightly uploads a mutation-baseline artifact (mutation-records-<suite>-<shard>.json); compare its status / raw_status per mutant across runs.
- Pending mutants are left out of the score; unreached ones count as survived (scripts/mutation/gate.py).
