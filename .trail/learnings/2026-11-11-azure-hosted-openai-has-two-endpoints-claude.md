---
title: Azure Hosted OpenAI has two endpoints and the Provider URL decides which one is called; an API version is only sent to the older one
author: Claude
date: 2026-11-11
branch: claude/jolly-goodall-w2z3cz
cost: { minutes: 67, tokens: 803825 }
id: l-b5b511fb
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - VERSION
  - backend/app/api/v1/cards.py
  - backend/app/services/card_lifecycle.py
  - backend/app/services/extensions/data_service.py
  - backend/tests/api/test_cards_archive_delete.py
  - backend/tests/api/test_cards_bulk_archive_delete.py
  - backend/tests/services/test_extension_card_write_bridge.py
  - docs/api/openapi.json
  - frontend/src/features/cards/ArchiveDeleteDialog.test.tsx
---

## Decided
Issue #1386: an admin pasted the endpoint the Azure portal shows for newer deployments, `https://<resource>.openai.azure.com/openai/v1/`, and every call was a 404, because the deployment path was appended to whatever was entered.
Azure serves chat on two paths. The deployment API names the deployment in the URL and requires a dated `api-version`. The v1 API takes the deployment name as the body's `model` and takes no dated `api-version`; Microsoft's docs say a dated one is rejected.
The entered URL alone decides: ending in `/openai/v1` means the v1 API, anything else the deployment API. There is no separate setting, for the same reason as the refused-parameter retry: the admin should not have to know the difference.
A trailing `/openai` or a deployment's whole target URI is cut back to the resource root; a path in front of `/openai` is kept, because a gateway may sit there.
The API Version field is switched off in the admin page for a v1 URL. The reporter had typed the model's version (`2025-08-07` for GPT-5) into it, so the hint now says it is the version of the API, not of the model.
A 404 in Test Connection is only reported as a missing deployment when Azure's error code is `DeploymentNotFound`; otherwise it names the path called and what to check, since a wrong path and an unknown API version both read "Resource not found".

## Tried and ruled out
Telling the reporter to use the resource endpoint and leaving the code alone: the portal hands out the v1 URL, so the next admin pastes it too.
Sending the key as `Authorization: Bearer` on the v1 path, as the OpenAI client does: the `api-key` header is kept on both paths so nothing changes for existing installs.
A regex lookbehind in the frontend rule: older Safari cannot parse one, and an unparsable regex breaks the whole chunk.

## Watch out
None of this was run against a real Azure resource. The v1 behaviour comes from Microsoft's documentation, and `api-key` being accepted on the v1 path from a third-party SDK's documentation.
The default API version `2025-01-01` is not in Microsoft's published list (latest GA `2024-10-21`; the 2025 ones end in `-preview`). It was left alone because it could not be tested.
The frontend rule and the backend rule are two copies of one pattern, kept in step by mirrored test cases.

In the code:
- backend/app/services/azure_openai.py: `chat_target`, `ChatTarget`, `not_found_detail`
- backend/app/services/ai_service.py: `_call_azure_openai`, the Azure branch of `check_provider_connection`
- backend/app/services/turbolens_ai.py: the `azure` branch of `call_ai`
- backend/app/services/openai_chat.py: `error_code`
- frontend/src/features/admin/aiProviderUi.ts: `azureUsesV1`; AiAdmin.tsx: the API Version field
- backend/tests/services/test_azure_openai.py and aiProviderUi.test.ts hold the mirrored URL cases
