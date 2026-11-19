---
title: A key deleted from the English locale files stays in the nine other locales until someone deletes it by hand
author: Tom
date: 2026-11-19
branch: notes/locale-key-deletion
cost: { minutes: 62, tokens: 776593 }
id: l-7846061c
scope: repo
status: active
src: agent
touches:
  - scripts/i18n/check_locales.py
  - ".claude/rules/i18n-locales.md"
  - frontend/src/i18n/locales/de/admin.json
---

## Decided
When an English key is deleted, it is deleted from the nine other locale files in the same change, line by line, by key. The i18n rule says so now.

## Tried and ruled out
Relying on /translate or the parity tests: the tests only fail on keys a locale is missing, check_locales.py lists leftovers as "extra" without failing, and the translator never removes keys. Nothing in the toolchain noticed eight orphan keys of the old license-types dialog, ten of the card licensing section and fourteen of the report.
Loading and dumping the JSON to remove them: it reorders and reformats the files.

## Watch out
Remove the lines with a line-based edit, then fix a trailing comma if the deleted key was the last one, and check each file still parses. Run check_locales.py report and confirm it lists no extra keys.

In the code: frontend/src/i18n/locales/*/admin.json, cards.json, reports.json; scripts/i18n/check_locales.py; .claude/rules/i18n-locales.md.
