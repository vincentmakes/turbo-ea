---
title: "Never run ruff format/check across mcp-server/: CI does not lint it, and it reformats 18 untouched files"
author: Claude
date: 2026-10-26
branch: claude/gallant-goodall-z68jul
cost: { minutes: 17, tokens: 163891 }
id: l-6950ed9d
scope: repo
status: active
src: agent
touches:
  - docs/admin/mcp.ar.md
  - docs/admin/mcp.da.md
  - docs/admin/mcp.de.md
  - docs/admin/mcp.es.md
  - docs/admin/mcp.fr.md
  - docs/admin/mcp.it.md
  - docs/admin/mcp.md
  - docs/admin/mcp.pt.md
  - docs/admin/mcp.ru.md
  - docs/admin/mcp.zh.md
---

## Decided
`MCP_ALLOWED_HOSTS` (discussion #1323) admits extra `Host` names through FastMCP's DNS-rebinding guard (`_build_transport_security()` in `mcp-server/turbo_ea_mcp/server.py`). The guard stays on. `X-Forwarded-Host` is not trusted: a DNS-rebound page is same-origin and can set any header. An extra host is never turned into an origin.

## Tried and ruled out
Running `ruff format . && ruff check .` inside `mcp-server/`, the way CLAUDE.md asks for `backend/`. `mcp-server/` has no ruff config, and CI only lints `backend/` (`.github/workflows/ci.yml` backend-lint). A fresh ruff (0.16) reformatted 18 untouched files and reported dozens of pre-existing findings. The fix was to restore the files and re-apply only my edits.

## Watch out
- To lint only your own lines there, run `ruff check --isolated --select E,F,I,N,W --line-length 100 <changed files>` and ignore the findings that were already there.
- A POST to `/mcp` meets the bearer gate (401) before the transport guard. To test the Host check, call `TransportSecurityMiddleware(settings).validate_request(Request(scope), is_post=True)` directly (`tests/test_server_entrypoints.py`).
- Every MCP env var has to be listed in `docker-compose.yml` explicitly. `MCP_ALLOWED_ORIGINS` and `MCP_OAUTH_ALLOWED_REDIRECT_URIS` were silently unset on compose installs until 2.179.0.
