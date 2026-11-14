---
title: "Frontend dependencies install only with npm 11; the cloud container's npm 10 refuses the lockfile"
author: Claude
date: 2026-11-13
branch: claude/hopeful-meitner-zpu254
cost: { minutes: 28, tokens: 199615 }
id: l-8096e5e6
scope: repo
status: active
src: agent
touches:
  - ".github/workflows/ci.yml"
  - frontend/package.json
  - frontend/src/features/ppm/PpmRiskTab.tsx
  - frontend/src/features/admin/CustomEolProductsGrid.tsx
  - frontend/src/features/grc/risk/RiskRegisterPage.tsx
  - frontend/src/features/grc/compliance/ComplianceGrid.tsx
  - frontend/src/components/grid/columnFreezePersistence.test.tsx
  - frontend/src/features/ea-delivery/AdrGrid.tsx
  - frontend/src/lib/printDocument.ts
  - frontend/src/features/grc/risk/riskPrint.ts
---

## Decided
Install the frontend with npm 11, the version CI's Node 24 ships: `npx --yes npm@11 ci --no-audit --no-fund` from the frontend folder.

## Tried and ruled out
- `npm ci` with the container's Node 22 / npm 10.9: fails with EUSAGE, saying package.json and the lockfile are out of sync (a long list of @babel/* mismatches). The lockfile is fine; npm 10 resolves the overrides differently from npm 11.
- `npm install` to "repair" the lockfile: it would rewrite package-lock.json and put an unrelated diff on the branch.

## Watch out
A fresh cloud session has no frontend node_modules at all, so the first frontend test or build needs this install. npm 11 warns that esbuild's install script is not approved; vitest still runs.

In the code:
- .github/workflows/ci.yml sets node-version 24
- frontend/package.json overrides block
