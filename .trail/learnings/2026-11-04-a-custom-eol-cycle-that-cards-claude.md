---
title: "A custom EOL cycle that cards link cannot be deleted, the same as the product"
author: Claude
date: 2026-11-04
branch: claude/blissful-goldberg-qnvh1z
cost: { minutes: 42, tokens: 570467 }
id: l-1c9a2227
scope: repo
status: active
src: agent
touches:
  - frontend/src/components/CustomEolProductDialog.test.tsx
  - frontend/src/components/CustomEolProductDialog.tsx
  - frontend/src/components/EolLinkSection.custom.test.tsx
  - frontend/src/features/admin/CustomEolFilterSidebar.test.tsx
  - frontend/src/features/admin/CustomEolFilterSidebar.tsx
  - frontend/src/features/admin/CustomEolProductsGrid.dialogs.test.tsx
  - frontend/src/features/admin/CustomEolProductsGrid.test.tsx
  - frontend/src/features/admin/EolCycleCellEditor.test.tsx
  - frontend/src/features/admin/SwitchToUpstreamDialog.test.tsx
  - backend/app/services/eol_custom_service.py
---

## Decided
The user chose: deleting a custom EOL cycle that any card links (visible or not) is refused with 409 `cards_linked` and the visible count, exactly like a product. The grid dialog explains and disables Delete, and suggests renaming the cycle, since a rename moves its cards.

## Tried and ruled out
Allowing the delete and leaving the cards' status "unknown" (the first design). It stranded links on a cycle that no longer existed: the switch to endoflife.date then 422'd ("Unknown custom cycle"), the product delete 409'd forever, and the API never names the hidden cards. Teaching the switch and the counts about orphan cycles was the alternative, but more code for a state nobody wants.

## Watch out
Counts also include links with no `eol_cycle` (filed under the cycle ""), so a product's `linked_cards` agrees with what blocks its delete.

In the code: `delete_cycle` / `linked_counts` in backend/app/services/eol_custom_service.py; dialog in frontend/src/features/admin/CustomEolProductsGrid.tsx.
