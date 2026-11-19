---
title: "The workspace import validates license data with the API's own schemas, and readers are not hardened against bad stored data"
author: Tom
date: 2026-11-19
branch: notes/bundle-validation
cost: { minutes: 61, tokens: 312036 }
id: l-3117e64b
scope: repo
status: active
src: agent
touches:
  - backend/app/services/workspace_io/license_compat.py
  - backend/app/services/workspace_io/applier.py
  - backend/app/services/item_catalogue.py
---

## Decided
The workspace import validates license cells, metric rows and type rows with the API's own Pydantic schemas. A row that fails is dropped, with the cells that point at it, and listed in the import report.

## Tried and ruled out
A guard in the readers of the license status: it would be needed in three places and covers only data the import no longer lets in.

## Watch out
A database that already holds a bad cell still gives 500 on the card's licensing page and on the report, and is repaired by hand. A sort_order outside int32 in a bundle can still give 500 in the preview.

In the code: backend/app/services/workspace_io/license_compat.py, backend/app/services/workspace_io/applier.py, backend/app/services/item_catalogue.py.
