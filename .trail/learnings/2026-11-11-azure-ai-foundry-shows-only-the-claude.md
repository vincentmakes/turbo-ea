---
title: "Azure AI Foundry shows only the v1 endpoint and no API version, so the hints send an admin there instead of to the portal"
author: Claude
date: 2026-11-11
branch: claude/jolly-goodall-w2z3cz
cost: { minutes: 23, tokens: 94090 }
id: l-9df7a937
scope: repo
status: active
src: agent
touches:
  - backend/tests/services/test_azure_openai.py
  - backend/tests/services/test_turbolens_ai.py
  - frontend/src/features/admin/aiProviderUi.test.ts
  - CHANGELOG.md
  - VERSION
  - backend/app/services/ai_service.py
  - backend/app/services/azure_openai.py
  - backend/app/services/openai_chat.py
  - backend/app/services/turbolens_ai.py
  - backend/tests/api/test_settings.py
---

## Decided
The reporter of #1386 created their deployment in Azure AI Foundry. Its Target URI shows only the endpoint ending in `/openai/v1/`, and no API version appears anywhere in the portal. Telling an admin to "check the Azure portal for supported versions" therefore sends a Foundry user nowhere.
The API Version hint, the 404 message of the connection test and the admin guide now say the same thing: if the portal shows only an endpoint ending in `/openai/v1/`, use that as the Provider URL, because it needs no API version.

## Watch out
What a real Azure resource has confirmed so far, from the reporter on v2.186.5: the resource endpoint without `/openai/v1/` works with API version `2025-03-01-preview` for a gpt-5 deployment, found by trying versions. The v1 path as Turbo EA calls it (key in the `api-key` header) has still not been run against a real resource.
Whether the default API version `2025-01-01` is accepted is still unknown; the reporter did not say which versions failed.

In the code:
- backend/app/services/azure_openai.py: `not_found_detail`
- frontend/src/i18n/locales/en/admin.json: `settings.ai.apiVersionHelper`
- docs/admin/ai.md: "Azure Hosted OpenAI endpoints" and the 404 troubleshooting row
