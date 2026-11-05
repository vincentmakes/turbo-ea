---
title: "Run mypy on the backend before pushing: CI's type check is its own job that ruff and pytest never cover"
author: Claude
date: 2026-11-04
branch: claude/blissful-goldberg-qnvh1z
cost: { minutes: 1, tokens: 1626 }
id: l-3e0d9d15
scope: repo
status: active
src: agent
touches:
  - backend/app/api/v1/eol.py
  - backend/app/services/eol_custom_service.py
  - backend/tests/services/test_eol_custom_service.py
  - CHANGELOG.md
  - backend/app/api/v1/reports.py
  - backend/app/services/card_flags.py
  - backend/app/services/dashboard_query.py
  - backend/tests/api/test_eol.py
  - backend/tests/api/test_reports_eol.py
  - backend/tests/services/test_card_flags.py
---

## Decided
- Add `python -m mypy app/` (from backend/) to the pre-push checks. CI's "Backend Type Check" job runs it separately; ruff, pytest and the guard tests all passed on a branch that still failed mypy on four lines (a set of raw attribute values, which can be None, passed where Iterable[str] was declared, and an untyped dict return).
- A helper fed raw `card.attributes.get(...)` values should take `Iterable[object]` and filter with `isinstance`, not demand `str` from every caller.

## Watch out
- In a fresh cloud-session venv, `pip install -e ".[dev]"` can leave mypy unable to start (`ModuleNotFoundError: pathspec.patterns.gitignore`). Pin it to CI's versions: `pip install "pathspec==1.1.1" "mypy==2.4.1"` (versions from the Backend Type Check job log).

In the code: backend/pyproject.toml (mypy config), .github/workflows/ci.yml job "Backend Type Check".
