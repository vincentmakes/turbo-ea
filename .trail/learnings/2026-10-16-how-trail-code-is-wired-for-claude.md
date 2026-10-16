---
title: How Trail-code is wired for Claude Code web sessions
author: Claude
date: 2026-10-16
branch: claude/setup-trail-code
cost: { minutes: 12, tokens: 248967 }
---

## Decided
- Trail is wired by committed files, not by `trail init` per session: web containers start fresh, so `~/.claude` hooks and the global npm install vanish. `.claude/settings.json` points every Trail hook event at `.trail/hook.cjs`, which no-ops until the CLI is on PATH.
- `.claude/hooks/session-start.sh` (web only) installs `@trailhq/trail-code`, runs `trail telemetry disable` and `trail build`, and runs async so the session opens at once (the owner did not want a ~2.5 min wait).
- Single developer: save learnings to the repo, never `--personal` (`~/.trail` dies with the container).
- `.gitignore` ignores `.claude/*` except `settings.json`, `hooks/` and `skills/`.

## Tried and ruled out
- Running `trail init` in the session-start hook: it rewrites repo files and re-runs its PR-review cold start every session.
- A synchronous hook: a full map build is ~2 min on this repo (2006 files).

## Watch out
- For the first ~2 min of a fresh session the map may be missing or partial; fall back to normal search.
- Trail's hook timeouts are in milliseconds in its own reading; its child-budget lookup only matches `graft-hooks.cjs`/`trail-hooks.cjs` paths, so `.trail/hook.cjs` gets the default 6 s query budget.
- Backend dev deps (pytest) are not installed in web sessions; that is separate from Trail.
