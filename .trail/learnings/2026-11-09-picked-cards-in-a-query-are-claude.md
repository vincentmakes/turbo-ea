---
title: "Picked cards in a query are checked only when a view is saved, never when it is read, so a hidden card answers like a missing one; a negated hop whose picks va…"
author: Claude
date: 2026-11-09
branch: claude/confident-curie-tyo9qq
cost: { minutes: 88, tokens: 176831 }
id: l-c4caf9bc
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - README.md
  - backend/app/api/v1/cards.py
  - backend/app/services/card_query.py
  - backend/app/services/portal_card_filters.py
  - backend/app/services/workspace_io/remap.py
  - backend/app/services/workspace_io/sections.py
  - backend/tests/api/test_bookmarks.py
  - backend/tests/api/test_cards.py
  - backend/tests/conftest.py
---

## Decided
- A query node can name specific cards, on the start card and at every hop, with an "include sub-cards" switch that widens each pick to its descendants through the parent link. Card ids and tag ids are the only ids the grammar carries; both follow the workspace transfer's id maps.
- The existence, type and read-scope checks on picked cards run only when a view is saved (the writer's scope). Reading a view checks nothing: an unknown, wrong-type or hidden pick simply matches no row. Reason: answering 400 for a missing card but 200 for a hidden one would let a reader tell a hidden card exists. Saving refuses a pick the writer cannot read, but a collaborator editing a shared view keeps the owner's existing picks (they are trusted; only newly added ids are checked against the editor's scope).
- "Include sub-cards" is refused on a card type without a hierarchy, in the backend, so a flag set through MCP cannot be invisible in the UI (which only shows the switch for hierarchical types).
- On import, when every pick of a negated hop ("has no card X") is unknown on the target, the whole hop is removed rather than left as "has no card of that type at all": a dropped pick must widen a view, never narrow it silently. A positive hop just loses the condition.

## Tried and ruled out
- Checking picks with the reader's scope on every read: a shared view would fail to open for a reader who cannot see one of the owner's picks.
- Checking existence on read without scope: that is the oracle above.

## Watch out
- The card names on the strip come from one fetch per strip mount through the shared by-ids fetcher; withheld ids render as "(hidden card)", never as a name.
- Nested dialog: the card picker opens from inside the condition popover on purpose; closing the popover first would delete the still-empty condition.

In the code:
- `backend/app/services/card_query.py` (`_card_ids`, `_CardCheck`, `trusted_card_ids`, `descendants_without_hierarchy`); `backend/app/api/v1/bookmarks.py` `_checked_query`; `rewrite_card_query_ids` in `workspace_io/remap.py`.
- Frontend: `useCardNames.ts`, `CardsPanel` in `QueryConditionPopover.tsx`, `cardsChipLabel` / `cardNameLabel` in `queryDraft.ts`.
