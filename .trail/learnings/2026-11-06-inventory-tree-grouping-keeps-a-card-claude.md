---
title: "Inventory tree grouping keeps a card in its own group, stores depth and crumb in a side map off the grid context, and never clones leaf rows"
author: Claude
date: 2026-11-06
branch: claude/keen-johnson-0nz7ld
cost: { minutes: 62, tokens: 345244 }
id: l-7d0527ad
scope: repo
status: active
src: agent
touches:
  - scripts/screenshots/pages.ts
  - frontend/src/components/grid/rowGrouping.ts
  - frontend/src/components/grid/useRowGrouping.tsx
  - frontend/src/features/inventory/InventoryPage.tsx
  - docs/assets/img/en/98a_inventory_group_by.png
---

## Decided
- "Indent children under parents" is a second, cumulative layer inside the existing client-side row grouping, not a new grid mode. The option is a checkbox item inside the Group by menu (toggles without closing), Inventory-only; the hook feature is opt-in through one `tree` option so Risk Register and ADR grid are untouched.
- A card never leaves the group its own value puts it in. A child whose parent has another value, is hidden by a column filter, or is not loaded becomes a root of its group and shows its missing ancestors as a muted prefix (ids stored, names resolved at render so an inline rename shows at once). Chosen over "follow the parent" because the header count, header checkbox and Mass Edit must stay truthful for the triage workflow the grouping exists for.
- Tree info (depth, crumb ids, collapse) lives in a side map exposed as `context.getTreeInfo(id)`, and the hook forces `refreshCells` on the Name column when the map changes. Leaf rows are never cloned: a Name edit mutates the row in place with no reload, so a clone rebuilt from stale `data` would revert it.
- Ordering is done in `postSortRows` (forest order inside each group's already-sorted leaves) so a column sort applies among siblings; depth is computed pre-grid from the visible-id set collected under filters.
- Indentation only: padding per depth plus a chevron. No vertical guide lines (the user ruled them out on the mock).

## Tried and ruled out
- Cloning leaf rows with a `__tree` marker (like group headers): reverts in-place Name edits on the next rebuild.
- Reusing `lib/cardTree.buildChildIndex`: it sorts siblings by name, which would override the grid's sort.
- A one-shot "recompute visible ids" flag after a filter clears collapsed parents: the filter's own model update consumes it before React re-renders; the hook instead re-collects whenever the row list changed since the last collection.

## Watch out
- `trail check` flags the changelog line as a conflict with the Oct 19 "child card parent" learning: a word-level match, not a real one.
- The demo seed gives parents to Business Processes, Capabilities, Organizations and Initiatives, never to Applications: pick those types for any screenshot of the tree.
- The group header row is `visibility: hidden` while its sticky copy exists; a Playwright click on a group chevron must target `.tea-group-sticky-host`, or use `expand_group=` in the URL.
- A longer "Group by: X · Parents" label wraps the Inventory toolbar sooner at 1280px (the Create button drops to a second row).

In the code:
- `frontend/src/components/grid/rowGrouping.ts`: `buildTreeLayout`, `forestOrder`, `glueGroups(nodes, axis | null, parentIdOf?)`, `GroupInfo.treeHidden`.
- `frontend/src/components/grid/useRowGrouping.tsx`: `tree` option, `getTreeInfo` / `toggleParentCollapse` on `GroupRowContext`, `GroupByMenuButton`'s `tree` prop.
- `frontend/src/features/inventory/InventoryPage.tsx`: `TreeNameFrame`, `groupTree` pref, `group_tree=1` URL param, `[data-tree-toggle]` guard in `onRowClicked`.
- Screenshot entry `98c_inventory_group_by_parents` on `/inventory?type=BusinessProcess&group_by=attr_processType&group_tree=1`.
