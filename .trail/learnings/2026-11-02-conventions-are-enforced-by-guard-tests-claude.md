---
title: "Conventions are enforced by guard tests, not Claude Code hooks; hooks are only for rules about actions, and the raw-colour backlog is a ratchet with exact coun…"
author: Claude
date: 2026-11-02
branch: claude/charming-wozniak-jamr5e
cost: { minutes: 46, tokens: 208962 }
id: l-ae4267aa
scope: repo
status: active
src: agent
touches:
  - CLAUDE.md
---

## Decided
- A CLAUDE.md rule about the shape of the code (no raw hex outside the tokens, every endpoint declares auth, no raw SQL, cards by id through the shared fetcher, lazy route pages, stored HTML only through the sanitiser) gets a static guard test: discover, require, allowlist with a one-line reason per entry, a staleness test, a self-test on a known-bad snippet. Claude Code hooks are reserved for rules about what the agent *does* (never write on GitHub, never hand-edit generated files, run ruff before a commit), which no test can observe. Hooks never replace rule text; they catch, they do not teach.
- The raw-colour backlog (about a thousand hex/rgb literals in ~170 frontend files) is enforced as a per-file baseline with EXACT counts: a file above its number fails, a file below its number fails too ("lower the entry"), zero while listed fails ("delete the entry"). Chosen over lower-or-equal so the baseline can never rot quietly; every remediation PR has to move the number.
- "fact sheet" terminology is deliberately NOT guarded: every occurrence is the LeanIX importer using the source system's own vocabulary.
- Remediation is grouped into two PRs (three at most): one with the security fix plus every guard plus every non-colour fix, one with the colour tokens and all identical-hex swaps. The user wants as few PRs as possible.

## Tried and ruled out
- Seven small PRs (security, guards, ORM rewrites, new tokens, three batches of hex swaps): rejected by the user as too many.
- Prompt- or agent-type hooks that judge CLAUDE.md compliance at Stop: nondeterministic, a model call per turn, and the guard tests already cover repo-wide invariants with allowlists.
- A regex hook blocking "fact sheet": would refuse legitimate edits to the LeanIX adapter.
- A PostToolUse hook on Edit|Write for conventions: misses edits made through sed/heredocs in Bash; a Stop-time check over the git diff is the robust shape if an action hook is ever added.

## Watch out
- Six `dangerouslySetInnerHTML` sites injected `t()` output with user-typed values unescaped (i18n has escapeValue false globally): a card named with an img/onerror tag executed from the restore dialog. The fix is `interpolation: { escapeValue: true }` on each call; the new richHtml guard requires every such site to be sanitizeRichHtml, escapeHtml, DOMPurify, or t() with escapeValue true.
- `GET /stakeholder-roles` was the one anonymous endpoint that was not public on purpose; 39 others are legitimately public and listed with reasons in the route-auth guard.
- Any frontend test that reads files from disk must import the literal `@/test/sourceScan` and wrap in describeSourceScan/itSourceScan, or the backend CI-workflow guard fails it; the helper walker is `walkSources` and the backend regex names it.

In the code:
- Backend guards: backend/tests/services/test_route_auth_guard.py, test_no_raw_sql_guard.py, test_api_conventions_guard.py, test_permission_keys_guard.py; shared helper backend/tests/app_source.py.
- Frontend guards: frontend/src/test/sourceScanners.ts (rawColours, walkSources), src/theme/rawColours.sourceScan.test.ts (RAW_COLOUR_BASELINE, EXEMPT), src/lib/richHtml.sourceScan.test.ts, src/api/cardsByIds.sourceScan.test.ts, src/lazyRoutes.sourceScan.test.tsx, src/hooks/useColumnFreeze.sourceScan.test.ts.
- Plan: /root/.claude/plans/ok-so-let-s-start-peaceful-hearth.md (session-local).
