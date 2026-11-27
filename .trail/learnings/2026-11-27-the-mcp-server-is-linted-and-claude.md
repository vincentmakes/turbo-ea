---
title: "The MCP server is linted and formatted by ruff in CI, so run ruff there before committing"
author: Claude
date: 2026-11-27
branch: claude/gracious-ritchie-51s8qg
cost: { minutes: 5, tokens: 46187 }
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

## Tried and ruled out
The earlier learning said never to run ruff across the MCP server because CI did not lint it and a format run rewrote 18 untouched files. That stopped being true once the package got its own config and the CI steps.

## Watch out
The job also runs vulture and a coverage floor; a new helper nothing calls fails it.

In the code:
- mcp-server/pyproject.toml: [tool.ruff], [tool.vulture]
- .github/workflows/ci.yml, MCP Server Tests: `ruff format --check .`, `ruff check .`, vulture, pytest with fail_under 88
- Run from mcp-server/: `ruff format . && ruff check . && vulture`
