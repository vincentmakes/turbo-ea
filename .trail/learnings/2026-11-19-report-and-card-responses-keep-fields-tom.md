---
title: "Report and card responses keep fields the frontend does not read, because they are documented API"
author: Tom
date: 2026-11-19
branch: notes/api-scope-decisions
cost: { minutes: 76, tokens: 848566 }
id: l-28b830bb
scope: repo
status: active
src: agent
touches:
  - backend/app/schemas/licenses.py
  - backend/app/services/license_status.py
  - frontend/src/features/reports/costTrendOption.ts
---

## Decided
worst_pct and worst_no_licence on report rows and metrics, and pair_keys on the year licenses response, stay in the API although no frontend code reads them. They are in docs/api/openapi.json and removing them would change a documented contract.
Code that only tests call is removed together with its tests (license_types.archived_keys, the scope parameter of item_catalogue.archived_keys, the colorOf and extraSeries options of costTrendOption). The multi-group support of pairBarsOption stays: it works and removing it brings no value.

## Tried and ruled out
Removing the unread fields in the same PR: the review proposed it because nothing in mcp-server or the frontend reads them, but an extension or an external client may.

## Watch out
Before deleting code that only tests reach, check who added it: costTrendOption's extra options looked like cost code but came from the old licensing trend chart.

In the code: backend/app/schemas/licenses.py (ReportRow, ReportMetric, YearLicensesOut), backend/app/services/license_status.py (card_worst), frontend/src/features/reports/costTrendOption.ts.
