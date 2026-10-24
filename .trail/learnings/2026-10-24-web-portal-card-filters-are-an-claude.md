---
title: "Web portal card filters are an admin preset, server-enforced, card-list portals only (PR #1321)"
author: Claude
date: 2026-10-24
branch: claude/openai-gpt6-chat-completions
cost: { minutes: 101, tokens: 1275615 }
id: l-fa6a4a18
scope: repo
status: active
src: agent
touches:
  - backend/app/api/v1/web_portals.py
  - backend/app/services/audit_changes.py
  - backend/app/services/portal_card_filters.py
  - backend/tests/api/test_web_portals.py
  - backend/tests/services/test_ai_service.py
  - backend/tests/services/test_audit_changes.py
  - backend/tests/services/test_openai_chat.py
  - backend/tests/services/test_portal_card_filters.py
  - backend/tests/services/test_turbolens_ai.py
  - backend/tests/services/test_workspace_io_remap.py
---

## Decided
- Card-list web portals (`view == "cards"`) take the Application Portfolio filter set as an **admin preset**, stored as `filters.card_filters` in the exact `CardFilterValue` shape (`frontend/src/features/reports/cardFilters.ts`). The dialog renders the shared `CardFilterSection`; options come from `GET /web-portals/filter-options` (gated on `web_portals.manage`, not `reports.portfolio`).
- The preset is applied **server-side** as SQL in `backend/app/services/portal_card_filters.py`, mirroring `matchesStaticFilters` row by row, because the public card list is paginated and a visitor must never widen it. `GET /web-portals/public/{slug}` strips `card_filters` (it names related card ids).
- Legacy `subtypes` / `tag_ids` keep applying exactly as before until a portal is next saved; `approval_statuses` applies in both shapes and survives a dialog save.

## Tried and ruled out
- Rebuilding the **visitor** filter bar on the shared section: doubles the work and touches the account-less viewer; the user chose admin preset only.
- Extending PPM / BPM **board** portals: they keep their own `PortfolioScope` / `ProcessScope` three-key parsers and Subtypes + Tags pickers; `_normalise_filters` drops `card_filters` on a board.
- Matching in Python over a full card payload per request: too costly per public page load.

## Watch out
- Tags change meaning on the first resave of a legacy portal: legacy = any tag across groups, card filters = OR within a group, AND across groups. The dialog warns (`legacyTagsSpanGroups`) and the audit log records `portal_filter.changed` `tag_matching`.
- Keep the SQL in parity with the report: tag groups whose `restrict_to_types` excludes the card type are ignored; hidden relation types read as card-type keys; card filters that narrow nothing fall back to the legacy keys.
- `workspace_io/remap.py` has a 96% mutation floor: test portal id rewrites with a **chained** id map, or "walked twice" mutants survive.
