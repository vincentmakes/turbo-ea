---
title: Verify each changed release instruction across every locale
author: Tom
date: 2026-11-21
branch: codex/sdlc-review-setup
id: l-809c1396
scope: repo
status: active
src: agent
touches:
  - scripts/i18n/check_locales.py
  - docs/admin/supply-chain.md
  - docs/reference/releases.md
---

## Decided
When an English manual changes a destination or a release step, compare each change across all nine translations, because the automatic report can be clean when a translated file was edited only in part.

## Tried and ruled out
We initially relied on the empty gap report for the translated pages.

## Watch out
This review found twelve obsolete links and one missing final-commit audit instruction after the report passed.

In the code: scripts/i18n/check_locales.py, docs/admin/supply-chain.md and docs/reference/releases.md.
