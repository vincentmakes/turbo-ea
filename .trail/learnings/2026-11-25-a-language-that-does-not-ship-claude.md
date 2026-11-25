---
title: "A language that does not ship with the app is data an admin adds, filled by file, AI or MCP, and only the strings that are new or changed since are translated…"
author: Claude
date: 2026-11-25
branch: claude/user-language-customization-o8ae1t
cost: { minutes: 8, tokens: 220586 }
id: l-f9263413
scope: repo
status: active
src: agent
touches:
  - frontend/src/i18n/index.ts
  - backend/app/api/v1/settings.py
  - backend/app/api/v1/users.py
---

## Decided
The owner gets many requests for more languages and will not add them to the core repo (bloat, token cost). A custom language is therefore data: an admin adds it in Settings and fills it by exporting a JSON pack and importing the translation, by one click with the configured AI provider, or through MCP tools.

Each translated string keeps a hash of the English text it was made from. After an upgrade a string is missing, stale (English changed) or translated, so only the delta is translated again. A stale translation is still shown, since an old translation beats English. "Retranslate everything" skips strings an admin corrected by hand.

Every way in goes through one server-side validator that treats the pack as untrusted: the key must exist in English, placeholders must match, and no tag or URL may appear that the English text does not have.

Built-in languages are unchanged. The first PR covers UI strings only. Card type, field and relation names live in the database and stay English in a custom language until a follow-up.

The owner asked for this split of work: planning and code review on the strongest model, everything else on Opus, CI does the testing, no local test runs.

## Tried and ruled out
Hosted translation platforms (Weblate, Crowdin) for a community library: their free open-source tiers ask for an OSI-approved licence and this project is FSL-1.1-MIT. Not confirmed with either vendor.

One folder per app version in a community repo: the hash diff already makes an older pack import cleanly on a newer version, so per-version copies only duplicate about 500 KB per language per release.

Doing the export and diff in the browser only: MCP and the AI job need the English text on the server, and a validator the client runs is not a gate.

## Watch out
The backend image did not contain the English locale files; they must be copied in at build time or the feature has nothing to diff against.

The UI is about 7,500 strings and 200k characters. That does not fit one paste into a chat window, so import merges per namespace and the AI job works in small chunks in the background.

Languages with more plural forms than one/other need extra keys that English does not have; the validator accepts a plural-category key when its `_other` sibling exists in English.

The community repo was not created: a cloud session is scoped to this repository.

In the code:
- English source: `frontend/src/i18n/locales/en/*.json` (14 namespaces), root `Dockerfile` backend stages
- Built-in list: `SUPPORTED_LOCALES` in `frontend/src/i18n/index.ts`, `backend/app/api/v1/settings.py`, `backend/app/api/v1/users.py`
- Planned: `backend/app/services/language_pack.py`, `backend/app/api/v1/custom_locales.py`, `frontend/src/i18n/customLocales.ts`
