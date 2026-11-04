---
title: "Principle references are numbered per instance and ADR imports are create-only drafts; button names in tests include the icon's ligature text"
author: Claude
date: 2026-11-03
branch: claude/confident-cerf-e9wmey
cost: { minutes: 29, tokens: 370374 }
id: l-0abeb36c
scope: repo
status: active
src: agent
touches:
  - docs/admin/audit-log.ar.md
  - docs/admin/audit-log.da.md
  - docs/admin/audit-log.de.md
  - docs/admin/audit-log.es.md
  - docs/admin/audit-log.fr.md
  - docs/admin/audit-log.it.md
  - docs/admin/audit-log.pt.md
  - docs/admin/audit-log.ru.md
  - docs/admin/audit-log.zh.md
  - docs/admin/metamodel.ar.md
---

## Decided
- EA principles carry a reference (P-001…), minted in one place for every writer (create route, catalogue import, demo seed, workspace applier, spreadsheet import). The highest number is found numerically, so P-1000 follows P-999; the ADR generator's string max() does not do this and breaks after ADR-999.
- Workspace transfer does NOT carry a principle's reference. Principles match on title, so the source's numbers could collide with numbers the target already uses. The applier numbers the rows it creates instead, which is why the column is nullable in the schema.
- The principles spreadsheet import upserts: it matches on reference, then on title ignoring case. A column absent from the sheet leaves that field untouched, and an empty cell clears it. This was the user's choice.
- The ADR spreadsheet import is create-only (also the user's choice). An existing reference is skipped and every other row becomes a draft through the shared create_decision. Status and signatories are never imported. A dry run passes publish=False, because event_bus.publish broadcasts to SSE immediately even when the transaction is later rolled back.
- related_decisions holds mixed shapes: ids from the MCP and the import, references from the demo seed, and dicts from the analysis commit flow. The export resolves ids and references to reference numbers and drops everything else.

## Watch out
- MaterialSymbol renders its icon name as ligature text, so an MUI Button's accessible name is "download Export", not "Export". Match it with a regex such as /^download Export$/ or /Import 2 rows/.
- grc.json is mostly nested (governance.decisions.*) while the risks.* keys at its end are flat. i18next resolves both, but new keys should go into the nested object they belong to.
- npm ci fails under the container's npm 10 because of a lock-file mismatch. CI uses Node 24 / npm 11, so run `npx -y npm@11 ci`.

In the code: backend/app/services/principle_service.py, backend/app/services/adr_import_service.py, workspace_io/schema.py (Principles skip_columns), migration 163, frontend/src/components/SpreadsheetImportDialog.tsx, frontend/src/lib/richTextCell.ts
