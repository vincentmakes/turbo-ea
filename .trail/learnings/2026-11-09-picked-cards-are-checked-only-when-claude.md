---
title: "Picked cards are checked only when a view is saved; a draft's unfilled condition is left out of the preview; a new query view clears the active filters after c…"
author: Claude
date: 2026-11-09
branch: claude/confident-curie-tyo9qq
cost: { minutes: 42, tokens: 166937 }
id: l-8166db8b
scope: repo
status: active
replaces: l-c4caf9bc
src: agent
touches:
  - frontend/src/features/inventory/InventoryFilterSidebar.test.tsx
  - frontend/src/features/inventory/InventoryFilterSidebar.tsx
  - frontend/src/features/inventory/InventoryPage.test.tsx
  - frontend/src/features/inventory/InventoryPage.tsx
  - frontend/src/features/inventory/viewApply.test.ts
  - frontend/src/features/inventory/viewApply.ts
  - frontend/src/i18n/locales/ar/inventory.json
  - frontend/src/i18n/locales/da/inventory.json
  - frontend/src/i18n/locales/de/inventory.json
  - frontend/src/i18n/locales/en/inventory.json
---

## Decided
- A query node can name specific cards, on the start card and at every hop, with an "include sub-cards" switch (hierarchical types only; refused elsewhere). Card ids and tag ids are the only ids the grammar carries; both follow the workspace transfer's id maps.
- Existence, type and read-scope checks on picked cards run only when a view is saved (the writer's scope). Reading a view checks nothing: an unknown, wrong-type or hidden pick matches no row, so a reader cannot tell a hidden card from a missing one. A collaborator editing a shared view keeps the owner's existing picks; only newly added ids are checked against the editor's scope.
- On import, a negated hop whose picks all vanish is removed; a positive hop just loses the condition. A dropped pick widens a view, never narrows it silently.
- While a query is being built, a condition that has no value yet is left out of the preview request and the rest of the chain is still sent. The earlier behaviour (dropping the whole query and showing every card of the type) read as "an empty condition matches everything".
- Starting a new query view clears the active facets and column filters so the grid shows exactly what the chain matches; a confirmation appears only when something is active, Cancel on that draft restores them, saving keeps the clean slate, and the pencil on an existing view clears nothing.

## Tried and ruled out
- Checking picks with the reader's scope on every read: a shared view would fail to open for a reader who cannot see one of the owner's picks.
- Checking existence on read without scope: a 400 for a missing card next to a 200 for a hidden one is an oracle.
- Sending no query while a condition is empty: the grid showed everything and the count lied.

## Watch out
- Card names on the strip come from one fetch per strip mount through the shared by-ids fetcher; withheld ids render as "(hidden card)".
- The card picker opens from inside the condition popover on purpose; closing the popover first would delete the still-empty condition.

In the code:
- `backend/app/services/card_query.py` (`_card_ids`, `trusted_card_ids`, `descendants_without_hierarchy`), `rewrite_card_query_ids` in `workspace_io/remap.py`.
- Frontend: `sendableQuery`, `emptyFilters`, `hasActiveFacets` in `features/inventory/queryDraft.ts` / `viewApply.ts`; the confirm dialog and `draftRestoreRef` in `InventoryPage.tsx`.
