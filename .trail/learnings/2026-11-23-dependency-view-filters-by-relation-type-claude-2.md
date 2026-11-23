---
title: Dependency view filters by relation type inside the layered view only; deleting a card comment always takes its replies and every stored copy of its text
author: Claude
date: 2026-11-23
branch: claude/bold-shannon-k3caig
cost: { minutes: 8, tokens: 66622 }
id: l-07d05247
scope: repo
status: active
replaces: l-8fa14898
src: agent
touches:
  - frontend/src/features/reports/LdvRelationFilter.tsx
  - backend/app/api/v1/comments.py
  - backend/app/models/comment.py
  - frontend/src/features/cards/sections/CommentsTab.tsx
---

## Decided
- Discussion #1423: the relation type filter is a toolbar menu of the Layered Dependency View beside Card types, shared by every place the view is drawn. The owner left the report's tree and table unfiltered and kept the choice in the browser's shared view settings, not in saved reports.
- Hiding a relation type removes its lines and only the cards those lines disconnected from the centred card. Cards the Card types or end-of-life filter had already left without a line stay where they were.
- Discussion #1424: the API could already delete a card comment; only the button was missing. The server says per comment whether the caller may delete it.
- The owner chose, after review, that deleting a comment always deletes the replies under it, whoever wrote them. The confirmation and the manual say so.
- With the delete: a history entry without the text, removal of the in-app notifications quoting the comment, and of the text kept in the stored "comment added" event.
- A comment on a card the caller may not read answers "Comment not found" on every comment route.
- Discussion #1425 (portal filters on text, number, date and yes/no fields) was explored and set aside by the owner; nothing was built.

## Tried and ruled out
- Letting an author delete their own comment only while every reply is theirs: offered as the safer option, the owner declined.
- Keeping the replies and blanking the parent (a soft delete, as decisions do): offered, declined.
- Keeping every card reachable from the centre after the relation filter: it also removed cards another filter had stranded, so an unrelated tick made them vanish.
- A report-level relation filter saved with the report, an edit button, an MCP delete tool: not asked for.

## Watch out
- Before the fix, deleting a parent comment through the ORM set its replies' parent to null and they became top-level comments.
- A reply could be posted with a parent on another card; deleting then reached across cards.
- The erase step must be scoped by card: notifications had no index on their card column.
- No Docker in this container: start the installed Postgres 16 by hand on port 5433 with the test script's user and database to run the API tests.

In the code: frontend/src/features/reports/LdvRelationFilter.tsx, layeredDependencyLayout.ts (filterHiddenRelationTypes); backend/app/api/v1/comments.py (_load_comment_for_write, _erase_comment_copies, can.delete), backend/app/models/comment.py (replies cascade), frontend/src/features/cards/sections/CommentsTab.tsx.
