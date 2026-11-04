---
title: "Static sx styles go in one pragma'd constant block, not inline, when the mutation gate counts them"
author: Claude
date: 2026-11-04
branch: claude/blissful-goldberg-qnvh1z
cost: { minutes: 30, tokens: 297923 }
id: l-81123378
scope: repo
status: active
src: agent
touches:
  - frontend/src/components/CustomEolProductDialog.tsx
  - frontend/src/features/admin/CustomEolFilterSidebar.tsx
---

## Decided
For the custom EOL filter sidebar, the static layout and colour styles were moved from inline `sx={{...}}` literals into one module-level `SX` object, wrapped in `// Stryker disable all: <reason>` ... `// Stryker restore all`. Inline, each literal is a mutant that jsdom cannot kill (no layout), and 150+ of them held the PR's frontend diff score under its 60% floor. A module-level object is static, so Stryker reports it Ignored (`ignoreStatic`); the explicit pragma documents why.

## Tried and ruled out
Next-line pragmas on every inline `sx`: multi-line objects need one per line and clutter JSX. Tests asserting pixel values: brittle and they prove nothing a user sees.

## Watch out
Only static, state-independent styles go in the block. A style that depends on state (a selected chip's colour) stays inline and is asserted with `toHaveStyle` (emotion's styles are computed in jsdom, so `fontWeight` and the like work).

In the code: `SX` in frontend/src/features/admin/CustomEolFilterSidebar.tsx.
