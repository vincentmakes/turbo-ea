---
title: Sorting the PPM Gantt task list reorders the flat row array; the column headers read the sort from context so column widths survive a click
author: Claude
date: 2026-11-04
branch: claude/eager-meitner-w25eff
cost: { minutes: 16, tokens: 182780 }
id: l-8c20a01c
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/ppm/ppmGanttModel.ts
  - frontend/src/features/ppm/PpmGanttTab.tsx
---

## Decided
Discussion #1355 asked for sortable columns on the project Gantt's task list, sorted among siblings so the hierarchy holds. The chart library (@wamra/gantt-task-react 0.6.17) stable-sorts its input only by `displayOrder` (never set here), then buckets rows by `parent` in input order and walks the tree depth-first. So one stable sort over the whole flat row array orders every sibling group, and no child can leave its parent. No custom TaskListHeader and no per-parent grouping code is needed.
Clicks cycle asc → desc → off (off = the stored sort_order), one column at a time. Each key is what its cell shows: drawn start/end, status-derived % for tasks. Unassigned goes last both ways, the empty "+" row stays last, and the choice persists in localStorage `ppm.gantt.sort`. On a phone (Title + % only), a remembered sort on a hidden column is ignored.

## Tried and ruled out
Passing the sort state into the `columns` memo so each header's `title` node shows it. The library's `useTableListResize` copies `columns` into state and resets every width the user dragged whenever the prop changes identity, so a sort click would undo column resizes. The headers read the sort from a React context (`GanttSortContext`) instead, and the component test asserts `columns` keeps its identity across a click.

## Watch out
`Column.title` is a ReactNode, but the library stamps `data-testid="table-column-header-${title}"`, so with a node it reads `[object Object]`. Nothing relied on it.
A quick real-browser look at a component without the backend: a throwaway Vite root in the scratchpad that imports from `@/…`. It needs an ESM `vite.config.mjs` importing vite and plugin-react by absolute path, `fs.allow` covering frontend/, a `node_modules` symlink to frontend/node_modules, and `api.get` monkeypatched in main.tsx.

In the code: frontend/src/features/ppm/ppmGanttModel.ts (sortGanttRows, nextGanttSort, loadGanttSort/saveGanttSort); frontend/src/features/ppm/PpmGanttTab.tsx (GanttSortContext, SortableHeader, effectiveSort).
