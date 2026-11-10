---
title: A query view shows the cards behind a match when you click a card type in its query string
author: Claude
date: 2026-11-10
branch: claude/confident-curie-tyo9qq
cost: { minutes: 187, tokens: 2699923 }
id: l-a74f1c35
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - VERSION
  - backend/app/api/v1/bookmarks.py
  - backend/app/api/v1/cards.py
  - backend/app/models/bookmark.py
  - backend/app/schemas/common.py
  - backend/app/services/card_query.py
  - backend/app/services/dashboard_defaults.py
  - backend/app/services/dashboard_service.py
  - backend/app/services/eol_query.py
---

## Decided
- The card type pill in the query string is the only control. There is no separate toggle and no section in the Columns tab. A pill is off until clicked, and the choice is saved with the view (`columns` entries `via:<line>:<hop path>`).
- Matches are asked for the rows loaded in the grid (`ids` in `POST /api/v1/cards/query/matches`), not recomputed from the query alone. So search, archived rows and other list filters can never make the matched columns disagree with the grid.
- The switched-on columns belong to the page (`viaSelection` in `InventoryPage.tsx`), never to the column picker. Stale `via:` filter, sort and width entries are stripped (`stripViaLayout`) whenever a key is not on.
- A row lists every matching card at that step of the chain. It does not say which card leads to which.

## Tried and ruled out
- A `listed` flag on a hop (or a top-level key) to make a view list another card of the chain. That is the same query written from that card. The flag would have given a pill three states and touched the query grammar, MCP, saved views, the dashboard widget and thirteen `startTypes` call sites.
- A matches endpoint that took only `{query}` with a 5,000-row cap. It could disagree with the grid and cut off silently.
- A "Matched via" section in the Columns tab. Two controls for one thing.
- Titling the column with the relation verb ("uses · IT Component"). It reads wrongly two hops away and collides with the relation column. The column is "{Type} · matched".

## Watch out
- Node keys are positional (`<line>:<hop path>`). Lines are numbered across `any_of` groups, and negated hops keep their index slot. Compute them on exactly the query object that is sent (`matchNodes`, `matchKeyAt`), or the backend answers for a different step.
- A `via:` id reused later by a different step would inherit a stored filter or sort unless it is stripped (`pruneViaKeys`, `stripViaLayout`).
- `.distinct()` and the relation-type condition in `relation_join` (`dashboard_query.py`) each have a dedicated test (a diamond path, two relation types on one card pair). Keep them.

In the code: `POST /api/v1/cards/query/matches` in `backend/app/api/v1/cards.py`, `backend/app/services/card_query_matches.py`, `relation_join` in `backend/app/services/dashboard_query.py`, `matchNodes` / `pruneViaKeys` / `matchKeyAt` in `frontend/src/features/inventory/querySet.ts`, `stripViaLayout` and `viaSelection` in `frontend/src/features/inventory/InventoryPage.tsx`.
