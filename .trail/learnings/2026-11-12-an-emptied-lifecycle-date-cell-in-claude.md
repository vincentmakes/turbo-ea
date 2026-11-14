---
title: An emptied lifecycle date cell in an Excel import clears that date; a missing lifecycle column leaves it alone; other value cells still ignore an empty cell
author: Claude
date: 2026-11-12
branch: claude/clever-davinci-jc62k6
cost: { minutes: 17, tokens: 172396 }
id: l-3876093d
scope: repo
status: active
src: agent
touches:
  - docs/guide/inventory.md
  - CHANGELOG.md
  - VERSION
  - frontend/src/features/inventory/ImportDialog.test.tsx
  - frontend/src/features/inventory/excelImport.execute.test.ts
  - frontend/src/features/inventory/excelImport.ts
  - frontend/src/features/inventory/excelImport.validate.test.ts
  - backend/app/api/v1/cards.py
---

## Decided
Issue #1393: a user emptied lifecycle date cells in an exported workbook and the import preview reported no change. Lifecycle columns now follow the rule relation and stakeholder columns already had: a column that is present with an empty cell clears that date, and a column that is absent from the sheet leaves the stored date untouched. An update row builds its lifecycle from the card's stored one, so a row whose dates were all emptied sends an empty lifecycle and the card ends up with none.

## Tried and ruled out
- Treating every empty cell as "clear" across the importer: for description, subtype, alias, external ID, parent label and attribute cells, "empty means leave alone" is deliberate (a comment and a test say so), so those were left as they are and the manual now states both rules.
- A backend change: the single-card update already replaces the lifecycle wholesale and accepts an empty one.

## Watch out
- Before the fix the bug only showed when a row was left with no lifecycle date at all; a row that kept one date already cleared the others. A test that empties one of several dates passes on the old code and proves nothing about the bug.
- The old code also wiped the dates of any lifecycle column missing from the sheet. That is gone, on purpose.
- An emptied tags cell still does not clear a card's tags. Same family, not decided yet.
- Column presence is read from the first row's keys, as for stakeholder columns. Real workbooks always carry every column there.

In the code:
- `frontend/src/features/inventory/excelImport.ts`: `lifecycleCols` next to `stakeholderCols` in `validateImport`, the lifecycle block that starts from `matchedExisting.lifecycle`, and the condition that attaches `data.lifecycle`.
- Tests: `excelImport.validate.test.ts` ("update classification"), `excelImport.execute.test.ts`, `ImportDialog.test.tsx`.
- Manual: `docs/guide/inventory.md`, "Lifecycle date cells" paragraph.
