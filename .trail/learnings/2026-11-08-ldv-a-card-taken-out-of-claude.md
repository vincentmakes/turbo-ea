---
title: "LDV: a card taken out of its box needs a z-index for the drag"
author: Claude
date: 2026-11-08
branch: feat/ldv-lanes-and-flags
touches:
  - CHANGELOG.md
  - frontend/e2e/dependency-view.spec.ts
  - frontend/src/features/reports/LayeredDependencyView.test.tsx
  - frontend/src/features/reports/LayeredDependencyView.tsx
  - frontend/src/features/reports/ldvDiagramExport.test.ts
  - frontend/src/features/reports/ldvDiagramExport.ts
  - frontend/src/features/reports/ldvLaneSizing.test.ts
  - frontend/src/features/reports/ldvLaneSizing.ts
  - frontend/src/features/reports/ldvObstacles.test.ts
  - frontend/src/features/reports/ldvObstacles.ts
---

## Decided
A card taken out of its LDV box for a drag (detachForDrag) is lifted to zIndex DRAGGED_CARD_Z (1000) and the zIndex is removed again on reattach; no layout sets a zIndex, so removing it restores the card exactly. The detach is committed with flushSync in onNodeDragStart so React Flow's store has the card without a parent before the next pointer move.

## Tried and ruled out
Detaching without a zIndex. React Flow draws a child at parent z + 1 (z 1 for a card in a lane) and a top-level node at z 0, so the detached card slid under every card of every lane it crossed; found by dragging the SAP card into the Technical lane and checking elementFromPoint at the pointer.

## Watch out
Anything that takes a node out of its parent mid-interaction changes its stacking order as well as its coordinates. Only a real browser shows it: jsdom never computes React Flow's z.
