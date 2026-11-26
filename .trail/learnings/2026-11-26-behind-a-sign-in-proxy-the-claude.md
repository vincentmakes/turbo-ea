---
title: "Behind a sign-in proxy the nginx we ship takes four 16 KB header buffers, the MCP server a 64 KB request head, and an export that cannot be written says why"
author: Claude
date: 2026-11-26
branch: claude/sleepy-goldberg-g9yr3y
cost: { minutes: 51, tokens: 292054 }
id: l-ccd1490b
scope: repo
status: active
replaces: l-660d0e2a
src: agent
touches:
  - CHANGELOG.md
  - Dockerfile
  - VERSION
  - backend/tests/services/test_nginx_headers.py
  - docs/admin/kubernetes.ar.md
  - docs/admin/kubernetes.da.md
  - docs/admin/kubernetes.de.md
  - docs/admin/kubernetes.es.md
  - docs/admin/kubernetes.fr.md
  - docs/admin/kubernetes.it.md
---

## Decided
Issue #1445: on Azure App Service with platform sign-in, the inventory all-fields export gave no file and no message. Our own edge nginx refused its long card-id request (a request line of about 7.4 KB) with "400 Request Header Or Cookie Too Large", because the sign-in layer adds large token headers and cookies to every request and nginx's default of four 8 KB header buffers could not hold both. The owner chose the targeted fix:

- The edge nginx and the frontend's static nginx take four 16 KB header buffers. One buffer holds the longest id-list request line with 8 KB to spare, so any header set the old default accepted with a short URL also passes with a full id-list URL. Checked on a local nginx: 400 with the default, accepted with the new value.
- The MCP server runs plain uvicorn, whose parser refused a request head over 16 KB; it now takes 64 KB, the edge's total.
- A failed export reports its reason and logs the error to the console.
- A value longer than an Excel cell allows (32,767 characters) stops the export with a message naming the card and the column. The owner chose this refusal over splitting the value across columns.

## Tried and ruled out
- Halving the 200-id chunks, or sending ids in a request body: more requests or new endpoints, for no guarantee behind someone else's proxy.
- An environment variable for the buffer size: every deployment template runs the same image.
- Cutting an over-long cell: on re-import a cut relation cell deletes the relations that were cut off, a cut text overwrites the stored one, and cut tags or stakeholders are removed. Only an empty text cell means "leave alone".
- Splitting a long value over continuation columns the importer rejoins: lossless, but a workbook format change; not chosen.

## Watch out
- 8 KB stays the request-line budget for the id chunks, for proxies on nginx's default buffers.
- Text added inside the edge entrypoint must hold no dollar sign, double quote, backtick or backslash.
- Tests of the inventory page replace the export module wholesale, so anything the page must tell apart by type lives in a module they do not replace.
- A test that looks a row up with a non-waiting query right after only waiting for the request to be sent passes in the ordinary run and fails under the slower mutation run.

In the code:
- Dockerfile (edge entrypoint, three server blocks) and frontend/nginx.conf: large_client_header_buffers 4 16k; guard backend/tests/services/test_nginx_headers.py.
- mcp-server/turbo_ea_mcp/server.py: MAX_REQUEST_HEAD_BYTES passed as h11_max_incomplete_event_size; pinned in tests/test_server_entrypoints.py.
- frontend/src/features/inventory/excelCellLimit.ts: assertCellsFitExcel, ExportCellTooLongError; InventoryPage.tsx reportIfExportFails; keys export.failed, export.cellTooLong.
