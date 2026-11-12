---
title: Draft step links are type-checked; MCP link base ignores a loopback value; mcp floor 1.22
author: Claude
date: 2026-11-12
branch: claude/beautiful-bell-1xycnr
cost: { minutes: 69, tokens: 213490 }
id: l-c0be1200
scope: repo
status: active
replaces: l-1124c7f5
src: agent
touches:
  - "backend/app/services/process_element_sync.py#validate_link_cards"
  - "backend/app/api/v1/bpm_workflow.py#update_draft_element_link"
  - "mcp-server/turbo_ea_mcp/config.py#public_app_url"
  - mcp-server/pyproject.toml
---

decided: PUT draft-elements checks every NEW link: normalise_draft_link_body (400 for a non-UUID or non-list orgs, ids rewritten canonical because approve and get_draft_elements compare canonical strings), then the existing read-scope 404, then validate_link_cards (404 missing/archived, 400 wrong type). Slot types are ELEMENT_LINK_CARD_TYPES = the seeded target_type_key of each slot's relation in ELEMENT_LINK_RELATION_MAP, plus Organization for organization_ids (what bpm.py update_element already checked and what calledProcess.ts LINK_KIND_TYPE offers); a services test pins it against seed.RELATIONS. validate_process_link now calls validate_link_cards, so a non-process card in the process slot is a 400 on BOTH routes (was 404). Values the step already holds (stored_link_ids) and hidden links kept for the caller are not re-checked: the modeler re-sends the whole org list, and a draft linking a card archived since must stay editable; approval still drops stale links with a warning. ruled out: archived -> 400 (validate_process_link already answered 404 for archived and missing). watch out: the published element table (bpm.py update_element) still does not type-check application/data_object/it_component. MCP: TURBO_EA_PUBLIC_URL on a loopback host (localhost, 127.0.0.1, [::1]; .env.example ships http://localhost for nginx) gives way to MCP_PUBLIC_URL's origin when that is a real host. mcp floor is 1.22.0, not 1.10.0: mcp 1.10-1.21 import pydantic._internal._typing_extra.eval_type_backport, which pydantic 2.14.0 removed, and their own pins allow 2.14, so a fresh install breaks; 1.9.x lacks mcp.server.transport_security. Tested 1.22.0 on pydantic 2.11.0 and 2.14.0, and 1.30.0.
