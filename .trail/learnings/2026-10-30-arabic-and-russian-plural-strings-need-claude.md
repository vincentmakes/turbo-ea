---
title: Arabic and Russian plural strings need every CLDR category or the count falls back to English
author: Claude
date: 2026-10-30
branch: claude/echarts-reports
cost: { minutes: 122, tokens: 312644 }
id: l-ba6eb30e
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - frontend/src/i18n/locales/ar/admin.json
  - frontend/src/i18n/locales/ar/bpm.json
  - frontend/src/i18n/locales/ar/cards.json
  - frontend/src/i18n/locales/ar/common.json
  - frontend/src/i18n/locales/ar/delivery.json
  - frontend/src/i18n/locales/ar/diagrams.json
  - frontend/src/i18n/locales/ar/grc.json
  - frontend/src/i18n/locales/ar/inventory.json
  - frontend/src/i18n/locales/ar/ppm.json
---

## Decided
Every plural key in the Arabic locale carries `_zero`, `_one`, `_two`, `_few`, `_many`, `_other`, and every Russian one `_one`, `_few`, `_many`, `_other`. i18next picks the suffix from the CLDR plural category of the count and does not fall back to the same language's `_other` when that suffix is missing; it walks the fallback language chain instead, so Arabic 58 ("many") and Russian 3 ("few") rendered the English string. 239 keys had only `_one` and `_other`; the forms were filled on 2026-10-30 following the five keys that already had the full set. Arabic `_zero` copies `_other`; Russian `_many` is the old `_other` where that was already a genitive plural.

## Tried and ruled out
Patching the i18n init to fall back to `_other` in-language: i18next has no such option, and a count-first string in the wrong noun case is still wrong. Treating it as one missing key: it was systemic, found only because a screenshot pass in Arabic showed "58 total items" in English inside a translated tooltip.

## Watch out
`scripts/i18n/check_locales.py` accepts locale-only plural forms as legitimate but does not demand them, so a new `_one`/`_other` key translated into ar or ru without the extra categories passes the parity check and still falls back to English at runtime. The default `/translate` run finds gaps against English only; this kind of structural gap must be named to the translator explicitly. Before/after screenshot passes in `ar` are the cheap way to catch it.

In the code:
- `frontend/src/i18n/locales/{ar,ru}/*.json` (every `_one` key has its siblings)
- `frontend/src/i18n/index.ts` (`fallbackLng: "en"`)
- `scripts/i18n/check_locales.py` (`plural_base`, legitimate extra forms)
- Find keys with a missing category: `grep -c '_many"' frontend/src/i18n/locales/ar/*.json` vs `_one"`
