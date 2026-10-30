---
title: "Patch a vulnerable transitive npm package by editing its lock entry, and check the lockfile with npm 11"
author: Claude
date: 2026-10-30
branch: claude/jolly-goodall-hxjh3p
cost: { minutes: 11, tokens: 80682 }
id: l-f9efb344
scope: repo
status: active
src: agent
touches:
  - frontend/package-lock.json
  - frontend/package.json
  - frontend/src/features/dashboard/customize/WidgetConfigDialog.test.tsx
  - frontend/src/features/dashboard/customize/sections/SankeySection.test.tsx
---

## Decided
A Dependabot or npm-audit fix for a transitive frontend package swaps that package's `version`, `resolved` and `integrity` in the lock entry by hand (values from `npm view <pkg>@<ver> dist.tarball dist.integrity`). This only works after checking that the new release declares the same `dependencies` and `engines`. If the parent pins an exact version, raise the `overrides` floor in package.json too.

## Tried and ruled out
`npm install --package-lock-only` / `npm update <pkg> --package-lock-only`: it re-resolves the whole tree and reshuffles the Babel 7/8 split between `@babel/core` and `@stryker-mutator/instrumenter` (~650 changed lock lines unrelated to the fix).

## Watch out
The container's npm 10 (Node 22) fails `npm ci` on main's lockfile too (ERESOLVE on the `@babel/core` peer overrides). CI runs Node 24 / npm 11, so verify with `npx -y npm@11 ci --ignore-scripts`: it refuses an out-of-sync lockfile, so a pass confirms the hand edit.

In the code: frontend/package.json `overrides` (qs pinned by typed-rest-client 6.15.1); frontend/package-lock.json.
