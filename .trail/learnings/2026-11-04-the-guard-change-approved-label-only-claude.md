---
title: The guard-change-approved label only covers the commits it was applied on; a push after approval needs it re-applied
author: Claude
date: 2026-11-04
branch: claude/guard-ratchet
cost: { minutes: 11, tokens: 174400 }
id: l-389e7d5b
scope: repo
status: active
src: agent
touches:
  - ".github/workflows/guard-ratchet.yml"
  - backend/tests/core/test_guard_ratchet.py
  - scripts/guard_ratchet.py
  - ".github/SECURITY_PIPELINE.md"
  - ".github/workflows/ci.yml"
  - CLAUDE.md
  - CONTRIBUTING.md
---

## Decided
The Guard Ratchet's override label is honoured only when its last application is later than the head commit's committer date. Without that, a maintainer labels once and every later push passes with warnings, which defeats the point of a check meant to stop an agent loosening a guard when stuck. The cost is that any new head commit, including an "Update branch" merge or a rebase, invalidates the label and the maintainer removes and re-applies it. That is the conservative side and was chosen deliberately.

A `--fail-under=0` entry in the CI workflow is an informational report, not a bar, so the ratchet no longer reports its removal (or a job rename that drops it) as a lowered floor.

## Tried and ruled out
Binding the approval to a head SHA stored somewhere: GitHub labels carry no payload, and a comment would mean an agent writing on GitHub. Comparing timestamps against the PR's event log needs nothing new.

## Watch out
The ratchet compares the merge of the PR into its base with the base, so a stale branch does not change its findings; "needs rebase" is only the branch-protection up-to-date rule.

A backslash inside an f-string expression is Python 3.12-only (PEP 701). The backend declares 3.11 as its minimum, and CI runs 3.12, so this only shows up for a contributor on 3.11 as an import error of the test module. Keep escapes outside the f-string.

Detecting a guard test by the `source_scan` substring pulls in whole files that mention the marker once (an API test with two marked tests, a 43-test theme test with one source-scan block), so deleting an unrelated test there needs the label. Accepted noise; tightening it to the real marker is a follow-up.

In the code:
- `.github/workflows/guard-ratchet.yml`, step "Who applied the approval label": `applied_at` from the event log's `created_at` vs `git log -1 --format=%ct "$HEAD_SHA"`.
- `scripts/guard_ratchet.py`: `compare_floors` skips a removed floor when `old == 0`; `_cell()` holds the `|` escape.
- `backend/tests/core/test_guard_ratchet.py::test_removing_an_informational_zero_floor_passes`.
- Local run without the DB fixtures: `pytest tests/core/test_guard_ratchet.py --noconftest -p no:cacheprovider`.
