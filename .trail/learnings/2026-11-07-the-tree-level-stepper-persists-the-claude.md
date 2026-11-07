---
title: "The tree level stepper persists the chosen level, not the collapsed set: chevron toggles stay session-only, the shown level is derived, and an active column fi…"
author: Claude
date: 2026-11-07
branch: claude/keen-johnson-0nz7ld
cost: { minutes: 47, tokens: 109559 }
id: l-6a9cb0fe
scope: repo
status: active
src: agent
touches:
  - docs/assets/img/ar/98c_inventory_group_by_parents.png
  - docs/assets/img/da/98c_inventory_group_by_parents.png
  - docs/assets/img/de/98c_inventar_gruppierung_eltern.png
  - docs/assets/img/en/98c_inventory_group_by_parents.png
  - docs/assets/img/es/98c_inventario_agrupacion_padres.png
  - docs/assets/img/fr/98c_inventaire_regroupement_parents.png
  - docs/assets/img/it/98c_inventario_raggruppamento_genitori.png
  - docs/assets/img/pt/98c_inventario_agrupamento_pais.png
  - docs/assets/img/ru/98c_inventarizatsiya_gruppirovka_roditeli.png
  - docs/guide/inventory.ar.md
---

## Decided
- The Inventory's − / + pill (no visible text, the catalogue's per-branch stepper look) steps the parent tree one depth level at a time. The displayed level is derived from the collapsed set (1 + the run of fully open depths), so a chevron click is reflected at once; only a stepper click writes the persisted level.
- What persists, like the filters, is the stepper's chosen level as a number (null = fully open): prefs, saved views (free-form bookmark `filters` JSON, no backend change) and the `group_tree_level=<n>` deep link, with the same precedence as `group_by` / `group_tree`. A new row list, an axis change or the tree being switched on re-applies it, which drops session-only chevron toggles.
- An active column filter keeps every branch open (hidden rows cannot be filter-tested, the same invariant groups already have); clearing the last filter re-applies the chosen level through a revision counter, after the layout was rebuilt without the filter's re-rooting.

## Tried and ruled out
- Persisting the collapsed id set: brittle across reloads and views, and a single manual collapse would reload as "level 1".
- Re-applying the level synchronously on filter clear: the layout at that moment still carries the filter's re-rooting, so the first rebuild would collapse the wrong parents.
- A one-shot "recompute" flag after a filter change: the filter's own model update consumes it before React re-renders.

## Watch out
- Depth and hasChildren in the tree info do not depend on the collapsed set, so the level effect can read this render's info ref; `collapsed` / `hiddenDescendants` do depend on it.
- A level saved deeper than the current data is clamped, so it simply shows everything.

In the code:
- `frontend/src/components/grid/rowGrouping.ts`: `treeLevelOf`, `collapsedParentsForLevel`, `normalizeTreeLevel`.
- `frontend/src/components/grid/useRowGrouping.tsx`: `tree.level` option, level-apply effect, `levelRev`, `treeLevel` return.
- `frontend/src/components/grid/TreeLevelStepper.tsx`; page state `groupTreeLevel` in `InventoryPage.tsx`; `groupTreeLevel` in `InventoryFilterSidebar.tsx` views.
