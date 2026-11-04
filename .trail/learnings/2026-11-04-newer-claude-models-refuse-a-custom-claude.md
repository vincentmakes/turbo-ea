---
title: Newer Claude models refuse a custom temperature; the Anthropic call drops it on refusal and Test Connection sends the same request
author: Claude
date: 2026-11-04
branch: claude/fix-anthropic-temperature-1358
cost: { minutes: 11, tokens: 160319 }
id: l-57c41c2d
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - VERSION
  - backend/app/api/v1/ai_suggest.py
  - backend/app/services/ai_service.py
  - backend/tests/api/test_ai_suggest.py
  - backend/tests/services/test_ai_service.py
  - backend/tests/services/test_ai_service_insights.py
  - docs/admin/ai.ar.md
  - docs/admin/ai.da.md
  - docs/admin/ai.de.md
---

## Decided
Newer Claude models (the 5.x family, e.g. claude-haiku-5-5) answer `temperature` with HTTP 400 `invalid_request_error: "`temperature` is deprecated for this model."` (#1358). The Anthropic call keeps sending temperature 0.1 and re-posts once without it on that refusal, so older models (Sonnet 4.6) keep identical output. This mirrors the #1319 OpenAI rule: correct the payload from the provider's error, never pick it by model name.
Test Connection must send the same sampling parameters as a real call; a probe without them passed while every real call failed.
A provider that answers with an error status is reachable: the AI routes show its reason, except 401/403 (OpenAI's 401 text echoes part of the key, and members see this message) and 402/429.

## Tried and ruled out
Matching Anthropic's refusal on an `error.param` field like OpenAI: Anthropic names no param, so the match is on the message text containing "temperature", limited to a 400 and to payloads that carry temperature, and retried once only.

## Watch out
The old connection-error tests mocked `client.post` to raise `HTTPStatusError`; a real httpx client returns the response and only `raise_for_status()` raises. Mock with real `httpx.Response(code, json=..., request=...)` objects or the status branches are never exercised.
The pytest failure before the fix was the intended regression run, not a flake.
Bedrock card suggestions still send temperature 0.1 through Converse; a newer Claude there may refuse it the same way (unverified, follow-up).

In the code:
- backend/app/services/ai_service.py: `_anthropic_refused_temperature`, `_post_anthropic`, `_call_anthropic`, the Anthropic branch of `check_provider_connection`
- backend/app/api/v1/ai_suggest.py: `provider_failure_detail`, `_log_provider_failure` (plain functions so mutmut mutates them; route handlers are decorated)
