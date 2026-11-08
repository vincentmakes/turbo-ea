---
title: "LDV lanes shrink back to their laid-out size, and that base lives on the box"
author: Claude
date: 2026-11-08
branch: feat/ldv-lanes-and-flags
touches:
  - CHANGELOG.md
  - docs/guide/reports.ar.md
  - docs/guide/reports.da.md
  - docs/guide/reports.de.md
  - docs/guide/reports.es.md
  - docs/guide/reports.fr.md
  - docs/guide/reports.it.md
  - docs/guide/reports.md
  - docs/guide/reports.pt.md
  - docs/guide/reports.ru.md
---

## Decided
- A Layered Dependency View lane or aggregate box is refitted on every drag move to the union of its laid-out rectangle and the bounding box of ALL its cards plus insets (`fitParentForDrag` / `fitBox` / `applyBoxFit`, `frontend/src/features/reports/ldvLaneSizing.ts`). It grows as a card is dragged against an edge and shrinks back as the card is moved back (asked for by the maintainer after testing the grow-only version), never below the laid-out size.
- The floor is the laid-out size, not a tight fit: each lane carries `DRAG_ROOM` (56 px) of spare width on purpose, and a tight fit would remove it the moment any card was touched.
- The laid-out rectangle is stored on the box as `data.fitBase`, relative to the box's own origin, and offset by every origin move. It cannot be read from the layout's `builtNodes` because lanes are draggable, which makes their layout coordinates stale. A re-layout or Reset view rebuilds the nodes and drops it.

## Tried and ruled out
- Fitting to the dragged card only: pulling one card back would cut off another card dragged out earlier.
- A guard in the view's `handleNodeDrag` skipping non-card nodes: dead code (the mutation run showed it), since `fitParentForDrag` returns the same array for a lane or a card with no box, and React drops that update.

## Watch out
- Write the origin shift as `0 - x0`, not `-x0`: negating a zero origin gives `-0`, which leaks into node positions and fails `toEqual`.
- MUI `sx` styles are computed under jsdom, so `toHaveStyle` on a component's colours and sizes really asserts. Render under `createTheme({ palette: { mode: "dark" } })` to pin a dark-mode branch.
