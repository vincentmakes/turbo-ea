---
title: "An inventory export that fails shows no message and no file; two things can make it fail, and the record count is not one of them"
author: Claude
date: 2026-11-26
branch: claude/sleepy-goldberg-g9yr3y
cost: { minutes: 2, tokens: 109356 }
id: l-d2bcb91e
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/inventory/InventoryPage.tsx
  - frontend/src/features/inventory/excelExport.ts
  - frontend/src/api/cardsByIds.ts
  - backend/app/api/v1/relations.py
  - frontend/xlsx-0.20.3.tgz
---

## Decided
Issue #1445 (open, cause not yet confirmed by the reporter): "Export → All fields" on ~2,000 cards produced no file and no error. There is no record limit: the inventory loads up to 10,000 cards and the export fetches relations 200 ids at a time. The owner was told the report cannot be closed as "not a bug" yet, and a reply was drafted asking for the browser console and Network tab, because the export is built in the browser and server logs do not show it.

What is verified:
- The export is started without being awaited or caught, so any failure inside it leaves no message and no download. This part is ours whatever the cause.
- The bundled spreadsheet library throws "Text length must not exceed 32767 characters" when the file is written if any one cell is longer than that (checked: 32,767 passes, 32,768 throws). Nothing in the export shortens or guards a cell. A card with about a thousand outgoing relations of one type, or a very long text field, would hit it.

What is only a candidate:
- A relation request refused before it reaches the backend. Each one is a ~7.4 KB URL, sized for the bundled nginx's 8 KB limit. The reporter runs on Azure App Service with an auth sidecar, so a front end with a smaller limit is possible. Not verified.

## Tried and ruled out
- Reading the reporter's server logs for the failure: they held only static-asset requests, Azure health-check pings and the backend startup, with no API lines at all.
- A limit on the number of cards: none exists on this path.

## Watch out
- A relation chunk that fails is thrown on purpose (half the relations is worse than none), so the fix for the silence belongs at the call site, not in swallowing the chunk error.
- "Current view" export is a separate, synchronous path; it writes through the same library, so the 32,767 limit applies to it too.
- A deployment described as "docker-compose" may be Azure App Service: look for [platform] lines, StartingAuthContainer and HealthCheck/1.0 in the logs.

In the code:
- frontend/src/features/inventory/InventoryPage.tsx: the "All fields" menu item calls exportToExcel(...) with no await / catch; page_size=10000 in loadData.
- frontend/src/features/inventory/excelExport.ts: RELATION_ID_CHUNK = 200, fetchRelationsForCards (throws on a failed chunk), enrichMissingCards (lenient), XLSX.writeFile in exportToExcel and exportCurrentViewToExcel.
- frontend/src/api/cardsByIds.ts: CARD_IDS_CHUNK = 200 and the 8 KB request-line reasoning.
- backend/app/api/v1/relations.py: MAX_CARD_IDS_PER_QUERY = 500.
- frontend/xlsx-0.20.3.tgz, xlsx.mjs write_ws_xml_cell: the 32767 check.
