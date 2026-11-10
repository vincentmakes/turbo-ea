---
title: "An OpenAI-compatible provider that refuses an optional parameter is retried without it whatever its error looks like, and there is no setting for it"
author: Claude
date: 2026-11-10
branch: claude/jolly-goodall-w2z3cz
cost: { minutes: 1, tokens: 6574 }
id: l-590937f1
scope: repo
status: active
src: agent
touches:
  - backend/app/services/openai_chat.py
  - backend/app/services/ai_service.py
  - frontend/src/features/admin/AiAdmin.tsx
  - backend/tests/services/test_openai_chat.py
---

## Decided
Discussion #1372: LM Studio behind a Bionic gateway refuses JSON mode with HTTP 400 and a body whose `error` is a bare string, with no `param` or `code`. The existing retry only understood OpenAI's own error object, so every card suggestion failed while Test Connection passed.
The reporter proposed a "use JSON response format" setting. The maintainer chose automatic recovery instead: an admin should not have to diagnose a 400 and find a switch, and the next quirk would need another switch.
The rule is two-tier. An error that fills OpenAI's `error.param` is judged on that alone and only with a code that blames the parameter. Any other envelope (bare string, FastAPI 422 `detail`, an `errors` array, non-JSON text) is searched for the name of an optional parameter the payload carries, as a whole word; the first in a fixed order wins.
Test Connection for the OpenAI-compatible and Azure providers sends what a suggestion sends (low temperature, JSON mode) and returns `adjusted`, the parameters the provider refused, which the admin page names.

## Tried and ruled out
Searching the error body's keys as well as its values: a server that echoes the request back would then name every parameter, costing a wasted retry per parameter.
Letting the message text override a filled `error.param`: OpenAI's messages mention other parameters in passing (the "must contain the word json" refusal names `response_format` but is about `messages`).
Reusing TurboLens's JSON repair for the suggestion parser: `turbolens_ai` imports `ai_service`, so the import would be circular. The parser has its own small fallbacks.
A per-provider memory of the adjusted request: each call pays one fast 400 first, which is cheap enough.

## Watch out
A false match of the text rule costs one extra request, after which the provider's real error is shown as before. That bound depends on `tried` and on MAX_ADAPTATIONS; keep both.
The probe carries three optional parameters, which is why MAX_ADAPTATIONS is 3.
A renamed output cap is not reported in `adjusted`: it was still sent.
The OpenAI-compatible path always appends `/v1/chat/completions` to the base URL, requires `GET /v1/models` in Test Connection, sends only `Authorization: Bearer` and always sends a `system` message; a provider that differs on any of those is a separate problem from a refused parameter.
In a cloud session, `npm ci` needs npm 11 (`npx -y npm@11 ci`), and a hand-made Postgres cluster for the tests must be created UTF-8.

In the code:
- backend/app/services/openai_chat.py: `refused_param`, `_refusal_text`, `_adaptable`, `post_chat_traced`, `error_detail`, `MAX_ADAPTATIONS`
- backend/app/services/ai_service.py: `_parse_llm_content`, `_probe_chat_payload`, `_probe_openai_model`, the OpenAI and Azure branches of `check_provider_connection`
- frontend/src/features/admin/AiAdmin.tsx: `handleAiTest`, key `settings.ai.testSuccessAdjusted`
- backend/tests/services/test_openai_chat.py: `TestRefusedParam` holds the real refusal bodies
