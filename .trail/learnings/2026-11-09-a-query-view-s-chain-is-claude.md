---
title: "A query view's chain is edited in the inventory's path strip or through MCP; created_via is only a badge, and tag ids are the one id the grammar carries, remap…"
author: Claude
date: 2026-11-09
branch: claude/confident-curie-tyo9qq
cost: { minutes: 39, tokens: 148805 }
id: l-b4a63bd5
scope: repo
status: active
replaces: l-6f0141b0
src: agent
touches:
  - backend/app/services/card_query.py
  - backend/app/services/workspace_io/remap.py
  - frontend/src/features/inventory/QueryPathStrip.tsx
  - mcp-server/turbo_ea_mcp/server.py
---

## Decided
- The web UI authors multi-hop queries: "New query view" in the Views tab opens the path strip above the grid in edit mode, and a pencil on a saved query view (owner or edit rights, with the manage-views permission) reopens it. The grid is the live preview. The MCP tools write the same grammar, so an assistant-created view is just a view with an MCP badge; nothing is MCP-only any more. This replaces the earlier rule that the query could change only through MCP.
- The builder is a single chain: one hop per card, any conditions per card, a "has no" toggle per hop, depth three. Branching stays possible through MCP and renders read-only.
- Tags are a hop condition and the one id the grammar carries: grouped by tag group, any tag within a group, every group must match. No "(empty)" for tags, because that would need a group id, which has no transfer map. On workspace transfer the view's query is rewritten like its filters: tag ids follow the tag map, unknown ids are dropped and counted as unresolved rather than left to refuse the whole view on open.
- The sidebar's metadata dialog still never sends the query; the strip saves it (a new view through the usual save dialog, an existing one with a direct update).

## Tried and ruled out
- Keeping queries MCP-only once a builder existed: two authors for one grammar is fine, two rules for who may edit is not.
- Storing tags as group id plus tag ids: group ids are matched by name on import and have no id map.
- Leaving an unresolved tag id in an imported query: the view would refuse to open with "unknown tag".

## Watch out
- Removing an English i18n key means deleting that line from all ten locale files in the same change, or the unused-key scan fails; the translate pass only adds keys.
- The Bookmarks transfer section now lists the query column as id-bearing; the pinned known-sections test and the id-free allowlist changed with it, which the Guard Ratchet flags for a maintainer label.
- A draft with no start type or an empty condition list is not sent to the server; the grid falls back to the ordinary filters rather than freezing.

In the code:
- Grammar and tags: `backend/app/services/card_query.py` (`CardWhere.tags`, `_without_tags`, `_tag_groups`); transfer: `rewrite_card_query_tags` in `backend/app/services/workspace_io/remap.py`.
- Builder: `frontend/src/features/inventory/QueryPathStrip.tsx` (edit mode), `QueryConditionPopover.tsx`, `queryDraft.ts`; page state `queryDraft` / `pendingSave` in `InventoryPage.tsx`; sidebar props `onStartQueryDraft`, `pendingSave`, `draftQuery`, `typesLocked`.
- MCP: `list_tag_groups` in `mcp-server/turbo_ea_mcp/server.py`.
