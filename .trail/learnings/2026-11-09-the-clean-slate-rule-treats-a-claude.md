---
title: The clean-slate rule treats a selected card type as a filter; the start type is always chosen in the strip
author: Claude
date: 2026-11-09
branch: claude/confident-curie-tyo9qq
cost: { minutes: 13, tokens: 222980 }
id: l-215ae38d
scope: repo
status: active
replaces: l-8166db8b
src: agent
touches:
  - frontend/src/features/inventory/viewApply.ts
  - frontend/src/features/inventory/InventoryPage.tsx
  - frontend/src/features/inventory/InventoryPage.test.tsx
  - frontend/src/features/inventory/viewApply.test.ts
  - docs/guide/inventory.md
---

## Decided
- The user corrected the earlier exception: with only a card type selected, New query view used to ask nothing and keep that type as the start type. Now a selected type counts as a filter like any other: New query view asks first, Start clears everything (the type too) and the strip opens on "Choose a type". The start type is always chosen in the strip.
- Any active state (a selected type, a facet, a grid column filter) shows the confirmation; with nothing active the draft opens straight away, also on "Choose a type". Saving keeps the clean slate, and the pencil on an existing view clears nothing.

## Tried and ruled out
- Keeping a single selected type as the start type of a new draft: the user expected the confirmation and an empty chooser, not a draft that silently took over whatever type happened to be selected.

## Watch out
- Cancel on a new draft must restore the type as well as the facets and column filters: the snapshot in `draftRestoreRef` is the whole filter state, taken before anything is cleared.
- Picked cards are checked only when a view is saved (the writer's scope); reading a view checks nothing.
- A condition with no value yet is left out of the preview request; the rest of the chain is still sent.
- Card names on the strip come from one fetch per strip mount through the shared by-ids fetcher; withheld ids render as "(hidden card)".

In the code:
- `hasActiveFacets` in `frontend/src/features/inventory/viewApply.ts` (its first clause is `filters.types.length > 0`).
- `beginQueryDraft` and `draftRestoreRef` in `frontend/src/features/inventory/InventoryPage.tsx`: a new draft is always `{ query: { type: "" }, viewId: null }`.
