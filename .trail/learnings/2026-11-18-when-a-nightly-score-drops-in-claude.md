---
title: "When a nightly score drops in a backend file that just moved shard, the shard is reporting its own old verdicts; and which dips of 17 November 2026 were answer…"
author: Claude
date: 2026-11-18
branch: claude/friendly-ptolemy-c0xdp8
cost: { minutes: 3, tokens: 21334 }
id: l-d76d5c7e
scope: repo
status: active
src: agent
touches:
  - scripts/mutation/mutmut_scope.py
  - scripts/mutation/README.md
  - backend/app/api/deps.py
  - frontend/src/lib/dates.ts
  - frontend/src/hooks/useApiQuery.ts
  - frontend/src/features/ea-delivery/collab/useDocumentDiscussion.ts
  - frontend/src/features/ea-delivery/collab/DocumentSidePanel.tsx
  - frontend/src/features/ea-delivery/RichTextEditor.test.tsx
  - frontend/src/features/ea-delivery/RichTextEditor.tsx
  - frontend/src/features/ea-delivery/mentions/mentionSuggestionStore.ts
---

## Decided
- The owner chose one pull request for the whole of nightly run 61 (17 November 2026): the test that failed on unmutated code, the two small frontend score dips, and the fix to the nightly's own script. This is the same shape as the pull request that answered run 60.
- A backend file's score that falls right after the file is dealt to another shard is usually not about the file or its tests. Each backend shard keeps its own cache of verdicts. Only the files in a shard's scope were refreshed when a test changed, while the shard's record of "which tests changed" moved on every night. A file that comes back to a shard was therefore reported with the verdicts that shard held from its last visit. The fix refreshes every file in the shard's cache when a test changes, and resets a "no tests" verdict whenever the test map links a test to that function.
- The owner chose to leave three surviving mutants on the date-only branch of the local-date parser as survivors, with no suppression. They are not equivalent mutants: they change behaviour outside UTC. Only tests that pin a timezone can kill them, and the mutation sandbox cannot run those tests. The repository suppresses a mutant only when it is equivalent, and no floor depends on that file.
- A style-only mutant in the discussion side panel now survives. It was counted killed before only because the test with the race (fixed after run 60) failed at random under it. It stays a survivor.
The mutation nightly of 17 November 2026 (run 61) was red because one editor test failed on unmutated code, twice, on one frontend shard. The cause is in the test. TipTap's focus command does not focus the editor at once: it does so one animation frame later. The editor forgets a remembered "@query" whenever it takes the focus. The test inserted text with the focus command, simulated a blur, then pressed the toolbar's Mention button. When the late focus landed between the blur and the press, the pick went in at the caret and not in place of the "@query". The fix is one wait in the test: until the editor reports that it has the focus, before the simulated blur.

## Tried and ruled out
- Fixing only the red shard: the six "score fell" flags would stay unanswered, and the backend ones return at every merge large enough to deal files to other shards.
- A separate pull request for the script fix: reasonable for review, but the owner preferred one.
- Suppressing the date mutants with a reason: it would stop the Timeout / Survived flip-flop, but it stretches the "equivalent only" rule.
- Forcing a re-test of every backend survivor to clear verdicts that are already out of date: about 13,000 mutants, the slowest kind, over several nights. Survivors that are out of date from earlier shard moves cannot be told apart from real ones; they are measured again the next time a test that runs them changes.
- Reading the deps.py drop as a missing test: the two logout tests that reach the optional-user dependency exist and killed 15 of its 23 mutants on the other shard the night before.
- Changing the product: a person's toolbar press blurs the editor for real and nothing focuses it again, so the editor is right.
- Treating it as a slow render: the message shows wrong text, not a wait that ran out.
- Assuming the cause from the source alone: a throwaway test that fires the blur straight after the insert and waits 50 ms failed 25 of 25 with the nightly's exact message; with requestAnimationFrame stubbed during the focus command it passed; with the wait it passed 25 of 25.

## Watch out
- The proof that a verdict is out of date: in the shard's state archive, the test map lists tests for the function while the file's verdict record holds "no tests" for all of its mutants. A fresh measurement cannot produce that pair.
- The tests named after a dependency do not necessarily reach it. The optional-user tests call a public settings route that does not use that dependency; only the logout route does.
- A Stryker verdict can flip from Killed to Survived with no code change when the kill came from a test that failed at random, or from a Timeout. Diff the per-mutant records of the two nights before writing a test.
- A second file that fell after a shard move (the extension migrations runner, four mutants) fits the same cause, but that shard's state was not inspected.

In the code:
- scripts/mutation/mutmut_scope.py: run() calls reopen_survivors with the shard's files; reopen_survivors rewrites mutants/mutmut-tests-digest.json every run; relink_untested skips a function the map already links to a test; reset_no_tests resets exit code 33.
- Evidence: nightly-state-backend-1 of run 61 (mutmut-stats.json key tests_by_mangled_function_name for app.api.deps.x_get_optional_user: 2 tests; app/api/deps.py.meta: 23 mutants at 33) against nightly-state-backend-4 of run 60 (same 2 tests; 15 killed, 8 survived).
- Per-mutant diff: the mutation-baseline artifact of each run holds mutation-records-<suite>-<shard>.json; match mutants by file, line and description (frontend) or by id (backend).
- frontend/src/hooks/useApiQuery.ts line 84: the refetch nonce, n + 1 to n - 1, is equivalent and gets a reasoned pragma.
- frontend/src/features/ea-delivery/collab/useDocumentDiscussion.ts line 56: the empty-list fallback had no assertion.
- frontend/src/lib/dates.ts line 70: the three kept survivors; frontend/vitest.stryker.config.ts leaves out the suites that pin a timezone.
- The other blur and focus assertions in that test file were checked and do not depend on this order: a late focus does not change what they expect, or a dialog's closing transition (about 195 ms) comes first.
- The test for the Mention button "pressed while the query is being typed" takes one of two code paths depending on whether the late focus has landed. Both give the same text, so it never fails, but which branch it covers is a matter of timing.

- TipTap 3.31.0, core/src/commands/focus.ts: view.focus() inside requestAnimationFrame.
- frontend/src/features/ea-delivery/RichTextEditor.tsx onFocus calls store.takeDismissed(); onBlur calls store.dismiss().
- frontend/src/features/ea-delivery/RichTextEditor.test.tsx, "replaces the '@query' a blur closed, until the editor is focused again": await waitFor(() => expect(editor.isFocused).toBe(true)) before fireEvent.blur.
- Failure message: expected '<p>see @Ado<span data-type="mention" …' to be '<p>see <span data-type="mention" …'.
