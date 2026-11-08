---
title: "LDV: take the dragged card out of its box, React Flow's drag copy goes stale"
author: Claude
date: 2026-11-08
branch: feat/ldv-lanes-and-flags
touches:
  - frontend/UI_GUIDELINES.md
  - frontend/e2e/dependency-view.spec.ts
  - frontend/src/features/reports/LayeredDependencyView.test.tsx
  - frontend/src/features/reports/LayeredDependencyView.tsx
  - frontend/src/features/reports/ldvLaneSizing.test.ts
  - frontend/src/features/reports/ldvLaneSizing.ts
---

## Decided
A dragged LDV card is taken out of its lane or aggregate box for the length of the drag (detachForDrag on onNodeDragStart: page position, no parentId/extent, box remembered in data.dragBoxId) and put back on onNodeDragStop (reattachAfterDrag, which refits once more). fitParentForDrag counts it at page position minus box position and never shifts it.

## Tried and ruled out
Refitting the box while the dragged card stays its child. React Flow (@xyflow/system XYDrag) keeps its own copy of a dragged node's position relative to its parent, emits a move only when a newly computed relative position differs from that copy, and writes the copy back on release. Moving the box's left/top origin and shifting the card under it made the copy stale: with extent parent a card pressed against the left edge read relative x 0 on every move, equal to the copy, so no move fired and the box stopped growing; on release the card jumped by the origin shift. Small (<7 px at fitted zoom) steps hid it, a 20 px step showed it every time.

## Watch out
The view tests call the drag handlers directly, so they can never see this: only a real drag in e2e/dependency-view.spec.ts does. Open such a spec's drag with two 1 px nudges: React Flow starts the drag on the first move past its 1 px threshold and measures the grab from there, so a 20 px opener leaves the card 20 px behind for the whole drag. Never move a dragged node's parent origin mid-drag without detaching the node first.
