---
title: "A query view combines whole query lines, AND inside a group and OR between groups; branches hanging from a card were dropped"
author: Claude
date: 2026-11-10
branch: claude/confident-curie-tyo9qq-branching
cost: { minutes: 74, tokens: 1713918 }
id: l-2b860015
scope: repo
status: active
replaces: l-d284b732
src: agent
touches:
  - backend/app/api/v1/cards.py
  - backend/app/services/card_query.py
  - backend/app/services/workspace_io/remap.py
  - backend/tests/api/test_bookmarks.py
  - backend/tests/api/test_cards.py
  - backend/tests/services/test_card_query.py
  - backend/tests/services/test_seed_demo.py
  - backend/tests/services/test_workspace_io_id_remap.py
  - backend/tests/services/test_workspace_io_remap.py
  - backend/tests/services/test_workspace_io_roundtrip.py
---

## Decided
- A view holds a stack of complete query lines. Lines in a group are joined by AND (a card must match every line, so they share the start card type); groups are joined by OR (results are added, and a group may start from another card type, so one view can list several card types).
- Each line is the single-chain strip a plain query view already had and may wrap. A circled plus under each group asks AND or OR; an × removes a line. AND / OR read in capitals from one translation key pair.
- Grammar: a plain query, `all_of` (2+ queries of one start type) or `any_of` (2+ groups). A plain query is unchanged, so stored views and MCP calls keep working. Six lines, twelve relations over all lines, three deep per line.
- A view's stored card type is set only when it lists one type; otherwise the type filter holds every start type. The server derives both from the query.

## Tried and ruled out
- Branches hanging from a card (first as a column grid, then as lines joined by drawn connectors): they mixed an extra condition on one card with a second query whose results are added, and the second kind has no honest place to hang on the first line. The maintainer's own example ("Application uses IT Component" OR "Organization uses Application", listing both types) could not be drawn from a card.
- An OR inside a chain (`related_any`): it equals two lines, and one way to say OR is enough.
- Horizontal scrolling and connector routing to cope with wrapped lines: unnecessary once nothing connects one line to another.

## Watch out
- Two requirements on the same card in the middle of a line cannot be built in the builder; an assistant writes them through MCP as sibling hops, and the strip shows them inline.
- When an import cannot find the cards picked on a line's start card, the line lists every card of its type; inside an OR group that adds the whole type. Kept on purpose, pinned by a test, counted in the import report.
- While a query is sent, the request's `type` comes from the query alone (only when it has one start type); a leftover type filter beside a two-type query returns nothing.
- Lines in the builder need stable keys: with index keys, removing a line hands its open condition editor to the next one.

In the code: `backend/app/services/card_query.py` (`CardQueryAll`, `CardQueryAny`, `query_groups`, `start_types`, `_group_condition`, `view_fields_for_query`), `frontend/src/features/inventory/querySet.ts`, `QueryPathStrip.tsx` (`LineStack`, `AddLineButton`, `useLineIds`), `InventoryPage.tsx` (`pinnedTypes`, `pinStartTypes`).
