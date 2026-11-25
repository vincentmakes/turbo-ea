---
title: Scope Playwright row assertions to the owning table
author: Tom
date: 2026-11-25
branch: fix/pml-development-guidance
id: l-d24ca18e
scope: repo
status: active
src: agent
touches:
  - frontend/e2e/pml-financials.spec.ts
  - frontend/src/features/ppm/PpmFinanceTree.tsx
---

The PML component tests passed, but the browser test failed after Cost Items moved into nested tables. A region-wide row search by text matched both the Cost Item row and the parent row containing the subtable. Scope the locator to the table for that level and identify the row by its own accessible action or cell.
