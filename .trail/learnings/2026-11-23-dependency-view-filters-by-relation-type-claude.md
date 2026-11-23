---
title: "Dependency view filters by relation type inside the layered view only, and a deleted card comment takes its replies and every stored copy of its text with it"
author: Claude
date: 2026-11-23
branch: claude/bold-shannon-k3caig
cost: { minutes: 34, tokens: 260188 }
id: l-8fa14898
scope: repo
status: active
src: agent
touches:
  - backend/app/api/v1/comments.py
  - backend/app/models/comment.py
  - backend/tests/api/test_comments.py
  - backend/tests/services/test_publish_before_commit.py
  - docs/guide/card-details.md
  - frontend/src/features/cards/CardDetailContent.tsx
  - frontend/src/features/cards/sections/CommentsTab.test.tsx
  - frontend/src/features/cards/sections/CommentsTab.tsx
  - frontend/src/features/cards/sections/historyChanges.test.ts
  - frontend/src/features/cards/sections/historyChanges.ts
---

## Decided
- Discussion #1423: the relation type filter is a second toolbar menu of the Layered Dependency View, beside Card types, so the Dependencies report, a card's Dependencies section and TurboLens share it. The owner approved leaving the report's tree and table unfiltered, as Card types already does, and keeping the choice in the shared view settings in the browser, not in saved reports.
- Hiding a relation type removes its lines and then the cards it disconnected: with a centred card, everything no longer reachable from it; with no centre (TurboLens), only a card that had a line and has none left. The consumers pick the neighbourhood before the view filters, so without this step the neighbours stayed on the canvas with no line.
- The Reveal tools' parent/child line is not a relation type: never listed, never hidden.
- Discussion #1424: the API could already delete a card comment; only the button was missing. The server now says per comment whether the caller may delete it, so the tab needs neither a permission prop nor the user's id.
- Approved with it: a hard delete that takes the replies, a "Comment deleted" history entry without the text, removal of the notifications that quote the comment, and removal of the text kept in the stored "comment added" event.
- Editing or deleting a comment on a card the caller may not read answers "Comment not found", the same as an unknown id.

## Tried and ruled out
- A report-level relation filter saved with the report: the request compared it with the Card types funnel, which is view-level.
- An edit button, and an MCP tool to delete a comment: not asked for.
- Deciding in the browser who may delete (author id or the card's manage-comments flag): the tab has no user id, and the flag it was handed is optimistic until permissions load.

## Watch out
- Measured before the fix: deleting a parent comment through the ORM kept its replies and set their parent to null, so they became top-level comments. The foreign key's cascade never ran because the ORM nulled the loaded children first.
- A malformed comment id was an unhandled error (500) on edit and delete; it is now 404.
- The read-scope guard answers "Card not found" for a hidden card; on a comment route that sentence itself confirms the comment exists, so it is rewritten.
- This container has no running Docker, so the backend test script cannot start its database. Postgres 16 binaries are installed: a server started by hand on port 5433 with the script's user and database names runs the API tests.

In the code: frontend/src/features/reports/LdvRelationFilter.tsx, layeredDependencyLayout.ts (filterHiddenRelationTypes), ldvViewModel.ts (countByRelationType), ldvDisplaySettings.ts (hiddenRelationTypeKeys); backend/app/api/v1/comments.py (_load_comment_for_write, _erase_comment_copies, can.delete), backend/app/models/comment.py (replies cascade); frontend/src/features/cards/sections/CommentsTab.tsx. Test database by hand: initdb + pg_ctl -o '-p 5433', role and database turboea / turboea_test, then POSTGRES_HOST=localhost POSTGRES_PORT=5433 TEST_DB_REQUIRED=1 pytest.
