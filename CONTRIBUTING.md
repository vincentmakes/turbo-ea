# Contributing to Turbo EA

Thank you for your interest in contributing to Turbo EA. This guide walks through the
process of proposing changes, submitting pull requests, and getting your code reviewed.

---

## Getting Started

1. **Fork the repository** and clone it locally.
2. Follow the [README](README.md) to set up your development environment.
3. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name main
   ```

## Branch Naming

Use descriptive branch names with a category prefix:

| Prefix | Purpose |
|--------|---------|
| `feature/` | New functionality |
| `fix/` | Bug fixes |
| `refactor/` | Code restructuring without behavior change |
| `docs/` | Documentation only |
| `chore/` | Maintenance, dependency updates, CI config |

Example: `feature/add-csv-import-validation`, `fix/stakeholder-permission-check`

---

## Making Changes

### Before You Code

- Check existing [issues](../../issues) and [discussions](../../discussions) to avoid duplicate work.
- For larger changes, open a discussion or issue first to get feedback on the approach.
- Read `CLAUDE.md` for codebase conventions — it is the single source of truth for architecture decisions and coding standards.

### While You Code

Follow these project conventions (detailed in `CLAUDE.md`):

**Backend:**
- All route handlers in `backend/app/api/v1/`, one file per resource domain.
- Register new routes in `backend/app/api/v1/router.py`.
- Use `async def` for all handlers and DB operations.
- Permission checks are mandatory on every mutating endpoint.
- New permission keys go in `backend/app/core/permissions.py`.
- Schema changes require a new Alembic migration (sequential numbering).
- No raw SQL — use SQLAlchemy ORM.

**Frontend:**
- Route-level pages use `lazy()` imports in `App.tsx`.
- Use `api.get()` / `api.post()` / etc. from `src/api/client.ts`.
- All TypeScript interfaces in `src/types/index.ts`.
- MUI 6 components only — no other UI libraries.
- Icons via the `MaterialSymbol` component.

### Before You Submit

Run the linters and build to catch issues early:

```bash
# Backend
cd backend
ruff check .
ruff format .
pytest

# Frontend
cd frontend
npm run lint
npm run build
```

---

## Pull Request Process

### 1. Create Your PR

- Push your branch and open a pull request against `main`.
- Fill out the PR template completely (summary, test plan, checklist).
- Keep PRs focused — one logical change per PR. Large changes should be split into smaller, reviewable pieces.

### 2. PR Description

Write a clear description that helps reviewers understand:

- **What** changed and **why**.
- **How** to test it (specific steps, not just "run tests").
- Any **trade-offs** or decisions you made.
- Screenshots for UI changes.

### 3. Review Process

- At least one maintainer review is required before merging.
- Address all review comments — resolve conversations or explain your reasoning.
- Keep the branch up to date with `main` (rebase preferred over merge commits).

### 4. Merging

- Squash-and-merge is the default strategy for clean history.
- The PR title becomes the commit message, so make it descriptive.

---

## Using Claude Code for PR Review

Claude Code can be used as a reviewer to catch issues before (or alongside) human review.
Here is how to integrate it into your workflow.

### Option A: Review Before Submitting

Before opening your PR, ask Claude Code to review your diff:

```bash
# From your feature branch
claude "Review my changes for this PR. Check for:
- Adherence to the conventions in CLAUDE.md
- Security issues (missing permission checks, raw SQL, exposed secrets)
- Missing error handling at system boundaries
- Any regressions or breaking changes

$(git diff main...HEAD)"
```

Or interactively inside a Claude Code session:

```
> /review-pr
```

### Option B: Review an Open PR

Point Claude Code at an existing PR for a thorough review:

```bash
claude "Review PR #42 on this repo. Focus on correctness, security,
and adherence to the project conventions documented in CLAUDE.md."
```

Claude Code will use `gh` CLI to fetch the PR diff and comments, then provide
file-by-file feedback.

### Option C: Automated Review via GitHub Actions (CI)

Add Claude Code as an automated reviewer in your CI pipeline. When a PR is opened
or updated, a GitHub Action can trigger Claude Code to post review comments directly
on the PR.

Example workflow (`.github/workflows/claude-review.yml`):

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

      - name: Run Claude Code review
        uses: anthropics/claude-code-action@beta
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          # Claude reads CLAUDE.md automatically for project context
```

This posts inline review comments on the PR, flagging issues before human
reviewers look at it.

### What Claude Code Checks

When reviewing against this codebase, Claude Code validates:

| Category | What It Checks |
|----------|---------------|
| **Conventions** | Cards terminology (not "fact sheets"), data-driven metamodel, no hardcoded types |
| **Security** | Permission checks on mutating endpoints, no raw SQL, encrypted secrets, parameterized queries |
| **Backend** | Async handlers, route registration, Pydantic validation, Alembic migrations for schema changes |
| **Frontend** | Lazy imports for routes, MUI 6 usage, correct API client usage, TypeScript interfaces in `types/index.ts` |
| **Architecture** | No over-engineering, no unnecessary abstractions, changes scoped to what was requested |

### Tips for Getting Good Reviews from Claude Code

1. **Keep `CLAUDE.md` up to date** — Claude Code uses it as the primary reference for project conventions.
2. **Write clear PR descriptions** — the more context you provide, the better the review.
3. **Ask specific questions** — "Is this permission check correct?" gets a more useful answer than "review this".
4. **Use it early** — review your changes before pushing, not just after.

---

## Reporting Issues

- **Bugs**: Open an issue with steps to reproduce, expected behavior, and actual behavior.
- **Feature requests**: Start a discussion in the Ideas category first.
- **Security vulnerabilities**: Do not open a public issue. Email the maintainers directly.

---

## Code of Conduct

Be respectful and constructive. We are all here to build a better tool.
