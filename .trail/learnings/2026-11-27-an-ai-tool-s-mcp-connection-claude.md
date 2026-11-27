---
title: "An AI tool's MCP connection is a durable record in the database, renewed by rotating refresh tokens, not a token kept in the MCP server's memory or a self-cont…"
author: Claude
date: 2026-11-27
branch: claude/zealous-gates-a140hx
cost: { minutes: 37, tokens: 408114 }
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
  - backend/tests/core/test_security.py
  - backend/tests/api/test_mcp_token_exchange.py
  - backend/app/api/v1/mcp_sessions.py
  - backend/app/config.py
---

## Decided
- Issue #1449 (Copilot Studio, and the owner's Claude connector, had to reconnect after every MCP restart). Two causes gave the same symptom: the MCP server kept access and refresh tokens only in memory, and a connection idle for more than 24 hours could not renew because the Turbo EA session behind it had expired. The owner chose to fix both, with security as the priority and renewal that needs no action from the user, the way GitHub's connector behaves.
- The backend owns one row per connection. The refresh token is rotated on every use; the row holds only a generation counter, and the token is an HMAC over (connection id, generation), so the database holds no token and no hash of one.
- A replaced token presented again within 60 seconds gets the same next token (a lost response or two workers refreshing at once); anything older ends the connection and is written to the Security log.
- A connection renews while it is used at least once every 30 days and ends 180 days after sign-in whatever the use. The second limit is what catches a person removed at the identity provider but still active in Turbo EA.
- The MCP server proves itself to the backend with a one-minute token signed by a key derived from SECRET_KEY, so a refresh token is useless anywhere but through the instance's own MCP server.
- The Turbo EA token minted for a connection carries the connection id and lasts one hour; user resolution refuses it as soon as the connection is ended, so revoking is immediate.
- The sign-in endpoint for SSO was left untouched: opening a connection is its own endpoint that takes the freshly issued user token plus the MCP server's proof.
- An endpoint that mints a new session from the caller's current token refuses a token bound to an MCP connection (its `msid` claim). Otherwise the hour-long, revocable token could be swapped for an ordinary 24-hour one that survives revoking the connection. The plain refresh and both impersonation endpoints refuse it, and any new endpoint of that kind needs the same refusal.
- The MCP server's one-minute service proof is checked with 30 seconds of clock leeway, so drift between the backend and MCP containers cannot refuse a renewal.
- On renewal, only the backend's 400, 403 and 422 end a connection. A 401 (proof refused: clock drift, a SECRET_KEY that differs), 404/405 (a backend older than the MCP server, as during a rolling upgrade), 429, a 5xx and a network error answer the AI tool 503 temporarily_unavailable with Retry-After. OAuth clients discard their refresh token on invalid_grant, so a wrong mapping recreates the very reconnect #1449 removed.
- The MCP server checks a refresh token's signature itself before relaying it. The backend sees every relayed call from one address, so its rate-limit bucket is shared by every connection, and an anonymous flood of junk tokens would otherwise starve every real renewal.
- A renewal refused because the account is disabled or its access expired also ends that connection and logs it, so enabling the account again never brings back a connection made before.
- Without SECRET_KEY the AI tool gets the plain SSO token for at most one hour and no refresh token, because that token is not bound to a connection and no Revoke reaches it.

## Tried and ruled out
- Sealed, self-contained tokens (encrypt the Turbo EA token into the refresh token, no state): survives a restart, but cannot detect a replayed token or revoke a connection, which RFC 9700 and the MCP authorization spec require of public clients. Dropped once the owner said security comes first.
- Fixing restarts only: leaves the 24-hour idle limit, which the owner hits with Claude.
- Storing a hash of each refresh token: more material in the database than a counter, and a retry inside the grace window could not be answered with the same token.
- A fallback path for an MCP server without SECRET_KEY or a backend older than the MCP server: it would be a second token scheme to test and secure. Instead sign-in still works and no refresh token is issued.
- Letting the MCP server mint user tokens itself because it holds SECRET_KEY: it would make the MCP server an identity issuer.
- Re-minting the token with its connection id kept, instead of refusing: no caller needs it. Only stdio mode uses the plain refresh, and with a password-login token.
- Boundary tests at ±25 / ±35 seconds on the real clock: they leave the leeway constant's ±1 mutants alive, and tests at exactly ±30 seconds on the real clock flake when a second ticks over.
- Binding a refresh token to the OAuth client id (RFC 6749 §6): a public client's id is public, so it adds little, and a client that omits client_id on refresh would lose its connection.
- Treating every non-2xx on renewal as a refusal: see above.

## Watch out
- The service-proof key context string exists twice, once in the backend and once in the MCP server, because the two packages share no code. A known-answer test on each side pins the same vector; change both together.
- A sign-in in flight still lives in MCP memory, so a restart during those few seconds fails that one attempt, and several MCP replicas need sticky routing for it.
- A database restored from a backup lags behind tokens already issued: such a token ends its connection (treated as a replay) and the user reconnects once.
- Connections made before this change live only in the old MCP server's memory and need one last reconnect after the upgrade.

In the code: backend/app/services/mcp_session_service.py, backend/app/api/v1/mcp_sessions.py, backend/app/core/security.py (verify_mcp_service_token, derive_key), backend/app/api/deps.py (msid check), backend/alembic/versions/181_mcp_sessions.py, backend settings MCP_SESSION_IDLE_DAYS / MCP_SESSION_MAX_DAYS, mcp-server/turbo_ea_mcp/oauth.py.
- PyJWT reads the time through `datetime.now(tz=timezone.utc)` inside `jwt.api_jwt`. Monkeypatch `jwt.api_jwt.datetime` with a subclass whose `now` returns a fixed moment, then use integer iat/exp. Expiry fails when `exp <= now - leeway`; issued-at fails when `iat > now + leeway`.

In the code: backend/app/api/v1/auth.py (_presented_claims, _refuse_mcp_connection_token, MCP_TOKEN_NOT_EXCHANGEABLE), backend/app/core/security.py (MCP_SERVICE_CLOCK_LEEWAY_SECONDS), backend/tests/core/test_security.py::TestMcpServiceTokenClockDrift, backend/tests/api/test_mcp_token_exchange.py.
- A pytest parametrize over `uuid.uuid4()` gives each xdist worker different test ids, and the whole CI run errors at collection ("Different tests were collected"). Use a fixed literal.
- The event stream binds `async_session` at import (`app.api.v1.events.async_session`), which the `patched_async_session` fixture does not cover; monkeypatch that name with `tests.seams.session_factory_for(db)`.

In the code: mcp-server/turbo_ea_mcp/api_client.py (refresh_mcp_session), mcp-server/turbo_ea_mcp/oauth.py (_handle_refresh, DEGRADED_ACCESS_TOKEN_SECONDS), backend/app/api/v1/mcp_sessions.py (refresh_mcp_session, REASON_ACCOUNT_BLOCKED), backend/tests/api/test_mcp_sessions.py.
