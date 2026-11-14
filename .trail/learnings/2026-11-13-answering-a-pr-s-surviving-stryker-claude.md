---
title: "Answering a PR's surviving Stryker mutants: where the full list is, and what a pragma really suppresses"
author: Claude
date: 2026-11-13
branch: claude/hopeful-meitner-zpu254
cost: { minutes: 154, tokens: 1603977 }
id: l-708c94a1
scope: repo
status: active
src: agent
touches:
  - frontend/src/components/charts/printCopy.ts
  - frontend/src/components/charts/printCopy.test.tsx
  - frontend/src/features/ppm/PpmRiskGrid.tsx
  - backend/tests/services/test_mutation_pragmas.py
  - scripts/mutation/gate.py
  - ".github/workflows/ci.yml"
---

## Decided
PR #1402 left 563 surviving mutants in the PPM report, report export / print, risk grid, risk import and schedule / cost files. The job log of `Frontend Mutation Tests` names only the first 50 (`SUMMARY_SURVIVOR_LIMIT` in `scripts/mutation/gate.py`); the full list is the run's `mutation-frontend` artifact (`mutation-frontend.json`: file, line, mutator id, replacement, status), downloaded through the Actions artifact link. Every survivor ends as one of three things: a test that kills it; a presentation pragma, where the static styles of a file are gathered into one constant block (`*_SX` / `SX` / `DRAWER_PAPER_PROPS`) wrapped in `// Stryker disable all: <reason>` ... `// Stryker restore all`; or an equivalent-mutant next-line pragma naming its mutators and why. A test that pins odd behaviour only to kill a mutant is the wrong answer: the "rgb() with a fourth part is opaque" case in printCopy.test.tsx read like a bug and was replaced by an equivalent-mutant pragma (getComputedStyle never serialises a comma-form rgb() / hsl() with an alpha).

## Tried and ruled out
- Listing all 563 survivors in the PR description by hand: the artifact is the record; the PR names the groups and the per-file pragma counts.
- A pragma on every `sx` line: dozens of one-line pragmas for the same reason; one constant block per file says it once.

## Watch out
- A module-level constant can survive although tests assert it, when another test re-imports the module (`vi.resetModules()` + `await import()`): Stryker's per-test coverage then credits the constant to the re-importing test only. A test that loads the module fresh and asserts on the constant kills it (see the "print copy's classes" case in printCopy.test.tsx).
- A next-line pragma names mutators, not mutants: it also drops already-killed siblings of that mutator on the same line from the score. Split the line when that matters.
- Hand-applying a mutant is a fair spot check (apply, run the one test file, revert), but keep the backup outside the repo so nothing stray gets committed.
- The pragma guard (`backend/tests/services/test_mutation_pragmas.py`, reason format `// Stryker disable next-line A,B: reason`) lives in the backend test tree, so CI skips it on a frontend-only PR: run it by hand (`pytest --noconftest`; it needs `libcst`).
- A mutant that makes a loop endless is reported as Timeout and counts as killed.

In the code: frontend/src/components/charts/printCopy.ts (isOpaqueColour pragma), frontend/src/features/ppm/PpmRiskGrid.tsx (SX block), scripts/mutation/gate.py (SUMMARY_SURVIVOR_LIMIT), .github/workflows/ci.yml (mutation-frontend artifact), backend/tests/services/test_mutation_pragmas.py. Commands: `python scripts/guard_ratchet.py --base origin/main` (new pragmas are notices, not blocking).
