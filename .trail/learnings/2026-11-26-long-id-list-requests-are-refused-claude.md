---
title: "Long id-list requests are refused by our own edge nginx when a sign-in layer in front adds big headers, which is why the all-fields export failed on Azure"
author: Claude
date: 2026-11-26
branch: claude/sleepy-goldberg-g9yr3y
cost: { minutes: 2, tokens: 16880 }
id: l-660d0e2a
scope: repo
status: active
replaces: l-d7f694d1
src: agent
touches:
  - frontend/src/features/inventory/excelExport.ts
  - frontend/src/api/cardsByIds.ts
  - frontend/src/features/inventory/InventoryPage.tsx
  - frontend/nginx.conf
  - backend/tests/services/test_nginx_headers.py
---

## Decided
Issue #1445, cause confirmed by the reporter's response body: "400 Request Header Or Cookie Too Large" from nginx, carrying our edge security headers. It is the edge nginx we ship, not an Azure gateway. The export's relation request is a ~7.4 KB request line, which fills one of nginx's four default 8 KB header buffers; Azure App Service sign-in (Easy Auth) adds large token headers to every request, and the rest no longer fits. Short requests pass, so only the id-list requests fail. The export then dies silently because its call is not caught.
The owner chose the targeted fix for issue #1445: the edge nginx and the frontend's static nginx both take four 16 KB header buffers, a failed inventory export shows an error, and the docs tell people what to raise on a proxy we do not ship. Chunk sizes (200 ids) and the API stay as they are.

Four 16 KB buffers are enough because one buffer holds the longest id-list request line (under 8 KB) with 8 KB to spare, and each 16 KB buffer packs at least two 8 KB ones. So any header set that passed the old default with a short URL also passes with a full id-list URL. Checked on a local nginx: a 7.4 KB request line plus four 6 KB headers gives the reporter's exact 400 page with the default and 200 with the new value; a short URL passes on both.

## Tried and ruled out
- A record limit, and a cell over Excel's 32,767 characters: the failure is at the relation fetch, before anything is written.
- An Azure front end refusing the URL: the 400 page and headers are ours.
- Halving the id chunks: twice the requests on large exports and diagrams, and still no guarantee behind someone else's proxy.
- Card ids in a POST body: removes URL limits everywhere, but needs new read endpoints, permissions, API spec and MCP changes.
- An environment variable for the buffer size: every deployment template runs the same image, so a fixed value reaches them all with no template change.
- Eight buffers instead of four: only helps header sets the old default already refused, and doubles worst-case memory per connection.

## Watch out
- The 200-id chunk was sized against the 8 KB request-line limit (414) alone; it leaves no room for header growth, and the failure then shows as 400, not 414.
- Every chunked id-list GET shares this exposure (cards by ids, diagrams, MCP), not only the export.

In the code:
- Dockerfile: edge server blocks set no large_client_header_buffers (default 4 8k).
- frontend/src/features/inventory/excelExport.ts: RELATION_ID_CHUNK = 200; frontend/src/api/cardsByIds.ts: CARD_IDS_CHUNK = 200.
- frontend/src/features/inventory/InventoryPage.tsx: exportToExcel(...) called with no await / catch.
- The frontend's static nginx needs the same value: the edge forwards every client header to it.
- Text added inside the edge entrypoint must hold no dollar sign, double quote, backtick or backslash; the script runs with unset variables as errors.
- The MCP server runs plain uvicorn, which refuses a request head over 16 KB whatever nginx allows.

- Dockerfile (edge entrypoint, three server blocks) and frontend/nginx.conf: large_client_header_buffers 4 16k;
- backend/tests/services/test_nginx_headers.py: the guard for it.
- frontend/src/features/inventory/InventoryPage.tsx: export failures go to the cellEditError snackbar, key export.failed.
