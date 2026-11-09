---
title: "A query view branches with an OR group beside the AND hops; the plus under a card only branches, the row chip continues the chain"
author: Claude
date: 2026-11-09
branch: claude/confident-curie-tyo9qq-branching
cost: { minutes: 100, tokens: 470714 }
id: l-48f9d117
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - backend/app/api/v1/reports.py
  - backend/app/services/card_query.py
  - backend/app/services/data_quality_bands.py
  - backend/tests/api/test_bookmarks.py
  - backend/tests/api/test_cards.py
  - backend/tests/services/test_card_query.py
  - backend/tests/services/test_data_quality_bands.py
  - docs/admin/mcp.ar.md
  - docs/admin/mcp.da.md
---

## Decided
- A node in a card query holds two hop lists: `related` (every hop must exist, as before) and `related_any` (at least one must exist). A node matches when all AND hops exist and, when an OR group is present, at least one OR hop exists: `h1 and h2 and (h3 or h4)`. `(A or B) and (C or D)` under one card is deliberately not expressible.
- In the builder the circled plus under a card is only for branches and always asks "And also…" / "Or…"; a card with no hop yet shows no plus, the "+ relation" chip at the row's end adds the first hop (the user chose to keep both controls). The first "Or" under a card moves that card's existing continuation hop into the OR group with the new branch, so "or" reads as "either the row above or this branch".
- An OR group left with one hop folds into `related`, survivor first, so the row above keeps it as its continuation. One helper in the frontend (`normalizeHops`) and the transfer rewrite in the backend apply the same rule and position.
- The strip is a CSS grid, one column per depth and one row per branch, in view mode too, so a branching query an assistant wrote through MCP reads the same way as one built in the UI. Branch rows come right after the row they hang from, deepest node first, so a row's parent column is always the nearest row above that holds that column.

## Tried and ruled out
- A plain first hop from the plus (no question when the card has no hop): two controls would do the same job; the user wanted the plus to be the branch control only.
- Emitting branch rows in left-to-right node order: it would put a deeper card's "or" row below a shallower card's "and" row whose column holds a different card, making the corner marker ambiguous.
- An English default for the "or" word in the Views-list path text: every caller passes the translated word.

## Watch out
- `or_needs_two` is a structural code (before metamodel resolution): a saved `related_any` needs two hops. The UI never produces a one-hop group, but a view loaded with one shows that error on save.
- Caps count both lists: 10 per list, 12 per tree, depth 3 through an OR hop too; the plus disappears when a cap is reached.
- The grid scrolls sideways on narrow screens instead of wrapping; the header row (Save, Cancel, pencil, ×) sits outside the scrolling container so it never scrolls away.

In the code: `backend/app/services/card_query.py` (`related_any`, `ResolvedNode.any_hops`, `_node_conditions`, `or_needs_two`), `backend/app/services/workspace_io/remap.py` (`_rewrite_hops`, fold), `frontend/src/features/inventory/queryDraft.ts` (`rows`, `addBranch`, `canBranch`, `canAppend`, `normalizeHops`), `QueryPathStrip.tsx` (`QueryGrid`, `BranchButton`), `queryPath.ts` (`compactPath` with `or`).
