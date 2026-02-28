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

Example: `feature/add-csv-import-validation`, `fix/stakeholder-permission-check`, `docs/update-bpm-screenshots`

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

# Docs (if you changed anything in docs/ or mkdocs.yml)
pip install -r requirements-docs.txt
mkdocs build --strict
```

---

## Maintaining the User Manual

The user manual lives in the `docs/` directory and is built with **MkDocs Material** + **mkdocs-static-i18n**. It deploys automatically to Cloudflare Pages on every push to `main`.

### Structure

```
docs/
├── index.md / index.es.md              ← Homepage & introduction
├── assets/img/{en,es}/                 ← Per-language screenshots
├── getting-started/login.md / .es.md   ← Accessing the platform
├── guide/                              ← Feature documentation
│   ├── dashboard.md / .es.md
│   ├── inventory.md / .es.md
│   └── ...
├── admin/                              ← Administration guides
│   ├── metamodel.md / .es.md
│   ├── users.md / .es.md
│   └── sso.md / .es.md
└── reference/glossary.md / .es.md      ← Glossary
```

### i18n Convention

Files use a **suffix-based** naming scheme: `page.md` is English (default), `page.es.md` is Spanish, `page.de.md` is German, etc. Untranslated pages fall back to English automatically.

### Editing Existing Pages

1. Find the Markdown file under `docs/` and its language-suffixed variants.
2. Edit the content — use `mkdocs serve` locally to preview changes.
3. If you update a screenshot, replace the PNG in `docs/assets/img/{locale}/` using the existing naming convention (`NN_short_description.png`).
4. Ensure you update **all language variants** if the change is structural (new sections, reordered content). Content-only translation updates can be done per-language.

### Adding a New Page

1. Create `docs/path/to/page.md` (English) and `docs/path/to/page.es.md` (Spanish).
2. Add the page to the `nav:` section in `mkdocs.yml`.
3. If the page includes screenshots, add them under `docs/assets/img/en/` and `docs/assets/img/es/` following the numbered naming pattern.

### Adding a New Language

1. Uncomment or add the locale block in `mkdocs.yml` → `plugins.i18n.languages`.
2. Add the locale to `plugins.search.lang` and `extra.alternate`.
3. Create `*.xx.md` files for each page (copy the English files as starting points):
   ```bash
   for f in $(find docs -name "*.md" ! -name "*.*.md"); do
     cp "$f" "${f%.md}.xx.md"
   done
   ```
4. Translate the content in each `.xx.md` file.
5. Add the corresponding screenshot folder `docs/assets/img/xx/` with localized screenshots. You can initially symlink or copy the English images and replace them as translations are captured.

### Screenshots

- Store in `docs/assets/img/{locale}/` (one folder per language).
- Naming: `NN_short_description.png` (e.g., `01_dashboard.png`, `22_create_card.png`).
- Take screenshots in the matching UI language.
- Reference with relative paths: `![alt](../assets/img/en/01_dashboard.png)`.

### Local Preview

```bash
pip install -r requirements-docs.txt
mkdocs serve
# → http://127.0.0.1:8000
```

### When to Update Docs

- **New feature**: Add or update the relevant guide page in all supported languages.
- **UI change**: Replace affected screenshots in all locale folders.
- **New admin setting**: Update the appropriate admin page.
- **Terminology change**: Update the glossary.

Use the `docs/` branch prefix for documentation-only PRs.

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

## Recommended Branch Protection Rules

For maintainers setting up the repository, apply these branch protection rules
to `main` via **Settings > Branches > Branch protection rules**:

| Rule | Setting | Why |
|------|---------|-----|
| **Require pull request reviews** | 1 approval minimum | Prevents unreviewed code from landing |
| **Require status checks to pass** | Backend Lint, Backend Tests, Frontend Lint, Frontend Build, Frontend Tests, Docs Build | Prevents broken code or docs from merging |
| **Require branches to be up to date** | Enabled | Ensures CI ran against the latest `main` |
| **Require conversation resolution** | Enabled | Review comments must be addressed |
| **Restrict force pushes** | Block everyone | Protects commit history |
| **Restrict deletions** | Block everyone | Prevents accidental branch deletion |

Security scanning jobs (`Backend Security Scan`, `Frontend Security Scan`) are
intentionally **not** required status checks — they run with `continue-on-error`
so that existing vulnerability findings don't block all PRs. Once findings are
triaged and resolved, promote them to required checks.

---

## Reporting Issues

- **Bugs**: Open an issue with steps to reproduce, expected behavior, and actual behavior.
- **Feature requests**: Start a discussion in the Ideas category first.
- **Security vulnerabilities**: Do not open a public issue. Email the maintainers directly.

---

## Code of Conduct

Be respectful and constructive. We are all here to build a better tool.
