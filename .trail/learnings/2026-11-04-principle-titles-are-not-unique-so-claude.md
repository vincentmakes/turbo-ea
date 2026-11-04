---
title: "Principle titles are not unique, so the importer contests a title only when a row would write it; ConfigSection.skip_columns is read by nothing"
author: Claude
date: 2026-11-04
branch: claude/confident-cerf-e9wmey
cost: { minutes: 59, tokens: 1531502 }
id: l-42b8a7f6
scope: repo
status: active
src: agent
touches:
  - docs/admin/metamodel.md
  - frontend/src/components/SpreadsheetImportDialog.test.tsx
  - frontend/src/components/SpreadsheetImportDialog.tsx
  - frontend/src/features/admin/principles/principleSpreadsheet.test.ts
  - frontend/src/features/admin/principles/principleSpreadsheet.ts
  - frontend/src/features/ea-delivery/adrSpreadsheet.test.ts
  - frontend/src/features/ea-delivery/adrSpreadsheet.ts
  - frontend/src/features/grc/risk/riskImport.ts
  - frontend/src/i18n/locales/en/admin.json
  - frontend/src/i18n/locales/en/common.json
---

## Decided
- Nothing enforces unique principle titles (the create route, the catalogue import and workspace transfer can all produce two principles with one title). The spreadsheet importer therefore keeps a title → list of holders index and only checks a title for conflicts when the row would write it: a rename or a create. A row that keeps its own title never conflicts, so an untouched export re-imports as all skipped. A title-only row that matches two principles fails as ambiguous and asks for the reference.
- ADR references are now counted numerically in the one generator every writer uses; the string max() answered ADR-999 forever once ADR-1000 existed.
- The ADR importer links ACTIVE cards only, looked up once per file — the same set the card picker offers.

## Tried and ruled out
- A last-wins title index with a plain "another principle holds this title" check: it refused rows of an unchanged export whenever two principles shared a title (the review's first finding).

## Watch out
- `ConfigSection.skip_columns` in workspace_io/schema.py has no consumer anywhere; a column stays out of a bundle only by being absent from `columns`. The three pre-existing declarations are dead configuration too.
- "Row N" in the import dialogs is now the Excel row: SheetJS stamps each parsed row with a non-enumerable `__rowNum__` (0-based, header = 0), which readSheetRows carries as `sheetRow`.

In the code: backend/app/services/principle_service.py (import_principle_rows), backend/app/services/adr_service.py (next_reference_number), backend/app/services/adr_import_service.py (_cards_by_name), frontend/src/lib/sheetRows.ts
