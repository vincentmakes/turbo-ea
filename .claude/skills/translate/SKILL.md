---
name: translate
description: Translate English changes to UI strings, seed labels, manual pages and screenshot filenames through the translator subagent. Fill missing manual translations across the checkout. Run before a PR that touches these sources.
context: fork
agent: translator
model: sonnet
background: false
allowed-tools: Bash(python scripts/i18n/check_locales.py:*) Bash(cd frontend && npx vitest run src/i18n:*) Bash(cd backend && python -m pytest tests/services/test_i18n_seed.py:*)
---

When running this skill in Codex as the calling agent, delegate the procedure below to the project's
`translator` profile and wait for its report. If you are already the translator, start at step 1.

Bring the nine non-English locales (`de fr es it pt zh ru da ar`) level with the English changes
on this branch and fill any older gaps in the user manual.

1. **Find the gaps.**
   `python scripts/i18n/check_locales.py report --base origin/main`
   Also list what else the branch changed: `git diff --name-only origin/main...HEAD` plus
   `git status --short`. Note new or changed English labels in `backend/app/services/seed.py`,
   English pages under `docs/`, and new `DOC_PAGES` entries in `scripts/screenshots/pages.ts`.
2. **UI JSON, per locale.** For each of the nine locales:
   `python scripts/i18n/check_locales.py todo <locale> --out /tmp/i18n-<locale>.json`, replace
   each English string in that file with its translation and leave removal markers as
   JSON `null`, then
   `python scripts/i18n/check_locales.py apply <locale> /tmp/i18n-<locale>.json`.
   If `apply` refuses a value, fix it and run `apply` again; nothing is written until every
   value passes.
3. **Seed.** Fill the `translations` dict of every new or relabelled entry in `seed.py` with all
   nine locales, in the shape of its neighbours.
4. **Manual.** Use `report --json` as the work list. Fill every locale listed under
   `docs.no_sibling`, including gaps on unchanged English pages. Update translations of
   changed pages, including every `docs.untouched_sibling` entry. Check headings, admonitions,
   tables, code, links, images and translated navigation labels. Skip internal specs and plans
   under `docs/superpowers/`.
5. **Screenshots.** Give every new `DOC_PAGES` entry its `de fr es it pt zh ru` filenames.
6. **Verify.**
   - `python scripts/i18n/check_locales.py report --json` — resolve all missing, empty,
     placeholder and removed keys. Review every remaining `changed` key against both
     English versions and its current translation. Both manual gap lists must also be empty.
     A zero exit code still requires the wording review.
   - `cd frontend && npx vitest run src/i18n`
   - `cd backend && python -m pytest tests/services/test_i18n_seed.py -q`
   - For manual changes, run `mkdocs build --strict` if available. Otherwise report the
     build as pending for the caller's docs-keeper step (`scripts/docs/docker-docs.sh all`).
7. **Report** in this shape, and nothing longer:

   | Locale | UI keys | Seed dicts | Doc pages | Screenshot names |
   |---|---|---|---|---|

   then: each remaining `changed` or `suspect` key, its locale and why the translation is
   correct; checks that could not run and why.

Do not commit. Do not touch any English file.
