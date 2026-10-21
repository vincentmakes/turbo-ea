---
title: "MCP confirm token (#1302): the gate lives at batch open, and a helper extracted from a tool needs new tests"
author: Claude
date: 2026-10-21
branch: fix/1302-mcp-confirm-token
cost: { minutes: 47, tokens: 623639 }
touches:
  - mcp-server/tests/test_write_tools_logos.py
  - CHANGELOG.md
  - CLAUDE.md
  - VERSION
  - backend/app/api/v1/mutation_batches.py
  - backend/app/schemas/mutation_batch.py
  - backend/app/services/mutation_batch_service.py
  - backend/tests/api/test_mutation_batches.py
  - backend/tests/services/test_mutation_batch_service.py
  - docs/admin/mcp.ar.md
---

## Decided
- Closing a mutation batch never checks the confirm token; the dry-run of any size closes like any other batch. The backend verifies the token when the REAL batch opens (`POST /mutation-batches`, `confirm_token` in the body) through `resolve_confirm_token` in `services/mutation_batch_service.py`: a dry-run of the same tool_name, by the same actor, under 15 minutes old, not yet used. Single use is a `confirmed_batch_id` stamp on the issuing dry-run's `summary`, written under `with_for_update()`; `close_summary` keeps the stamp when the preview is closed afterwards. The real batch stores the token in its own `confirm_token` column only as the audit cross-reference. No migration.
- Every bulk MCP write tool opens a dry-run batch on its preview, because that is how it is issued a token: `create_cards_bulk`, `update_cards_bulk`, `archive_cards`, `upsert_relations_bulk` (which never had a mutation batch before), `assign_stakeholders`, `create_risks`, `update_risks`, `set_card_logos`, `clear_card_logos`. The preview returns `batch_id` + `confirm_token` via `_preview_fields`. A new bulk tool must do the same or its commits above 20 rows can never succeed.
- `MCP_BATCH_CONFIRMATION_THRESHOLD` and `MCP_REQUIRE_DRYRUN_FIRST` only tighten or relax the MCP-edge error; the backend floor of 20 applies regardless (the config comments already called it a floor). Documented in docs/admin/mcp.md and its 9 locales, no backend setting added.
- The audit log reads any `dry_run` batch as Dry run, closed or not (`statusOf`).

## Tried and ruled out
- Detecting token reuse by searching for a second real batch carrying the token: a statement that waited on a row lock never sees rows the other transaction inserted, so two concurrent commits could both pass. Stamping the locked issuing row is what serializes them.
- Extending only the four tools the plan first named: `set_card_logos` and `clear_card_logos` already had the parameter and gate but their dry-run returned before any batch, so no token could ever be issued to them; six tools needed the change, not four.

## Watch out
- Extracting a block out of a decorated MCP tool into a plain function (here `_clear_logos_preview`) makes it visible to mutmut for the first time, and the PR job's cached stats link a NEW function only to NEW tests: pre-existing tests that reach it are not selected, so their assertions kill nothing. #1303 scored 49.3% against the 60% floor that way. Add new tests that call the helper directly and compare its whole return value (keys, status strings, the token it was built with).
- `mcp-server/` has no ruff config and CI lints `backend/` only. Running ruff with the backend config on an mcp-server file reformats pre-existing lines (88 vs 100 columns) into pure churn; keep the file's existing formatting.
- A subagent spawned while plan mode was on reported itself still in plan mode after the plan was approved and did nothing; re-send the task stating plainly that plan mode is off.
- The reporter's source references and suggested regression list in #1302 were exactly right; a detailed MCP bug report with file links is worth validating line by line before planning.
