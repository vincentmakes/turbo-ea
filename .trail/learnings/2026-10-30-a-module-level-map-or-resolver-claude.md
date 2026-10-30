---
title: "A module-level map or resolver is tested by loading the module inside the test, or Stryker never runs that test against it"
author: Claude
date: 2026-10-30
branch: claude/echarts-bpm-ppm
cost: { minutes: 221, tokens: 1941836 }
id: l-e6ae5a60
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/bpm/BpmDashboard.test.tsx
  - frontend/src/features/bpm/BpmnTemplateChooser.test.tsx
  - frontend/src/features/bpm/ProcessAssessmentPanel.test.tsx
  - frontend/src/features/bpm/ProcessFlowTab.branches.test.tsx
  - frontend/src/features/bpm/ProcessNavigator.part1.mutation.test.tsx
  - frontend/src/features/bpm/ProcessNavigator.tsx
  - frontend/src/features/bpm/bpmChartOptions.test.ts
  - frontend/src/features/bpm/bpmChartOptions.ts
  - frontend/src/features/bpm/processNavigatorState.test.ts
  - frontend/src/features/bpm/useBpmFieldOptions.ts
---

## Decided
The unit test of a value built while a module loads (a colour map, a label table, a resolver made at module level or in a describe body) loads the module freshly inside the test body (`vi.resetModules()` then `await import(...)`), the way `tokens.test.ts` and `turboeaModdle.test.ts` do. Stryker runs with `ignoreStatic`, and its per-test coverage credits a module-level initialiser only to tests that executed the module load inside their body. A static `import` at the top of the test file runs during collection, outside any test, so a `toEqual` there never runs against those mutants; they go to whichever component test re-imported the module (via `vi.resetModules()` and a dynamic import) and survive there.

## Tried and ruled out
Asserting the map with `toEqual` through a static import: the test passed and killed nothing. 19 of 24 changed-line mutants on `processNavigatorState.ts` survived under a 97% module floor while the file's own test pinned every label and colour.

## Watch out
A describe body runs at collection time too: `const color = scaleColor(...)` at describe level is static; build it inside each `it`. And a test file that calls `vi.stubEnv("TZ", …)` anywhere is left out of Stryker entirely (`vitest.stryker.config.ts` scans for it), so a module whose only tests sit in such a file scores as if untested; keep the timezone-pinned suites in their own file (`useDateFormat.timezone.test.ts`).

In the code:
- `frontend/src/features/bpm/processNavigatorState.test.ts` (`freshState()`), `frontend/src/features/bpm/bpmChartOptions.test.ts` (`scaleColor` describe), `frontend/src/hooks/useDateFormat.timezone.test.ts`
- `frontend/stryker.config.json` `ignoreStatic: true`; `scripts/mutation/floors.toml` `[modules]`
