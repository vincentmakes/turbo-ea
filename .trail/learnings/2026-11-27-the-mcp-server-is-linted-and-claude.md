---
title: "The MCP server is linted and formatted by ruff in CI, so run ruff there before committing"
author: Claude
date: 2026-11-27
branch: claude/gracious-ritchie-51s8qg
cost: { minutes: 6, tokens: 48260 }
id: l-31e06075
scope: repo
status: active
replaces: l-6950ed9d
src: agent
touches:
  - dev/ARCHITECTURE.md
  - docker-compose.yml
  - docs/admin/mcp.md
  - mcp-server/tests/test_config.py
  - mcp-server/tests/test_ppm_helpers.py
  - mcp-server/tests/test_ppm_tools.py
  - mcp-server/tests/test_safeguards.py
  - mcp-server/turbo_ea_mcp/config.py
  - mcp-server/turbo_ea_mcp/ppm.py
  - mcp-server/turbo_ea_mcp/server.py
---

## Decided
The MCP server package has its own ruff configuration and the MCP Server Tests job fails on a format or lint error, so a change there is formatted and linted before it is committed, like the backend. Checked 2026-11-27: the whole package was already formatted (52 files, nothing to change).
- A task may only be moved into a work package of its own project, but the check runs only when the package changes. The task dialog always re-sends the current package, so a task the old bug left in another project's package can still be edited.
- An assistant's update sends only the fields whose value changes. Re-sending an unchanged package or date made the backend renumber the row and re-run roll-ups for nothing.
- The long PPM text fields grow with their content up to a cap, then scroll.

## Tried and ruled out
The earlier learning said never to run ruff across the MCP server because CI did not lint it and a format run rewrote 18 untouched files. That stopped being true once the package got its own config and the CI steps.
- Refusing a milestone as a task's work package in the task routes: the web dialog offers milestones as a package, so that refusal lives only in the Gantt drop and in the MCP tool.
- A drag handle on the text fields: the component library sizes the box itself and fights a manual drag.
- Checking the package on every task save: it would lock out tasks already misplaced.

## Watch out
The job also runs vulture and a coverage floor; a new helper nothing calls fails it.

In the code:
- mcp-server/pyproject.toml: [tool.ruff], [tool.vulture]
- .github/workflows/ci.yml, MCP Server Tests: `ruff format --check .`, `ruff check .`, vulture, pytest with fail_under 88
- Run from mcp-server/: `ruff format . && ruff check . && vulture`
- The test browser has no layout, so a growing field cannot be tested by height. Assert that the box has no fixed row count and that the library's hidden measuring box is present.
- An unknown assignee or risk owner reaches a foreign key; without the explicit check it is a database error (500), not a 400.

- backend/app/services/ppm_gantt_move.py: wbs_of_initiative, parse_uuid; backend/app/api/v1/ppm.py: update_task, _require_user
- mcp-server/turbo_ea_mcp/ppm.py: plan_saves, task_errors
- frontend/src/features/ppm/PpmTaskDialog.tsx: minRows / maxRows; PpmTaskDialog.test.tsx
