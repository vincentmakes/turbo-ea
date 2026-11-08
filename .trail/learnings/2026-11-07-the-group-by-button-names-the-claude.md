---
title: "The Group by button names the tree layer Parent, chosen over Tree and Nested: an explicit word beats a shorter one, and the option sits first in the menu"
author: Claude
date: 2026-11-07
branch: claude/keen-johnson-0nz7ld
cost: { minutes: 4, tokens: 309021 }
id: l-9d5d4657
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - VERSION
  - docs/assets/img/ar/98c_inventory_group_by_parents.png
  - docs/assets/img/da/98c_inventory_group_by_parents.png
  - docs/assets/img/de/98c_inventar_gruppierung_eltern.png
  - docs/assets/img/en/98c_inventory_group_by_parents.png
  - docs/assets/img/es/98c_inventario_agrupacion_padres.png
  - docs/assets/img/fr/98c_inventaire_regroupement_parents.png
  - docs/assets/img/it/98c_inventario_raggruppamento_genitori.png
  - docs/assets/img/pt/98c_inventario_agrupamento_pais.png
---

## Decided
The Inventory Group by button reads "Group by: Parent" (tree alone) and "Group by: <axis> · Parent" (both layers), and the "Indent children under parents" checkbox is the first item in the menu, above "No grouping". The user wanted the label shorter but explicit, and picked Parent over the shorter alternatives: the word must say what the rows are indented by.

## Tried and ruled out
- "Tree" and "Nested" as the button word: shorter, but they describe the shape, not the relation; the user chose the explicit word.
- Keeping the item at the bottom of the menu: the user wants the layer option seen first, before the axis list.

## Watch out
- "Parent" is only one character shorter than "Parents", so the Inventory toolbar still wraps to a second row around 1280px when both layers are named on the button.

In the code:
- `frontend/src/i18n/locales/en/common.json`: `groupBy.buttonParents`, `groupBy.buttonActiveParents`.
- `GroupByMenuButton` in `frontend/src/components/grid/useRowGrouping.tsx`; position pinned by `GroupByMenuButton.test.tsx`.
