# How We Handle Pull Requests (and How Claude Code Fits In)

Hey everyone -- wanted to lay out how we propose and review changes in this repo, and how
we're using Claude Code as part of the review loop.

---

## The PR Lifecycle

### 1. Start with a conversation

Before writing code for anything non-trivial, open an **issue** or **discussion** first.
Describe what you want to change and why. This avoids wasted effort and gives maintainers
a chance to point you in the right direction.

Small fixes (typos, obvious bugs) can skip this step.

### 2. Branch and build

```bash
git checkout -b feature/your-change main
```

Follow the conventions documented in `CLAUDE.md` -- that file is the single source of truth
for how this codebase works. Key points:

- Backend: async handlers, permission checks on every mutation, SQLAlchemy ORM only, Alembic for schema changes
- Frontend: MUI 6, lazy route imports, API client from `src/api/client.ts`, types in `src/types/index.ts`
- General: data-driven metamodel (no hardcoded card types), "cards" not "fact sheets"

### 3. Self-check before pushing

```bash
# Backend
cd backend && ruff check . && ruff format --check . && pytest

# Frontend
cd frontend && npm run lint && npm run build
```

If any of these fail, fix them before opening your PR.

### 4. Open a PR

Push your branch and open a pull request against `main`. We have a PR template that
guides you through what to include — fill it out completely. A good PR description
covers:

- **What** changed and **why** (not just "fixed bug")
- **How to test** it (specific steps)
- **Trade-offs** or decisions worth calling out
- **Screenshots** for any UI changes

Keep PRs focused. One logical change per PR. If you find yourself writing "also" in the
description, consider splitting.

### 5. Review and merge

At least one maintainer reviews before merge. Address feedback, keep the branch up to
date with `main`, and we'll squash-merge once it's approved.

---

## Putting Claude Code in the Review Loop

We're using [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to augment
(not replace) human review. Here's how.

### For contributors: pre-review your own PR

Before pushing, you can ask Claude Code to review your changes locally:

```bash
claude "Review my changes against the conventions in CLAUDE.md.
Flag any security issues, missing permission checks, or convention violations.

$(git diff main...HEAD)"
```

This catches the obvious stuff before a human ever looks at it — missing `async def`,
forgotten permission checks, raw SQL, exposed secrets, etc.

You can also use the interactive `/review-pr` command inside a Claude Code session.

### For maintainers: review open PRs with Claude Code

Pull up any open PR for review:

```bash
claude "Review PR #42. Check for correctness, security, and adherence
to CLAUDE.md conventions. Pay special attention to permission checks
and any new API endpoints."
```

Claude Code will fetch the diff via `gh`, cross-reference it with `CLAUDE.md`, and
give file-by-file feedback.

### Automated CI review (optional)

For teams that want every PR reviewed automatically, you can add a GitHub Action using
`anthropics/claude-code-action`:

```yaml
name: Claude Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: anthropics/claude-code-action@beta
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

Claude Code reads `CLAUDE.md` from the repo automatically, so it already knows the
project's conventions, architecture, and security requirements. It posts inline comments
on the PR — just like a human reviewer.

---

## What Claude Code Actually Catches

Based on our `CLAUDE.md`, here's what it validates:

| Area | Examples |
|------|----------|
| **Security** | Missing permission checks, raw SQL, exposed password hashes, unencrypted secrets |
| **Backend conventions** | Non-async handlers, unregistered routes, missing Alembic migrations, missing Pydantic validation |
| **Frontend conventions** | Missing lazy imports, wrong API client usage, non-MUI components, types outside `index.ts` |
| **Architecture** | Hardcoded card types, over-engineering, unnecessary abstractions, "fact sheet" terminology |
| **General** | Scope creep (changes beyond what was requested), missing error handling at boundaries |

### What it doesn't replace

Claude Code is a fast first pass. It doesn't replace:

- **Domain knowledge** — a human reviewer who understands the business context
- **UX judgment** — whether a UI change actually makes sense for users
- **Integration testing** — it reads code, it doesn't run your app
- **Architecture decisions** — for significant design choices, discuss with maintainers

---

## The `CLAUDE.md` File

This is the key to making Claude Code effective as a reviewer. It contains:

- All coding conventions (backend + frontend)
- Architecture overview and project structure
- Database schema and API reference
- Security requirements
- RBAC system documentation

**Keep it up to date.** When conventions change, update `CLAUDE.md`. Claude Code is
only as good as the context it has.

---

## TL;DR

1. Discuss before you code (for non-trivial changes)
2. Branch from `main`, follow `CLAUDE.md` conventions
3. Run linters and tests before pushing
4. Open a focused PR with a clear description
5. Use Claude Code to pre-review your changes (`claude "review my diff..."`)
6. Maintainers review (human + Claude Code), then squash-merge

Questions? Drop them in this thread.
