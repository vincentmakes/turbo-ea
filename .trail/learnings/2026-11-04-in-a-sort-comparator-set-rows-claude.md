---
title: "In a sort comparator, set rows with no value aside instead of ranking nulls inside it, or the mutation gate keeps a survivor no test can kill"
author: Claude
date: 2026-11-04
branch: claude/eager-meitner-w25eff
cost: { minutes: 9, tokens: 107672 }
id: l-b9605293
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/ppm/PpmGanttTab.test.tsx
  - frontend/src/features/ppm/ppmGanttModel.test.ts
  - frontend/src/features/ppm/ppmGanttModel.ts
  - CHANGELOG.md
  - VERSION
  - docs/guide/ppm.ar.md
  - docs/guide/ppm.da.md
  - docs/guide/ppm.de.md
  - docs/guide/ppm.es.md
  - docs/guide/ppm.fr.md
---

## Decided
A sort that has to put "no value" rows last (no responsible person, no data) filters those rows out, sorts the rest, and appends them. The null case is not ranked inside the comparator. Direction is applied as `asc ? cmp : -cmp`, not `cmp * sign`.

## Tried and ruled out
A null branch inside the comparator, `Number(a === null) - Number(b === null)`. On short arrays V8 sorts by binary insertion and always calls compare(later, earlier). Comparing a null row against a named row then gives the same placement whether the branch returns 1 or 0, so Stryker's `b.value === null -> true` mutant survives every input order. Permutation tests could not kill it.
`cmp * sign` with sign ±1 is equivalent to `cmp / sign`.
A `?? ""` fallback before a parse that rejects anything unknown is equivalent to any other literal there. `String(value)` removes the literal.

## Watch out
A numeric collator (`numeric: true`) orders integer strings exactly like numbers. Mutating a `typeof === "string"` branch to always use the collator survives integer fixtures. Fractional values kill it: the collator ranks "33.3" below "33.25".
To check a fix without running Stryker locally (which the repo forbids), hand-apply each reported survivor and re-run that one test file.

In the code: frontend/src/features/ppm/ppmGanttModel.ts sortGanttRows / loadGanttSort; survivors read from the CI run's `mutation-frontend.json` artifact (Frontend Mutation Tests job).
