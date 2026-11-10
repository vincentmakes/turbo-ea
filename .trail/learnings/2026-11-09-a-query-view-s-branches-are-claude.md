---
title: "A query view's branches are stacked path lines joined by a drawn AND / OR connector; only the bottom line offers pluses"
author: Claude
date: 2026-11-09
branch: claude/confident-curie-tyo9qq-branching
cost: { minutes: 53, tokens: 882751 }
id: l-d284b732
scope: repo
status: active
replaces: l-48f9d117
src: agent
touches:
  - CHANGELOG.md
  - VERSION
  - backend/app/api/v1/cards.py
  - backend/app/services/card_query.py
  - backend/app/services/workspace_io/remap.py
  - backend/tests/api/test_bookmarks.py
  - backend/tests/api/test_cards.py
  - backend/tests/services/test_card_query.py
  - backend/tests/services/test_seed_demo.py
  - backend/tests/services/test_workspace_io_id_remap.py
---

## Decided
- Each branch of a query view is its own wrapping line of chips, like the main line, stacked below it. A connector leaves the arrow that follows the card the branch hangs from (a dot under that arrow), drops, and turns into the new line, whose first chip is a filled AND or OR badge in capitals. The origin card is never repeated and never named in words.
- Only the bottom line offers circled pluses: one under each of its cards that already has a relation (it asks AND or OR, then the relation), and one under its AND / OR badge that adds another branch from the same point with the same operator, so "A OR B OR C" is three lines. Removing the bottom line hands the pluses to the line above.
- The grammar is unchanged: `related` for AND, `related_any` for OR, and an OR group left with one hop folds into `related`, survivor first.

## Tried and ruled out
- A grid with one column per depth and each card's conditions stacked in its cell: the user rejected it on the PR screenshot ("stacking everything into columns is really what I didn't want").
- Starting a branch line with a faded copy of the origin card, or a caption naming it: the user wanted the start point drawn.
- Dropping the connector from the card pill: the user wanted it to leave the arrow between the hops. The plus stays under the pill.
- "And also…" / "Or…" as menu labels: the operator reads AND / OR in capitals everywhere, from one translation key pair.
- Pluses on every line without a branch: the user wanted a single stack, so only the last line has them.

## Watch out
- Connector positions are measured from the DOM. They must be re-measured when the icon font finishes loading (the arrow is wide ligature text before that) and on resize; a connector ignores the boxes holding its own arrow and its own badge when it looks for a clear route.
- A branch a user builds always takes the bottom of the stack. A query an assistant writes through MCP may branch from several cards; every line shows and can be edited, but the pluses still sit on the last line only.

In the code: `frontend/src/features/inventory/QueryPathStrip.tsx` (`QueryLines`, `QueryLine`, `BranchButton`, the sibling plus), `branchConnector.ts` (routing), `queryDraft.ts` (`rows`, `addBranch`, `canBranch`), i18n keys `queryView.connectiveAnd` / `connectiveOr` / `addBranchAnd` / `addBranchOr`.
