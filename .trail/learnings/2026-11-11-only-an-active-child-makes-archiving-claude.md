---
title: Only an active child makes archiving or deleting a card ask for a child strategy; archived children stay put on archive and are detached on delete
author: Claude
date: 2026-11-11
branch: claude/epic-ritchie-0kjhe7
cost: { minutes: 11, tokens: 175372 }
id: l-516b7741
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
Issue #1382: a card whose children were all archived could not be archived. The dialog lists only active children, so it offered no strategy, while the server refused for children of any status. The rule is now: a strategy is required only when the card has an active child. On archive, archived children are left under the parent, so restoring both brings the hierarchy back. On hard delete they are detached to the top level, never deleted, because nobody was asked about them. The dialog also shows the strategy choices whenever the server answers 409, which covers active children the user may not view.

## Tried and ruled out
Making the impact endpoint count archived children so the dialog would offer strategies: it would ask the user a question about cards they already archived, and "cascade" on a delete would then remove archived cards the dialog never listed.
Returning a "strategy required" flag from the impact endpoint for hidden children: it tells the caller that cards they may not read exist before they act. Reacting to the 409 the server already sends adds no new disclosure.

## Watch out
The pytest failure trail saw was the deliberate run of the new tests against the unfixed code, not a real break.
In the dialog's test file an earlier test queues a `mockResolvedValueOnce` on `api.post` it never consumes, and `vi.clearAllMocks()` does not drop queued once-values, so a later test's first post gets that leftover. Call `mockReset()` on the mock before queuing a rejection.
Docker does not run in the cloud container, so `./scripts/test.sh` stops. A local PostgreSQL 16 is installed: init a data directory under `/var/lib/postgresql` as the postgres user (the scratchpad is not reachable by that user), start it on port 5432, create role and database `turboea` / `turboea_test`, then run pytest from `backend/` in its venv.

In the code:
- `backend/app/services/card_lifecycle.py`: `active_children()` next to `direct_children()` (which still returns every status so disconnect and reparent tidy archived rows).
- `backend/app/api/v1/cards.py`: the four 409 `children_present` checks; `detach_strategy` in `delete_card` and bulk delete (the `cards.parent_id` self-FK has no ON DELETE).
- `backend/app/services/extensions/data_service.py`: `archive_card`.
- `frontend/src/features/cards/ArchiveDeleteDialog.tsx`: `strategyRequired`.
- Tests: `TestArchivedChildrenNeedNoStrategy` in `backend/tests/api/test_cards_archive_delete.py` and `test_cards_bulk_archive_delete.py`.
