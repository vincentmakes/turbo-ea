---
title: "An MCP-authored query view stays editable in the web UI for its name, sharing, OData and layout only; the query and facets change through MCP, a copy saved fro…"
author: Claude
date: 2026-11-09
branch: claude/confident-curie-tyo9qq
cost: { minutes: 27, tokens: 160028 }
id: l-6f0141b0
scope: repo
status: active
src: agent
---

## Decided
- For a saved inventory view whose filter is a multi-hop query written through the MCP server, the web UI lets the owner rename it, share it, toggle its OData feed and update its layout (columns, column layout, grouping). The facets and the query itself change only through MCP. Reason: layout is the grid's business and changes often; the query is the view's meaning and has exactly one author, the assistant, so there is one editor and no half-edited state.
- "Save current view" while such a view is active creates a plain view without the query. Keeping "a query view is MCP-authored" strictly true beats letting a UI save create a second author of the query; the UI explains that the query is not copied.
- The query grammar (per hop: lifecycle phase, subtype, attributes by option key, approval status, nested hops up to three) holds metamodel keys only, never a card id or a tag id, so a view survives a workspace transfer and a reader who may not see a card never learns it exists from a stored id.

## Tried and ruled out
- Metadata-only UI edits (layout also via MCP): forces the assistant to reproduce a grid layout it cannot see.
- Fully read-only in the UI except delete: owners could not even rename or share what they asked the assistant to build.
- Copying the query into a view saved from the UI: the view would show the MCP banner while created through the web, two authors for one query.
- Tags or specific related cards in the grammar: both are ids, which break on transfer and would need a read-scope check on write.

## Watch out
- The UI detects a query view by the presence of the stored query, not by who created it, because the web UI never writes a query.
- A query view's PATCH from the UI must carry the view's stored facets with only the grouping keys replaced from the current grid, never the current facets, or the first rename silently overwrites the saved filters.

In the code:
- Grammar and compiler: `backend/app/services/card_query.py`; stored on `bookmarks.query` with `created_via` from `ProvenanceMixin`.
- UI behaviour: `InventoryFilterSidebar.tsx` (`handleSaveView` on a query view), `QueryPathStrip.tsx`, `viewApply.ts` (`isQueryView`).
