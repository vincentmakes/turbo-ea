---
title: Reauthorize both roles before deferred writes under impersonation
author: Tom
date: 2026-11-22
branch: fix/batch-workspace-permissions
id: l-a020fd0b
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - VERSION
  - backend/app/api/v1/mutation_batches.py
  - backend/app/api/v1/workspace.py
  - backend/app/services/card_read_scope.py
  - backend/tests/api/test_mutation_batches.py
  - backend/tests/api/test_workspace_transfer_jobs.py
  - backend/tests/services/test_card_read_scope_payloads.py
---

## Decided
Before a queued write, reload the actor and confirm the real role can still impersonate, then check the effective role’s current permission.

## Tried and ruled out
A check of the effective role alone cannot see revocation on the real role.

## Watch out
FastAPI BackgroundTasks can retain request ContextVars.
