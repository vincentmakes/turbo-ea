---
title: "LDV lanes grow with their cards but have no manual resize, and relation values stay off diagram edges"
author: Claude
date: 2026-11-07
branch: feat/ldv-lanes-and-flags
touches:
  - CHANGELOG.md
  - docs/guide/diagrams.ar.md
  - docs/guide/diagrams.da.md
  - docs/guide/diagrams.de.md
  - docs/guide/diagrams.es.md
  - docs/guide/diagrams.fr.md
  - docs/guide/diagrams.it.md
  - docs/guide/diagrams.md
  - docs/guide/diagrams.pt.md
  - docs/guide/diagrams.ru.md
---

## Decided
- Layered Dependency View lanes and aggregate boxes grow as a card is dragged against their edge (#1295): cards keep `extent: "parent"`, the view's `onNodeDrag` runs `growParentForDrag` (`ldvLaneSizing.ts`), and the grown size goes on `width`/`height`, `measured` and `style`. Read a box's size through `boxSize`. Create diagram exports the grown size; Reset view restores the automatic one.
- There is deliberately NO manual resize handle on a lane or box. The maintainer reviewed a version with right-edge, bottom-edge and corner `NodeResizeControl`s and dropped it: a hand-set size lasts only until the next re-layout, like a card position, and the handles were chrome on every lane.
- Ticked yes/no attributes join single-select values in the LDV's "Show relationship values" suffix (#1285), e.g. `CRUD [Create · Read]`, via `relationAttributeSuffix` in `lib/relationAttributeBadges.ts`. This stays LDV-only: diagram edges keep the bare forward verb.

## Tried and ruled out
- Bracketed values on diagram edges, both hand-drawn (relation picker) and expanded (+ / Expand). The label is stored in the diagram XML, so it cannot follow a later attribute change in the inventory, unlike the LDV, which computes it live behind its toggle. Dropped by the maintainer; `relationEdge.ts` was removed and `DiagramEditor.tsx` is unchanged from main.

## Watch out
- In this cloud container the frontend build runs out of memory on main as well as on any branch: Node gets a 2 GB default heap here. Build with `NODE_OPTIONS=--max-old-space-size=6144 npm run build`; CI's runners need nothing.
- The local npm 10 refuses `npm ci` on the current lockfile (it is resolved by CI's Node 24 npm). Install with `npx --yes npm@11 ci` instead of editing the lockfile. A worktree that symlinks another checkout's `node_modules` goes stale as soon as main bumps dependencies.
