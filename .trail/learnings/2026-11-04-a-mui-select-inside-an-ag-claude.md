---
title: "A MUI Select inside an AG Grid popup cell editor needs the ag-custom-component-popup class on its menu, not disablePortal"
author: Claude
date: 2026-11-04
branch: claude/blissful-goldberg-qnvh1z
cost: { minutes: 42, tokens: 570467 }
id: l-14733ce4
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
  - frontend/src/features/admin/EolCycleCellEditor.tsx
---

## Decided
A popup cell editor that contains a MUI `Select` passes `MenuProps={{ className: "ag-custom-component-popup" }}`. AG Grid ends a popup edit on any mousedown outside the popup unless an ancestor of the target carries that class (`isElementWithinCustomPopup` in ag-grid-community). The Select's menu is portalled to <body>, so without the class, picking an option ends the edit and commits the previous value. Found by a review; the grid tests stub AgGridReact, so no unit test can see it.

## Tried and ruled out
`disablePortal` (what the Autocomplete-based inventory cell editors use). For a Select the menu is a Modal; without a portal, MUI's aria-hidden pass hides the whole app root, the menu included, so the listbox and options become inaccessible. In tests even `getByRole("combobox")` stops finding the trigger.

## Watch out
Autocomplete uses a Popper, not a Modal, so `disablePortal` stays right there. The unit test can only pin that the listbox has the class as an ancestor. Whether a real grid keeps the edit open is a browser check.

In the code: frontend/src/features/admin/EolCycleCellEditor.tsx, `menuProps` on `MilestoneField` (frontend/src/components/CustomEolProductDialog.tsx).
