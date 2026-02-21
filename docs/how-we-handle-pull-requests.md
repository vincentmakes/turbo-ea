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

Run linters **and tests** before opening your PR:

```bash
# Backend — lint + format check
cd backend && ruff check . && ruff format --check .

# Backend — unit tests (no database needed)
cd backend && python -m pytest tests/core/ tests/services/ -q

# Backend — full test suite (auto-provisions ephemeral Postgres via Docker)
./scripts/test.sh

# Frontend
cd frontend && npm run lint && npm run build && npm run test:run
```

If any of these fail, fix them before opening your PR. CI runs the same checks and will
block merge on failure.

### 4. Open a PR

Push your branch and open a pull request against `main`. We have a PR template that
guides you through what to include -- fill it out completely. A good PR description
covers:

- **What** changed and **why** (not just "fixed bug")
- **How to test** it (specific steps)
- **Trade-offs** or decisions worth calling out
- **Screenshots** for any UI changes

Keep PRs focused. One logical change per PR. If you find yourself writing "also" in the
description, consider splitting.

### 5. CI checks

Every PR triggers our CI pipeline (`.github/workflows/ci.yml`) with 5 parallel jobs:

| Job | What it does |
|-----|-------------|
| `backend-lint` | Runs `ruff check` and `ruff format --check` on `backend/` |
| `backend-test` | Runs `pytest` with coverage against a PostgreSQL 16 service container |
| `frontend-lint` | Runs ESLint on `frontend/` |
| `frontend-build` | Runs TypeScript check + Vite build |
| `frontend-test` | Runs Vitest with coverage |

All 5 jobs must pass before a PR can be merged. If a job fails, click into the GitHub
Actions log to see the specific error.

### 6. Review and merge

At least one maintainer reviews before merge. Address feedback, keep the branch up to
date with `main`, and we'll squash-merge once it's approved.

---

## Writing Tests for Your PR

Every new feature or bug fix should include tests. See `CLAUDE.md` for full conventions;
here's the short version.

### Backend tests

Tests live in `backend/tests/` mirroring the source structure:

```
backend/tests/
├── conftest.py                 # Fixtures, factories, test DB setup
├── core/                       # Unit tests for core utilities
├── services/                   # Unit tests for business logic
└── api/                        # Integration tests for API endpoints
```

**Key patterns:**
- Use the factory helpers from `conftest.py` (`create_user`, `create_card`, `create_card_type`, etc.) -- don't insert raw models.
- `create_card_type` defaults to `built_in=False`. Pass `built_in=True` explicitly when testing built-in type behavior.
- Integration tests use the savepoint-rollback pattern -- each test runs in a transaction that rolls back automatically.
- Rate limiting is auto-disabled in tests. Assert business logic status codes, not 429.
- The `test_engine` fixture is a sync, session-scoped fixture using `NullPool`. Don't convert it to async (this prevents event loop mismatches with pytest-asyncio).

### Frontend tests

Tests live next to their source files:

```
src/api/client.test.ts
src/hooks/useCurrency.test.ts
src/components/LifecycleBadge.test.tsx
```

**Key patterns:**
- Mock the API client with `vi.mock("@/api/client")`, not the global fetch.
- Use Testing Library for component tests.
- Vitest runs in jsdom environment (configured in `vitest.config.ts`).

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

This catches the obvious stuff before a human ever looks at it -- missing `async def`,
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
on the PR -- just like a human reviewer.

---

## What Claude Code Actually Catches

Based on our `CLAUDE.md`, here's what it validates:

| Area | Examples |
|------|----------|
| **Security** | Missing permission checks, raw SQL, exposed password hashes, unencrypted secrets |
| **Backend conventions** | Non-async handlers, unregistered routes, missing Alembic migrations, missing Pydantic validation |
| **Frontend conventions** | Missing lazy imports, wrong API client usage, non-MUI components, types outside `index.ts` |
| **Architecture** | Hardcoded card types, over-engineering, unnecessary abstractions, "fact sheet" terminology |
| **Testing** | Missing tests for new features/bug fixes, incorrect use of test factories, tests that don't follow savepoint-rollback pattern |
| **General** | Scope creep (changes beyond what was requested), missing error handling at boundaries |

### What it doesn't replace

Claude Code is a fast first pass. It doesn't replace:

- **Domain knowledge** -- a human reviewer who understands the business context
- **UX judgment** -- whether a UI change actually makes sense for users
- **Integration testing** -- it reads code, it doesn't run your app
- **Architecture decisions** -- for significant design choices, discuss with maintainers

---

## The `CLAUDE.md` File

This is the key to making Claude Code effective as a reviewer. It contains:

- All coding conventions (backend + frontend)
- Architecture overview and project structure
- Database schema and API reference
- Security requirements
- RBAC system documentation
- Testing conventions and patterns

**Keep it up to date.** When conventions change, update `CLAUDE.md`. Claude Code is
only as good as the context it has.

---

## TL;DR

1. Discuss before you code (for non-trivial changes)
2. Branch from `main`, follow `CLAUDE.md` conventions
3. Run linters **and tests** before pushing
4. Open a focused PR with a clear description
5. CI runs 5 jobs (backend lint/test, frontend lint/build/test) -- all must pass
6. Use Claude Code to pre-review your changes (`claude "review my diff..."`)
7. Maintainers review (human + Claude Code), then squash-merge

Questions? Drop them in this thread.
