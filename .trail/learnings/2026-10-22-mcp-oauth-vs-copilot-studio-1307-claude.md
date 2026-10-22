---
title: "MCP OAuth vs Copilot Studio (#1307): self-describing client ids, 401 on stale tokens, outages keep sessions"
author: Claude
date: 2026-10-22
branch: claude/mcp-copilot-studio-oauth
cost: { minutes: 55, tokens: 467965 }
touches:
  - CHANGELOG.md
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
- Copilot Studio registers once (RFC 7591) and never re-registers, so an in-memory DCR store breaks it on every MCP restart. Client ids are now self-describing: `tea1.<b64 claims {r: redirect_uris, n: nonce}>.<HMAC-SHA256>`, key = HMAC(SECRET_KEY, "turbo-ea-mcp/oauth-client-id/v1") (`config.oauth_client_key`). `authorize` uses `_lookup_client` (memory first, else `client_from_id`); exact-match redirect checking is unchanged. `store.clients` is now only a bounded cache (`MAX_CACHED_CLIENTS`).
- SECRET_KEY is passed to the mcp-server container everywhere (compose, Helm, Bicep, Cloud Run, CFN, 3 Terraform modules) — same secret objects the backend reads, no new IAM needed.
- `RequireBearerForMcp` resolves the token: unknown → 401 `error="invalid_token"`; resolver raising → 503 + Retry-After (never 500).
- `api_client.refresh_token` raises `RefreshUnavailable` on network error / 5xx; only a 4xx or a 200 without a token is a refusal. `resolve_token` keeps the session in an outage (serves a still-valid JWT, raises for an expired one); the refresh grant answers 503 `temporarily_unavailable` keeping both tokens.
- nginx routes `/.well-known/openid-configuration` (incl. `/mcp` suffix) to the MCP server in both server blocks; guarded by `TestOAuthDiscoveryRouting`.
- Client id capped at 2048 chars (redirect URIs ≤1024, ≤10) so an accepted id always fits nginx's 8 KB authorize request line.

## Tried and ruled out
- Treating any non-200 from /auth/refresh as session end: with the gate resolving every /mcp request, a restarting backend would sign everyone out and the gate 500'd on ConnectError (found by the Fable review).
- Advertising client_secret_post / adding OIDC-only fields (jwks_uri…) to the discovery doc: we issue no secrets or id_tokens; Copilot Studio's captured trace registers as a public client (`none`) and reads the RFC 8414 doc first.

## Watch out
- Copilot Studio's discovery (per Umbraco-MCP-Base #308 trace): follows `resource_metadata` from the 401, then AS metadata at `/.well-known/oauth-authorization-server/<mcp path>`, then root, then `/.well-known/openid-configuration/<path>`.
- Most "Connection creation failed" reports are deployment: Copilot Studio calls from Microsoft's cloud, so the instance must be public HTTPS with a public CA, and MCP_PUBLIC_URL must not be the localhost default. Kiro/desktop clients work against internal hosts, which hides this.
- Copilot Studio tools created before 2.175.2 hold old random client ids and must be recreated once.
- mcp-server is not ruff-formatted in CI; don't run `ruff format` over it (reformats unrelated code).
