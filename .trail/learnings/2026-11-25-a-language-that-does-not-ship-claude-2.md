---
title: "A language that does not ship with the app is data an admin adds; it covers UI strings and database labels, takes any script and direction, and only new or cha…"
author: Claude
date: 2026-11-25
branch: claude/user-language-customization-o8ae1t
cost: { minutes: 43, tokens: 655521 }
id: l-ac0d528b
scope: repo
status: active
replaces: l-f9263413
src: agent
touches:
  - ".env.example"
  - CHANGELOG.md
  - CLAUDE.md
  - README.md
  - VERSION
  - dev/ARCHITECTURE.md
  - docker-compose.yml
  - docs/admin/custom-languages.md
  - docs/admin/mcp.md
  - docs/admin/settings.md
---

## Decided
The owner will not add more languages to the core repo. A custom language is data: an admin adds it in Settings and fills it by pack file, by the configured AI provider (a server background job) or through MCP. Each string keeps a hash of the English it was made from, so after an upgrade only missing and stale strings are translated again; a stale translation is still shown.

Owner's choices on 2026-11-25: the first PR covers UI strings and database labels (card types, fields, options, relation verbs and the other translated records). A new language is left-to-right by default with a right-to-left switch, and must take any script (Hebrew, Hindi, Thai). A community library in `vincentmakes/turbo-ea-translations` comes right after: a new language auto-merges, edits need that language's maintainer.

Database labels stay where they already live, in each record's own translations under the custom code, so the existing label resolvers show them unchanged. They are written by a service, not the admin routes, and only the custom code's entry is touched; that is how locked built-in records and dashboards get a custom language.

One validator is the gate for every way in. It treats a pack as untrusted: key exists in English, placeholders match, no tag or link English lacks.
Language packs are untrusted (files, AI answers, MCP, later a community repo that auto-merges). The first validator compared complete tags with the English text. Review broke it twice, both confirmed by running them:
- an unclosed tag in front of an English tag is not a complete tag, so it was never compared, and the browser reads it as an element with attributes;
- an i18next reference with options can carry a tag in escaped form, which i18next decodes after the check.

The rule now: remove the exact tag tokens English has, then refuse anything that still opens a tag; the number of i18next references must equal English's; opening and closing placeholder braces must pair up. The frontend applies the same rule again when it loads a custom language and drops a string that fails, so the server is not the only gate.

## Tried and ruled out
Hosted translation platforms: their free open-source tiers ask for an OSI licence and this project is FSL-1.1-MIT (not confirmed with a vendor).

A folder per app version in the community repo: an older pack already imports cleanly on a newer version, so copies only add weight.

Storing a custom language's lifecycle phase help in the setting: the defaults are code served while the setting is absent, so it would freeze them for the ten built-in languages. It is kept with the pack and overlaid when read.

Starting to build before the owner approved the plan: they asked for a plan first and stopped it. Ask for approval when the request says "make a plan".
Rewriting the nineteen dialog texts that are rendered as HTML to React nodes in the same change: fifteen call sites, each needing its own test for the mutation gate. One check in the loader protects all of them; the rewrite stays a follow-up.

Trusting the edge proxy's content security policy: it blocks inline script on the bundled proxy only, not links, redirects or full-page overlays, and not at all in development or behind another proxy.

## Watch out
Rejecting "control characters" must not reject the joiners and marks Hindi, Persian, Hebrew and Thai need; only C0/C1 controls and the two bidi overrides are refused.

Languages differ in plural forms; a form the pack lacks is filled from its general form so no count falls back to English.

An extension's manifest used to overwrite a contributed field's translations on update, which would wipe a custom language.

A file meant for the community must hold built-in labels only, or it leaks an installation's own names.

In the code:
- `backend/app/services/language_pack.py`, `metamodel_strings.py`, `custom_locale_store.py`, `custom_locale_translate.py`, `backend/app/api/v1/custom_locales.py`
- `frontend/src/i18n/customLocales.ts`, `frontend/src/features/admin/customLocales/`
- `.claude/rules/custom-locales.md`
Translated text is also concatenated into HTML strings where English has no tag at all: grid "no rows" templates, a print document, chart tooltips. Escape at those places; a tag-less English string is not proof of safety.

A plural form filled in for "zero" overrides the language's own rule for 0 in every language, so fill it only for languages that have a zero form.

A string validator that scans before it measures spends event-loop time on a 10 MB value; check length first.

Reviewers launched as copies of a long session each carry its whole history and used up the usage limit before producing anything. Launch fresh reviewers with a written brief.

- `backend/app/services/language_pack.py` (`validate_value`), probes kept out of the repo
- `frontend/src/i18n/customLocales.ts` (loader gate)
- HTML sinks: `ArchiveDeleteDialog.tsx`, `RestoreDialog.tsx`, `SurveyRespond.tsx`, `RolesAdmin.tsx`, `TypeDetailDrawer.tsx`, `StakeholderRolePanel.tsx`, `RelationTypesPanel.tsx`, `LinkDiagramsDialog.tsx`
