---
title: "Inventory preview panel, search on Back and portfolio subtype filter (#1287 #1289 #1294): what the review settled"
author: Claude
date: 2026-10-21
branch: feat/inventory-report-quick-wins
cost: { minutes: 58, tokens: 1464290 }
touches:
  - CHANGELOG.md
  - VERSION
  - docs/guide/inventory.ar.md
  - docs/guide/inventory.da.md
  - docs/guide/inventory.de.md
  - docs/guide/inventory.es.md
  - docs/guide/inventory.fr.md
  - docs/guide/inventory.it.md
  - docs/guide/inventory.md
  - docs/guide/inventory.pt.md
---

## Decided
- A side panel that must leave the page usable (the Inventory card preview, #1289) is `<Portal><Drawer variant="persistent">`, never a temporary Drawer with `hideBackdrop` + `disableEnforceFocus` + `disableScrollLock`. A temporary Drawer is a Modal, and a Modal marks every sibling of its portal `aria-hidden` whatever props it gets, so the page would stay clickable but vanish from screen readers. `CardDetailSidePanel` takes an opt-in `nonModal` prop; every other caller and the extension SDK keep the modal drawer.
- The persistent variant has no Escape handling of its own: close on an Escape keydown that started inside the panel and was not `defaultPrevented`, so AG Grid behind it keeps its own Escape. `slotProps.transition: { mountOnEnter, unmountOnExit }` (MUI 6.5) keeps the content unmounting on close as the modal one does.
- The inventory search effect (`InventoryPage.tsx`, the `?search=` sync) acts only when `searchParams.has("search")`: Back from a card is `navigate(-1)` onto a bare `/inventory`, and typing never writes the param, so "no param" must not read as "search cleared" (#1287).
- The portfolio subtype filter (#1294) is the card`s own `subtype` (`subtypeFilters` on `FilterState`), distinct from `relSubtypeFilters`, which filters relation attributes. It rides the shared `FilterSelect`, whose built-in "(empty)" is `__empty__`, the same sentinel the inventory reads on `?subtype=`.

## Tried and ruled out
- Hiding the backdrop and relaxing focus on the temporary Drawer: the first test caught the page being `aria-hidden`.
- Deleting a duplicated test line with `sed /pattern/d`: it also deleted two identical `waitFor` lines in unrelated tests; review caught it.

## Watch out
- `trail check` flags word-level matches ("key card type", "mock api", "user click") as conflicts with learnings about unrelated topics; read the named learning before treating one as real.
- `labels.notSet` in `common.json` is new in 2.173.0 (only `lifecycle.notSet` / `groupBy.notSet` existed before); the single-select editors keep `labels.none`, only the yes/no editor says Not set (#1266).
