---
title: "/translate finds missing translations only: an edited English sentence must be named to it explicitly"
author: Claude
date: 2026-10-26
branch: claude/gallant-goodall-z68jul
cost: { minutes: 8, tokens: 194391 }
id: l-cc90e2e3
scope: repo
status: active
src: agent
touches:
  - ".env.example"
  - docs/admin/mcp.ar.md
  - docs/admin/mcp.da.md
  - docs/admin/mcp.de.md
  - docs/admin/mcp.es.md
  - docs/admin/mcp.fr.md
  - docs/admin/mcp.it.md
  - docs/admin/mcp.md
  - docs/admin/mcp.pt.md
  - docs/admin/mcp.ru.md
---

## Decided
When English text that already has translations changes (here two sentences in `docs/admin/mcp.md`, after its nine siblings were filled), call `/translate` with args that quote the old and new English sentences and name the sibling files. It then edits exactly those spots and runs `mkdocs build --strict`.

## Tried and ruled out
Relying on the default `/translate` run. Its gap finder (`scripts/i18n/check_locales.py`, diff against `origin/main`) reports missing keys, pages and screenshot names. A changed sentence inside a page or key that every locale already has is not a gap, so it would ship stale in nine languages.

## Watch out
- The MCP SDK's Host check (`mcp/server/transport_security.py`, `_validate_host`) compares the raw header case-sensitively, with no normalisation. `parse_hosts` lower-cases entries because proxies send lower case. A proxy that sends mixed case still needs the exact form, which is why the guide says matching is exact.
- An entry that still carries a scheme or path can never match. `_build_transport_security()` warns about it and logs the admitted hosts once at boot. Both messages are asserted word for word in `tests/test_server_entrypoints.py` (they're mutation targets).
