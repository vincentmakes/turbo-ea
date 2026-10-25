---
name: translate
description: Fill all non-English locales (UI JSON, seed translations, doc siblings, screenshot filenames) from this branch's English changes, on a Sonnet subagent. Run before opening a PR that touched en/*.json, seed.py, docs/*.md or pages.ts.
context: fork
agent: translator
model: sonnet
background: false
allowed-tools: Bash(python scripts/i18n/check_locales.py:*) Bash(cd frontend && npx vitest run src/i18n:*) Bash(cd backend && python -m pytest tests/services/test_i18n_seed.py:*)
---

Bring the nine non-English locales (`de fr es it pt zh ru da ar`) level with the English changes
on this branch. Follow the rules in your agent definition; this is the procedure.

1. **Find the gaps.**
   `python scripts/i18n/check_locales.py report --base origin/main`
   Also list what else the branch changed: `git diff --name-only origin/main...HEAD` plus
   `git status --short`. Note new or changed English labels in `backend/app/services/seed.py`,
   English pages under `docs/`, and new `DOC_PAGES` entries in `scripts/screenshots/pages.ts`.
2. **UI JSON, per locale.** For each of the nine locales:
   `python scripts/i18n/check_locales.py todo <locale> --out /tmp/i18n-<locale>.json`, replace
   every value in that file with its translation, then
   `python scripts/i18n/check_locales.py apply <locale> /tmp/i18n-<locale>.json`.
   If `apply` refuses a value, fix it and run `apply` again; nothing is written until every
   value passes.
3. **Seed.** Fill the `translations` dict of every new or relabelled entry in `seed.py` with all
   nine locales, in the shape of its neighbours.
4. **Docs.** Create or update the nine `.<locale>.md` siblings of every English page the branch
   added or changed, mirroring headings, admonitions, tables, code and image paths.
5. **Screenshots.** Give every new `DOC_PAGES` entry its `de fr es it pt zh ru` filenames.
6. **Verify.**
   - `python scripts/i18n/check_locales.py report` — no missing, empty or placeholder gaps.
   - `cd frontend && npx vitest run src/i18n`
   - `cd backend && python -m pytest tests/services/test_i18n_seed.py -q`
   - `mkdocs build --strict` when docs changed and mkdocs is installed.
7. **Report** in this shape, and nothing longer:

   | Locale | UI keys | Seed dicts | Doc pages | Screenshot names |
   |---|---|---|---|---|

   then: values left as *suspect* (equal to English) and why; checks that could not run and why.

Do not commit. Do not touch any English file.
