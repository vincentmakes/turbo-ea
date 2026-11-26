---
title: The inventory all-fields export fails silently behind Azure App Service because its long relation request is refused with a 400 before it reaches our API
author: Claude
date: 2026-11-26
branch: claude/sleepy-goldberg-g9yr3y
cost: { minutes: 2, tokens: 25834 }
id: l-d7f694d1
scope: repo
status: active
replaces: l-d2bcb91e
src: agent
touches:
  - frontend/src/features/inventory/InventoryPage.tsx
  - frontend/src/features/inventory/excelExport.ts
  - frontend/src/api/client.ts
  - backend/app/api/v1/relations.py
---

## Decided
Issue #1445: "Export → All fields" gave no file and no message on ~2,000 cards. The reporter's console shows the first relation request answered 400, and the export stopping there. The 400 is not ours: the message shown was the bare "Bad Request", and our only 400 on that request (more than 500 ids) carries a full sentence, while the export sends 200 ids. So a layer in front of the backend refused it. The site runs on Azure App Service (azurewebsites.net, auth sidecar), not the bundled stack. Which layer is still unknown; the body and Server header of the 400 would say.

The owner was told this is a compatibility gap to fix on our side, plus the missing error message: the id list rides in a ~7.4 KB URL sized for the bundled nginx only.

## Tried and ruled out
- A record limit: none exists (10,000 cards load, relations go 200 ids at a time).
- A cell over Excel's 32,767 characters as the cause here: the failure is at the relation fetch, before anything is written. The library does throw on such a cell and nothing guards it, so it remains a separate latent risk.
- The reporter's server logs: static assets, health pings and startup only.

## Watch out
- A failed relation chunk is thrown on purpose, so surface the error at the call site; do not swallow it.
- An error whose message is only the status phrase means the body had no `detail`: a proxy answered, not FastAPI.

In the code:
- frontend/src/features/inventory/InventoryPage.tsx: "All fields" menu item calls exportToExcel(...) with no await / catch.
- frontend/src/features/inventory/excelExport.ts: RELATION_ID_CHUNK = 200, fetchRelationsForCards.
- frontend/src/api/client.ts: the `fallback` message in request().
- backend/app/api/v1/relations.py: MAX_CARD_IDS_PER_QUERY = 500.
