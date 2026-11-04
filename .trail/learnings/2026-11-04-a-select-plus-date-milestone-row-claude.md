---
title: "A select-plus-date milestone row needs 170px for the date, and a MaterialSymbol ligature is part of a button's accessible name"
author: Claude
date: 2026-11-04
branch: claude/blissful-goldberg-qnvh1z
cost: { minutes: 74, tokens: 1001900 }
id: l-1104f5f5
scope: repo
status: active
src: agent
touches:
  - frontend/src/i18n/locales/ar/admin.json
  - frontend/src/lib/eolContribution.test.ts
  - frontend/src/lib/eolContribution.ts
  - CHANGELOG.md
  - backend/app/api/v1/eol.py
  - backend/app/services/eol_custom_service.py
  - backend/app/services/extensions/data_service.py
  - backend/tests/api/test_eol_custom_products.py
  - backend/tests/services/test_extension_eol_bridge.py
  - docs/admin/eol.ar.md
---

## Decided
- A milestone (Active support / End of life) is a select plus a date input in one wrapping flex row, both `flex: 1 1 170px` (what `SafariDateField` and the native date input need with their buttons); in the two-column cycle grid each milestone spans the whole row (`gridColumn: "1 / -1"`). In a narrow container (the grid's popup editor, a phone) the date wraps under the select instead of being squeezed. The screenshot that caught it showed "dd/ı" and "1 ×" in ~74px dates.
- The date field is labelled by kind ("Supported until", "End of life on"), never "Date" beside an option also called "Date"; the option reads "On a date…".
- A form's problems go on the field at fault (`error`/`helperText`), shown once the row was edited, never a banner before the user typed anything.

## Watch out
- `MaterialSymbol` renders the icon name as text, so an icon button's accessible name is "auto_awesome Suggest with AI": match `{ name: /Suggest with AI/ }`, never the exact string.
- A page that keeps state in `window.location` (the EOL sub-tab) leaks it between tests in one file: reset with `history.replaceState` in `beforeEach`.
- Playwright's `fill` on a date input does not blur, and the DateField commits on blur: a screenshot taken right after shows no validation on that field.

In the code: `MilestoneField` / `CycleFields` in frontend/src/components/CustomEolProductDialog.tsx; EolAdmin.custom.test.tsx.
