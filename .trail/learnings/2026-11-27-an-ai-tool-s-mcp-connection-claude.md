---
title: "An AI tool's MCP connection is a durable record in the database, renewed by rotating refresh tokens, not a token kept in the MCP server's memory or a self-cont…"
author: Claude
date: 2026-11-27
branch: claude/zealous-gates-a140hx
cost: { minutes: 22, tokens: 321518 }
id: l-6a76cc7a
scope: repo
status: active
src: agent
touches:
  - backend/app/services/mcp_session_service.py
  - backend/app/core/security.py
  - backend/app/api/deps.py
  - mcp-server/turbo_ea_mcp/oauth.py
  - mcp-server/turbo_ea_mcp/server.py
  - backend/app/api/v1/auth.py
---

## Decided
- Issue #1449 (Copilot Studio, and the owner's Claude connector, had to reconnect after every MCP restart). Two causes gave the same symptom: the MCP server kept access and refresh tokens only in memory, and a connection idle for more than 24 hours could not renew because the Turbo EA session behind it had expired. The owner chose to fix both, with security as the priority and renewal that needs no action from the user, the way GitHub's connector behaves.
- The backend owns one row per connection. The refresh token is rotated on every use; the row holds only a generation counter, and the token is an HMAC over (connection id, generation), so the database holds no token and no hash of one.
- A replaced token presented again within 60 seconds gets the same next token (a lost response or two workers refreshing at once); anything older ends the connection and is written to the Security log.
- A connection renews while it is used at least once every 30 days and ends 180 days after sign-in whatever the use. The second limit is what catches a person removed at the identity provider but still active in Turbo EA.
- The MCP server proves itself to the backend with a one-minute token signed by a key derived from SECRET_KEY, so a refresh token is useless anywhere but through the instance's own MCP server.
- The Turbo EA token minted for a connection carries the connection id and lasts one hour; user resolution refuses it as soon as the connection is ended, so revoking is immediate.
- The sign-in endpoint for SSO was left untouched: opening a connection is its own endpoint that takes the freshly issued user token plus the MCP server's proof.

## Tried and ruled out
- Sealed, self-contained tokens (encrypt the Turbo EA token into the refresh token, no state): survives a restart, but cannot detect a replayed token or revoke a connection, which RFC 9700 and the MCP authorization spec require of public clients. Dropped once the owner said security comes first.
- Fixing restarts only: leaves the 24-hour idle limit, which the owner hits with Claude.
- Storing a hash of each refresh token: more material in the database than a counter, and a retry inside the grace window could not be answered with the same token.
- A fallback path for an MCP server without SECRET_KEY or a backend older than the MCP server: it would be a second token scheme to test and secure. Instead sign-in still works and no refresh token is issued.
- Letting the MCP server mint user tokens itself because it holds SECRET_KEY: it would make the MCP server an identity issuer.

## Watch out
- The service-proof key context string exists twice, once in the backend and once in the MCP server, because the two packages share no code. A known-answer test on each side pins the same vector; change both together.
- A sign-in in flight still lives in MCP memory, so a restart during those few seconds fails that one attempt, and several MCP replicas need sticky routing for it.
- A database restored from a backup lags behind tokens already issued: such a token ends its connection (treated as a replay) and the user reconnects once.
- Connections made before this change live only in the old MCP server's memory and need one last reconnect after the upgrade.

In the code: backend/app/services/mcp_session_service.py, backend/app/api/v1/mcp_sessions.py, backend/app/core/security.py (verify_mcp_service_token, derive_key), backend/app/api/deps.py (msid check), backend/alembic/versions/181_mcp_sessions.py, backend settings MCP_SESSION_IDLE_DAYS / MCP_SESSION_MAX_DAYS, mcp-server/turbo_ea_mcp/oauth.py.
