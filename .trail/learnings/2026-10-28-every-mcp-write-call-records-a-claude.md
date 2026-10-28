---
title: "Every MCP write call records a mutation batch, and records carry the channel that made them next to the person"
author: Claude
date: 2026-10-28
branch: feat/mcp-batches-and-record-provenance
cost: { minutes: 35, tokens: 256680 }
id: l-3cb60150
scope: repo
status: active
src: agent
touches:
  - mcp-server/turbo_ea_mcp/batches.py
  - mcp-server/turbo_ea_mcp/server.py
  - mcp-server/tests/test_safeguards.py
  - backend/app/api/v1/diagrams.py
  - backend/app/services/rollback_service.py
  - backend/app/services/derived_writes.py
  - backend/app/api/v1/mutation_batches.py
  - backend/app/models/event.py
  - backend/app/models/mutation_batch.py
  - backend/app/services/event_bus.py
---

## Decided
- Every MCP write tool call is one mutation-batch row, preview included. Previews of single-record tools (diagrams, BPMN import, ADR, SoAW, comments, lifecycle, sign) used to record nothing, and `create_diagram`, `import_bpmn`, `add_card_comment`, `sign_adr`, `transition_card_lifecycle` recorded nothing on commit either. The user chose the uniform rule so one guard test can enforce it on every current and future write tool.
- Diagram create/update get a real backend dry run (savepoint rollback, like the BPM diagram save) and publish `diagram.created` / `diagram.updated` / `diagram.deleted` events, so web-UI diagram writes become auditable too through the auto-batch. Rollback deletes an MCP-created diagram unless it was published since; updates and deletes are declined with a reason (no canvas snapshot).
- Provenance columns `created_via` / `updated_via` (web, mcp, api, ext, system) go on every record MCP can create: cards, diagrams, risks, ADRs, SoAWs, comments, BPM flow versions. The person stays in `created_by` / `updated_by`. One mixin with Python-side `default` / `onupdate` callables reading the request contextvars, so no write path needs code. The user chose all seven over cards + diagrams only.
- The "via MCP" marker shows in the card header, the inventory (columns + an Origin facet sent to the server), the History tab per event, the diagrams gallery, and each module's existing created-by surface. Nothing is shown for web-made records.

## Tried and ruled out
- Deriving the channel from a record's earliest event: ADR and SoAW creation publish no event, and the join is too costly for the inventory grid.
- Putting `card_ids` old/new inside a `diagram.updated` event's `changes`: the read-scope scrubber only strips top-level `*card_ids` keys and diagram events reach every dashboard reader, so hidden cards would leak. They go top-level as `added_card_ids` / `removed_card_ids`.
- Commits-only batches for single-record tools: cheaper audit log, but the guard test would need per-tool exceptions and a preview that touched the backend would leave no trace.

## Watch out
- A subagent spawned while plan mode was on reported itself blocked by plan mode after approval and did nothing; it worked only after the task was re-sent with "plan mode is OFF" stated plainly.
- The guard must allow GET calls before the batch opens (`import_bpmn` looks the card up first, `set_card_logos` reads first) and require the first WRITE to be the batch open.
- `derived_maintenance` must pin `updated_via` exactly as it pins `updated_at`, or every rescore re-stamps the channel.
- The workspace card applier builds rows from explicit kwargs: adding a Card column to `CARD_COLUMNS` exports it but drops it on import without the constructor kwarg.

In the code:
- Plan: /root/.claude/plans/when-creating-a-diagram-toasty-hoare.md (branch `feat/mcp-batches-and-record-provenance`)
- MCP wrapper `mcp-server/turbo_ea_mcp/batches.py`, tools in `mcp-server/turbo_ea_mcp/server.py`, guard `mcp-server/tests/test_safeguards.py::TestEveryWriteToolIsABatch`
- Backend `backend/app/api/v1/diagrams.py`, `backend/app/services/rollback_service.py`, new `backend/app/models/provenance.py`, migration `157_record_provenance.py`, `backend/app/services/derived_writes.py::pin_updated_at`, `workspace_io/exporter.py` CARD_COLUMNS + `applier.py` Card(...) kwarg
- Frontend `frontend/src/components/OriginChip.tsx`, flat `common.json` keys `origin.*`
