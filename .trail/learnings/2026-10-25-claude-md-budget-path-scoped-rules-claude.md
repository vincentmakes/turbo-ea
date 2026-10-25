---
title: CLAUDE.md is capped at 40 KB; conventions live in path-scoped .claude/rules/; translations are a Sonnet fork
author: Claude
date: 2026-10-25
branch: chore/agent-instructions-budget
---

## Decided
- `CLAUDE.md` went from 370 KB to ~33 KB and is capped at 40,000 bytes by `backend/tests/services/test_agent_instructions_budget.py`, so it cannot regrow. A new convention goes in `.claude/rules/<area>.md` with a `paths:` frontmatter unless it applies to every change.
- Domain deep-dives live in path-scoped `.claude/rules/*.md` (25 files, text moved verbatim), not in `docs/dev/` pages: a rule file loads automatically on Read/Write/Edit of a matching path, whereas a docs page relies on the agent choosing to read it. Reference tables (env vars, DB schema, metamodel defaults, RBAC registry, security runtime) are in `dev/ARCHITECTURE.md`, which is not loaded.
- Translations for the 9 non-English locales are produced by a Sonnet fork (`/translate` → `.claude/agents/translator.md`, driven by `scripts/i18n/check_locales.py report|todo|apply`), in the same PR as the feature, after the English implementation. Sonnet over Haiku because full doc pages in de/fr with diacritics and the « fiche » vs « carte » rule need the stronger model; Opus ruled out as waste on mechanical work.

## Tried and ruled out
- A separate follow-up translation PR: breaks the "every change ships translated" checklist and the parity tests in CI.
- Split tiers (Haiku for JSON, Sonnet for docs): two delegations per feature for a small saving.
- `@import` in CLAUDE.md to organise the file: imports are always expanded, so they save no tokens.

## Watch out
- Whether `enabledPlugins: {"<name>@synced": false}` in project settings disables claude.ai-synced plugins in cloud sessions is unconfirmed by the docs; verify with `/context` in a fresh session.
- Grep/Glob do not trigger path-scoped rule loading, only Read/Write/Edit and `cat`/`head`; that is why each slimmed rule in CLAUDE.md keeps a `→ .claude/rules/<file>.md` pointer, and the guard test fails a rules file CLAUDE.md never names.
- Text that tests or scripts read out of CLAUDE.md moved with it: `test_ci_workflow_mutation.py` now reads `.claude/rules/testing-ci.md` too, and `scripts/bump-deps.sh` counts DrawIO version mentions in `diagrams.md` and `deploy.md`.
- `.gitignore` ignores `.claude/*` with an explicit allowlist; a new `.claude/` subdirectory needs its own `!` line or it never gets committed.
